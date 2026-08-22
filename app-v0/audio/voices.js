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
  ['pluckz', 'Pluckz'],
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
  { key: 'body1', label: 'Low body', min: -12, max: 18, step: 0.5, unit: 'dB',
    help: 'The lowest body resonance — the weight of the instrument.' },
  { key: 'body2', label: 'Body', min: -12, max: 18, step: 0.5, unit: 'dB',
    help: 'The middle resonance.' },
  { key: 'body3', label: 'Voice', min: -12, max: 18, step: 0.5, unit: 'dB',
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
  dampening: 4200, sustain: 6, attackNoise: 1, pickMul: 7, detune: 1, drive: 0, body1: -6,
  body2: 12, body3: 9, bodyHz: [130, 450, 760], bodyQ: [0.7, 0.9, 1.1], tameHz: 1500,
  damping: 4, roomSize: 0.22, roomWet: 0.05, out: 1,
};

// PLUCKZ — the tone of the buzz-string notation player, reproduced rather than approximated.
//
// It is here for one reason: that player's gamaka database, 3242 raga-specific ornaments,
// was authored BY EAR against this timbre. An imported shape played on the tone it was
// judged on can be compared with the original; played on anything else, a difference could
// be the ornament or could be the instrument, and there is no way to tell which.
//
// Only the pick is a number anyone would move — the tone itself is a fixed harmonic table
// per register, and moving it would make this a different instrument with no claim to
// reproduce anything. All three settled by ear on real phrases:
//
//   pick       how much attack. At 0 no pick is built at all, which gives an exact copy of
//              the original tone — which has no attack transient whatsoever.
//   pickDecay  how long it lasts. Keep it under about a quarter of a second: noise audible
//              for longer is heard as noise rather than as an attack, whatever its colour.
//              A pick's contact with a string lasts milliseconds.
//   pickTop    how bright the attack STARTS, as a multiple of the note — the burst sweeps
//              down from there to about the third harmonic, because a real pluck's noise
//              dies bright-first.
//   saHz       what Sa is sounding at, in Hz. NOT a setting — the host tells the voice, and
//              the register tables are read against it, so the same swara keeps the same
//              tone whatever Sa the piece is played at. The default is this app's own
//              default Sa (C4) so a host that never says anything still gets sensible
//              registers.
// The register is read RELATIVE TO SA, not in Hz — and that is a departure from the original
// worth being clear about.
//
// There, the tables are chosen by absolute frequency, so the same phrase played higher up
// genuinely thins out. Its veena also sits low: its page opens on sruthi E with the veena's
// own quarter-frequency, which puts sa at 164.8Hz. This app's default Sa is C4, an octave
// above that, and the two together were the whole complaint — measured over the Abhogi
// varnam, 495 of its 574 notes landed on the five-partial table here where the original put
// 131, and the thirteen-partial table with the robbed fundamental was never reached at all.
// The instrument was not wrong; it was being played an octave above where it lives.
//
// Keyed to Sa, the same swara gets the same table whatever Sa is set to, which is what this
// voice is FOR: the imported gamaka shapes were authored against a timbre, and a comparison
// only means something if the notes are on the tone they were judged on. The ratios below
// are the original's own thresholds at the sruthi its page opens on, so at that sruthi this
// makes exactly the choice it makes.
export const PLUCKZ_REF_SA = 164.8;      // 5233 * 1.0594631^4 / 40 — its veena sa at sruthi E
export const PLUCKZ_TABLES = [
  // partials[0] is the FUNDAMENTAL. (These came from Web Audio `real` arrays, whose index 0
  // is DC; the leading zero is already dropped.)
  { below: 150 / PLUCKZ_REF_SA, partials: [2, 40, 50, 80, 70, 60, 40, 30, 30, 25, 20, 10, 5] },
  { below: 280 / PLUCKZ_REF_SA, partials: [10, 20, 18, 20, 6, 13, 10, 10, 2] },
  { below: Infinity, partials: [13, 20, 11, 5, 5] },
];
export const pluckzTable = (freq, saHz) =>
  PLUCKZ_TABLES.find((t) => freq / (saHz > 0 ? saHz : 261.6255653) < t.below).partials;

export const PLUCKZ_DEFAULTS = { pick: 0.2, pickDecay: 0.08, pickTop: 12, out: 0, saHz: 261.6255653005986 };

