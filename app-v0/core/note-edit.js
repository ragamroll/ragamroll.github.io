// Pure edit operations for the draw roll. The model (absolute step/octave/dur/
// curve) is the source of truth; serializeModel re-derives the RELATIVE surface
// notation (octave >/< marks, L=-scaled length, swara letter) while preserving
// hand-authored annotations (comments, sahitya, whitespace, directives) by token
// ordinal. Deriving octave from the absolute model — instead of patching the
// relative marks in place — removes octave-boundary ripple at the root.
import { walkTokens, parseAttrs, stringifyAttrs } from './gamaka-inline.js';
import { stepToSwara } from './detect.js';
import { EDO } from './shruti.js';

export function octMarks(dOct) {
  return dOct > 0 ? '>'.repeat(dOct) : (dOct < 0 ? '<'.repeat(-dOct) : '');
}

// Round a curve to note-relative integer deltas (u to 2dp), matching draw's
// inlineSrc() so gamaka output is identical to the existing curve-editing path.
function relCurve(curve, step) {
  return curve.map(([u, s]) => [Math.round(u * 100) / 100, Math.round(s - step)]);
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
  // Attributes: keep non-gamaka attrs from the original body; re-derive gamaka.
  let attrs = {};
  if (verbatimBody) { try { attrs = parseAttrs(verbatimBody); } catch { attrs = {}; } }
  const rest = { ...attrs }; delete rest.gamaka;
  const cur = (n.curve && n.curve.length) ? relCurve(n.curve, n.step) : null;
  const merged = cur ? { gamaka: cur, ...rest } : rest;
  const s = stringifyAttrs(merged);
  const lenStr = len > 1 ? len : '';
  return marks + letter + lenStr + (s ? '{' + s + '}' : '');
}

// Contract: any non-empty `inserts` (including the `-1` prepend) REQUIRES
// deriveOctave:true — an inserted note shifts the running O= register that
// verbatim (unchanged) notes downstream rely on, so without deriveOctave those
// verbatim notes desync their octave from what they'd actually parse back to.
export function serializeModel(srcText, { model, changed, inserts, deletes, deriveOctave, ctx }) {
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
