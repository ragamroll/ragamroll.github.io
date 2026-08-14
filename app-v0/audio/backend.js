/**
 * A swappable synth backend. The app talks only to this interface; Tone.js (or a
 * future wasm soundfont) lives entirely behind an implementation of it.
 *
 * @typedef {Object} ScheduledEvent
 * @property {number} midi
 * @property {number} startSec
 * @property {number} durSec
 * @property {'melody'|'tala'} track
 *
 * @typedef {Object} SynthBackend
 * @property {(events: ScheduledEvent[], totalSec: number, opts?: {talaGain?: number, talaVoice?: string}) => (void|Promise<void>)} load  // talaGain (0..1) scales tala velocity; talaVoice picks the tala voice ('reed'|'mallet'|'membrane') for the tala browser — omit for the composition's fixed 'veena' accent strum
 * @property {() => Promise<void>} play    // start from 0, or resume from pause; awaits audio unlock
 * @property {() => void} pause            // freeze; position() holds
 * @property {() => void} stop             // stop + reset position() to 0
 * @property {() => number} position       // 0..1 fraction of totalSec elapsed
 * @property {() => number} latency        // output latency in seconds (for A/V sync compensation); 0 if unknown
 * @property {(vol: number) => void} setMasterVolume  // master output level 0..1 (1 = 0 dB, 0 = silence); scales melody+tala+drone. Live
 * @property {(sec?: number) => void} fadeIn           // ramp master up from silence (click-free start)
 * @property {(sec?: number) => void} fadeOutStop      // ramp master down, then stop + droneOff, restoring the level
 * @property {(vol: number) => void} setTalaVolume    // tala track volume 0..1; live on a playing piece
 * @property {(muted: boolean) => void} setMelodyMuted // mute/unmute the melody track; live (solo tala+drone)
 * @property {(name: string) => void} setTimbre       // melody voice preset ('bowed-fm'|'soft-am'|'reed'); applies on next load()
 * @property {(ev: {midi?: number, freq?: number, durSec: number, gamaka?: Float32Array}) => void} previewNote  // sound ONE note immediately, for auditioning while editing. A ScheduledEvent minus its timing. MUST NOT touch the transport: position(), the play/pause state and any scheduled events are unaffected, so a note can be auditioned mid-playback or with nothing loaded at all
 * @property {(freqs: number[], vol?: number) => void} setDrone  // constant drone at these freqs, vol 0..1; vol<=0 / empty = off. Same freqs + new vol changes loudness without re-voicing. Independent of the transport
 * @property {() => void} droneOff         // silence the drone
 * @property {() => void} dispose          // release audio resources (incl. drone)
 * @property {?(() => void)} onended       // fires exactly once when playback reaches the end; the backend then enters a stopped state and position() reads 1 until load()/stop() resets it
 */
export {};

/**
 * How far ahead of the SPEAKER the audio clock runs, in seconds.
 *
 * This is what a playhead has to be pushed back by, and getting it wrong is visible: the
 * line arrives at a note before the note is heard. Three sources, in order of honesty.
 *
 * `getOutputTimestamp()` is a MEASUREMENT — the context reports which audio time has
 * actually left the device and when — so it accounts for the buffer, the driver and the
 * output path all at once. Safari implements it and does NOT implement outputLatency,
 * which is exactly the case that was reading as "no latency at all".
 *
 * `baseLatency + outputLatency` is the arithmetic when there is no measurement. Neither
 * term alone is the answer: baseLatency is the graph's own buffering and outputLatency
 * the device's, and on this machine they are 43ms and 128ms — reading only the first,
 * which is what the fallback did whenever outputLatency was nullish, compensated a
 * quarter of the real delay.
 *
 * Clamped to half a second: a wild reading from a context that has not rendered yet
 * would otherwise drag the playhead somewhere it can never be.
 */
export function outputDelay(ctx) {
  const c = nativeContext(ctx);
  if (!c) return 0;
  try {
    const ts = c.getOutputTimestamp && c.getOutputTimestamp();
    if (ts && ts.contextTime > 0) {
      const d = c.currentTime - ts.contextTime;
      if (d > 0 && d < 0.5) return d;
    }
  } catch (_) { /* not implemented, or the context is not running */ }
  const base = c.baseLatency || 0, out = c.outputLatency || 0;
  return Math.min(0.5, base + out);
}

/**
 * The NATIVE AudioContext behind whatever a backend hands over.
 *
 * Tone bundles standardized-audio-context, and what it calls the raw context is that
 * library's wrapper: it carries baseLatency and neither outputLatency nor
 * getOutputTimestamp. Asked about latency it answered 43ms where the context underneath
 * measured 152ms — not a wrong number so much as a quarter of the question, and the
 * measurement was not merely unused but unavailable.
 *
 * The unwrapping is by a private field, so it is checked rather than trusted: anything
 * that does not look like a context leaves the wrapper in place, which is exactly the
 * behaviour there was before.
 */
function nativeContext(ctx) {
  if (!ctx) return null;
  const n = ctx._nativeAudioContext || ctx._nativeContext;
  return (n && typeof n.currentTime === 'number') ? n : ctx;
}
