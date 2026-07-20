import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';

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

// Melody voice factory. Each returns a PolySynth with triggerAttackRelease +
// dispose + volume, tuned so the envelope carries a gentle sustained tone
// rather than the stock pluck.
function makeMelody(timbre) {
  switch (timbre) {
    case 'reed': {      // filtered MonoSynth — soft, mellow reed
      const s = new Tone.PolySynth(Tone.MonoSynth).toDestination();
      s.set({ oscillator: { type: 'triangle' },   // few harmonics → gentle
              envelope: { attack: 0.14, decay: 0.2, sustain: 0.8, release: 0.6 },
              filter: { Q: 0.5, type: 'lowpass', rolloff: -24 },
              filterEnvelope: { attack: 0.18, decay: 0.3, sustain: 0.5, release: 0.6,
                                baseFrequency: 180, octaves: 2 } });
      return s;
    }
    case 'soft-am': {   // AM, gentle reed/soft pad
      const s = new Tone.PolySynth(Tone.AMSynth).toDestination();
      s.set({ harmonicity: 2, oscillator: { type: 'sine' }, modulation: { type: 'sine' },
              envelope: { attack: 0.08, decay: 0.2, sustain: 0.85, release: 0.6 },
              modulationEnvelope: { attack: 0.2, decay: 0, sustain: 1, release: 0.5 } });
      return s;
    }
    case 'bowed-fm':
    default: {          // FM, bowed-string swell
      const s = new Tone.PolySynth(Tone.FMSynth).toDestination();
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
    case 'veena': {      // plucked string — the composition's sparse accent strum.
      // PluckSynth isn't Monophonic-based (no PolySynth); the composition tala is
      // sparse accent strums, so mono is fine.
      const s = new Tone.PluckSynth().toDestination();
      s.set({ attackNoise: 0.6, dampening: 2200, resonance: 0.9 });
      return s;
    }
  }
}

export function createToneBackend() {
  let synth = null;      // melody voice
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
          dest.triggerAttackRelease(freq, e.durSec, time, vel);
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
      transport().start();
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
    latency() {
      // Output latency of the real AudioContext, for A/V sync compensation.
      // Guarded: 0 when the context / fields are unavailable (e.g. old browsers).
      const c = Tone.getContext && Tone.getContext();
      const raw = c && c.rawContext;
      return (raw && (raw.outputLatency ?? raw.baseLatency)) || 0;
    },
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
    setTimbre(name) { timbre = name; },
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
    },
  };
  return b;
}
