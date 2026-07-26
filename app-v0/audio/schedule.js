// Pure scheduling math: turn a MIDI sequence into timed note events. No DOM, no Tone.
import { sampleCurve } from '../core/gamaka-inline.js';

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}
const EDO = 53;   // gamaka curve deltas are 53-EDO steps relative to the note

function secPerTick(sequence) {
  return 60 / sequence.tempoBpm / sequence.ppq;
}

export function scheduleEvents(sequence) {
  const spt = secPerTick(sequence);
  const events = [];
  for (const track of sequence.tracks) {
    const name = track.channel === 0 ? 'melody' : 'tala';
    for (const n of track.notes) {
      const startSec = n.startTicks * spt, durSec = n.durTicks * spt;
      const freq = n.freq;
      const ev = { midi: n.pitch, startSec, durSec, track: name };
      // Optional microtonal override (experimental 53-EDO scale). Absent unless
      // an app-level retune set it — so the default event shape is unchanged.
      if (freq != null) ev.freq = freq;
      // Inline gamaka (melody only): sample the note-relative curve to a uniform
      // frequency array over the note's span. baseFreq = the note's own freq
      // (retuned shruti, or 12-TET midi); a delta of d 53-EDO steps scales it by
      // 2^(d/53). The backend ramps the voice's frequency through this array.
      if (name === 'melody' && Array.isArray(n.gamaka) && n.gamaka.length >= 2) {
        const base = freq != null ? freq : midiToFreq(n.pitch), N = 48;
        const arr = new Float32Array(N);
        for (let k = 0; k < N; k++) arr[k] = base * Math.pow(2, sampleCurve(n.gamaka, k / (N - 1)) / EDO);
        ev.gamaka = arr;
      }
      events.push(ev);
    }
  }
  events.sort((a, b) => a.startSec - b.startSec);
  return events;
}

export function totalSeconds(sequence) {
  return sequence.totalTicks * secPerTick(sequence);
}
