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
export function loadDrafts(urls = ['./ragas/drafts.json', '../tools/out/drafts.json']) {
  if (!_draftsPromise) {
    _draftsPromise = (async () => {
      for (const url of urls) {
        try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (_) { /* try the next */ }
      }
      _draftsPromise = null;
      return {};
    })();
  }
  return _draftsPromise;
}
