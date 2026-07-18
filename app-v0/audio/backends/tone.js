import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';

// The ONLY module that references Tone.js. Encapsulates all Tone version specifics.
// v14: Tone.Transport is the global transport. If a future vendored bundle exposes
// only getTransport()/getContext(), swap the helper below — nothing else changes.
// NOTE: Tone.Transport is a GLOBAL singleton — only one player instance is
// supported; a second createPlayer() would clobber the first one's schedules.
const transport = () => (Tone.Transport ?? Tone.getTransport());

// Volume-fraction (0..1) -> Tone dB. 1 -> ~-4 dB (headroom under 0), lower
// fractions taper logarithmically; 0 is handled by the caller (off).
const volToDb = (v) => 20 * Math.log10(v) - 4;

export function createToneBackend() {
  let synth = null;
  let drone = null;      // separate sustained voice; survives load/play/stop
  let droneKey = '';     // freqs signature — lets volume change without re-voicing
  let total = 0;
  let ended = false;
  const b = {
    onended: null,
    // opts.talaGain (0..1) scales the tala track velocity; melody is fixed.
    load(events, totalSec, opts = {}) {
      const talaGain = opts.talaGain != null ? opts.talaGain : 1;
      b.disposeMelody();   // keep the drone playing across sequence reloads
      total = totalSec;
      ended = false;
      synth = new Tone.PolySynth(Tone.Synth).toDestination();
      const tr = transport();
      tr.cancel();
      tr.position = 0;
      for (const e of events) {
        const vel = e.track === 'tala' ? 0.7 * talaGain : 0.8;
        // e.freq: experimental 53-EDO retune; falls back to 12-TET midi.
        const freq = e.freq != null ? e.freq : midiToFreq(e.midi);
        tr.schedule((time) => {
          synth.triggerAttackRelease(freq, e.durSec, time, vel);
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
      ended = false;
      await Tone.start();               // unlock AudioContext on the user gesture
      transport().start();
    },
    pause() { transport().pause(); },
    stop() { ended = false; const tr = transport(); tr.stop(); tr.position = 0; },
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
      const db = volToDb(vol);
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
    droneOff() {
      if (!drone) return;
      try { drone.releaseAll ? drone.releaseAll() : drone.triggerRelease(); } catch {}
      drone.dispose();
      drone = null;
      droneKey = '';
    },
    disposeMelody() {
      const tr = transport();
      tr.cancel();
      tr.stop();
      if (synth) { synth.dispose(); synth = null; }
    },
    dispose() {
      b.disposeMelody();
      b.droneOff();
    },
  };
  return b;
}
