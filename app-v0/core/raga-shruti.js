// Maps a raga onto the 22-shruti (53-EDO) box grid for the raga browser. Pure —
// no DOM, no audio. Two views share the same 22 columns so a raga's swaras line
// up under the shruti positions:
//   - headerColumns(): the selected raga's janaka-mela scale as per-box detail
//     (fixed S/P, active a/b comma cells, inactive gaps) for the pinned header.
//   - ragaFootprint(): the set of boxes a raga actually occupies, for the per-row
//     X strip.
import { BOXES, S_STEP, P_STEP, EDO } from './shruti.js';
import { MELA_NAMES, presentVarieties, melaVarieties, melaForRaga, stepForVariety, jiComma } from './melakarta.js';
import { getRagaExt } from './raga-ext.js';

const IDX_BY_STEP = new Map(BOXES.map((b, i) => [b.step, i]));
const boxIndexOfStep = (step) => (IDX_BY_STEP.has(step) ? IDX_BY_STEP.get(step) : -1);

export const BOX_COUNT = BOXES.length;                 // 22
export const centsOfStep = (step) => Math.round((step / EDO) * 1200);

// The raga's janaka mela: the authored one (raga-ext) if present, else the
// heuristic lowest-superset mela. null for a raga with no melakarta match.
export function ragaMela(ragas, name) {
  const ext = getRagaExt(name);
  if (ext?.mela) return { n: ext.mela, name: MELA_NAMES[ext.mela] };
  return melaForRaga(ragas, name);
}

// The variable-swara variety numbers to lay out. With a janaka mela we show the
// full mela (all R/G/M/D/N) so absent swaras can be dimmed; without one we fall
// back to just the raga's present varieties.
export function ragaVarieties(ragas, name) {
  const mela = ragaMela(ragas, name);
  const v = (mela && melaVarieties(ragas, mela.n)) || presentVarieties(ragas, name) || {};
  return { mela, varieties: v };
}

// Which swara letters the raga actually uses (from its 12-EDO notes). S is
// always present; P when its note is set; R/G/M/D/N when their note is set.
export function presentLetters(ragas, name) {
  const c = ragas?.[name]?.C12_SWARAS || {};
  const set = new Set(['S']);
  for (const L of ['R', 'G', 'M', 'D', 'N']) if (c[L] != null) set.add(L);
  if (c.P != null) set.add('P');
  return set;
}

// Default a/b comma per variable swara: the just-intonation-nearest shruti.
export function defaultAb(varieties) {
  return Object.fromEntries(Object.entries(varieties).map(([L, num]) => [L, jiComma(L, num)]));
}

// A partial 53-EDO scale {S,P,…present} from varieties + a/b commas, for the
// playback retune. Swaras absent from the preview srgm are simply unused.
export function scaleForAb(varieties, ab) {
  const s = { S: S_STEP, P: P_STEP };
  for (const L of Object.keys(varieties)) {
    const st = stepForVariety(L, varieties[L], (ab && ab[L]) || 'a');
    if (st != null) s[L] = st;
  }
  return s;
}

// 22 column descriptors for the header of the given raga at comma selection `ab`:
//   { i, step, kind:'fixed'|'active'|'inactive', letter?, comma?, chosen?, present?, cents? }
// Active boxes are the two (a/b) shrutis of each mela swara; `chosen` marks the
// one `ab` selects, `present` whether the raga uses that swara (else dim).
export function headerColumns(ragas, name, ab) {
  const { varieties } = ragaVarieties(ragas, name);
  const present = presentLetters(ragas, name);
  const activeByIdx = new Map();
  for (const [L, num] of Object.entries(varieties)) {
    for (const c of ['a', 'b']) {
      const idx = boxIndexOfStep(stepForVariety(L, num, c));
      if (idx >= 0) activeByIdx.set(idx, { letter: L, comma: c });
    }
  }
  return BOXES.map((b, i) => {
    if (b.fixed) {
      const L = b.names[0];                            // 'S' or 'P'
      return { i, step: b.step, kind: 'fixed', letter: L, chosen: true, present: present.has(L), cents: centsOfStep(b.step) };
    }
    const a = activeByIdx.get(i);
    if (a) {
      return { i, step: b.step, kind: 'active', letter: a.letter, comma: a.comma,
               chosen: ((ab && ab[a.letter]) || 'a') === a.comma, present: present.has(a.letter), cents: centsOfStep(b.step) };
    }
    return { i, step: b.step, kind: 'inactive' };
  });
}

// The set of box indices a raga occupies (one per present swara, at its
// just-intonation comma) — the per-row X strip.
export function ragaFootprint(ragas, name) {
  const { varieties } = ragaVarieties(ragas, name);
  const present = presentLetters(ragas, name);
  const ab = defaultAb(varieties);
  const idx = new Set();
  if (present.has('S')) idx.add(boxIndexOfStep(S_STEP));
  if (present.has('P')) idx.add(boxIndexOfStep(P_STEP));
  for (const L of ['R', 'G', 'M', 'D', 'N']) {
    if (!present.has(L) || varieties[L] == null) continue;
    const i = boxIndexOfStep(stepForVariety(L, varieties[L], ab[L]));
    if (i >= 0) idx.add(i);
  }
  return idx;
}
