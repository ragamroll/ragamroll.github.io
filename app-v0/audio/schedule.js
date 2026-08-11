// Pure scheduling math: turn a MIDI sequence into timed note events. No DOM, no Tone.
import { sampleCurve, GAMAKA_SAMPLES } from '../core/gamaka-inline.js';

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
const EDO = 53;   // gamaka curve deltas are 53-EDO steps relative to the note

function secPerTick(sequence) {
  return 60 / sequence.tempoBpm / sequence.ppq;
}

/**
 * `range` — {from, to} in SECONDS — schedules only that stretch of the piece, with
 * everything shifted so the range begins at 0. That is how an A–B segment is played:
 * the backend stays a plain "play this list from the top" transport and never learns
 * what a marker is, so the capability belongs to every backend at once.
 *
 * The two tracks are cut DIFFERENTLY, and musically they have to be.
 *
 * A MELODY note straddling the boundary is CLIPPED and still sounds — a phrase does
 * not become silent because you asked to hear it from the middle. Its gamaka is
 * re-sampled over the surviving sub-range, so a note cut in half sounds ITS PORTION of
 * the ornament rather than the whole shape squeezed into less time. (This is the same
 * uStart/uEnd treatment `core/roll-audio.js` already gives it; the maths moves here so
 * both backends inherit it instead of one of them owning it.)
 *
 * A TALA stroke is kept only when its ONSET falls inside the range. Percussion cannot
 * be clipped into — re-striking a stroke whose attack already happened would put a
 * beat in the music that is not there. Same rule `roll-audio` applies to its strums.
 */
export function scheduleEvents(sequence, range) {
  const spt = secPerTick(sequence);
  const from = range && range.from > 0 ? range.from : 0;
  const to = range && range.to != null ? range.to : Infinity;
  const events = [];
  for (const track of sequence.tracks) {
    const name = track.channel === 0 ? 'melody' : 'tala';
    for (const n of track.notes) {
      const startSec = n.startTicks * spt, durSec = n.durTicks * spt;
      const endSec = startSec + durSec;
      if (endSec <= from || startSec >= to) continue;          // wholly outside the range
      if (name === 'tala' && startSec < from) continue;        // its attack already happened
      const a = Math.max(startSec, from), b = Math.min(endSec, to);
      // Which slice of this note's own span survived, as a fraction of it. A
      // zero-length note has no interior to address, so it keeps the whole curve.
      const u0 = durSec > 0 ? (a - startSec) / durSec : 0;
      const u1 = durSec > 0 ? (b - startSec) / durSec : 1;
      const freq = n.freq;
      const ev = { midi: n.pitch, startSec: a - from, durSec: b - a, track: name };
      // Optional microtonal override (experimental 53-EDO scale). Absent unless
      // an app-level retune set it — so the default event shape is unchanged.
      if (freq != null) ev.freq = freq;
      // Inline gamaka (melody only): sample the note-relative curve to a uniform
      // frequency array over the note's span. baseFreq = the note's own freq
      // (retuned shruti, or 12-TET midi); a delta of d 53-EDO steps scales it by
      // 2^(d/53). The backend ramps the voice's frequency through this array.
      if (name === 'melody' && Array.isArray(n.gamaka) && n.gamaka.length >= 2) {
        const base = freq != null ? freq : midiToFreq(n.pitch), N = GAMAKA_SAMPLES;
        const arr = new Float32Array(N);
        for (let k = 0; k < N; k++) arr[k] = base * Math.pow(2, sampleCurve(n.gamaka, u0 + (u1 - u0) * k / (N - 1)) / EDO);
        ev.gamaka = arr;
      }
      events.push(ev);
    }
  }
  events.sort((a, b) => a.startSec - b.startSec);
  return events;
}

// With a `range`, the length of the stretch actually scheduled — what `player.load`
// needs as its totalSec, so `position()` reads 0..1 across the segment. Clamped to the
// piece, so a `to` past the end does not report silence that will never play.
export function totalSeconds(sequence, range) {
  const full = sequence.totalTicks * secPerTick(sequence);
  if (!range) return full;
  const from = range.from > 0 ? range.from : 0;
  const to = Math.min(range.to != null ? range.to : full, full);
  return Math.max(0, to - from);
}
