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

// Where a `{…}` block starting at `at` ends: the index just past its closing brace, or
// the end of the text if it never closes.
//
// QUOTE-AWARE, and that is the whole reason it exists as its own function. Two scanners
// counted braces independently and neither looked at quotes, which was fine while every
// value was a number, an array of them, or a short word. A value can now carry another
// notation system's text verbatim — that is what `gka` is for — and a brace inside that
// string closed the block early, leaving the rest of the line to be read as notes. One
// routine, used by the tokenizer and by the token walker, so the two cannot disagree
// about where a note ends.
export function blockEnd(s, at) {
  let depth = 0, inStr = false;
  for (let k = at; k < s.length; k++) {
    const c = s[k];
    if (inStr) {
      if (c === '\\') k++;                 // an escaped anything, including a quote
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return k + 1; }
  }
  return s.length;
}

/**
 * Split notation into what a READER sees and what is folded away.
 *
 * A piece with gamakas is mostly braces: one curve is ten pairs of numbers, and a line of
 * eight ornamented swaras is four hundred characters of which eight are the music. This
 * returns the text in runs — plain stretches, and the `{…}` blocks between them — so a
 * view can print the swaras and leave a mark where each block was.
 *
 * Pure, and it never loses anything: every block keeps its body, so what is folded can be
 * shown on demand and the source itself is untouched.
 *
 * Whole-line `%` comments are passed through as plain text. A brace inside prose is not a
 * note's attributes, and folding one would eat the line it was written on.
 */
export function collapseNotation(src) {
  const parts = [];
  let plain = '', i = 0, atLineStart = true;
  const flush = () => { if (plain) { parts.push({ text: plain }); plain = ''; } };
  while (i < src.length) {
    const c = src[i];
    if (atLineStart && c === '%') {
      let e = i; while (e < src.length && src[e] !== '\n') e++;
      plain += src.slice(i, e); i = e; atLineStart = false; continue;
    }
    if (c === '\n') { plain += c; i++; atLineStart = true; continue; }
    if (c === '{') {
      const end = blockEnd(src, i), body = src.slice(i + 1, end - 1);
      let attrs = null;
      try { attrs = parseAttrs(body); } catch (_) { /* malformed: still folded, still kept */ }
      flush();
      parts.push({ body, curve: !!(attrs && curveOf(attrs)),
        keys: attrs ? Object.keys(attrs) : [] });
      i = end; atLineStart = false; continue;
    }
    plain += c; i++; atLineStart = false;
  }
  flush();
  return parts;
}

/**
 * The folded notation, grouped into lines that can FLOW and lines that cannot.
 *
 * Folding turns four hundred characters into a dozen, which leaves a line of swaras ending
 * a fifth of the way across the pane. Reading wants them packed: more of the piece on
 * screen is the whole point of reading mode.
 *
 * But not everything may be packed. A directive line says what follows it — a raga, a tala,
 * an octave, a tempo — and running the next phrase onto the end of it hides the change. A
 * comment is prose someone wrote on its own line. A blank line is a break the writer put
 * there. Those keep their own lines; runs of swaras flow together.
 *
 * A line is swaras if it holds a note token: an optional register mark, a swara or rest
 * letter, optional digits, standing alone. "Tala=adi,1" does not qualify — its 'd' is not
 * at a token boundary — which is the case that decides whether this is safe.
 */
