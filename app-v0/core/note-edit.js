// Pure edit operations for the draw roll. The model (absolute step/octave/dur/
// curve) is the source of truth; serializeModel re-derives the RELATIVE surface
// notation (octave >/< marks, L=-scaled length, swara letter) while preserving
// hand-authored annotations (comments, sahitya, whitespace, directives) by token
// ordinal. Deriving octave from the absolute model — instead of patching the
// relative marks in place — removes octave-boundary ripple at the root.
import { walkTokens, parseAttrs, stringifyAttrs, withCurve, curveOf } from './gamaka-inline.js';
import { stepToSwara } from './detect.js';
import { NOTATION_VERSION } from './parser.js';
import { EDO } from './shruti.js';

export function octMarks(dOct) {
  return dOct > 0 ? '>'.repeat(dOct) : (dOct < 0 ? '<'.repeat(-dOct) : '');
}

// Round a curve to note-relative integer deltas (u to 2dp), matching draw's
// inlineSrc() so gamaka output is identical to the existing curve-editing path.
// Two decimals, matching what pitchy writes and what the curated corpus holds
// (-17.19, 0.01, 3.92 …). Rounding a delta to a WHOLE shruti loses up to half a step —
// 11 cents — per anchor, and it did so silently: any edit re-tokenises the note it
// touched, and an edit that re-derives octaves re-tokenises EVERY note in the piece.
// A single delete was enough to flatten every gamaka in a curated file to integers.
// u gets a digit more than the pitch does, and not for symmetry. A note is one unit of
// u no matter how long it is, so on a long note 0.01 of u is a sizeable stretch of
// time — and an anchor placed at the wrong instant on a steep climb is a pitch error
// just as surely as a mis-rounded step. Two places put ~6 cents into an absorbed rest;
// three puts it under one. The pitch stays at two: it is measured in shrutis, where
// a hundredth is already far below anything audible.
function relCurve(curve, step) {
  return curve.map(([u, s]) => [Math.round(u * 1000) / 1000, Math.round((s - step) * 100) / 100]);
}

// Build a note token's text from the absolute model: octave marks (from the
// running register when deriveOctave, else the verbatim marks), swara letter,
// L=-scaled length, and the gamaka/other-attrs brace.
function noteToken(n, { verbatimOct, verbatimBody, deriveOctave, curL, curOct, ctx }) {
  if (n.rest) {                             // rest insert: bare 'z' token, no octave marks/gamaka
    const len = Math.max(1, Math.round(n.dur / curL.v));
    return 'z' + (len > 1 ? len : '');
  }
  const { letter, octave } = stepToSwara(n.step, ctx);
  const marks = deriveOctave ? octMarks(octave - curOct.v) : verbatimOct;
  if (deriveOctave) curOct.v = octave;
  const len = Math.max(1, Math.round(n.dur / curL.v));
  // Attributes: keep the note's other attrs from the original body; re-derive its curve.
  let attrs = {};
  if (verbatimBody) { try { attrs = parseAttrs(verbatimBody); } catch { attrs = {}; } }
  const merged = withCurve(attrs, (n.curve && n.curve.length) ? relCurve(n.curve, n.step) : null);
  const s = stringifyAttrs(merged);
  const lenStr = len > 1 ? len : '';
  return marks + letter + lenStr + (s ? '{' + s + '}' : '');
}

// Contract: any non-empty `inserts` (including the `-1` prepend) REQUIRES
// deriveOctave:true — an inserted note shifts the running O= register that
// verbatim (unchanged) notes downstream rely on, so without deriveOctave those
// verbatim notes desync their octave from what they'd actually parse back to.
// A dropped token leaves its separator behind, so every delete widens a gap in the
// saved notation and two adjacent deletes widen it twice. srgm is whitespace-separated,
// so collapsing a run of spaces changes nothing except how it reads — except inside a
// COMMENT, where the spacing is someone's text and not ours to tidy.
/**
 * Stamp the notation version onto a piece this app has written.
 *
 * Every edit re-serialises the notes it touched, and those come back with their curve
 * under `gcurve` — so the file IS version 2 the moment anything is committed to it, and
 * saying so is not optional. A file that already declares a version keeps what it says,
 * including a version from the future: this app has rewritten some of its notes, not
 * decided what the rest of it means.
 *
 * The directive goes at the very top, above the raga, because it says how to read
 * everything below it — including the raga line.
 */
export function stampVersion(src, version = NOTATION_VERSION) {
  if (/(^|\n)\s*[Vv]=/.test(src)) return src;
  return `V=${version}\n` + src;
}

