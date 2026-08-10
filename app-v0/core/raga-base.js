// The raga database. One record per raga: its 12-tone scale, and — where we have
// them — its mela, its 53-EDO shrutis and its arohana/avarohana.
//
// It used to be three files. raga-base.json and raga-add.json held the same shape
// and were merely different imports; raga-ext.json held the richer fields under
// CAPITALISED keys while the others were lowercase. Nothing ever compared `Latangi`
// with `lathangi`, so the same raga could sit in the data twice — and did, seven
// times. tools/build-raga-db.mjs merges them; those three files remain as the
// authoring sources, and raga-db.json is what ships.
//
// A folded-away spelling becomes an ALIAS, never a rename: recordings, curated
// filenames and every share link already carry the name they were saved with, and
// a rename would break them silently. Aliases resolve but are not listed, so a
// browser shows each raga once.
let RAGAS = null;
let RAW = null;          // the same data WITHOUT the alias proxy — canonical keys only
let ALIAS = new Map();   // alias (lowercased) -> canonical key

function indexAliases(db) {
  const m = new Map();
  if (db) for (const [name, rec] of Object.entries(db)) {
    for (const a of (rec && rec.aliases) || []) m.set(String(a).toLowerCase(), name);
  }
  return m;
}

// A raga answers to every name it has ever had, but is LISTED only once.
//
// Reading a record is `ragas[name]` in a dozen places — melakarta, reference,
// raga-shruti, the parser, the tools — and each of those would otherwise have to
// resolve the name first, which is a rule every future call site has to remember
// too. Resolving on the way in makes an alias work everywhere by construction,
// while ownKeys still reports only canonical names, so nothing that enumerates the
// database (the browsers, the corpus index) shows a raga twice.
function withAliases(db, alias) {
  if (!db || typeof db !== 'object' || !alias.size) return db;
  return new Proxy(db, {
    get(t, k) {
      if (typeof k === 'string' && !(k in t)) {
        const canon = alias.get(k.toLowerCase());
        if (canon) return t[canon];
      }
      return t[k];
    },
    has(t, k) {
      if (typeof k === 'string' && !(k in t) && alias.has(k.toLowerCase())) return true;
      return k in t;
    },
  });
}

// Node/test path: synchronous JSON read. Only attempt the node-only import in
// a node environment — the browser has no `process`, so it skips straight to
// RAGAS = null with no thrown/caught error (and no console noise).
if (typeof process !== 'undefined' && process.versions?.node) {
  try {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const HERE = dirname(fileURLToPath(import.meta.url));
    // The merged database, falling back to the raw source for a tree where it has
    // not been generated yet.
    let db;
    try { db = JSON.parse(readFileSync(join(HERE, 'raga-db.json'), 'utf8')); }
    catch { db = JSON.parse(readFileSync(join(HERE, 'raga-base.json'), 'utf8')); }
    ALIAS = indexAliases(db);
    RAW = db;
    RAGAS = withAliases(db, ALIAS);
  } catch {
    // Browser path: fetched and injected by app.js before parse() is called.
    RAGAS = null;
  }
}

export { RAGAS };

export function setRagas(data) { ALIAS = indexAliases(data); RAW = data; RAGAS = withAliases(data, ALIAS); }
export function getRagas() { return RAGAS; }

// Resolve a raga name to its canonical key: exactly, then by a folded-away
// spelling, then case-insensitively for each. Returns the input unchanged if
// nothing matches — callers tolerate it.
// `aliases: false` resolves CASE only, never a folded-away spelling. The parser
// wants that: the model should report the raga the notation names, not a rewrite of
// it. Alias resolution belongs at lookup — swaraMap and the alias proxy do it — so a
// piece written against an old spelling still plays, and still says what it says.
export function resolveRagaName(name, { aliases = true } = {}) {
  if (!RAW || name == null) return name;
  // Against the RAW map, never through the alias proxy: the proxy answers to an
  // alias, so asking it whether `hamsadhwani` exists would say yes and this would
  // hand back the alias as though it were canonical.
  if (RAW[name]) return name;
  const lower = String(name).toLowerCase();
  if (aliases && ALIAS.has(lower)) return ALIAS.get(lower);
  if (RAW[lower]) return lower;
  return Object.keys(RAW).find((k) => k.toLowerCase() === lower) || name;
}

// Returns the C12_SWARAS map (swara letter -> note name) for a raga (name
// matched case-insensitively, aliases included). Throws on unknown raga;
// callers wrap parse.
export function swaraMap(ragaName) {
  const r = RAW && RAW[resolveRagaName(ragaName)];
  if (!r || !r.C12_SWARAS) throw new Error(`unknown raga: ${ragaName}`);
  return r.C12_SWARAS;
}
