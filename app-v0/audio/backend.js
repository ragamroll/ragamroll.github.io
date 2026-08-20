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
 * @property {(sec: number) => void} seek    // move the play position (clamped to 0..totalSec) without playing; events before it do not fire. Call between load() and play(), or while paused
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
 * CAN THIS PAGE MAKE THE SOUND AT ALL?
 *
 * The plucked string is a comb filter and the tala's strum is a PluckSynth, and Tone builds
 * both on an AudioWorklet. A browser only provides AudioWorklet in a SECURE CONTEXT — https,
 * or localhost. Served over plain http from a machine on the network, which is how anyone
 * would try this app out on a phone, those voices cannot be created and simply make no sound.
 * The drone is oscillators and needs no worklet, so it plays perfectly.
 *
 * The result is an app that appears to work — the playhead runs, the roll scrolls, the drone
 * sounds — and has no melody, with the explanation sitting in a console nobody is looking at
 * on a phone. It cost an evening of chasing a fault that was not in the app.
 *
 * So the app asks, and says so on the page.
 */
export function audioSupport() {
  if (typeof globalThis.AudioWorkletNode === 'function') return { ok: true, why: '' };
  const secure = globalThis.isSecureContext !== false;
  return {
    ok: false,
    why: secure
      ? 'This browser has no AudioWorklet, which the plucked voices are built on. The drone will play and the melody will not.'
      : 'The melody needs https. Served over plain http (other than localhost) a browser withholds AudioWorklet, which the plucked string and the tala strum are built on — so you get the drone and nothing else.',
  };
}

/**
 * A PLAYHEAD CLOCK: the transport's own reading, carried forward with wall time between
 * its updates.
 *
 * Both backends read a clock that steps rather than flows. Tone's transport advances in
 * its scheduler's steps, and an AudioContext's currentTime advances a render quantum at a
 * time (and, where the device batches its callbacks, several at once). Sampled every
 * animation frame in the app, the transport reading repeated for two to thirteen frames
 * and then jumped: 60fps with no dropped frames, 26 value changes a second, up to 216ms of
 * a motionless playhead, per-frame advance varying more than its own mean (cv 1.24). The
 * loop was never the problem — the number it drew was.
 *
 * The audio is exact and untouched by any of this. This is only what the DRAWING is told.
 *
 * Between updates the reading is carried forward by elapsed wall time, because a running
 * transport advances at one second per second. The carry is:
 *
 *  - CAPPED (`MAX_CARRY`), so a clock that has genuinely stalled — a suspended context, a
 *    backgrounded tab — is believed rather than extrapolated off the end of the piece.
 *  - only applied while RUNNING. `running` is the caller's answer, not a guess from the
 *    numbers: a paused transport reports the same seconds as a stalled one, and a playhead
 *    that keeps gliding over silence is a worse fault than the one being fixed.
 *  - MONOTONIC within a run. The carry lags by at most the frame on which a change is
 *    noticed, so it under-predicts rather than over-predicts; the clamp is there for the
 *    case it does not.
 *
 * reset() is required at every point where the position moves by something other than
 * time passing — load, play, pause, stop, seek. Without it a resume carries the length of
 * the pause into the first frame after it.
 */
export const MAX_CARRY = 0.25;   // seconds of wall time a stalled reading is carried
export const ORIGIN_SMOOTHING = 0.12;   // how hard a new reading pulls the origin

/**
 * @param {() => number} now  wall clock in ms; injectable so a test can hold it still
 */
export function makePlayClock(now = () => performance.now(), smoothing = ORIGIN_SMOOTHING) {
  // The wall-clock instant that maps to position 0 — an ORIGIN, not a position. Deriving
  // the playhead from it is what makes the motion even: every frame is (now - origin),
  // which advances by exactly the frame's own duration whether or not the transport said
  // anything. Simply carrying the last reading forward and SNAPPING to each new one was
  // measurably better than raw (26Hz -> 59Hz) and still stepped, because the snap is
  // itself a jump of whatever the reading had drifted by.
  let origin = null;
  let raw = -1, out = 0;
  return {
    reset() { origin = null; raw = -1; out = 0; },
    /** @param {number} seconds transport reading @param {boolean} running is it advancing */
    read(seconds, running) {
      const t = now();
      // Paused or stopped: the transport IS the answer, and the origin is re-derived so a
      // resume starts from where the line is rather than from where it would have been.
      if (!running) { origin = t - seconds * 1000; raw = seconds; out = seconds; return seconds; }
      const est = t - seconds * 1000;
      if (origin == null) origin = est;
      // Each new reading corrects the origin by a FRACTION of its disagreement. A reading
      // is noticed up to a frame after it changed, so the estimates it gives are late by a
      // varying amount; taken whole, that jitter would be drawn. Taken a tenth at a time,
      // it averages out and the correction is spread over frames too small to see.
      else if (seconds !== raw) origin += smoothing * (est - origin);
      raw = seconds;
      // Never further ahead than the last real reading plus the carry cap: a suspended
      // context or a backgrounded tab stops the transport but not the wall clock, and
      // without this the playhead would run off the end of a piece that is not playing.
      const p = Math.min((t - origin) / 1000, seconds + MAX_CARRY);
      out = Math.max(out, p);   // within a run the line does not go back up the roll
      return out;
    },
  };
}

/**
 * outputDelay, but STEADY — the same measurement with its per-frame noise taken out.
 *
 * The delay is a property of the device, and the playhead subtracts it from the drawn
 * position on every frame. getOutputTimestamp reports it afresh each time it is asked and
 * disagrees with itself by a few milliseconds: measured over four seconds of playback,
 * mean 149.4ms with a spread of 130 to 154. That is ±12ms of pure noise added straight
 * onto the line's position, and with the transport clock smoothed it was ALL of the
 * jitter that was left — the position itself was even to a twentieth (cv 0.05), the line
 * drawn from it was not (cv 0.32).
 *
 * A slow average keeps the number honest while making it still: it ignores the
 * frame-to-frame disagreement entirely.
 *
 * But it must not CRAWL between two honest answers. A context that has not rendered yet
 * reports a fraction of its real delay — 24ms against the 150ms it settles at, measured
 * from a cold start — and averaging that in a twentieth at a time drags the playhead
 * across more than a tenth of a second over the first seconds of a piece: smooth, and
 * wrong, and worse than the jitter it was there to remove. A disagreement bigger than
 * anything the noise produces is not noise; it is the situation having changed, and it is
 * taken at once. That covers the warm-up and a change of output device alike.
 */
export const LATENCY_JUMP = 0.03;   // seconds of disagreement taken as a real change

export function makeLatencyMeter(smoothing = 0.05, jump = LATENCY_JUMP) {
  let v = null;
  return (ctx) => {
    const d = outputDelay(ctx);
    v = (v == null || Math.abs(d - v) > jump) ? d : v + smoothing * (d - v);
    return v;
  };
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
