// The lane model: written swaras and sahitya, against the notes that actually sound.
//
// A .srgm converted from gka carries two things a converter cannot place. `%@` is the
// written swaras for a stretch of music and `%$` the sahitya, and neither can be attached
// per note automatically — not because the format is lacking but because the music is: a
// single ornamented gesture routinely traverses two or three written swaras, so the Kalyani
// varnam has 191 written swaras against 112 audible notes. The mapping is a human judgement.
// This module is the data that judgement is made on, and the record of it once made.
//
// A bead is { text, note, grow, block }. `note` IS the edit: an index into the notes, or
// null while the bead is still loose. Every position on screen is derived from it and
// nothing is positioned by hand — an earlier free-drag design had to fight overlap,
// ordering and beads sliding past one another, and all of that disappears when position is
// a consequence rather than an input.
//
// Two parsers would be one too many. parse() reads the music — how long each note is, and
// which are rests — and walkTokens reads the annotations around it, counting note ordinals
// the same way parse() counts note events. Nothing here re-implements either.
import { parse } from './parser.js';
import { walkTokens, parseAttrs, stringifyAttrs } from './gamaka-inline.js';

// The per-note attribute this tool writes. NOT `swara`: a parsed note already has a `swara`
// — the letter it is, S or R or G — and copying a group of written swaras over the top of
// that would erase the note's own identity. `written` is what the group is: what was
// written for the stretch of music this note belongs to.
export const WRITTEN_KEY = 'written';
export const SAHITYA_KEY = 'sahitya';

/** The first note at or after `i` that makes a sound. A group never attaches to a rest. */
export function firstAudible(notes, i) {
  while (i < notes.length && notes[i].rest) i++;
  return i;
}

/**
 * Everything the lane editor needs, from the source text alone.
 *
 * Returns { notes, sw, sa, blockSpan, front, resumed }. `notes` carries each note's start
 * and length in units, whether it is a rest, and the `%BB` block it was written inside.
 */
export function readLanes(src) {
  const model = parse(src);
  const events = model.events.filter((e) => e.type === 'note');

  // The annotations, and which block each note sits in. Comments never reach parse(), so
  // they are read here — from the same walk that counts the notes, so a `%@` line is tied
  // to the block whose notes it describes rather than to a line number.
  const lines = { sw: [], sa: [] };
  const blockOf = [];
  const attrsOf = [];
  let session = null, block = 0;
  walkTokens(src, (t) => {
    if (t.isComment) {
      const raw = t.head.trim();
      if (/^%BB\b/.test(raw)) block += 1;
      else if (raw.startsWith('%@')) lines.sw.push([block, raw.slice(2)]);
      else if (raw.startsWith('%$')) lines.sa.push([block, raw.slice(2)]);
      else if (raw.startsWith('%LANES')) { try { session = JSON.parse(raw.slice(6).trim()); } catch (_) { session = null; } }
      return undefined;
    }
    if (!t.isNote) return undefined;
    blockOf[t.ordinal] = block;
    let a = {};
    if (t.hadBrace) { try { a = parseAttrs(t.body); } catch (_) { a = {}; } }
    attrsOf[t.ordinal] = a;
    return undefined;
  });

  const notes = [];
  let at = 0;
  events.forEach((e, i) => {
    notes.push({ start: at, dur: e.absLen || 0, rest: !!e.rest, block: blockOf[i] || 0,
      tok: (e.swara || '') + (e.absLen || ''), attrs: attrsOf[i] || {} });
    at += e.absLen || 0;
  });

  // Beads are the annotation lines split at whitespace, kept VERBATIM. An early version
  // stripped `-`, `,` and `;` and it was wrong: a comma may mean held or may mean silence,
  // and a hyphen marks a phrase end. Stripping destroys what the reader is there to judge.
  const bead = (src2) => {
    const out = [];
    for (const [blk, line] of src2) for (const w of line.split(/\s+/).filter(Boolean)) out.push({ text: w, note: null, grow: 0, block: blk });
    return out;
  };
  const sw = bead(lines.sw), sa = bead(lines.sa);

  // Where each block sits on the timeline. A block is one source line of gka notation and
  // its `%@` / `%$` describe exactly those notes, so it is a real constraint on where a
  // bead may go — not a hint.
  const blockSpan = {};
  for (const n of notes) {
    const b = blockSpan[n.block] || (blockSpan[n.block] = { start: n.start, end: n.start });
    if (n.start < b.start) b.start = n.start;
    if (n.start + n.dur > b.end) b.end = n.start + n.dur;
  }

  // Resume. Groups are written left to right, so replaying the notes in order and consuming
  // beads off the head of the queue rebuilds the grouping exactly. The text is CHECKED
  // rather than trusted: a file edited by hand, or one whose `%@` line changed, will
  // disagree, and then those beads stay loose and are counted. Never bind text to a note it
  // did not come from.
  const resumed = { sw: 0, sa: 0, mismatch: 0 };
  const restore = (key, beads, lane) => {
    let head = 0;
    notes.forEach((n, ni) => {
      const v = n.attrs[key];
      if (typeof v !== 'string' || !v.trim()) return;
      const want = v.trim().split(/\s+/);
      const have = beads.slice(head, head + want.length).map((b) => b.text);
      if (have.length !== want.length || have.join(' ') !== want.join(' ')) { resumed.mismatch += 1; return; }
      for (let j = 0; j < want.length; j++) beads[head + j].note = ni;
      head += want.length;
      resumed[lane] += want.length;
    });
  };
  restore(WRITTEN_KEY, sw, 'sw');
  restore(SAHITYA_KEY, sa, 'sa');

  const lastOf = (beads) => beads.reduce((m, b) => (b.note != null && b.note > m ? b.note : m), -1);
  const front = { sw: firstAudible(notes, lastOf(sw) + 1), sa: firstAudible(notes, lastOf(sa) + 1) };
  // A note deliberately passed over leaves no trace in the attributes — it is
  // indistinguishable from one not yet reached — so the frontiers are remembered
  // separately. Without this, reopening silently undoes every "leave empty".
  if (session) {
    if (Number.isFinite(session.sw)) front.sw = session.sw;
    if (Number.isFinite(session.sa)) front.sa = session.sa;
    const g = session.grow || {};
    for (const [k, beads] of [['sw', sw], ['sa', sa]]) {
      for (const i of Object.keys(g[k] || {})) if (beads[i]) beads[i].grow = g[k][i];
    }
  }

  return { notes, sw, sa, blockSpan, front, resumed, total: at, diagnostics: model.diagnostics };
}

