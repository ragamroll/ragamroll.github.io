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

// Sample a curve [[u,val]…] (increasing u in [0,1]) at position u, smoothstep
// between points. Shared by the draw roll and the audio path so they sound alike.
export function sampleCurve(c, u) {
  if (c.length === 1) return c[0][1];
  for (let k = 1; k < c.length; k++) {
    if (u <= c[k][0]) { const [u0, s0] = c[k - 1], [u1, s1] = c[k]; let t = (u - u0) / Math.max(1e-6, u1 - u0); t = t * t * (3 - 2 * t); return s0 + (s1 - s0) * t; }
  }
  return c[c.length - 1][1];
}

const NOTE_HEAD = /^(>*|<*)([sSrRgGmMpPdDnNzZ])(\d*)$/;
const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

// Re-emit inline attributes into the srgm text. `curves` is keyed by the note
// token's ordinal among ALL note tokens — counting rests (z/Z) and out-of-raga
// swaras too, so the ordinal matches parse()'s note events 1:1 (the parser turns
// a literal rest OR an out-of-raga swara into a note event with rest=true). The
// caller keys by that same ordinal; the draw model records it per note. Each
// counted token's {…} is rewritten to carry the given gamaka (dropped when
// absent), preserving other attributes (e.g. sahitya) and all surrounding text.
export function serializeInline(srcText, curves) {
  let out = '', i = 0, noteIdx = -1, atLineStart = true;
  while (i < srcText.length) {
    const c = srcText[i];
    if (c === '\n') { out += c; i++; atLineStart = true; continue; }
    if (isWs(c)) { out += c; i++; continue; }        // leading/inner whitespace (keeps line-start status)
    // A whole comment line (first non-blank char is '%') is ignored by the parser
    // — emit it verbatim and do NOT count its tokens, so ordinals stay aligned.
    if (atLineStart && c === '%') {
      let e = i; while (e < srcText.length && srcText[e] !== '\n') e++;
      out += srcText.slice(i, e); i = e; atLineStart = false; continue;
    }
    atLineStart = false;
    let j = i;
    while (j < srcText.length && !isWs(srcText[j]) && srcText[j] !== '{') j++;
    const head = srcText.slice(i, j);
    let k = j, hadBrace = false, body = '';
    if (srcText[j] === '{') {                        // consume a brace-balanced block
      hadBrace = true; let d = 0;
      for (k = j; k < srcText.length; k++) {
        if (srcText[k] === '{') d++;
        else if (srcText[k] === '}') { d--; if (d === 0) { k++; break; } }
      }
      body = srcText.slice(j + 1, k - 1);
    }
    if (NOTE_HEAD.test(head)) {                       // any note token (plain, rest, or out-of-raga)
      noteIdx++;
      let attrs = {};
      if (hadBrace) { try { attrs = parseAttrs(body); } catch { attrs = {}; } }
      const cur = curves[noteIdx];
      const rest = { ...attrs }; delete rest.gamaka;                  // other attrs (e.g. sahitya)
      attrs = (cur && cur.length) ? { gamaka: cur, ...rest } : rest;  // gamaka first
      const s = stringifyAttrs(attrs);
      out += head + (s ? '{' + s + '}' : '');
    } else {
      out += srcText.slice(i, k);                    // directive / non-note token
    }
    i = k;
  }
  return out;
}
