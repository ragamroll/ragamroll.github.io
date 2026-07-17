// Pure formatters for the raga/tala reference browser. No DOM, no framework.
import { PITCH_CLASS } from './tuning.js';

const SWARA_ORDER = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N'];
const orderIndex = (s) => {
  const i = SWARA_ORDER.indexOf(s);
  return i < 0 ? SWARA_ORDER.length : i;
};

// [{swara, note}] for a raga's C12_SWARAS:
//  - exclude the Z/z rest-marker
//  - collapse a lowercase swara whose uppercase maps to the SAME note (keep upper)
//  - keep case-variants that map to DIFFERENT notes (e.g. c12 r=C# vs R=D)
//  - sorted in canonical swara order
export function ragaSwaras(c12swaras) {
  if (!c12swaras) return [];
  const has = (k) => Object.prototype.hasOwnProperty.call(c12swaras, k);
  const out = [];
  for (const [swara, note] of Object.entries(c12swaras)) {
    if (swara === 'Z' || swara === 'z') continue;
    if (swara !== swara.toUpperCase()) {
      const up = swara.toUpperCase();
      if (has(up) && c12swaras[up] === note) continue;   // same-note case dupe -> drop lowercase
    }
    out.push({ swara, note });
  }
  out.sort((a, b) => orderIndex(a.swara) - orderIndex(b.swara));
  return out;
}

export function formatSwaraSeq(c12swaras) {
  return ragaSwaras(c12swaras).map((e) => e.swara).join(' ');
}

export function formatRagaSwaras(c12swaras) {
  return ragaSwaras(c12swaras).map((e) => `${e.swara}=${e.note}`).join(' ');
}

// [{swara, delta}] — semitone distance of each swara above Sa, mod 12.
// Built on ragaSwaras() so Z-exclusion, case-dedup, and canonical order are
// shared and the intervals line up with the swara sequence / note map.
export function swaraIntervals(c12swaras) {
  const pc = (x) => PITCH_CLASS[x] ?? 0;
  const saPc = pc(c12swaras?.S ?? 'C');
  return ragaSwaras(c12swaras).map(({ swara, note }) => ({
    swara,
    delta: (pc(note) - saPc + 12) % 12,
  }));
}

// "S=0 R=2 G=4 P=7 N=11" — swara=delta, space-joined. Empty/missing map -> "".
export function formatIntervals(c12swaras) {
  return swaraIntervals(c12swaras).map((e) => `${e.swara}=${e.delta}`).join(' ');
}

// "0 2 4 7 11" — bare semitone deltas, space-joined. The swara-less form used
// as the primary line in the raga browser. Empty/missing map -> "".
export function formatIntervalNumbers(c12swaras) {
  return swaraIntervals(c12swaras).map((e) => e.delta).join(' ');
}

// Zero-pad a single-digit mela raga name so string sorting is numeric:
// mela_1 -> mela_01, mela_10 unchanged, non-mela names unchanged.
export function padMelaName(name) {
  return String(name).replace(/^(mela_)(\d)$/, '$10$2');
}

export function formatTala(entry) {
  if (!entry) return '';
  const [aksharas, accents] = entry;
  return `${aksharas} aksharas · accents at ${accents.join(', ')}`;
}