/**
 * Bring older notation up to the current version: the curve attribute renamed, and the
 * version stamped. Both are the file saying what it already said in today's words.
 *
 * It goes through the notation's own tokeniser rather than a text substitution, because
 * the word "gamaka" appears in COMMENTS all over the curated corpus, describing what was
 * heard. Only a note's attribute block is rewritten.
 *
 * READING does not need this — the parser accepts either name whatever the file says. It
 * is for the files and fixtures that should be WRITTEN the current way.
 */
export function migrateNotation(src) {
  return stampVersion(walkTokens(String(src), (t) => {
    if (!t.isNote || !t.hadBrace) return undefined;
    let attrs;
    try { attrs = parseAttrs(t.body); } catch { return undefined; }   // leave what cannot be read
    const a = stringifyAttrs(withCurve(attrs, curveOf(attrs)));
    return t.head + (a ? '{' + a + '}' : '');
  }));
}

export function tidySpaces(src) {
  return src.split('\n')
    .map((l) => (l.trimStart().startsWith('%') ? l : l.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '')))
    .join('\n');
}

/**
 * A painted note or rest, turned into the edit that writes it down.
 *
 * Where it lands was already decided by placePaint; this says what the notation has to
 * do about it, and it is four different things: cut a note in two around it, append past
 * the end (with silence for the gap it was dropped after), prepend before the first
 * note, or drop it into a gap.
 *
 * An EMPTY piece is the one case that cannot be expressed as an edit to a model, because
 * there is no token to anchor against — so a token is returned for the caller to append
 * to the source directly. That token carries its own octave marks: nothing re-derives
 * them on this path, and a blank skeleton's `O=5` would otherwise flatten a note painted
 * in an upper or lower row.
 *
 * `deriveOctave` is always true for the model path — an inserted token shifts the running
 * octave register that every later verbatim note reads.
 */
export function paintEdit({ place, ts, dur, step, rest, model, notes, starts, contentEnd, ctx }) {
  const item = rest ? { rest: true, dur } : { step, octave: Math.floor(step / EDO) + 5, dur, curve: null };
  const changed = new Set(), inserts = new Map();

  if (place.kind === 'append' && place.anchorTok < 0) {
    const lead = ts > 0 ? ('z' + (Math.round(ts) > 1 ? Math.round(ts) : '') + ' ') : '';
    const len = Math.max(1, Math.round(dur));
    const body = len > 1 ? String(len) : '';
    const sw = rest ? null : stepToSwara(step, ctx);
    const tok = rest ? ('z' + body) : (octMarks(sw.octave - 5) + sw.letter + body);
    return { seed: lead + tok };
  }
  if (place.kind === 'split') {
    const hostIdx = notes.findIndex((n) => n.tok === place.host);
    const host = model.get(place.host);
    const { head, tail } = splitSpans(starts[hostIdx], host.dur, ts, dur);
    if (head <= 0) {
      // Degenerate: the paint lands at or before the host's own start, and a zero-length
      // head would emit a bogus token. Insert BEFORE the host instead.
      if (hostIdx > 0) inserts.set(notes[hostIdx - 1].tok, [item]);
      else inserts.set(-1, ts > 0 ? [{ rest: true, dur: ts }, item] : [item]);
    } else {
      host.dur = head; changed.add(place.host);
      // The tail carries the host's remainder onward, same pitch, no gamaka of its own.
      const tailNote = tail > 0 ? { step: host.step, octave: host.octave, dur: tail, curve: null } : null;
      inserts.set(place.host, tailNote ? [item, tailNote] : [item]);
    }
  } else if (place.kind === 'append') {
    const gap = Math.round(ts - contentEnd);
    inserts.set(place.anchorTok, gap > 0 ? [{ rest: true, dur: gap }, item] : [item]);
  } else if (place.anchorTok < 0) {
    inserts.set(-1, ts > 0 ? [{ rest: true, dur: ts }, item] : [item]);
  } else {
    inserts.set(place.anchorTok, [item]);
  }
  return { changed, inserts, deriveOctave: true };
}

/**
 * A note has been dragged to a new pitch. Mutates it and says whether the octave
 * register has to be re-derived for the whole piece.
 *
 * The octave comes from stepToSwara, NOT from Math.floor(step/EDO): the two disagree
 * near the top of an octave, where c12 wraps to the next one, and the letter is already
 * derived that way — spelling them differently would put the note in the wrong octave.
 *
 * A gamaka is held in ABSOLUTE steps, so a moved note has to say what its ornament
 * meant. 'preserve-pitch' leaves the curve where it was, so what sounds is unchanged
 * and only the note it is written against moved; 'move-with-note' shifts it by the same
 * interval, so the shape rides along and sounds transposed.
 */
