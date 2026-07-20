// The 72 melakarta (Kanakangi–Ratnangi scheme). Names follow the Katapayadi
// convention — the first two consonants encode the mela number (e.g. Ma-Ya =
// 5,1 → 51 reversed → 15 = Mayamalavagowla). Grouped into the 12 chakras of 6.
//
// The variety numbers ({R,G,D,N}=1..3, M=1..2) are NOT stored: they derive at
// runtime from each mela's 12-EDO note names already in raga-base.json. This
// module owns the names + the derivation, and maps a mela onto the 53-EDO strip.
import { PITCH_CLASS } from './tuning.js';
import { BOXES, S_STEP, P_STEP, EDO } from './shruti.js';

export const CHAKRAS = [
  'Indu', 'Netra', 'Agni', 'Veda', 'Bana', 'Rutu',
  'Rishi', 'Vasu', 'Brahma', 'Disi', 'Rudra', 'Aditya',
];

// 1-based; index 0 is a placeholder so MELA_NAMES[n] reads naturally.
export const MELA_NAMES = [
  null,
  'Kanakangi', 'Ratnangi', 'Ganamurti', 'Vanaspati', 'Manavati', 'Tanarupi',
  'Senavati', 'Hanumatodi', 'Dhenuka', 'Natakapriya', 'Kokilapriya', 'Rupavati',
  'Gayakapriya', 'Vakulabharanam', 'Mayamalavagowla', 'Chakravakam', 'Suryakantam', 'Hatakambari',
  'Jhankaradhwani', 'Natabhairavi', 'Keeravani', 'Kharaharapriya', 'Gourimanohari', 'Varunapriya',
  'Mararanjani', 'Charukesi', 'Sarasangi', 'Harikambhoji', 'Dheerasankarabharanam', 'Naganandini',
  'Yagapriya', 'Ragavardhini', 'Gangeyabhushani', 'Vagadheeswari', 'Shulini', 'Chalanata',
  'Salagam', 'Jalarnavam', 'Jhalavarali', 'Navaneetam', 'Pavani', 'Raghupriya',
  'Gavambhodi', 'Bhavapriya', 'Shubhapantuvarali', 'Shadvidhamargini', 'Suvarnangi', 'Divyamani',
  'Dhavalambari', 'Namanarayani', 'Kamavardhini', 'Ramapriya', 'Gamanashrama', 'Vishwambhari',
  'Shamalangi', 'Shanmukhapriya', 'Simhendramadhyamam', 'Hemavati', 'Dharmavati', 'Neetimati',
  'Kantamani', 'Rishabhapriya', 'Latangi', 'Vachaspati', 'Mechakalyani', 'Chitrambari',
  'Sucharitra', 'Jyotiswarupini', 'Dhatuvardhani', 'Nasikabhushani', 'Kosalam', 'Rasikapriya',
];

// The chakra (1..12) and 1..6 position within it, for a mela number.
export function chakraOf(n) {
  return { chakra: Math.ceil(n / 6), name: CHAKRAS[Math.ceil(n / 6) - 1], pos: ((n - 1) % 6) + 1 };
}

// semitone-above-Sa -> variety number, per swara. Keyed by swara letter so the
// r2=g1 / d2=n1 overlaps never collide.
const VARIETY = {
  R: { 1: 1, 2: 2, 3: 3 }, G: { 2: 1, 3: 2, 4: 3 }, M: { 5: 1, 6: 2 },
  D: { 8: 1, 9: 2, 10: 3 }, N: { 9: 1, 10: 2, 11: 3 },
};

// Derive {R,G,M,D,N} variety numbers for mela n from raga-base's 12-EDO notes.
export function melaVarieties(ragas, n) {
  const c = ragas?.[`mela_${n}`]?.C12_SWARAS;
  if (!c) return null;
  const sa = PITCH_CLASS[c.S] ?? 0;
  const out = {};
  for (const L of ['R', 'G', 'M', 'D', 'N']) {
    const semis = (((PITCH_CLASS[c[L]] ?? 0) - sa) % 12 + 12) % 12;
    const v = VARIETY[L][semis];
    if (v == null) return null;
    out[L] = v;
  }
  return out;
}

// Lookups built from BOXES:
//  VARIETY_STEP[letter][number][comma] -> 53-EDO step
//  STEP_VARIETY[letter][step]          -> variety number  (reverse, a OR b)
//  STEP_COMMA[step]                    -> 'a' | 'b'
const VARIETY_STEP = {};
const STEP_VARIETY = {};
const STEP_COMMA = {};
for (const b of BOXES) {
  for (const nm of b.names) {
    const L = nm[0];
    if (!'RGMDN'.includes(L)) continue;
    const num = Number(nm[1]);
    const comma = nm.slice(-1);            // 'a' | 'b'
    ((VARIETY_STEP[L] ??= {})[num] ??= {})[comma] = b.step;
    (STEP_VARIETY[L] ??= {})[b.step] = num;
    STEP_COMMA[b.step] = comma;
  }
}

