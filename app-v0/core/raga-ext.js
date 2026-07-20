// Extended raga data (feature "C"): janaka mela, C16+comma swaras, arohana /
// avarohana / phrases. Hand-authorable overlay merged on top of the generated
// raga-base.json; see docs/raga-preview-design.md.
//
// This module holds the runtime store + the PURE derivations shared by the
// generator (tools/gen-raga-ext.mjs) and the app.
import { S_STEP, P_STEP } from './shruti.js';
import { presentVarieties, stepForVariety, melaForRaga, jiAb } from './melakarta.js';
import { ragaSwaras } from './reference.js';

let RAGAEXT = {};

// Node/test path: load the overlay if it exists (it may not before generation).
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    RAGAEXT = JSON.parse(readFileSync(join(HERE, 'raga-ext.json'), 'utf8'));
  } catch { RAGAEXT = {}; }
}

export function setRagaExt(data) { RAGAEXT = data || {}; }
export function getRagaExt(name) { return RAGAEXT[name] || null; }
export function allRagaExt() { return RAGAEXT; }

// The raga's distinct swaras, ascending. Uses ragaSwaras so same-note case
// variants collapse (e.g. malayamarutham's s/S, r/R … → S R G M P D N) instead
// of emitting every key.
function orderedLetters(c12) {
  return ragaSwaras(c12).map((e) => e.swara);
}

// Straight scale up/down as srgm. Octave shifts (> / <) PERSIST, so aroha and
// avaroha are written as ONE continuous phrase: ascend to the upper S, then
// descend. e.g. mohanam → arohana "S R G P D >S", avarohana "S <D P G R S"
// (the leading S is the sustained upper S; `<D` drops back to the base octave).
// Concatenated they read "… >S S <D P G R S" — no double octave shift.
export function deriveArohaAvarohana(c12) {
  if (!c12) return { arohana: '', avarohana: '' };
  const letters = orderedLetters(c12);           // [S, …ascending…]
  const desc = letters.slice(1).reverse();       // notes above S, high→low
  return {
    arohana: `${letters.join(' ')} >S`,
    avarohana: desc.length ? `S <${desc.join(' ')} S` : 'S S',
  };
}

// The raga's shrutis in C16 + comma, e.g. "S R2a G3a P D2a >S". Varieties from
// C12; commas from the janaka mela's JI-nearest. '' if unknown.
export function ragaSwarasC16(ragas, name) {
  const c = ragas?.[name]?.C12_SWARAS;
  if (!c) return '';
  const pv = presentVarieties(ragas, name);
  const mela = melaForRaga(ragas, name);
  const commas = mela ? jiAb(ragas, mela.n) : {};
  const toks = orderedLetters(c).map((L) =>
    (L === 'S' || L === 'P') ? L : `${L}${pv[L] ?? ''}${commas[L] || ''}`);
  return `${toks.join(' ')} >S`;
}

// Parse a C16+comma swaras string into a partial 53-EDO scale {S,P,+present:step}
// for the playback retune. Ignores S/P/octave tokens (S=0, P fixed already set).
export function scaleFromC16(str) {
  const scale = { S: S_STEP, P: P_STEP };
  for (const tok of String(str || '').split(/\s+/).filter(Boolean)) {
    const m = /^([RGMDN])([123])([ab])?$/.exec(tok);
    if (m) {
      const step = stepForVariety(m[1], Number(m[2]), m[3] || 'a');
      if (step != null) scale[m[1]] = step;
    }
  }
  return scale;
}