/**
 * Where every bead of one lane sits, in units. Attached beads share their note's span;
 * loose beads sit inside their OWN block, spread over whatever of it the frontier has not
 * passed — never behind the frontier, because a bead behind it can no longer be attached.
 *
 * This is what makes the initial state useful rather than a queue: on the Kalyani varnam it
 * puts all 191 written swaras within a note or two of where they belong before anyone
 * touches anything.
 */
export function layoutLane(state, which) {
  const beads = which === 'sw' ? state.sw : state.sa;
  const { notes, blockSpan, total } = state;
  const out = new Array(beads.length).fill(null);

  const byNote = new Map();
  beads.forEach((b, i) => {
    if (b.note == null) return;
    if (!byNote.has(b.note)) byNote.set(b.note, []);
    byNote.get(b.note).push(i);
  });
  for (const [ni, ids] of byNote) {
    const n = notes[ni];
    if (!n) continue;
    const w = n.dur / ids.length;
    ids.forEach((i, j) => { out[i] = { start: n.start + w * j, dur: w + (beads[i].grow || 0), att: true }; });
  }

  const f = state.front[which];
  const fs = f < notes.length ? notes[f].start : total;
  const loose = new Map();
  beads.forEach((b, i) => {
    if (b.note != null) return;
    if (!loose.has(b.block)) loose.set(b.block, []);
    loose.get(b.block).push(i);
  });
  for (const [blk, ids] of loose) {
    const sp = blockSpan[blk] || { start: fs, end: total };
    const from = Math.max(sp.start, fs);
    const to = Math.max(from + 0.6, sp.end);
    const w = (to - from) / ids.length;
    ids.forEach((i, j) => { out[i] = { start: from + w * j, dur: w, att: false, block: blk }; });
  }
  return out;
}

/**
 * The alignment, written back into the notation.
 *
 * Through walkTokens, like every other rewrite in this codebase: a note's `{…}` is rebuilt
 * and everything around it — comments, whitespace, directives, the `%@` and `%$` lines this
 * was all read from — is emitted verbatim. The annotations stay because they are the
 * evidence: a reader who wants to check the alignment needs to see what was written.
 *
 * A note with no beads LOSES any group it had. That is what detaching means, and a writer
 * that only ever added would leave the file disagreeing with the screen.
 */
