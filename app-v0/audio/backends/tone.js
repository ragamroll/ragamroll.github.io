import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';
import { createSampledVoice, isSampled, warmSamples } from '../sampler.js';
import { outputDelay } from '../backend.js';

// The ONLY module that references Tone.js. Encapsulates all Tone version specifics.
// v14: Tone.Transport is the global transport. If a future vendored bundle exposes
// only getTransport()/getContext(), swap the helper below — nothing else changes.
// NOTE: Tone.Transport is a GLOBAL singleton — only one player instance is
// supported; a second createPlayer() would clobber the first one's schedules.
const transport = () => (Tone.Transport ?? Tone.getTransport());
const destination = () => (Tone.Destination ?? Tone.getDestination());
const rawCtx = () => { const c = Tone.getContext && Tone.getContext(); return c && c.rawContext; };

// Volume-fraction (0..1) -> Tone dB. 0 -> silence. Linear-log; used for master.
const gainDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
// Tala/drone taper: square the slider so the softer band spans more of the
// travel — the old low end now sits around mid-slider (~-12 dB at 0.5).
const trackDb = (v) => gainDb(v * v);
// Tala sits a further -8 dB under the taper (it should stay under the melody).
const talaDb = (v) => trackDb(v) - 8;
// Drone variant: extra headroom since its three S/P/>S voices sum.
const droneDb = (v) => trackDb(v) - 14;

// Melody voice factory. The srgm melody is monophonic (notes never overlap), so
// each timbre is a single MONO synth — not a PolySynth.
function makeMelody(timbre) {
  if (isSampled(timbre)) return makeSampled(timbre);
  switch (timbre) {
    case 'reed': {      // filtered MonoSynth — soft, mellow reed
      const s = new Tone.MonoSynth().toDestination();
      s.set({ oscillator: { type: 'triangle' },   // few harmonics → gentle
              envelope: { attack: 0.14, decay: 0.2, sustain: 0.8, release: 0.6 },
              filter: { Q: 0.5, type: 'lowpass', rolloff: -24 },
              filterEnvelope: { attack: 0.18, decay: 0.3, sustain: 0.5, release: 0.6,
                                baseFrequency: 180, octaves: 2 } });
      return s;
    }
    case 'soft-am': {   // AM, gentle reed/soft pad
      const s = new Tone.AMSynth().toDestination();
      s.set({ harmonicity: 2, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
              envelope: { attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.6 },
              modulationEnvelope: { attack: 0.2, decay: 0, sustain: 1, release: 0.5 } });
      return s;
    }
    case 'bowed-fm':
    default: {          // FM, bowed-string swell
      const s = new Tone.FMSynth().toDestination();
      s.set({ harmonicity: 2, modulationIndex: 6, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
              envelope: { attack: 0.12, decay: 0.1, sustain: 0.9, release: 0.4, attackCurve: 'sine' },
              modulationEnvelope: { attack: 0.2, decay: 0.2, sustain: 0.8, release: 0.4 } });
      return s;
    }
  }
}

