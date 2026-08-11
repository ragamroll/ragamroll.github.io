import { midiToFreq } from '../schedule.js';

// A SynthBackend on bare Web Audio — no library, no bundle. The counterpart to
// backends/tone.js, for pages that want the roll to SOUND without carrying 353KB of
// Tone: the generated raga browser, and anything else embedded.
//
// The voices are `core/roll-audio.js`'s, which draw has been playing all along — same
// triangle melody with a duration-scaled envelope, same 6ms-attack veena strum, same
// three-sine drone. What is new is a TRANSPORT. roll-audio is fire-and-forget: it
// commits every oscillator to the audio clock and hands back the moment it started,
// leaving draw to derive its own playhead from `AC.currentTime - playStart` and to
// notice for itself when the piece ended. Those are exactly position(), pause() and
// onended, written in a page instead of behind the contract, so here they move down to
// where every caller can have them.
//
// Web Audio has no transport of its own: a scheduled oscillator cannot be paused, only
// stopped. So pausing means killing the sources and remembering how far in we were, and
// resuming means scheduling the REMAINDER — which is the same clipping scheduleEvents
// does for a range, applied to what is left rather than to what was asked for.

const LEAD = 0.06;        // scheduling head-start, so the first note is never late
const MEL_PEAK = 0.2;     // matches core/roll-audio.js's voice()
const STRUM_PEAK = 0.24;
const DRONE_PEAK = 0.09;

// The Tone backend takes its track levels in dB (a squared taper, tala -8dB under it,
// drone -14dB). These are the linear equivalents, so the two backends sound alike at
// the same slider position rather than only being correct in isolation.
const trackGain = (v) => (v > 0 ? v * v : 0);
const talaGainOf = (v) => trackGain(v) * 0.4;      // ≈ -8 dB
const droneGainOf = (v) => trackGain(v) * 0.2;     // ≈ -14 dB

