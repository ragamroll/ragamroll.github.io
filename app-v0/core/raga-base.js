let RAGAS = null;
// Node/test path: synchronous JSON read. Only attempt the node-only import in
// a node environment — the browser has no `process`, so it skips straight to
// RAGAS = null with no thrown/caught error (and no console noise).
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    RAGAS = JSON.parse(readFileSync(join(HERE, 'raga-base.json'), 'utf8'));
  } catch {
    // Browser path: fetched and injected by app.js before parse() is called.
    RAGAS = null;
  }
}

export { RAGAS };

export function setRagas(data) { RAGAS = data; }
export function getRagas() { return RAGAS; }

// Resolve a raga name to its canonical key, case-insensitively (keys are
// lowercase). Returns the input unchanged if no match — callers tolerate it.
export function resolveRagaName(name) {
  if (!RAGAS || name == null) return name;
  if (RAGAS[name]) return name;
  const lower = String(name).toLowerCase();
  if (RAGAS[lower]) return lower;
  return Object.keys(RAGAS).find((k) => k.toLowerCase() === lower) || name;
}

// Returns the C12_SWARAS map (swara letter -> note name) for a raga (name
// matched case-insensitively). Throws on unknown raga; callers wrap parse.
export function swaraMap(ragaName) {
  const r = RAGAS && RAGAS[resolveRagaName(ragaName)];
  if (!r || !r.C12_SWARAS) throw new Error(`unknown raga: ${ragaName}`);
  return r.C12_SWARAS;
}