export function commaOf(step) { return STEP_COMMA[step] || 'a'; }

// 5-limit just-intonation target (cents) for each swara variety. The default
// comma is whichever of the two 53-EDO shrutis (a/b) sits closest to this — so
// e.g. Shankarabharanam defaults to the just major scale (9/8, 5/4, 4/3, 5/3, 15/8).
const JI_CENTS = {
  R1: 111.73, R2: 203.91, R3: 315.64,          // 16/15, 9/8, 6/5
  G1: 182.40, G2: 315.64, G3: 386.31,          // 10/9, 6/5, 5/4
  M1: 498.04, M2: 590.22,                       // 4/3, 45/32
  D1: 813.69, D2: 884.36, D3: 1017.60,          // 8/5, 5/3, 9/5
  N1: 884.36, N2: 1017.60, N3: 1088.27,         // 5/3, 9/5, 15/8
};
const centsOf = (step) => (step / EDO) * 1200;

// The a/b comma nearest the just-intonation ratio for variety `${letter}${num}`.
export function jiComma(letter, num) {
  const pair = VARIETY_STEP[letter][num];
  const target = JI_CENTS[`${letter}${num}`];
  return Math.abs(centsOf(pair.a) - target) <= Math.abs(centsOf(pair.b) - target) ? 'a' : 'b';
}

// The JI-nearest comma choice for every swara of mela n → {R,G,M,D,N: 'a'|'b'}.
export function jiAb(ragas, n) {
  const v = melaVarieties(ragas, n);
  if (!v) return null;
  return Object.fromEntries(['R', 'G', 'M', 'D', 'N'].map((L) => [L, jiComma(L, v[L])]));
}

// Mela number whose 12-EDO scale is the major scale (JI major default).
export const MAJOR_MELA = 29;   // Dheerasankarabharanam

// Build the full 53-EDO scale {S,R,G,M,P,D,N: step} for mela n with a per-swara
// a/b comma choice (ab = {R,G,M,D,N: 'a'|'b'}, defaulting to 'a'). null if n bad.
export function melaScale(ragas, n, ab = {}) {
  const v = melaVarieties(ragas, n);
  if (!v) return null;
  const s = { S: S_STEP, P: P_STEP };
  for (const L of ['R', 'G', 'M', 'D', 'N']) s[L] = VARIETY_STEP[L][v[L]][ab[L] || 'a'];
  return s;
}

// The mela that best matches a composition's Raga= (name). A mela name maps
// directly; a janya raga → the LOWEST-numbered mela whose scale is a superset of
// the raga's present swaras (its janaka for common ragas). null if no match.
// Variety numbers of the present variable swaras of a raga (from its C12 notes).
// e.g. mohanam → {R:2, G:3, D:2} (M, N absent).
export function presentVarieties(ragas, name) {
  const c = ragas?.[name]?.C12_SWARAS;
  if (!c) return {};
  const sa = PITCH_CLASS[c.S] ?? 0;
  const out = {};
  for (const L of ['R', 'G', 'M', 'D', 'N']) {
    if (c[L] == null) continue;
    const semis = (((PITCH_CLASS[c[L]] ?? 0) - sa) % 12 + 12) % 12;
    const v = VARIETY[L][semis];
    if (v != null) out[L] = v;               // skip notes that aren't a standard variety
  }
  return out;
}

// 53-EDO step for a swara variety + a/b comma (e.g. R,2,'a' → 8), or null.
export function stepForVariety(letter, num, comma = 'a') {
  return VARIETY_STEP[letter]?.[num]?.[comma] ?? null;
}

export function melaForRaga(ragas, name) {
  if (!name || name === 'c12') return null;   // c12 = chromatic, not a raga to match
  const m = /^mela_(\d+)$/.exec(name);
  if (m) { const n = Number(m[1]); return n >= 1 && n <= 72 ? { n, name: MELA_NAMES[n] } : null; }
  if (!ragas?.[name]?.C12_SWARAS) return null;
  const want = presentVarieties(ragas, name);
  if (!Object.keys(want).length) return null;
  for (let n = 1; n <= 72; n++) {
    const mv = melaVarieties(ragas, n);
    if (mv && Object.entries(want).every(([L, v]) => mv[L] === v)) return { n, name: MELA_NAMES[n] };
  }
  return null;
}

// Reverse: which mela (if any) a built scale {R,G,M,D,N: step} corresponds to,
// ignoring the a/b comma. Returns {n, name} or null (non-melakarta).
export function melaOfScale(ragas, scale) {
  if (!scale) return null;
  const key = ['R', 'G', 'M', 'D', 'N'].map((L) => STEP_VARIETY[L]?.[scale[L]]).join(',');
  for (let n = 1; n <= 72; n++) {
    const v = melaVarieties(ragas, n);
    if (v && `${v.R},${v.G},${v.M},${v.D},${v.N}` === key) return { n, name: MELA_NAMES[n] };
  }
  return null;
}
