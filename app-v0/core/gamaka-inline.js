// Inline gamaka/sahitya helpers. Pure (no DOM) so they're unit-testable and
// shared by the parser and the draw page. A note's attributes are stored as a
// relaxed (JSON5-ish) object inside a trailing {…} block, e.g.
//   P{gamaka:[[0,0],[0.5,9],[1,0]], sahitya:"va"}
// The gamaka curve's `step` is a 53-EDO delta RELATIVE TO THE NOTE (0 = on the
// note); the draw page converts to/from absolute at its boundary.

// Parse a relaxed object BODY (the text inside the outer braces) into a plain
// object. Accepts unquoted bareword keys and trailing commas. Throws on malformed.
export function parseAttrs(body) {
  const normalized = ('{' + body + '}')
    .replace(/([{,]\s*)([A-Za-z_]\w*)(\s*:)/g, '$1"$2"$3')   // quote bareword keys
    .replace(/,(\s*[}\]])/g, '$1');                           // strip trailing commas
  return JSON.parse(normalized);
}

// Emit an attribute object as a relaxed body: unquoted keys, JSON values.
// Inverse of parseAttrs for the value shapes we produce.
export function stringifyAttrs(obj) {
  return Object.entries(obj).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(', ');
}

// Capturing head: (octave marks)(swara/rest letter)(length digits)
const NOTE_HEAD_G = /^(>*|<*)([sSrRgGmMpPdDnNzZ])(\d*)$/;

// Walk srgm token-by-token. Emits inter-token whitespace, newlines, and whole-line
// `%` comments verbatim (never counted). For each token, calls visit(t); if visit
// returns a string it replaces the token, else the token is emitted verbatim.
// `ordinal` counts NOTE tokens (rests + out-of-raga swaras included) so it matches
// parse()'s note events 1:1 and the draw model's `tok`.
export function walkTokens(srcText, visit) {
  let out = '', i = 0, ordinal = -1, atLineStart = true;
  while (i < srcText.length) {
    const c = srcText[i];
    if (c === '\n') { out += c; i++; atLineStart = true; continue; }
    if (isWs(c)) { out += c; i++; continue; }
    if (atLineStart && c === '%') {                    // whole-line comment: verbatim, uncounted
      let e = i; while (e < srcText.length && srcText[e] !== '\n') e++;
      out += srcText.slice(i, e); i = e; atLineStart = false; continue;
    }
    atLineStart = false;
    let j = i;
    while (j < srcText.length && !isWs(srcText[j]) && srcText[j] !== '{') j++;
    const head = srcText.slice(i, j);
    let k = j, hadBrace = false, body = '';
    if (srcText[j] === '{') {                           // brace-balanced block
      hadBrace = true; let d = 0;
      for (k = j; k < srcText.length; k++) {
        if (srcText[k] === '{') d++;
        else if (srcText[k] === '}') { d--; if (d === 0) { k++; break; } }
      }
      body = srcText.slice(j + 1, k - 1);
    }
    const raw = srcText.slice(i, k);
    const hm = NOTE_HEAD_G.exec(head);
    const isNote = !!hm;
    if (isNote) ordinal++;
    const t = isNote
      ? { isNote: true, ordinal, octMarks: hm[1], letter: hm[2], len: hm[3], head, hadBrace, body, raw }
      : { isNote: false, ordinal: -1, octMarks: '', letter: '', len: '', head, hadBrace, body, raw };
    const rep = visit(t);
    out += (rep === undefined ? raw : rep);
    i = k;
  }
  return out;
}

// Sample a curve [[u,val]…] (increasing u in [0,1]) at position u, smoothstep
// between points. Shared by the draw roll and the audio path so they sound alike.
export function sampleCurve(c, u) {
  if (c.length === 1) return c[0][1];
  for (let k = 1; k < c.length; k++) {
    if (u <= c[k][0]) { const [u0, s0] = c[k - 1], [u1, s1] = c[k]; let t = (u - u0) / Math.max(1e-6, u1 - u0); t = t * t * (3 - 2 * t); return s0 + (s1 - s0) * t; }
  }
  return c[c.length - 1][1];
}

// How many points every player resamples a curve to before ramping through it.
// Shared, because the density IS audible: a player interpolates linearly between
// its samples, so a coarse grid flattens the smoothstep's curvature. Measured
// against the exact curve over the 87 gamakas in curated/, worst case across all
// of them: 48 points 18.3 cents, 64 -> 11.9, 96 -> 5.3, 192 -> 3.3, 384 -> 1.1.
// 192 puts the worst case under the ~5 cent JND (median note 0.5c) at a cost of
// one Float32Array or one automation event per sample per note, which is nothing.
// Two players used to differ here (48 and 64) and rendered the same notation up to
// 11 cents apart.
export const GAMAKA_SAMPLES = 192;

const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

// Re-emit inline attributes into the srgm text. `curves` is keyed by the note
// token's ordinal among ALL note tokens — counting rests (z/Z) and out-of-raga
// swaras too, so the ordinal matches parse()'s note events 1:1 (the parser turns
// a literal rest OR an out-of-raga swara into a note event with rest=true). The
// caller keys by that same ordinal; the draw model records it per note. Each
// counted token's {…} is rewritten to carry the given gamaka (dropped when
// absent), preserving other attributes (e.g. sahitya) and all surrounding text.
export function serializeInline(srcText, curves) {
  return walkTokens(srcText, (t) => {
    if (!t.isNote) return undefined;
    let attrs = {};
    if (t.hadBrace) { try { attrs = parseAttrs(t.body); } catch { attrs = {}; } }
    const cur = curves[t.ordinal];
    const rest = { ...attrs }; delete rest.gamaka;
    const merged = (cur && cur.length) ? { gamaka: cur, ...rest } : rest;
    const s = stringifyAttrs(merged);
    return t.head + (s ? '{' + s + '}' : '');
  });
}
