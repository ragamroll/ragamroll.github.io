// `%%` — the app talking to itself.
//
// srgm has always had comments: a line starting with `%` is a note to a person and
// is dropped before anything is tokenised. That is the right treatment for prose and
// the wrong one for structured data, and the two had become the same thing — pitchy
// writes `% 9.728s` before each note, which is really a MEASUREMENT wearing a
// comment's clothes. Nothing can read it back without guessing at the format, and a
// person editing the file cannot tell which of their comments the app depends on.
//
// So: a second `%` means the line belongs to the tools.
//
//     % this bit is too fast              <- a person's note, untouched, unread
//     %% t=9.728 u=155.6 m=4.86           <- the app's own
//
// It stays a comment, so every existing reader — the parser, isNoteLine, walkTokens —
// already ignores it and the notation still round-trips clean. Nothing has to learn
// about it to keep working.
//
// Key=value, space separated, because the readers differ in what they need and a
// format that can gain a key without breaking an old reader is the only one worth
// writing into saved files. An unknown key is carried through, never dropped.
//
// The first use is a position written in EVERY unit that matters, rather than in one
// tool's unit:
//
//   t  seconds of the recording it was heard at   — pitchy's axis
//   u  length-units from the start of the piece   — draw's axis
//   m  measures (avartanas), fractional           — what a musician counts
//
// pitchy measures in seconds and draw counts length-units against a tala; a stamp in
// one is unusable in the other without knowing the tempo, and the tempo can change
// after the stamp was written. Writing all three costs a few bytes and removes the
// conversion — and the guessing — entirely.
import { walkTokens } from './gamaka-inline.js';

export const MARK = '%%';

const NUMERIC = new Set(['t', 'u', 'm']);

/** `%% t=9.728 u=155.6` -> { t: 9.728, u: 155.6 }; null if the line is not a mark. */
export function parseMark(line) {
  const s = String(line == null ? '' : line).trim();
  if (!s.startsWith(MARK)) return null;
  const out = {};
  for (const part of s.slice(MARK.length).trim().split(/\s+/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;                       // a bare word is not a field; skip it rather than invent one
    const k = part.slice(0, eq), v = part.slice(eq + 1);
    if (NUMERIC.has(k)) { const n = Number(v); out[k] = Number.isFinite(n) ? n : v; }
    else out[k] = v;                             // unknown key: kept as written
  }
  return out;
}

/** { t: 9.728, u: 155.6 } -> `%% t=9.728 u=155.6`. Undefined/null fields are dropped. */
export function formatMark(fields) {
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '') continue;
    parts.push(`${k}=${typeof v === 'number' ? trimNum(v) : String(v).replace(/\s+/g, '_')}`);
  }
  return parts.length ? `${MARK} ${parts.join(' ')}` : MARK;
}

// 9.7280 -> 9.728, 4 -> 4. Trailing zeros in a saved file are noise a reader has to
// look past, and they make two identical marks compare unequal as text.
function trimNum(n) {
  const s = Number(n).toFixed(3);
  return s.replace(/\.?0+$/, '');
}

/**
 * Every mark in a piece, with the note it sits before.
 *
 * `tok` is the ordinal of the NEXT note token — rests and out-of-raga swaras
 * included — which is the same numbering parse() and the draw model use, so a mark
 * can be matched to a note without re-deriving anything. A mark after the last note
 * gets that note's ordinal + 1, which no note has: it belongs to the end.
 */
export function readMarks(srcText) {
  const marks = [];
  walkTokens(String(srcText || ''), (t) => {
    if (!t.isComment) return undefined;
    const kv = parseMark(t.raw);
    if (kv) marks.push({ ...kv, tok: t.nextOrdinal });
    return undefined;
  });
  return marks;
}

/** The mark attached to a note, or null. Later marks win — the last one written is current. */
export function markFor(marks, tok) {
  let hit = null;
  for (const m of marks) if (m.tok === tok) hit = m;
  return hit;
}
