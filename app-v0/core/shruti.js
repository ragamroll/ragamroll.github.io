// Experimental 22-shruti scale model on 53-EDO. Pure — no DOM, no audio.
//
// The 12 variable swaras each have two microtonal variants (a, b) one 53-EDO
// comma apart; some positions are shared between neighbouring swaras
// (r2=g1, r3=g2, d2=n1, d3=n2), so the 30 named variants collapse to 22
// distinct steps across the octave (S..P..S'). Selection picks one shruti per
// swara slot: two in the R/G region (lower→R, higher→G), two in D/N
// (lower→D, higher→N), one M. S(0) and P(31) are fixed.

export const EDO = 53;
export const S_STEP = 0;
export const P_STEP = 31;
export const OCTAVE_STEP = 53;

// Every selectable box: 53-EDO step + the swara-variety name(s) it carries.
// Shared steps list both names (R-name first, so the lower slot reads left).
export const BOXES = [
  { step: 0,  names: ['S'],          fixed: true },
  { step: 4,  names: ['R1a'],        region: 'RG', pair: 'R1' },
  { step: 5,  names: ['R1b'],        region: 'RG', pair: 'R1' },
  { step: 8,  names: ['R2a', 'G1a'], region: 'RG', pair: 'R2' },
  { step: 9,  names: ['R2b', 'G1b'], region: 'RG', pair: 'R2' },
  { step: 13, names: ['R3a', 'G2a'], region: 'RG', pair: 'R3' },
  { step: 14, names: ['R3b', 'G2b'], region: 'RG', pair: 'R3' },
  { step: 17, names: ['G3a'],        region: 'RG', pair: 'G3' },
  { step: 18, names: ['G3b'],        region: 'RG', pair: 'G3' },
  { step: 22, names: ['M1a'],        region: 'M',  pair: 'M1' },
  { step: 23, names: ['M1b'],        region: 'M',  pair: 'M1' },
  { step: 26, names: ['M2a'],        region: 'M',  pair: 'M2' },
  { step: 27, names: ['M2b'],        region: 'M',  pair: 'M2' },
  { step: 31, names: ['P'],          fixed: true },
  { step: 35, names: ['D1a'],        region: 'DN', pair: 'D1' },
  { step: 36, names: ['D1b'],        region: 'DN', pair: 'D1' },
  { step: 39, names: ['D2a', 'N1a'], region: 'DN', pair: 'D2' },
  { step: 40, names: ['D2b', 'N1b'], region: 'DN', pair: 'D2' },
  { step: 44, names: ['D3a', 'N2a'], region: 'DN', pair: 'D3' },
  { step: 45, names: ['D3b', 'N2b'], region: 'DN', pair: 'D3' },
  { step: 48, names: ['N3a'],        region: 'DN', pair: 'N3' },
  { step: 49, names: ['N3b'],        region: 'DN', pair: 'N3' },
];

const BY_STEP = new Map(BOXES.map((b) => [b.step, b]));
export function boxAt(step) { return BY_STEP.get(step) || null; }

// The a/b twin of a variant (same `pair`), or null for fixed / lone steps.
export function twin(step) {
  const b = BY_STEP.get(step);
  if (!b || b.fixed) return null;
  const t = BOXES.find((o) => o.pair === b.pair && o.step !== step);
  return t ? t.step : null;
}

export function regionOf(step) { return BY_STEP.get(step)?.region || null; }

// The variety label a step should show when it fills a given slot letter,
// e.g. shared step 8 reads 'R2a' as R but 'G1a' as G.
export function nameForSlot(step, letter) {
  const b = BY_STEP.get(step);
  if (!b) return '';
  return b.names.find((n) => n[0].toUpperCase() === letter.toUpperCase()) || b.names[0];
}

// Collapse a set/array of selected steps into a scale {S,R,G,M,P,D,N} of
// 53-EDO steps, or null if the selection is not a complete 7-swara scale
// (needs exactly 2 in R/G, 1 in M, 2 in D/N). Lower pick → R/D, higher → G/N.
export function selectionToScale(selected) {
  const steps = [...selected];
  const rg = steps.filter((s) => regionOf(s) === 'RG').sort((a, b) => a - b);
  const m  = steps.filter((s) => regionOf(s) === 'M');
  const dn = steps.filter((s) => regionOf(s) === 'DN').sort((a, b) => a - b);
  if (rg.length !== 2 || m.length !== 1 || dn.length !== 2) return null;
  return { S: S_STEP, R: rg[0], G: rg[1], M: m[0], P: P_STEP, D: dn[0], N: dn[1] };
}

// 53-EDO step of a swara LETTER in a scale (case-insensitive). S/P are fixed;
// R/G/M/D/N come from the override; anything else → null (leave 12-TET).
export function stepForLetter(scale, letter) {
  const L = String(letter).toUpperCase();
  if (L === 'S') return S_STEP;
  if (L === 'P') return P_STEP;
  if (scale && L in scale && 'RGMDN'.includes(L)) return scale[L];
  return null;
}

// Frequency of a 53-EDO step above the octave's Sa frequency.
export function stepFreq(saFreq, step) { return saFreq * Math.pow(2, step / EDO); }
