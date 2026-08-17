// The melody voices, in ONE list.
//
// All synthesised. There were four sampled sets too — violin, flute, guitar, harmonium,
// fetched from a CDN when picked — and they are gone: a plucked string that answers the same
// way twice is worth more here than a recording that has to arrive over the network, cannot
// bend through a gamaka without dragging its formants with it, and plays as a synth whenever
// it is late or the reader is offline.
//
// There were three: the backend's switch, the app's picker and the lane editor's <select>.
// Two of the picker's entries — `pluck` and `reed-fm` — named voices the backend had never
// heard of, so they fell through its default and played as the bowed synth. Nothing said
// so: a switch's default is exactly the shape that swallows a name it does not know, and
// the picker went on offering four synth voices and delivering three, one of them twice.
//
// So the names live here, the pickers are built from this, and the backend tags each voice
// it builds with the name of the case that built it — which is what lets a guard catch the
// next one of these by asking for a voice and being told what it actually got.
//
// Tone is deliberately NOT imported here. This is a list of names, and a page that only
// wants to draw a menu should not pull 350KB of synthesiser to do it.
// Pluck leads because it is the one built from parts and the one with a panel: it is what
// this app sounds like now, and the default a reader meets.
export const SYNTH_VOICES = [
  ['pluck', 'Pluck'],
  ['soft-am', 'Soft'],
  ['bowed-fm', 'Bowed'],
  ['reed', 'Reed'],
];

export const MELODY_VOICES = SYNTH_VOICES;

// What the panel can move, in the order it shows them: the name a player would use, the
// range, and how the slider travels across it.
//
// SCALE matters more than it sounds. A slider linear in a quantity the ear hears
// logarithmically is a slider that does nothing for two thirds of its travel and everything
// in the last inch — which is exactly what the first version of this panel did:
//
//   Sustain was linear in LOOP GAIN. Half the travel bought 0.6s of decay; the last tenth
//   bought twenty-five. It is in SECONDS now, and the gain is worked out per note.
//
//   Brightness was linear in Hz across four octaves, so the first octave had 7% of the
//   slider and the right two thirds all sounded bright. It is logarithmic now, like hearing.
//
// `log` means the slider position is mapped exponentially onto [min,max]; `lin` is plain.
export const STRING_PARAMS = [
  { key: 'dampening', label: 'Brightness', min: 250, max: 7000, scale: 'log', unit: 'Hz',
    help: 'Where the string loses its highs. Low is a heavy wound string; high is a wire.' },
  { key: 'sustain', label: 'Sustain', min: 0.2, max: 9, step: 0.1, scale: 'log', unit: 's',
    help: 'How long a note takes to die away — the same time at every pitch, which a bare comb filter does not give you.' },
  { key: 'attackNoise', label: 'Pick length', min: 0.3, max: 8, step: 0.1, scale: 'log', unit: '×',
    help: 'Periods of noise in the pluck. A plectrum is short and hard; a finger is long and soft.' },
  { key: 'pickMul', label: 'Pick brightness', min: 1.5, max: 20, scale: 'log', unit: '×',
    help: 'How much of the pick the string can carry, as a multiple of the note.' },
  { key: 'drive', label: 'Drive', min: 0, max: 0.9, step: 0.01, scale: 'curve',
    help: 'Soft clipping, with its loudness taken back out. A little thickens the tone; a lot breaks the note up.' },
  { key: 'body1', label: 'Low body', min: 0, max: 18, step: 0.5, unit: 'dB',
    help: 'The lowest body resonance — the weight of the instrument.' },
  { key: 'body2', label: 'Body', min: 0, max: 18, step: 0.5, unit: 'dB',
    help: 'The middle resonance.' },
  { key: 'body3', label: 'Voice', min: 0, max: 18, step: 0.5, unit: 'dB',
    help: 'The upper resonance — where the instrument speaks.' },
  { key: 'damping', label: 'Damping', min: 0, max: 24, step: 1, unit: 'dB',
    help: 'How much of the top the body absorbs. RIGHT IS MORE — it was the other way round, and read as reversed because it was.' },
  { key: 'roomWet', label: 'Room', min: 0, max: 0.4, step: 0.01,
    help: 'A little space. Too much and a fast phrase smears into one chord.' },
  { key: 'detune', label: 'Pair', min: 1, max: 1.012, step: 0.0002, unit: '¢',
    help: 'The second string of the course. The slow beating between the pair is what "full" means.' },
  { key: 'out', label: 'Level', min: -24, max: 6, step: 1, unit: 'dB', help: '' },
];

// A heavy wound string over a large box: dark (the highs go first), long enough to ring under
// the hand, and the box speaks low. Picked with a soft finger rather than a plectrum.
//
// Sustain is the number to be careful with, and it is a TIME to sixty decibels down: six
// seconds is a string that rings under the hand, one second is a note that is stopped almost
// as it speaks. At a loop gain of .998 — before this was a time at all — it barely decayed,
// half a decibel a second, and a plucked note that does not decay is what a compressor
// sounds like, which is exactly what this voice was accused of.
export const STRING_DEFAULTS = {
  dampening: 1250, sustain: 6, attackNoise: 1.8, pickMul: 4, detune: 1.002, drive: 0,
  body1: 9, body2: 6, body3: 3, bodyHz: [105, 200, 430], bodyQ: [0.8, 1.0, 1.3],
  tameHz: 1300, damping: 15, roomSize: 0.22, roomWet: 0.08, out: -4,
};

// Slider position (0..1) <-> value, for the three scales. The panel stores and applies the
// VALUE; only the travel is bent.
export function fromSlider(p, t) {
  const x = Math.max(0, Math.min(1, t));
  if (p.scale === 'log') return p.min * Math.pow(p.max / p.min, x);
  if (p.scale === 'curve') return p.min + (p.max - p.min) * x * x;   // the knee is early
  return p.min + (p.max - p.min) * x;
}
export function toSlider(p, v) {
  const val = Math.max(p.min, Math.min(p.max, v));
  if (p.scale === 'log') return Math.log(val / p.min) / Math.log(p.max / p.min);
  if (p.scale === 'curve') return Math.sqrt((val - p.min) / (p.max - p.min));
  return (val - p.min) / (p.max - p.min);
}

// Which voices have an instrument panel. Only the plucked string is built from parts a
// reader can move; the rest are Tone presets with nothing meaningful to expose.
export const TUNABLE = new Set(['pluck', 'veena']);
export const isTunable = (name) => TUNABLE.has(name);

export const isVoice = (name) => MELODY_VOICES.some(([v]) => v === name);
