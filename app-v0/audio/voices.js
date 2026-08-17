import { SAMPLE_SETS } from './sampler.js';

// The melody voices, in ONE list.
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
export const SYNTH_VOICES = [
  ['soft-am', 'Soft'],
  ['bowed-fm', 'Bowed'],
  ['reed', 'Reed'],
  ['pluck', 'Pluck'],
];

// The sampled sets come last, and marked: they are the ones that need the network. Offline,
// or before they arrive, they play as a synth and say nothing about it, which is better
// than silence and better than a warning nobody can act on.
export const SAMPLED_VOICES = Object.entries(SAMPLE_SETS).map(([k, v]) => [k, v.label + ' ◆']);

export const MELODY_VOICES = [...SYNTH_VOICES, ...SAMPLED_VOICES];

export const isVoice = (name) => MELODY_VOICES.some(([v]) => v === name);
