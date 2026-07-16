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
 * @property {(events: ScheduledEvent[], totalSec: number) => (void|Promise<void>)} load
 * @property {() => Promise<void>} play    // start from 0, or resume from pause; awaits audio unlock
 * @property {() => void} pause            // freeze; position() holds
 * @property {() => void} stop             // stop + reset position() to 0
 * @property {() => number} position       // 0..1 fraction of totalSec elapsed
 * @property {() => void} dispose          // release audio resources
 * @property {?(() => void)} onended       // fires exactly once when playback reaches the end; the backend then enters a stopped state and position() reads 1 until load()/stop() resets it
 */
export {};