export function writeLanes(src, state) {
  const groups = { [WRITTEN_KEY]: new Map(), [SAHITYA_KEY]: new Map() };
  const collect = (beads, key) => {
    for (const b of beads) {
      if (b.note == null) continue;
      if (!groups[key].has(b.note)) groups[key].set(b.note, []);
      groups[key].get(b.note).push(b.text);
    }
  };
  collect(state.sw, WRITTEN_KEY);
  collect(state.sa, SAHITYA_KEY);

  const out = walkTokens(src, (t) => {
    if (!t.isNote) return undefined;
    let attrs = {};
    if (t.hadBrace) { try { attrs = parseAttrs(t.body); } catch (_) { attrs = {}; } }
    const w = groups[WRITTEN_KEY].get(t.ordinal), sa = groups[SAHITYA_KEY].get(t.ordinal);
    // Rebuilt in a stable order — gka, written, sahitya, then whatever else the note
    // carried, in the order it carried it. Otherwise every save reshuffles keys and the
    // diff is unreadable, which is how a real change comes to be missed among noise.
    const next = {};
    if (attrs.gka !== undefined) next.gka = attrs.gka;
    if (w && w.length) next[WRITTEN_KEY] = w.join(' ');
    if (sa && sa.length) next[SAHITYA_KEY] = sa.join(' ');
    for (const k of Object.keys(attrs)) {
      if (k === 'gka' || k === WRITTEN_KEY || k === SAHITYA_KEY) continue;
      next[k] = attrs[k];
    }
    const body = stringifyAttrs(next);
    return t.head + (body ? '{' + body + '}' : '');
  });

  // The session line. Frontiers cannot be derived from the attributes — a note deliberately
  // left empty is indistinguishable from one not yet reached — so they are written down.
  const grow = { sw: {}, sa: {} };
  state.sw.forEach((b, i) => { if (b.grow) grow.sw[i] = Math.round(b.grow * 100) / 100; });
  state.sa.forEach((b, i) => { if (b.grow) grow.sa[i] = Math.round(b.grow * 100) / 100; });
  const line = '%LANES ' + JSON.stringify({ sw: state.front.sw, sa: state.front.sa, grow });

  const lines = out.split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith('%LANES'));
  if (at >= 0) lines[at] = line;
  else {
    // After `O=`, where the reference implementation puts it and where a reader looking for
    // the header will find it. Failing that, above the first note rather than at the very
    // top, so a title comment stays the first thing in the file.
    const hdr = lines.findIndex((l) => /^\s*O\s*=/.test(l));
    if (hdr >= 0) lines.splice(hdr + 1, 0, line);
    else {
      const firstNote = lines.findIndex((l) => /^\s*(?:>*|<*)[sSrRgGmMpPdDnNzZ]\d*(\{|\s|$)/.test(l));
      lines.splice(firstNote >= 0 ? firstNote : lines.length, 0, line);
    }
  }
  return lines.join('\n');
}

// ---- the edit ---------------------------------------------------------------------------
//
// Four operations, and every one of them is about `note`. Attaching writes it, leaving
// empty writes nothing at all, detaching takes the last thing back. Nothing moves a bead:
// where it appears is layoutLane's answer to where it belongs.
//
// Pure, so the page holds no rules of its own — and so the rules can be argued with in a
// test rather than through a browser.

const laneOf = (state, k) => (k === 'sw' ? state.sw : state.sa);

/** A copy that shares nothing the operations write to. */
function clone(state) {
  return { ...state,
    sw: state.sw.map((b) => ({ ...b })),
    sa: state.sa.map((b) => ({ ...b })),
    front: { ...state.front },
    log: (state.log || []).slice() };
}

/** Loose beads can be chosen; an attached one is already spoken for. */
export function canSelect(state, k, i) {
  const b = laneOf(state, k)[i];
  return !!b && b.note == null;
}

/**
 * The run a shift-click asks for, or null if it cannot be had.
 *
 * A selection never spans an already-attached bead. Groups are built left to right and a
 * run that jumped over one would be asking to attach beads either side of something
 * already placed — which is not a group, it is two.
 */
export function selectRun(state, k, anchor, i) {
  const beads = laneOf(state, k);
  if (!beads[anchor] || !beads[i]) return null;
  const a = Math.min(anchor, i), b = Math.max(anchor, i);
  for (let j = a; j <= b; j++) if (beads[j].note != null) return null;
  return { a, b };
}

/**
 * Bind beads a..b to the lane's frontier note, and move that frontier on.
 *
 * ONLY that lane's. The two advance independently — a syllable may cover three notes while
 * the written swaras go one to one — and moving both would silently mis-place the next
 * attach in the other lane.
 */
export function attach(state, k, a, b) {
  const f = state.front[k];
  if (f >= state.notes.length) return state;
  const run = selectRun(state, k, a, b);
  if (!run) return state;
  const next = clone(state);
  const beads = laneOf(next, k);
  for (let j = run.a; j <= run.b; j++) beads[j].note = f;
  next.log.push({ k, a: run.a, b: run.b, prev: f });
  next.front[k] = firstAudible(next.notes, f + 1);
  return next;
}

/**
 * Pass over a note without consuming a bead. This is how silence is written: traditional
 * Carnatic notation has no rest, so "nothing sung here" is a note left empty rather than a
 * marker placed on it.
 */
export function leaveEmpty(state, k) {
  const f = state.front[k];
  if (f >= state.notes.length) return state;
  const next = clone(state);
  next.log.push({ k, a: -1, b: -1, prev: f });
  next.front[k] = firstAudible(next.notes, f + 1);
  return next;
}

/** Take back the last step, whichever lane it was in and whichever kind it was. */
export function detach(state) {
  const log = state.log || [];
  if (!log.length) return state;
  const next = clone(state);
  const e = next.log.pop();
  if (e.a >= 0) { const beads = laneOf(next, e.k); for (let j = e.a; j <= e.b; j++) beads[j].note = null; }
  next.front[e.k] = e.prev;
  return next;
}