// Slider position (0..1) <-> value, for the three scales. The panel stores and applies the
// VALUE; only the travel is bent.
// NAMED SETTINGS, so a reader can pick a starting point instead of finding one. A preset is
// a whole instrument — every value, including the ones the panel does not show — because
// half an instrument applied over another is neither.
//
// The names are honest about what they are: a synthesis, not a recording. What is here is a
// heavier string over a box tuned differently from the plain one, which is a good deal of
// what tells one plucked instrument from another; whether it passes for the instrument a
// player would name is a judgement for that player, and the panel is right there.
export const STRING_PRESETS = [
  // The built-in setting comes first and carries no values of its own: it IS whatever
  // STRING_DEFAULTS is, so making a setting the default does not leave a preset quietly
  // claiming to be something else.
  { name: 'Veena-ish', values: null },
  // The plainer string this started as, kept because it is still a good one and because a
  // default that cannot be got back from is a decision taken away from a reader.
  { name: 'Plain', values: {
    dampening: 2717.0971011239694, sustain: 6, attackNoise: 1.8,
    pickMul: 5.364893652938356, detune: 1.0024, drive: 0, body1: 10, body2: 6.5, body3: 14,
    bodyHz: [105, 200, 430], bodyQ: [0.8, 1, 1.3], tameHz: 1300, damping: 5,
    roomSize: 0.22, roomWet: 0.08, out: 1,
  } },
];


// Reading an instrument back IN — the other half of the panel's ⭳ Save.
//
// Stricter than JSON.parse on purpose, and it refuses WHOLE rather than taking the part it
// understands: a key this build does not have is either a typo or a parameter from another
// build, and half an instrument laid over another is neither — the same reason a preset is
// applied entire. What it does NOT refuse is an old file that is missing settings added
// since: those come from the built-ins and the reader is told which, because a file that
// still loads and says what it lacked is worth more than one that is rejected.
//
// A value no slider can reach is held at the end of its travel. The panel would otherwise
// show a number the reader can look at and never get back to once anything is moved.
const PARAM_BY_KEY = new Map(STRING_PARAMS.map((p) => [p.key, p]));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function readInstrument(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { return { ok: false, error: 'That file is not JSON. The panel writes the kind it reads with ⭳ Save.' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'That JSON is not a settings object.' };

  const unknown = Object.keys(raw).filter((k) => !(k in STRING_DEFAULTS));
  if (unknown.length)
    return { ok: false, error: `${unknown.join(', ')} ${unknown.length > 1 ? 'are not settings' : 'is not a setting'} this build has, so nothing was changed.` };

  const values = { ...STRING_DEFAULTS };
  const notes = [];
  for (const [k, val] of Object.entries(raw)) {
    const def = STRING_DEFAULTS[k];
    if (Array.isArray(def)) {
      if (!Array.isArray(val) || val.length !== def.length || !val.every(isNum))
        return { ok: false, error: `${k} should be ${def.length} numbers, so nothing was changed.` };
      values[k] = val.slice();
      continue;
    }
    if (!isNum(val)) return { ok: false, error: `${k} should be a number, so nothing was changed.` };
    const p = PARAM_BY_KEY.get(k);
    const held = p ? Math.max(p.min, Math.min(p.max, val)) : val;
    if (held !== val) notes.push(`${p.label} was ${val}, past what this build's slider reaches — held at ${held}`);
    values[k] = held;
  }

  const missing = Object.keys(STRING_DEFAULTS).filter((k) => !(k in raw));
  if (missing.length)
    notes.push(`${missing.join(', ')} ${missing.length > 1 ? 'were' : 'was'} not in the file and ${missing.length > 1 ? 'are' : 'is'} at the built-in value`);

  return { ok: true, values, notes };
}


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
//
// Pluckz is NOT here, and that is a decision rather than an omission. Its numbers were
// settled by ear against real phrases and it exists to reproduce one particular tone —
// the one 3242 imported gamaka shapes were authored against — so a panel that let the tone
// drift would defeat what it is for. The three that anyone would want to move are on the
// voice (PLUCKZ_DEFAULTS below, reachable through the backend's setVoiceParam), so a reader
// who wants them is one line from them; they are simply not offered as sliders.
export const TUNABLE = new Set(['pluck', 'veena']);
export const isTunable = (name) => TUNABLE.has(name);

export const isVoice = (name) => MELODY_VOICES.some(([v]) => v === name);
