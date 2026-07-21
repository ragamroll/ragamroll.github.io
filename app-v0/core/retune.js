// Playback-pitch retune: tune a built sequence's melody notes to 53-EDO shrutis
// (n.freq) for audio. By DEFAULT every note is placed on its just-intonation
// 22-shruti (chosen by semitone from Sa — works for any raga and for c12); an
// explicit `scale` override (mela + a/b commas) wins per swara; `shift` transposes
// the whole thing. MIDI export never reads n.freq, so its 12-EDO goldens stay
// exact; only the audio path (schedule.js) carries the shruti frequencies. Shared
// by the app (composition playback) and the raga preview.
import { PITCH_CLASS } from './tuning.js';
import { stepForLetter, stepFreq, defaultShrutiStep } from './shruti.js';
import { midiToFreq } from '../audio/schedule.js';

const mod12 = (x) => ((x % 12) + 12) % 12;

// 12-TET pitch class of Sa for the model's active raga (incl. Raga transpose).
export function saBaseOf(model, ragas) {
  const rev = [...model.events].reverse();
  const key = rev.find((e) => e.type === 'raga')?.key || ['c12', '0'];
  const semis = Number.parseInt(key[1], 10) || 0;
  const saNote = ragas?.[key[0]]?.C12_SWARAS?.S ?? 'C';
  return (PITCH_CLASS[saNote] ?? 0) + semis;
}

// Iterates model.events with the SAME filter buildSequence uses → notes align
// by index. `scale` = {S,R,G,M,P,D,N: 53-EDO step} override (partial ok, may be
// null); `shift` = a semitone transpose (0 = none). Every melody note is retuned
// to a shruti: the override's step for that swara if present, else the default
// JI-12 shruti for the note's semitone above Sa.
export function applyPlaybackPitch(seq, model, scale, saBase, shift) {
  const notes = seq.tracks[0].notes;
  const PER = seq.ppq / 2;                        // buildSequence: 1 length-unit = eighth
  let i = 0;
  for (const e of model.events) {
    if (e.type !== 'note' || e.rest) continue;
    if (Math.round(e.absLen * PER) <= 0) continue;
    const m = notes[i]?.pitch;
    if (m != null) {
      const semitone = mod12(m - saBase);
      // Override wins per swara; otherwise the default shruti for this semitone.
      const step = (scale ? stepForLetter(scale, e.swara) : null) ?? defaultShrutiStep(semitone);
      const saMidi = m - semitone + shift;        // Sa at this note's octave, transposed
      notes[i].freq = stepFreq(midiToFreq(saMidi), step);
    }
    i++;
  }
}
