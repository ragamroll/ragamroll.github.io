// Playback-pitch retune: apply an experimental 53-EDO scale and/or a whole-audio
// semitone transpose to a built sequence's melody notes (n.freq). MIDI export
// never reads n.freq, so goldens stay exact; only the audio path (schedule.js)
// carries it. Shared by the app (composition playback) and the raga preview.
import { PITCH_CLASS } from './tuning.js';
import { stepForLetter, stepFreq } from './shruti.js';
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
// by index. `scale` = {S,R,G,M,P,D,N: 53-EDO step} (partial ok); `shift` = a
// semitone transpose (0 = none).
export function applyPlaybackPitch(seq, model, scale, saBase, shift) {
  if (!scale && !shift) return;                 // pure 12-TET, no override → default path
  const notes = seq.tracks[0].notes;
  const PER = seq.ppq / 2;                        // buildSequence: 1 length-unit = eighth
  let i = 0;
  for (const e of model.events) {
    if (e.type !== 'note' || e.rest) continue;
    if (Math.round(e.absLen * PER) <= 0) continue;
    const m = notes[i]?.pitch;
    if (m != null) {
      const step = scale ? stepForLetter(scale, e.swara) : null;
      if (step != null) {
        const saMidi = m - mod12(m - saBase) + shift;   // Sa at this note's octave, transposed
        notes[i].freq = stepFreq(midiToFreq(saMidi), step);
      } else if (shift) {
        notes[i].freq = midiToFreq(m + shift);          // 12-TET note, transposed
      }
    }
    i++;
  }
}
