// Note-name -> MIDI, JFugue convention: C5 = 60, midi = 12*octave + pc.
// This module is the pitch seam: today it emits 12-EDO integers matching
// jfugue's MusicStringParser.getNote().value + IntervalPatternTransformer.
// Non-12-EDO tunings (cents/frequency) plug in here later without touching
// the parser or renderers.
export const PITCH_CLASS = {
  'C': 0, 'B#': 0,
  'C#': 1, 'Db': 1,
  'D': 2,
  'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'E#': 5,
  'F#': 6, 'Gb': 6,
  'G': 7,
  'G#': 8, 'Ab': 8,
  'A': 9,
  'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

// MIDI -> note name, JFugue octave convention (C5 = 60). Sharps only.
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToName(midi) {
  return SHARP_NAMES[((midi % 12) + 12) % 12] + Math.floor(midi / 12);
}

export function noteToMidi(name, octave, semitones = 0) {
  if (name == null || name === 'R') return 0;      // rest
  const pc = PITCH_CLASS[name];
  if (pc === undefined) return 0;                  // unknown -> rest
  // JFugue quirk: octave 0 is the engine's default octave 5 (getNote("C0")==60).
  const oct = Number(octave) === 0 ? 5 : Number(octave);
  return 12 * oct + pc + Number(semitones);
}
