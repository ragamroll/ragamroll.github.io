// Sounding a RagaM-Roll: the voice, the drone and the tala strums.
//
// Separate from the component on purpose — the roll draws, this sounds, and an app
// can take one without the other. The app that wants both keeps its own transport,
// because only it knows what time it is; this schedules into an AudioContext and
// hands back the moment playback starts.
//
// The gamaka is what makes it worth sharing rather than rewriting per page. A note's
// pitch follows the SAME interpolator the roll draws with, sampled at the same rate,
// so the curve you see is the pitch you hear. Two copies of that interpolation is
// exactly the bug this codebase already had once.
//
// Everything routes through one session gain, so starting again cuts the previous
// playback instead of stacking melodies over each other.
import { sampleCurve, GAMAKA_SAMPLES } from './gamaka-inline.js';
import { EDO } from './shruti.js';

// Drone: mandra Sa, Sa, Pa — 31 is the 53-EDO fifth.
const DRONE_STEPS = [-EDO, 0, 31];
const STRUM_STEPS = [0, 31];

export function createRollAudio(actx, freqOf) {
  let session = null;
  const mix = { drone: 0.5, tala: 0.5 };

  const bus = (name, dest, level) => {
    if (!session) return dest;
    if (!session[name]) { const g = actx.createGain(); g.gain.value = level; g.connect(dest); session[name] = g; }
    return session[name];
  };

  function stop() {
    if (!session) return;
    const now = actx.currentTime, s = session;
    s.gain.gain.cancelScheduledValues(now);
    s.gain.gain.setTargetAtTime(0.0001, now, 0.02);
    // Let the fade finish before tearing the graph down, or stopping mid-ramp clicks.
    setTimeout(() => {
      for (const o of s.oscs) { try { o.stop(); o.disconnect(); } catch (e) { /* already stopped */ } }
      for (const b of ['dBus', 'tBus']) { try { s[b] && s[b].disconnect(); } catch (e) { /* not created */ } }
      try { s.gain.disconnect(); } catch (e) { /* already gone */ }
    }, 90);
    session = null;
  }

  function open() {
    stop();
    const g = actx.createGain(); g.gain.value = 1; g.connect(actx.destination);
    session = { gain: g, oscs: [] };
    return g;
  }

  function drone(dest, now, dur) {
    const b = bus('dBus', dest, mix.drone), pk = 0.09;
    for (const st of DRONE_STEPS) {
      const o = actx.createOscillator(); o.type = 'sine'; o.frequency.value = freqOf(st);
      const g = actx.createGain();
      g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(pk, now + 0.12);
      g.gain.setValueAtTime(pk, now + dur - 0.2); g.gain.linearRampToValueAtTime(0, now + dur);
      o.connect(g); g.connect(b); o.start(now); o.stop(now + dur + 0.05);
      if (session) session.oscs.push(o);
    }
  }

  // A veena-like pluck on an accent slot.
  function strum(b, when) {
    const pk = 0.24;
    for (const st of STRUM_STEPS) {
      const o = actx.createOscillator(); o.type = 'triangle'; o.frequency.value = freqOf(st);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(pk, when + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0008, when + 0.34);
      o.connect(g); g.connect(b); o.start(when); o.stop(when + 0.4);
      if (session) session.oscs.push(o);
    }
  }

  // Strums are scheduled whatever the tala level is — 0 only means the bus is
  // silent, so raising the slider mid-play brings them in rather than finding
  // nothing there.
  function talaStrums(dest, from, to, start, spu, tala) {
    if (!tala || !tala.measure || !tala.accents.length) return;
    const b = bus('tBus', dest, mix.tala);
    for (let cyc = 0; cyc < to; cyc += tala.measure)
      for (const acc of tala.accents) {
        const u = cyc + (acc - 1);
        if (u < from - 1e-6 || u >= to) continue;
        strum(b, start + (u - from) * spu);
      }
  }

  // One note, sounding the sub-range [uStart,uEnd] of its own gamaka — a note clipped
  // by a segment boundary sounds its portion of the curve, not the whole shape
  // squeezed into less time.
  function voice(dest, when, dur, nn, uStart = 0, uEnd = 1) {
    const o = actx.createOscillator(); o.type = 'triangle';
    // Attack and release scale with the note, so a rapid note never has its hold
    // point land before the attack peak — that clicked on fast passages.
    const atk = Math.min(0.012, dur * 0.35), rel = Math.min(0.035, dur * 0.45);
    const hold = Math.max(when + atk, when + dur - rel);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(0.2, when + atk);
    g.gain.setValueAtTime(0.2, hold); g.gain.linearRampToValueAtTime(0.0001, when + dur);
    if (nn.curve && nn.curve.length >= 2) {
      const N = GAMAKA_SAMPLES, arr = new Float32Array(N);
      for (let k = 0; k < N; k++) arr[k] = freqOf(sampleCurve(nn.curve, uStart + (uEnd - uStart) * k / (N - 1)));
      o.frequency.setValueCurveAtTime(arr, when, dur);
    } else o.frequency.setValueAtTime(freqOf(nn.step), when);
    o.connect(g); g.connect(dest); o.start(when); o.stop(when + dur + 0.05);
    if (session) session.oscs.push(o);
  }

  return {
    stop,
    isPlaying: () => session != null,

    // Live mix. Adjusting during playback moves the bus that is already sounding,
    // so a slider takes effect on the phrase you are listening to.
    setMix(m) {
      if (m.drone != null) { mix.drone = m.drone; if (session && session.dBus) session.dBus.gain.setTargetAtTime(m.drone, actx.currentTime, 0.02); }
      if (m.tala != null) { mix.tala = m.tala; if (session && session.tBus) session.tBus.gain.setTargetAtTime(m.tala, actx.currentTime, 0.02); }
    },
    mix: () => ({ ...mix }),

    // A single note under the drone — what an editor plays back while you shape it.
    note(nn, dur) {
      const dest = open(), now = actx.currentTime + 0.03;
      drone(dest, now, dur + 0.4);
      voice(dest, now, dur, nn);
      return now;
    },

    // A stretch of the roll, [from,to) in length-units. Notes straddling either end
    // sound only their part. Returns the context time playback begins, which is what
    // the caller's own playhead counts from.
    phrase({ notes, starts, from, to, secPerUnit, tala }) {
      const dest = open(), start = actx.currentTime + 0.06;
      drone(dest, start, (to - from) * secPerUnit + 0.4);
      talaStrums(dest, from, to, start, secPerUnit, tala);
      for (let i = 0; i < notes.length; i++) {
        const s0 = starts[i], s1 = s0 + notes[i].dur;
        const a = Math.max(from, s0), b = Math.min(to, s1);
        if (b <= a) continue;
        voice(dest, start + (a - from) * secPerUnit, (b - a) * secPerUnit, notes[i],
          (a - s0) / notes[i].dur, (b - s0) / notes[i].dur);
      }
      return start;
    },
  };
}