// Tala percussion voice factory. All are pitched (so the lower-Sa / Pa / Ma / Sa
// strokes stay distinct) with a short, sustain-0 envelope so each akshara reads
// as a struck stroke. Applied on the next load().
function makeTala(timbre) {
  switch (timbre) {
    case 'mallet': {     // soft pitched mallet — marimba / kalimba
      const s = new Tone.PolySynth(Tone.Synth).toDestination();
      s.set({ oscillator: { type: 'triangle' },
              envelope: { attack: 0.002, decay: 0.28, sustain: 0, release: 0.2 } });
      return s;
    }
    case 'reed':
    default: {           // warm rounded tick — the melody reed, made percussive (default)
      const s = new Tone.PolySynth(Tone.MonoSynth).toDestination();
      s.set({ oscillator: { type: 'triangle' },
              envelope: { attack: 0.01, decay: 0.22, sustain: 0, release: 0.3 },
              filter: { Q: 0.5, type: 'lowpass', rolloff: -24 },
              filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.2, release: 0.3, baseFrequency: 200, octaves: 2 } });
      return s;
    }
    case 'membrane': {   // pitched membrane kick — mridangam-ish (the original)
      const s = new Tone.PolySynth(Tone.MembraneSynth).toDestination();
      s.set({ pitchDecay: 0.08, octaves: 1.5, oscillator: { type: 'sine' },
              envelope: { attack: 0.008, decay: 0.32, sustain: 0, release: 0.32 } });
      return s;
    }
    case 'veena': {      // plucked string — the composition's accent strum.
      // The strum is a DYAD: buildSequence puts Sa and Pa on the SAME tick, the way a
      // veena is struck. PluckSynth is monophonic and cannot be wrapped in PolySynth
      // (it isn't Monophonic-based), so a single one took the first note and threw
      // "Start time must be strictly greater than previous start time" on the second
      // — half of every strum, silently, for as long as this voice has existed.
      // Two voices, taken in turn, so both notes of a strum sound.
      const out = new Tone.Volume(0).toDestination();
      const voices = [new Tone.PluckSynth(), new Tone.PluckSynth()];
      for (const v of voices) { v.set({ attackNoise: 0.6, dampening: 2200, resonance: 0.9 }); v.connect(out); }
      let next = 0;
      return {
        volume: out.volume,
        triggerAttackRelease(...a) { const v = voices[next]; next = (next + 1) % voices.length; v.triggerAttackRelease(...a); },
        dispose() { for (const v of voices) v.dispose(); out.dispose(); },
      };
    }
  }
}

// A sampled melody voice, wearing the same face as a synth one.
//
// The scheduler bends a gamaka by ramping `synth.frequency`, which only an oscillator has.
// So a voice may instead offer `curve(points, time, dur, vel)` and say what it means in
// its own terms — which is the honest seam: a sampler bends by playback rate, and pretending
// it has a frequency param would have been a lie the first ramp exposed.
//
// It keeps a synth INSIDE it as the fallback, per note: samples arrive over a CDN, so the
// first note of a playback can easily be ahead of them, and offline there are none at all.
// A missing sample costs the timbre, never the sound.
function makeSampled(name) {
  const out = new Tone.Volume(0).toDestination();
  const inner = makeMelody('soft-am');          // the fallback voice, and the fallback ONLY
  inner.disconnect(); inner.connect(out);
  const ctx = rawCtx();
  // A NATIVE gain node, connected into the Tone chain by Tone itself. Reaching for a Tone
  // node's private `_nativeAudioNode` guessed at an internal that this build does not
  // expose — so `dest` came back null, the voice was never built, and every note fell back
  // to the synth while the picker said Violin. Tone.connect is the supported seam between
  // a raw node and a Tone one, and it is the whole point of having it.
  const dest = ctx ? ctx.createGain() : null;
  if (dest) Tone.connect(dest, out);
  const fallback = {
    plain: (freq, time, dur, vel) => inner.triggerAttackRelease(freq, dur, time, vel),
    curve: (pts, time, dur, vel) => {
      inner.triggerAttack(pts[0], time, vel);
      for (let k = 1; k < pts.length; k++) inner.frequency.linearRampToValueAtTime(pts[k], time + (dur * k) / (pts.length - 1));
      inner.triggerRelease(time + dur);
    },
  };
  // No raw destination to play into (an unusual Tone build) — then this is the synth voice,
  // which is exactly what the fallback is for.
  const voice = ctx && dest ? createSampledVoice(ctx, name, dest, fallback) : null;
  if (voice) voice.load();
  return {
    volume: out.volume,
    sampled: true,
    triggerAttackRelease(freq, dur, time, vel) {
      if (voice) voice.note(freq, time, dur, vel); else fallback.plain(freq, time, dur, vel);
    },
    curve(points, time, dur, vel) {
      if (voice) voice.curve(points, time, dur, vel); else fallback.curve(points, time, dur, vel);
    },
    dispose() { if (voice) voice.dispose(); inner.dispose(); out.dispose(); },
  };
}

