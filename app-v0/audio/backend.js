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
 * @property {(events: ScheduledEvent[], totalSec: number, opts?: {talaGain?: number}) => (void|Promise<void>)} load  // talaGain (0..1) scales tala velocity
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
 * @property {(freqs: number[], vol?: number) => void} setDrone  // constant drone at these freqs, vol 0..1; vol<=0 / empty = off. Same freqs + new vol changes loudness without re-voicing. Independent of the transport
 * @property {() => void} droneOff         // silence the drone
 * @property {() => void} dispose          // release audio resources (incl. drone)
 * @property {?(() => void)} onended       // fires exactly once when playback reaches the end; the backend then enters a stopped state and position() reads 1 until load()/stop() resets it
 */
export {};
