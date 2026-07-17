import * as Tone from '../../vendor/tone.js';
import { midiToFreq } from '../schedule.js';

// The ONLY module that references Tone.js. Encapsulates all Tone version specifics.
// v14: Tone.Transport is the global transport. If a future vendored bundle exposes
// only getTransport()/getContext(), swap the helper below — nothing else changes.
// NOTE: Tone.Transport is a GLOBAL singleton — only one player instance is
// supported; a second createPlayer() would clobber the first one's schedules.
const transport = () => (Tone.Transport ?? Tone.getTransport());

export function createToneBackend() {
  let synth = null;
  let total = 0;
  let ended = false;
  const b = {
    onended: null,
    load(events, totalSec) {
      b.dispose();
      total = totalSec;
      ended = false;
      synth = new Tone.PolySynth(Tone.Synth).toDestination();
      const tr = transport();
      tr.cancel();
      tr.position = 0;
      for (const e of events) {
        const vel = e.track === 'tala' ? 0.35 : 0.8;
        tr.schedule((time) => {
          synth.triggerAttackRelease(midiToFreq(e.midi), e.durSec, time, vel);
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
    dispose() {
      const tr = transport();
      tr.cancel();
      tr.stop();
      if (synth) { synth.dispose(); synth = null; }
    },
  };
  return b;
}