export function applyMove(note, oldStep, ctx, mode = 'preserve-pitch') {
  const dStep = note.step - oldStep;
  const oldOct = stepToSwara(oldStep, ctx).octave, newOct = stepToSwara(note.step, ctx).octave;
  note.octave = newOct;
  if (mode === 'move-with-note' && note.curve && note.curve.length) {
    note.curve = note.curve.map(([u, sv]) => [u, sv + dStep]);
  }
  return { deriveOctave: newOct !== oldOct, dStep };
}

/**
 * The whole commit path, for any host: re-serialise the model over the source it came
 * from and tidy what a deletion left behind.
 *
 * Both apps that edit a roll need exactly this and nothing more of each other — draw
 * re-parses into its own globals afterwards, the app hands the string to a worker — so
 * the shared part ends at the string. It is the counterpart to core/roll-edit.js: that
 * decides what a gesture MEANS, this decides what the notation then SAYS.
 */
export function applyEdit(srcText, { model, changed = new Set(), inserts = new Map(),
  deletes = new Set(), deriveOctave = false, ctx, restDurs } = {}) {
  const out = serializeModel(srcText, { model, changed, inserts, deletes, deriveOctave, ctx, restDurs });
  return stampVersion(deletes.size ? tidySpaces(out) : out);
}

export function serializeModel(srcText, { model, changed, inserts, deletes, deriveOctave, ctx, restDurs }) {
  const curL = { v: 1 }, curOct = { v: 5 };   // running L= multiplier + octave register
  let prependDone = false;                    // emit inserts.get(-1) before the first NOTE token, once
  return walkTokens(srcText, (t) => {
    if (!t.isNote) {                          // directive / non-note: track L= and O=, emit verbatim
      // Mirror parser.js's L=/O= directives exactly: keys are single-char
      // L/l or O/o; L's value is any positive number (Number(), fractions
      // allowed) and, like the parser, an invalid/non-positive value leaves
      // curL.v unchanged rather than resetting it; O's value is a signed
      // integer (parser: /^-?\d+$/), parsed with parseInt.
      const lm = /^[Ll]=(.+)$/.exec(t.raw);
      if (lm) { const f = Number(lm[1]); if (!Number.isNaN(f) && f > 0) curL.v = f; }
      const om = /^[Oo]=(-?\d+)$/.exec(t.raw);
      if (om) curOct.v = parseInt(om[1], 10);
      return undefined;
    }
    const tok = t.ordinal;
    // Prepend (Task 13): inserts.get(-1) is a special list emitted immediately before
    // the FIRST note token in the walk — not a real ordinal, so it can never collide
    // with a per-token inserts.get(tok) anchor (tok is always >= 0). Fires once,
    // regardless of whether this first token survives, is deleted, or is a rest/
    // out-of-raga note absent from the model.
    let prefix = '';
    if (!prependDone) {
      prependDone = true;
      const pre = inserts.get(-1);
      if (pre && pre.length) {
        prefix = pre.map(item => noteToken(item, { verbatimOct: '', verbatimBody: '',
          deriveOctave: true, curL, curOct, ctx })).join(' ') + ' ';
      }
    }
    // CONSTRAINT: a tok must not be BOTH a delete target and an insert anchor; inserts
    // anchor on surviving notes only. This check returns before the inserts.get(tok) block
    // below, so any tok in both deletes and inserts would silently drop its insert.
    if (deletes.has(tok)) return prefix + '';  // drop the token (Task 4); prepend still emitted
    const n = model.get(tok);
    if (n === undefined) {                    // a rest (z) or out-of-raga note: not in the model
      // A rest's own MIDI ignores the octave register (parser.js noteEvent:
      // rests always resolve at a fixed octave 5), but parser.js's octshift()
      // runs for EVERY token matching SWARA_RE — rests and out-of-raga swaras
      // included — and PERSISTENTLY shifts the running register before that
      // register is read by later notes. So when deriving octaves we must
      // still apply this token's own octave-mark delta to curOct.v here,
      // even though the token itself is emitted verbatim, or the register
      // desyncs and later notes drift by whole octaves.
      if (deriveOctave && t.octMarks) {
        const d = t.octMarks[0] === '>' ? t.octMarks.length : -t.octMarks.length;
        curOct.v += d;
      }
      // A rest whose LENGTH was changed is the one thing about it that can change —
      // silence has a duration and nothing else. Rewritten through noteToken so the
      // running L= multiplier is honoured exactly as it is for a note.
      if (restDurs && restDurs.has(tok)) {
        return prefix + noteToken({ rest: true, dur: restDurs.get(tok) },
          { verbatimOct: '', verbatimBody: '', deriveOctave: false, curL, curOct, ctx });
      }
      return prefix ? prefix + t.raw : undefined;   // verbatim (also keeps ordinal alignment)
    }
    // The surviving note: verbatim head unless it changed; octave re-derived globally when asked.
    let piece;
    if (changed.has(tok) || deriveOctave) {
      piece = noteToken(n, { verbatimOct: t.octMarks, verbatimBody: t.hadBrace ? t.body : '',
        deriveOctave, curL, curOct, ctx });
    } else {
      piece = t.raw;                          // fully verbatim
      // still advance the register bookkeeping is unnecessary when not deriving
    }
    const ins = inserts.get(tok);             // new notes emitted right after (Task 4)
    if (ins && ins.length) {
      for (const m of ins) piece += ' ' + noteToken(m, { verbatimOct: '', verbatimBody: '',
        deriveOctave: true, curL, curOct, ctx });
    }
    return prefix + piece;
  });
}

