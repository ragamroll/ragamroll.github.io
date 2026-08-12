// Pure helpers for seeding a blank composition with a raga's notation.
// srgm-text in, srgm-text out; no DOM. Shared by the build (assembleSeed) and
// the draw page (chooseSeed).
import { ragaPreviewSrgm } from './raga-preview.js';

// A swara/rest token: optional octave marks, a swara/rest letter, optional
// length, optional trailing {…} attr block. Excludes directives like Raga=/Tala=
// (which have '=') and T480/O=5/L=1/I[…].
const SWARA_TOK = /^[><]*[sSrRgGmMpPdDnNzZ]\d*(\{.*)?$/;

// True iff the line carries at least one swara/rest token (i.e. it's a note line,
// not a blank line, a `%` comment, or a directive-only line).
export function isNoteLine(line) {
  const t = line.trim();
  if (!t || t[0] === '%') return false;
  return t.split(/\s+/).some((tok) => SWARA_TOK.test(tok));
}

// Aroha srgm, plus (if present) the signature's NOTE lines appended under a
// "% signature" line — the aroha's own header directives are kept, the
// signature file's directive/comment lines are dropped. The octave register
// is reset to O=5 before the signature notes, since the signature is its own
// phrase and shouldn't inherit whatever octave the aroha happened to end on
// (e.g. an aroha ending on `>S` would otherwise render the signature an
// octave high). Pure.
export function assembleSeed(arohaSrgm, signatureSrgm) {
  let seed = String(arohaSrgm).replace(/\s+$/, '');
  if (signatureSrgm) {
    const noteLines = String(signatureSrgm).split('\n').filter(isNoteLine);
    if (noteLines.length) seed += '\n% signature\nO=5\n' + noteLines.join('\n');
  }
  return seed + '\n';
}

// Pick the seed srgm for a raga: a prebuilt draft (from drafts.json), else a
// plain aroha/avarohana synthesised from shipped raga data, else null (caller
// falls back to a bare blank). `extForName` is the per-raga ext object;
// `ragasMap` is the full base map (for C12_SWARAS).
export function chooseSeed(name, draftsMap, extForName, ragasMap) {
  if (draftsMap && draftsMap[name]) return { srgm: draftsMap[name], kind: 'draft' };
  const hasScale = !!(extForName?.arohana || ragasMap?.[name]?.C12_SWARAS);
  if (hasScale) return { srgm: ragaPreviewSrgm(name, extForName, ragasMap, {}), kind: 'plain' };
  return null;
}


// The per-raga seed map (drafts.json), fetched once and shared by every page that offers
// a raga picker. Two paths because the same file is served from a deployed build and
// from a local curation run; a total failure is NOT memoized, so the next pick retries
// rather than being told forever that there are no drafts.
let _draftsPromise = null;

/**
 * The corpus: every raga that has been notated from a recording, what it is, and the
 * recordings themselves. This is what the file holds now — a v2 document — because the
 * app's raga browser needs the rows and not only the seeds, and shipping a second file
 * would have duplicated every srgm string.
 *
 * Returns null when there is no corpus (a fresh clone, or a dev tree where the
 * generator has never run) and when the file is still the old shape.
 */
function fetchDoc(urls) {
  if (!_draftsPromise) {
    _draftsPromise = (async () => {
      for (const url of urls) {
        try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (_) { /* try the next */ }
      }
      _draftsPromise = null;              // a total failure is not memoized: the next pick retries
      return null;
    })();
  }
  return _draftsPromise;
}

export function loadCorpus(urls = ['./ragas/drafts.json', '../tools/out/drafts.json']) {
  return fetchDoc(urls).then((j) => (j && j.v === 2 ? j : null));
}

/**
 * The per-raga seed map, fetched once and shared by every page that offers a raga picker.
 *
 * DERIVED from the corpus rather than stored beside it: the seed is the aroha with the
 * signature's note lines appended, which is assembleSeed, and computing it here means the
 * file cannot carry a seed that disagrees with the rows it was made from. The old shape —
 * a plain {raga: srgm} map — is still read, so a stale drafts.json on a cached page keeps
 * working rather than silently offering no seeds.
 */
export function loadDrafts(urls = ['./ragas/drafts.json', '../tools/out/drafts.json']) {
  return fetchDoc(urls).then((j) => {     // the same one fetch the corpus uses
    if (!j) return {};
    if (j.v !== 2) return j;               // the old map, verbatim
    const map = {};
    for (const r of j.ragas || []) {
      const a = (r.rows || []).find((x) => x.kind === 'aroha');
      if (!a) continue;                    // no aroha -> the picker falls back to the plain scale
      const sig = (r.rows || []).find((x) => x.kind === 'signature');
      map[r.raga] = assembleSeed(a.srgm, sig ? sig.srgm : null);
    }
    return map;
  });
}