export function createWebAudioBackend(context) {
  let actx = context || null;
  const ctx = () => {
    if (!actx) actx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    return actx;
  };

  let master = null, melBus = null, talaBus = null, droneBus = null;
  let live = [];              // oscillators currently scheduled; pause/stop kill these
  let droneOscs = [], droneKey = '';
  let events = [], total = 0;
  let state = 'stopped';      // 'stopped' | 'playing' | 'paused'
  let ended = false;
  let originSec = 0;          // ctx time that would map to offset 0 of the piece
  let offsetSec = 0;          // how far into the piece a resume should start
  let endTimer = null, fadeTimer = null;
  let masterVol = 1, talaVol = 1, droneVol = 0.5, melodyMuted = false;

  function graph() {
    const c = ctx();
    if (master) return;
    master = c.createGain(); master.gain.value = masterVol; master.connect(c.destination);
    melBus = c.createGain(); melBus.gain.value = melodyMuted ? 0 : 1; melBus.connect(master);
    talaBus = c.createGain(); talaBus.gain.value = talaGainOf(talaVol); talaBus.connect(master);
    droneBus = c.createGain(); droneBus.gain.value = droneGainOf(droneVol); droneBus.connect(master);
  }

  const clearTimers = () => {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
  };

  // Silence and release everything currently sounding. Sources are stopped rather than
  // faded: the caller that wants a click-free exit goes through fadeOutStop.
  function kill() {
    for (const o of live) { try { o.stop(); } catch (_) { /* already stopped */ } try { o.disconnect(); } catch (_) { /* gone */ } }
    live = [];
  }

  // One melody note. `gamaka` is already a frequency array over the note's own span
  // (scheduleEvents sampled it), so the curve is played verbatim — the same numbers the
  // roll drew with, never re-derived here.
  function melodyVoice(when, dur, freq, gamaka) {
    const c = ctx();
    const o = c.createOscillator(); o.type = 'triangle';
    // Attack and release scale with the note, so a rapid note never has its hold point
    // land before the attack peak — that clicked on fast passages.
    const atk = Math.min(0.012, dur * 0.35), rel = Math.min(0.035, dur * 0.45);
    const hold = Math.max(when + atk, when + dur - rel);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when); g.gain.linearRampToValueAtTime(MEL_PEAK, when + atk);
    g.gain.setValueAtTime(MEL_PEAK, hold); g.gain.linearRampToValueAtTime(0.0001, when + dur);
    if (gamaka && gamaka.length >= 2) o.frequency.setValueCurveAtTime(gamaka, when, dur);
    else o.frequency.setValueAtTime(freq, when);
    o.connect(g); g.connect(melBus); o.start(when); o.stop(when + dur + 0.05);
    live.push(o);
  }

  // A veena-like pluck. One oscillator per EVENT, not per interval: the strum's fifth
  // is already two separate tala events by the time it reaches a backend.
  function strumVoice(when, freq) {
    const c = ctx();
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(STRUM_PEAK, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 0.34);
    o.connect(g); g.connect(talaBus); o.start(when); o.stop(when + 0.4);
    live.push(o);
  }

  const freqOf = (e) => (e.freq != null ? e.freq : midiToFreq(e.midi));

  // Schedule everything from `off` seconds into the piece onward, starting at `at`.
  //
  // Melody straddling `off` is clipped and still sounds, and its gamaka is entered
  // part-way — the same rule scheduleEvents applies at a range boundary, for the same
  // reason: resuming mid-note must not restart the ornament. A tala stroke whose attack
  // already happened is not re-struck.
  function schedule(at, off) {
    for (const e of events) {
      const end = e.startSec + e.durSec;
      if (end <= off) continue;
      const when = at + Math.max(e.startSec, off) - off;
      if (e.track === 'tala') { if (e.startSec >= off) strumVoice(when, freqOf(e)); continue; }
      if (e.startSec >= off) { melodyVoice(when, e.durSec, freqOf(e), e.gamaka); continue; }
      const u0 = e.durSec > 0 ? (off - e.startSec) / e.durSec : 0;
      const tail = e.gamaka && e.gamaka.length >= 2
        ? e.gamaka.subarray(Math.min(e.gamaka.length - 2, Math.round(u0 * (e.gamaka.length - 1))))
        : null;
      melodyVoice(when, end - off, freqOf(e), tail);
    }
  }

  const elapsed = () => Math.max(0, ctx().currentTime - originSec);

  const b = {
    onended: null,
    load(evs, totalSec) {
      clearTimers();
      kill();
      events = evs || []; total = totalSec || 0;
      state = 'stopped'; ended = false; offsetSec = 0;
    },
    async play() {
      if (total <= 0 || state === 'playing') return;
      graph();
      const c = ctx();
      if (c.state === 'suspended') { try { await c.resume(); } catch (_) { /* stays suspended */ } }
      if (ended) { ended = false; offsetSec = 0; }
      const at = c.currentTime + LEAD;
      originSec = at - offsetSec;
      kill();
      schedule(at, offsetSec);
      state = 'playing';
      clearTimers();
      endTimer = setTimeout(() => {
        endTimer = null;
        // Natural end: position() must read 1 until load()/stop() resets it, so this
        // is a terminal state rather than a stop() (which would zero it).
        state = 'stopped'; ended = true; offsetSec = 0; kill();
        if (b.onended) b.onended();
      }, Math.max(0, (total - offsetSec) * 1000 - LEAD * 1000) + LEAD * 1000 + 30);
    },
    pause() {
      if (state !== 'playing') return;
      offsetSec = Math.min(total, elapsed());
      clearTimers(); kill();
      state = 'paused';
    },
    stop() {
      clearTimers(); kill();
      state = 'stopped'; ended = false; offsetSec = 0;
    },
    position() {
      if (ended) return 1;
      if (total <= 0) return 0;
      if (state === 'playing') return Math.min(1, Math.max(0, elapsed() / total));
      return Math.min(1, offsetSec / total);
    },
    latency() {
      const c = actx;
      return (c && (c.outputLatency ?? c.baseLatency)) || 0;
    },
    // Sound ONE note now, for auditioning while a curve is being shaped. Never touches
    // the transport: nothing here reads or writes originSec/offsetSec/state, so a
    // preview is invisible to position() whatever is playing.
    previewNote(ev) {
      if (!ev || !(ev.durSec > 0)) return;
      graph();
      const c = ctx();
      if (c.state === 'suspended') c.resume().catch(() => {});
      melodyVoice(c.currentTime + 0.005, ev.durSec, freqOf(ev), ev.gamaka);
    },
    setMasterVolume(vol) {
      masterVol = vol > 0 ? vol : 0;
      if (master) master.gain.setTargetAtTime(masterVol, ctx().currentTime, 0.02);
    },
    fadeIn(sec = 0.06) {
      graph();
      clearTimers();
      const t = ctx().currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.0001, t);
      master.gain.linearRampToValueAtTime(masterVol, t + sec);
    },
    fadeOutStop(sec = 0.12) {
      if (!master) { b.stop(); return; }
      const t = ctx().currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + sec);
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        b.stop(); b.droneOff();
        master.gain.setValueAtTime(masterVol, ctx().currentTime);
      }, sec * 1000 + 40);
    },
    setTalaVolume(vol) {
      talaVol = vol;
      if (talaBus) talaBus.gain.setTargetAtTime(talaGainOf(vol), ctx().currentTime, 0.02);
    },
    setMelodyMuted(muted) {
      melodyMuted = !!muted;
      if (melBus) melBus.gain.setTargetAtTime(melodyMuted ? 0 : 1, ctx().currentTime, 0.02);
    },
    // One voice, so there is nothing to switch. Accepted and ignored ON PURPOSE rather
    // than omitted: a caller may drive either backend, and a missing method would throw
    // where a light backend should simply sound plainer.
    setTimbre() { /* single-voice backend */ },
    // A constant drone, independent of the transport. Same freqs + a new volume moves
    // the bus rather than re-voicing, so the level can be set without a re-attack.
    setDrone(freqs, vol = 0.5) {
      if (!freqs || !freqs.length || vol <= 0) { b.droneOff(); return; }
      graph();
      droneVol = vol;
      const key = freqs.join(',');
      if (droneOscs.length && key === droneKey) {
        droneBus.gain.setTargetAtTime(droneGainOf(vol), ctx().currentTime, 0.05);
        return;
      }
      b.droneOff();
      const c = ctx();
      if (c.state === 'suspended') c.resume().catch(() => {});
      droneBus.gain.setValueAtTime(droneGainOf(vol), c.currentTime);
      const now = c.currentTime;
      for (const f of freqs) {
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(DRONE_PEAK, now + 0.9);
        o.connect(g); g.connect(droneBus); o.start(now);
        droneOscs.push({ o, g });
      }
      droneKey = key;
    },
    droneOff() {
      if (!droneOscs.length) return;
      const now = ctx().currentTime;
      for (const { o, g } of droneOscs) {
        try { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0.0001, now, 0.2); } catch (_) { /* gone */ }
        try { o.stop(now + 1.4); } catch (_) { /* already stopped */ }
      }
      droneOscs = []; droneKey = '';
    },
    dispose() {
      clearTimers(); kill(); b.droneOff();
      for (const n of [melBus, talaBus, droneBus, master]) { try { n && n.disconnect(); } catch (_) { /* gone */ } }
      master = melBus = talaBus = droneBus = null;
      state = 'stopped'; ended = false; offsetSec = 0; events = []; total = 0;
    },
  };
  return b;
}