export function snapToAkshara(t, beat) {
  const q = beat > 0 ? beat : 1;
  return Math.round(t / q) * q;
}

// Snap an absolute step to the nearest raga row, preserving octave: pick the raga
// mod-step nearest the target's pitch-class, then place it in the target's octave.
export function snapToRagaRow(step, gridSteps) {
  if (!gridSteps || !gridSteps.length) return Math.round(step);
  const octave = Math.floor(step / EDO);
  const targetPitchClass = ((step % EDO) + EDO) % EDO;  // floor-mod: handle negative steps correctly
  let best = gridSteps[0], bd = Infinity;
  for (const g of gridSteps) {
    const d = Math.abs(g - targetPitchClass);
    if (d < bd) { bd = d; best = g; }
  }
  return octave * EDO + best;
}

// Arithmetic for a paint-inside-an-existing-note ("split") edit. The host note's
// span [hostStart, hostStart+hostDur) is cut at `ts`: the HEAD [hostStart, ts) stays
// with the host, and the TAIL [ts, hostStart+hostDur) becomes a continuation note
// carrying the host's original pitch onward (see applyPaint in draw.js). `painted`
// (the new note's own duration) isn't part of the head/tail arithmetic — it's the
// span that gets wedged between head and tail — but is accepted here so callers can
// pass the whole paint gesture without picking it apart. Both outputs are clamped to
// >= 0: head + tail === hostDur whenever ts falls inside [hostStart, hostStart+hostDur]
// (the normal case); outside that range one side clamps to 0 and conservation no
// longer holds — callers must handle head<=0 (paint at/before the host's own start)
// as a degenerate case (see applyPaint's split branch).
export function splitSpans(hostStart, hostDur, ts, painted) {
  const head = Math.max(0, ts - hostStart);
  const tail = Math.max(0, hostDur - (ts - hostStart));
  return { head, tail };
}

// Decide where a painted note (onset ts, duration dur) lands in the sequential
// model. `durs[i]` is note i's duration; `starts[i]` its onset; `total` piece len.
export function placePaint({ ts, dur, notes, starts, durs, total }) {
  if (ts >= total || !notes.length) return { kind: 'append', anchorTok: notes.length ? notes[notes.length - 1].tok : -1 };
  for (let i = 0; i < notes.length; i++) {
    const s0 = starts[i], s1 = starts[i] + (durs ? durs[i] : 0);
    if (ts >= s0 && ts < s1) return { kind: 'split', anchorTok: notes[i].tok, host: notes[i].tok };
    if (ts < s0) return { kind: 'fill', anchorTok: i > 0 ? notes[i - 1].tok : -1 };
  }
  return { kind: 'append', anchorTok: notes[notes.length - 1].tok };
}

// Raga pitch-class rows within an absolute 53-EDO step range [lo,hi] inclusive,
// sorted ascending — for seeding the roll's pitch header on a blank piece.
export function ragaRowsInRange(ragaMods, lo, hi) {
  const mods = [...ragaMods].sort((a, b) => a - b);
  const rows = [];
  for (let o = Math.floor(lo / EDO); o <= Math.floor(hi / EDO) + 1; o++)
    for (const m of mods) { const s = m + o * EDO; if (s >= lo && s <= hi) rows.push(s); }
  return rows.sort((a, b) => a - b);
}