export function createToneBackend() {
  let synth = null;      // melody voice (mono)
  let preview = null;    // audition voice — see previewNote; never the melody voice

  let tala = null;       // tala voice — separate so its volume is live
  let drone = null;      // separate sustained voice; survives load/play/stop
  let droneKey = '';     // freqs signature — lets volume change without re-voicing
  let timbre = 'soft-am';   // melody voice preset; applied on the next load()
  let melodyMuted = false;  // remembered so a reload keeps the melody muted
  let masterDb = 0;         // canonical master level (dB); fades ramp around it
  let fadeTimer = null;     // pending fadeOutStop teardown; cancelled by a new load/play
  let total = 0;
  let ended = false;
  const clearFade = () => { if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; } };

  // Resolve once the context's clock has actually advanced, or after `capMs` either way.
  const clockAwake = (ctx, capMs = 250) => new Promise((resolve) => {
    if (!ctx || typeof ctx.currentTime !== 'number') { resolve(); return; }
    const t0 = ctx.currentTime, started = Date.now();
    const tick = () => {
      if (ctx.currentTime > t0 || Date.now() - started > capMs) { resolve(); return; }
      setTimeout(tick, 10);
    };
    tick();
  });
  const b = {
    onended: null,
    // opts.talaGain (0..1) is the tala track's initial live volume.
    load(events, totalSec, opts = {}) {
      const talaGain = opts.talaGain != null ? opts.talaGain : 1;
      clearFade();         // a new load supersedes any pending fade teardown
      b.disposeMelody();   // keep the drone playing across sequence reloads
      total = totalSec;
      ended = false;
      synth = makeMelody(timbre);
      synth.volume.value = melodyMuted ? -Infinity : 0;   // melody mute (hear tala/drone alone)
      // Composition tala (no talaVoice) uses the fixed 'veena' accent-strum voice;
      // the tala browser passes opts.talaVoice from its picker to audition voices.
      tala = makeTala(opts.talaVoice || 'veena');
      tala.volume.value = talaDb(talaGain);     // live-adjustable via setTalaVolume
      const tr = transport();
      tr.cancel();
      tr.position = 0;
      for (const e of events) {
        const isTala = e.track === 'tala';
        const dest = isTala ? tala : synth;
        const vel = isTala ? 0.7 : 0.8;         // fixed velocity; loudness is the track volume
        // e.freq: experimental 53-EDO retune; falls back to 12-TET midi.
        const freq = e.freq != null ? e.freq : midiToFreq(e.midi);
        tr.schedule((time) => {
          // Inline gamaka: ramp the (mono) melody voice's frequency through the
          // sampled curve instead of a fixed pitch. Linear ramps (strictly
          // increasing times) — robust across browsers; same voice = same timbre.
          if (e.gamaka && e.gamaka.length && !isTala && synth.curve) {
            synth.curve(e.gamaka, time, e.durSec, vel);       // a voice that bends its own way
          } else if (e.gamaka && e.gamaka.length) {
            const arr = e.gamaka, N = arr.length;
            synth.triggerAttack(arr[0], time, vel);
            for (let k = 1; k < N; k++) synth.frequency.linearRampToValueAtTime(arr[k], time + e.durSec * k / (N - 1));
            synth.triggerRelease(time + e.durSec);
          } else {
            dest.triggerAttackRelease(freq, e.durSec, time, vel);
          }
        }, e.startSec);
      }
      if (totalSec > 0) {
        tr.schedule(() => {
          // Halt the transport internally (not via the public b.stop(), which
          // resets `ended`): after a natural end position() must report 1.
          const t = transport();
          t.stop();
          t.position = 0;
          ended = true;
          if (b.onended) b.onended();
        }, totalSec);
      }
    },
    async play() {
      if (total <= 0) return;
      clearFade();                      // don't let a stale teardown stop this run
      ended = false;
      await Tone.start();               // unlock AudioContext on the user gesture
      // WAIT FOR THE CLOCK TO MOVE before scheduling anything against it.
      //
      // Tone.start() resolves when the context reports itself running, which is not the
      // same as the hardware having started: on a phone the first output buffers can be
      // dropped while the audio route is still being set up, and a piece that opens on a
      // note loses the front of it. Every note after the first is fine, because by then
      // the clock and the speaker agree — which is what made this look like a fault in
      // one note rather than in the start.
      //
      // Bounded, and a no-op wherever the clock is already ticking: at most ~250ms, and
      // a context that never advances is simply started anyway rather than hanging on a
      // promise that will not settle.
      await clockAwake(rawCtx());
      // STARTED IN THE FUTURE, by the time it takes a buffer to reach the speaker.
      //
      // A piece that opens on a note puts that note's attack at transport time 0, and
      // starting the transport "now" asks for it at an audio time that is already being
      // rendered — so the envelope begins part-way through and the first note comes out
      // clipped, or on a device with a big buffer, missing. Every note after it is fine,
      // which is what made this look like a quirk of the first note rather than of the
      // start. A piece that happens to open on a rest never showed it at all.
      //
      // The runway is the output delay itself, floored at 60ms: whatever the device
      // needs to get sound out is what it needs to get the FIRST sound out.
      transport().start('+' + Math.max(0.06, outputDelay(rawCtx())).toFixed(3));
    },
    pause() { transport().pause(); },
    stop() {
      ended = false;
      const tr = transport();
      tr.stop();
      tr.position = 0;
      tr.cancel();               // drop the leftover schedule
      b.disposeMelody();         // free the melody/tala oscillators (rebuilt on next play)
      b.idleSuspend();           // nothing playing + no drone → suspend the audio context
    },
    // Suspend the AudioContext when fully idle (transport stopped AND no drone),
    // so no ticker / audio-thread work continues. Auto-resumes: play() awaits
    // Tone.start() and setDrone() calls Tone.start(), both of which resume it.
    idleSuspend() {
      const raw = rawCtx();
      if (raw && raw.state === 'running' && transport().state !== 'started' && !drone) {
        raw.suspend().catch(() => {});
      }
    },
    position() {
      if (ended) return 1;              // contract: natural end reads 1 until stop/replay
      if (total <= 0) return 0;
      // Tone's transport can report a ~1e-16 residue after stop(); clamp so the
      // contract's "stop resets position() to 0" holds exactly.
      const s = transport().seconds;
      return s < 1e-6 ? 0 : Math.min(1, s / total);
    },
    latency() { return outputDelay(rawCtx()); },
    // Constant tambura-style drone: sustained Sa/Pa voices, independent of the
    // transport. `vol` (0..1) sets loudness; vol<=0 or empty freqs = off. When
    // only the volume changes (same freqs) the voices keep ringing — no
    // re-attack click. Called on a user gesture, so Tone.start() can unlock.
    setDrone(freqs, vol = 0.5) {
      if (!freqs || !freqs.length || vol <= 0) { b.droneOff(); return; }
      const key = freqs.join(',');
      const db = droneDb(vol);
      if (drone && key === droneKey) { drone.volume.value = db; return; }  // live volume
      b.droneOff();
      Tone.start();
      drone = new Tone.PolySynth(Tone.Synth).toDestination();
      drone.set({ oscillator: { type: 'sine' },
                  envelope: { attack: 0.9, decay: 0, sustain: 1, release: 1.4 } });
      drone.volume.value = db;
      drone.triggerAttack(freqs);
      droneKey = key;
    },
    // Sound ONE note right now, for auditioning while a curve is being shaped.
    //
    // Deliberately NOT the transport: it is triggered at Tone.now() and touches no
    // schedule, so position() and the play/pause state are exactly as they were. That
    // is the contract — an editor asking to hear a note must not be able to disturb
    // playback, and must work with nothing loaded at all.
    //
    // Its own voice, too. The melody voice is monophonic and may be mid-phrase, so
    // borrowing it would cut the note that is playing and land the preview's frequency
    // ramps on top of the scheduled ones. It is also independent of the melody mute:
    // muting the melody is for listening to the tala, and this is an explicit request
    // to hear a pitch.
    previewNote(ev) {
      if (!ev || !(ev.durSec > 0)) return;
      Tone.start();                              // called on a user gesture; unlocks/resumes
      if (!preview) preview = makeMelody(timbre);
      const t = Tone.now();
      if (ev.gamaka && ev.gamaka.length) {
        const arr = ev.gamaka, N = arr.length;
        preview.triggerAttack(arr[0], t, 0.8);
        for (let k = 1; k < N; k++) preview.frequency.linearRampToValueAtTime(arr[k], t + ev.durSec * k / (N - 1));
        preview.triggerRelease(t + ev.durSec);
      } else {
        const freq = ev.freq != null ? ev.freq : midiToFreq(ev.midi);
        preview.triggerAttackRelease(freq, ev.durSec, t, 0.8);
      }
    },
    // Master output level (0..1): scales everything — melody, tala, drone.
    // 1 → 0 dB (unattenuated), 0 → silence. Live.
    setMasterVolume(vol) {
      masterDb = gainDb(vol);
      destination().volume.value = masterDb;
    },
    // Click-free start/stop by ramping the master output. Both anchor to the
    // stored master level (masterDb) — never the live, possibly mid-ramp value.
    // fadeIn dips to silence then ramps up; fadeOutStop ramps down, then stops +
    // clears the drone and restores the level. The teardown timer is tracked so
    // a following load()/play() cancels it (else it would kill the new run).
    fadeIn(sec = 0.06) {
      clearFade();
      const v = destination().volume;
      v.value = -60;
      v.rampTo(masterDb, sec);
    },
    fadeOutStop(sec = 0.12) {
      const v = destination().volume;
      v.rampTo(-60, sec);
      clearFade();
      fadeTimer = setTimeout(() => {
        fadeTimer = null;
        b.stop(); b.droneOff(); v.value = masterDb;
      }, sec * 1000 + 40);
    },
    // Tala track volume (0..1), live — takes effect on a currently playing piece.
    setTalaVolume(vol) {
      if (tala) tala.volume.value = talaDb(vol);
    },
    // Melody mute (live) — lets the user solo tala + drone to set their levels.
    setMelodyMuted(muted) {
      melodyMuted = muted;
      if (synth) synth.volume.value = muted ? -Infinity : 0;
    },
    // Melody voice preset ('bowed-fm' | 'soft-am' | 'reed'); applies next load.
    setTimbre(name) {
      timbre = name;
      // Start fetching now rather than when Play is pressed: the voice is built at load(),
      // and without this the opening of the first playback is the fallback synth while the
      // samples are still on their way.
      if (isSampled(name)) warmSamples(rawCtx(), name);
    },
    droneOff() {
      if (!drone) return;
      try { drone.releaseAll ? drone.releaseAll() : drone.triggerRelease(); } catch {}
      drone.dispose();
      drone = null;
      droneKey = '';
      b.idleSuspend();           // if playback is also stopped, go fully idle
    },
    disposeMelody() {
      const tr = transport();
      tr.cancel();
      tr.stop();
      if (synth) { synth.dispose(); synth = null; }
      if (tala) { tala.dispose(); tala = null; }
    },
    dispose() {
      b.disposeMelody();
      b.droneOff();
      // The preview voice survives load()/stop() on purpose — you audition notes
      // between takes — so only a full dispose releases it.
      if (preview) { preview.dispose(); preview = null; }
    },
  };
  return b;
}
