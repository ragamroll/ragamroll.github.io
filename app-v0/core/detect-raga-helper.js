// Builds the raga step-set + swara-name map that detect.js needs, mirroring
// pitchy.html's setRaga exactly. Kept separate so pitchy.html's
// setRaga and the golden-chain test share one implementation. Pure — no DOM.
import { getRagas, setRagas } from './raga-base.js';
import { ragaVarieties, presentLetters, defaultAb } from './raga-shruti.js';
import { stepForVariety } from './melakarta.js';
import { nameForSlot } from './shruti.js';
import { getRagaExt, scaleFromC16 } from './raga-ext.js';

// pitchy.html's boot merges raga-base.json with raga-add.json before calling
// setRagas (see pitchy.html ~1687-1692: `{ ...base, ...add }`) — many ragas
// (e.g. anandabhairavi) live only in raga-add.json. raga-base.js's Node
// auto-load only reads raga-base.json, so without this merge buildRagaSteps
// would resolve those ragas to a degenerate {S}-only step set. Do the merge
// once at module load (Node only — the browser gets the merge from pitchy.html's
// own boot), so buildRagaSteps matches what setRaga resolves for the same name.
// (raga-ext.js already auto-loads raga-ext.json in Node on its own, so no
// separate setRagaExt call is needed to match pitchy.html's ext merge.)
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    const add = JSON.parse(readFileSync(join(HERE, 'raga-add.json'), 'utf8'));
    // What is already loaded WINS. raga-db.json carries every raga plus the aliases
    // that fold the duplicate spellings together, and raga-add's raw records have
    // neither — letting them land on top erased the alias index and a raga reached
    // by an old spelling lost its mela and arohana. This now only fills gaps, which
    // is all it was ever for.
    setRagas({ ...add, ...(getRagas() || {}) });
  } catch {
    // leave whatever raga-base.js already auto-loaded (base-only)
  }
}

export function buildRagaSteps(name) {
  const ragaSteps = new Set();
  const ragaSwaraName = new Map();
  if (!name) return { ragaSteps: null, ragaSwaraName };
  const ragas = getRagas();
  const { varieties } = ragaVarieties(ragas, name);
  const present = presentLetters(ragas, name);
  const ab = defaultAb(varieties);
  // The raga's OWN authored swaras (C16 + comma), when raga-ext supplies them.
  // ragaVarieties deliberately returns the PARENT MELA's varieties — its
  // contract is the raga-browser header, which shows the full mela so absent
  // swaras can be dimmed. That is a display view, and using it to decide PITCH
  // is wrong for a janya whose swaras differ from its parent: revathi is
  // mela 2 (Ratnangi, G1/D1) but sounds G3a/D2a, which is what both its C12
  // notes (G=E, D=A) and its authored swaras say. raga-preview already resolves
  // pitch this way via scaleFromC16; this brings detection/naming in line.
  const authored = (() => { const s = getRagaExt(name)?.swaras; return s ? scaleFromC16(s) : null; })();
  const add = (step, nm) => { ragaSteps.add(step); ragaSwaraName.set(step, nm); };
  if (present.has('S')) add(0, 'S');       // S_STEP
  if (present.has('P')) add(31, 'P');      // P_STEP
  for (const L of ['R', 'G', 'M', 'D', 'N']) {
    if (!present.has(L)) continue;
    const st = (authored && authored[L] != null) ? authored[L]
      : (varieties[L] != null ? stepForVariety(L, varieties[L], ab[L]) : null);
    if (st != null) add(st, nameForSlot(st, L));
  }
  return { ragaSteps, ragaSwaraName };
}
