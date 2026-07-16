// Pure formatters for the raga/tala reference browser. No DOM, no framework.
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

export function formatTala(entry) {
  if (!entry) return '';
  const [aksharas, accents] = entry;
  return `${aksharas} aksharas · accents at ${accents.join(', ')}`;
}