const NOTE_IN_LINE = /(^|\s)(?:>*|<*)[sSrRgGmMpPdDnNzZ]\d*(?=[{\s]|$)/;
export function foldedLines(src) {
  const out = [];
  let cur = null;
  const start = (kind) => { cur = { kind, parts: [] }; out.push(cur); };
  for (const line of src.split('\n')) {
    const kind = !line.trim() ? 'blank'
      : line.trim().startsWith('%') ? 'comment'
        : NOTE_IN_LINE.test(line) ? 'notes' : 'directive';
    start(kind);
    for (const p of collapseNotation(line)) cur.parts.push(p);
  }
  return out;
}

/**
 * The folded notation, grouped by AVARTANA.
 *
 * Packing swaras across the line makes a piece short; grouping them by the tala makes it
 * readable. Carnatic notation is read a cycle at a time — the eye wants a line to begin
 * where a cycle begins — so a run of swaras is cut at the tala's own boundaries rather than
 * wherever the pane happens to end.
 *
 * Not every piece divides neatly. A note may straddle a boundary — twelve-unit notes in an
 * eight-unit cycle cross every other one — and cutting mid-note would be a lie about where
 * the cycle starts. So a group that cannot close on its boundary TAKES THE NEXT ONE, up to
 * four cycles, and closes on the first boundary a note ends on. If none does, it closes
 * after the straddling note and is marked ragged: the piece genuinely does not line up, and
 * pretending otherwise would put a cycle mark where there is none.
 *
 * `durations` is absLen per note token, in the order walkTokens counts them — which is the
 * order parse() emits note events in, rests included. `measure` is the cycle in length
 * units, 0 when there is no tala, in which case nothing is grouped.
 */
const MAX_CYCLES = 4;
export function readingBlocks(src, { durations = [], measure = 0 } = {}) {
  const lines = foldedLines(src);
  // Where each note token begins, in units from the top of the piece.
  const startAt = [];
  { let t = 0; for (let i = 0; i < durations.length; i++) { startAt.push(t); t += durations[i] || 0; } }

  const out = [];
  let run = null;          // the note tokens waiting to be cut into cycles
  const flushRun = () => {
    if (!run || !run.parts.length) { run = null; return; }
    if (!(measure > 0)) { out.push({ kind: 'notes', parts: run.parts }); run = null; return; }
    let group = [], groupStart = null, cycles = 1;
    const parts = run.parts;
    // A note's attribute block is a part of its own that FOLLOWS it, so a cut made the
    // moment a note's clock reaches the boundary leaves the note's own fold at the head of
    // the next line — "G∿ M" then "· P". Closing a group takes what belongs to its last
    // note with it: the fold, and the space after it.
    const absorb = (i) => {
      while (i + 1 < parts.length && parts[i + 1].ord === undefined
        && (parts[i + 1].body !== undefined || /^\s*$/.test(parts[i + 1].text || ''))) {
        group.push(parts[++i]);
      }
      return i;
    };
    for (let i = 0; i < parts.length; i++) {
      const item = parts[i];
      group.push(item);
      if (item.ord === undefined) continue;              // text or a fold: no clock of its own
      if (groupStart === null) groupStart = startAt[item.ord] ?? 0;
      const end = (startAt[item.ord] ?? 0) + (durations[item.ord] || 0);
      // How many cycles this group must span to CONTAIN this note. Advancing one cycle per
      // straddling note was not the same thing: a note twelve units long in an eight-unit
      // cycle needs two at once, and stepping by one meant every note pushed the boundary
      // just behind itself until the group ran out of cycles and gave up.
      const need = Math.max(cycles, Math.ceil((end - groupStart) / measure - 1e-9));
      if (need > MAX_CYCLES) {                           // it does not line up: say so
        i = absorb(i);
        out.push({ kind: 'notes', parts: group, cycles, ragged: true });
        group = []; groupStart = null; cycles = 1;
        continue;
      }
      cycles = need;
      if (Math.abs(end - (groupStart + measure * cycles)) < 1e-9) {   // closes on a cycle
        i = absorb(i);
        out.push({ kind: 'notes', parts: group, cycles });
        group = []; groupStart = null; cycles = 1;
      }
    }
    // A tail of pure whitespace is not a group. It is what is left after the last cycle
    // closed, and given a line of its own it draws a blank cycle that is not in the piece.
    if (group.length) {
      const hasNotes = group.some((p) => p.ord !== undefined);
      const prev = out[out.length - 1];
      if (hasNotes) out.push({ kind: 'notes', parts: group, cycles, ragged: true });
      else if (prev && prev.kind === 'notes') prev.parts.push(...group);
    }
    run = null;
  };

  let ord = -1;
  for (const line of lines) {
    if (line.kind !== 'notes') { flushRun(); out.push(line); continue; }
    if (!run) run = { parts: [] };
    // Number the note tokens as they go past, so a part can be found in `durations`.
    for (const p of line.parts) {
      if (p.text === undefined) { run.parts.push(p); continue; }   // a fold belongs to the note before it
      let rest = p.text, buf = '';
      const re = /(^|\s)((?:>*|<*)[sSrRgGmMpPdDnNzZ]\d*)(?=[{\s]|$)/g;
      let m2, last = 0;
      while ((m2 = re.exec(rest))) {
        const at = m2.index + m2[1].length;
        buf = rest.slice(last, at);
        if (buf) run.parts.push({ text: buf });
        ord += 1;
        run.parts.push({ text: m2[2], ord });
        last = at + m2[2].length;
        re.lastIndex = last;
      }
      const tail = rest.slice(last);
      if (tail) run.parts.push({ text: tail });
    }
    run.parts.push({ text: ' ' });
  }
  flushRun();
  return out;
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
    if (atLineStart && c === '%') {                    // whole-line comment: uncounted
      let e = i; while (e < srcText.length && srcText[e] !== '\n') e++;
      const raw = srcText.slice(i, e);
      // Offered to the visitor so a caller can READ a comment (a %% metadata line
      // needs to know which note it sits before) or rewrite one. Returning nothing
      // keeps it verbatim, which is what every existing caller does.
      const r = visit({ isNote: false, isComment: true, ordinal: -1, nextOrdinal: ordinal + 1,
        octMarks: '', letter: '', len: '', head: raw, hadBrace: false, body: '', raw });
      out += (typeof r === 'string') ? r : raw;
      i = e; atLineStart = false; continue;
    }
    atLineStart = false;
    let j = i;
    while (j < srcText.length && !isWs(srcText[j]) && srcText[j] !== '{') j++;
    const head = srcText.slice(i, j);
    let k = j, hadBrace = false, body = '';
    if (srcText[j] === '{') {                           // brace-balanced block
      hadBrace = true;
      k = blockEnd(srcText, j);
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
    if (u <= c[k][0]) {
      const [u0, s0] = c[k - 1], [u1, s1] = c[k];
      // CLAMPED before the smoothstep, which is a cubic and must never be evaluated
      // outside the pair it interpolates. A curve whose first anchor is not at u=0 — one
      // anchor dragged off the end is enough — was asked for the pitch before it began,
      // and t went to -18: the cubic answered fourteen thousand steps above Sa, which
      // reached the audio layer as an infinite frequency and threw. Outside its own range
      // a curve HOLDS its end value, which is the only honest reading of a pitch that was
      // never written.
      let t = Math.max(0, Math.min(1, (u - u0) / Math.max(1e-6, u1 - u0)));
      t = t * t * (3 - 2 * t);
      return s0 + (s1 - s0) * t;
    }
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
// ---- the curve attribute's name -------------------------------------------------------
//
// It is `gcurve` now and was `gamaka` before. "gamaka" names the MUSICAL IDEA — an
// ornament — and what the brace actually holds is one way of writing one down: a pitch
// curve in points. When the second way arrives (a named oscillation, a shorthand for a
// kampita) it will want the word back.
//
// READ BOTH, FOREVER. Every file, every share link and every curated notation written
// before this says `gamaka`, and a reader who hand-types the old key is not wrong, only
// old. WRITE ONE: everything this project serialises says `gcurve`, and a piece is
// stamped V=2 the moment it is written (see notationVersion in core/parser.js).
export const CURVE_KEY = 'gcurve';
const LEGACY_CURVE_KEY = 'gamaka';

/** The curve an attribute block carries, under either name, or null. */
export function curveOf(attrs) {
  if (!attrs) return null;
  const c = Array.isArray(attrs[CURVE_KEY]) ? attrs[CURVE_KEY]
    : (Array.isArray(attrs[LEGACY_CURVE_KEY]) ? attrs[LEGACY_CURVE_KEY] : null);
  return c && c.length ? c : null;
}

/**
 * The attributes to write for a note: its curve under the current name, then everything
 * else it already carried. BOTH names are dropped first — a file that said `gamaka` must
 * not come back saying both, which would leave two curves for one note and no rule about
 * which wins.
 */
export function withCurve(attrs, curve) {
  const rest = { ...(attrs || {}) };
  delete rest[CURVE_KEY]; delete rest[LEGACY_CURVE_KEY];
  return (curve && curve.length) ? { [CURVE_KEY]: curve, ...rest } : rest;
}

export function serializeInline(srcText, curves) {
  return walkTokens(srcText, (t) => {
    if (!t.isNote) return undefined;
    let attrs = {};
    if (t.hadBrace) { try { attrs = parseAttrs(t.body); } catch { attrs = {}; } }
    const merged = withCurve(attrs, curves[t.ordinal]);
    const s = stringifyAttrs(merged);
    return t.head + (s ? '{' + s + '}' : '');
  });
}
