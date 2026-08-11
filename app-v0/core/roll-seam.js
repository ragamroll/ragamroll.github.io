// Moving the boundary a note shares with its neighbour, for whichever app is hosting.
//
// The counterpart to core/roll-edit.js. That module decides what a gesture MEANS and
// emits an intent; this one decides what a boundary intent DOES to the music — which
// notes give up time, whose gamaka carries the pitch across, and what the notation then
// has to say. Neither knows which page it is on.
//
// It is stateful on purpose: a drag is a conversation. The contour is captured once,
// when the pointer goes down, and every preview re-cuts THAT rather than re-reading
// notes it has already re-split — otherwise each preview folds the last one's rounding
// into the next, and a slow drag ends somewhere a fast one does not.
//
// What the host supplies is small: where the music is, how long an akshara lasts, and
// what to do when an edit is final. It never touches the DOM.
import { anchorsOf, resplitAt } from './note-split.js';
import { snapToAkshara } from './note-edit.js';
import { EDO } from './shruti.js';

/**
 * model()     -> { notes, starts, rests }   the SAME arrays the host renders from —
 *                previews mutate them in place, which is how a drag is seen at all
 * beat()      -> number                     the tala's akshara, the smallest length
 * pushUndo()                                called once per COMMITTED edit, never per preview
 * commit(spec) -> Promise                   { changed, deletes, restDurs, deriveOctave }
 * render()                                  redraw after a preview
 * notify(msg)                               optional; a refusal the user should see
 */
export function createSeamHost({ model, beat, pushUndo, commit, render, notify = () => {} }) {
  let seamDrag = null;
  let pushDrag = null;    // { idx, tok, near, oldDur, t0, starts, restT0 } snapshotted at grab start
  function restorePush() {
    if (!pushDrag) return;
    const { notes, starts, rests } = model();
    const d = pushDrag;
    if (notes[d.idx]) notes[d.idx].dur = d.oldDur;
    for (let j = 0; j < starts.length && j < d.starts.length; j++) starts[j] = d.starts[j];
    rests.forEach((r, k) => { if (k < d.restT0.length) r.t0 = d.restT0[k]; });
    pushDrag = null;
  }
  async function pushEdge(i, it) {
    const { notes, starts, rests } = model();
    const near = it.edge !== 'far';
    const akshara = beat() || 1;      // NOT `beat`: that is the injected accessor
    if (!pushDrag || pushDrag.tok !== it.tok || pushDrag.near !== near) {
      pushDrag = { idx: i, tok: it.tok, near, oldDur: notes[i].dur, t0: starts[i],
        starts: starts.slice(), restT0: rests.map((r) => r.t0) };
    }
    const d = pushDrag;
    // Far edge: the pointer IS the note's end. Near edge: the pointer's distance above
    // the note's start is how much has been pulled open.
    const dur = Math.max(akshara, Math.round(d.near ? d.oldDur - (it.t - d.t0) : it.t - d.t0));
    const delta = dur - d.oldDur;

    if (it.phase !== 'commit') {
      // The notes after it move DURING the drag. Without this the note grows over its
      // neighbours and they only jump apart on pointerup — the piece looks broken at
      // exactly the moment you are judging whether the length is right.
      notes[i].dur = dur;
      const end = d.t0 + d.oldDur;
      for (let j = 0; j < starts.length; j++) if (d.starts[j] >= end) starts[j] = d.starts[j] + delta;
      rests.forEach((r, k) => { if (d.restT0[k] >= end) r.t0 = d.restT0[k] + delta; });
      render(); return;
    }
    pushDrag = null;
    if (delta === 0) { render(); return; }
    pushUndo();
    notes[i].dur = dur;
    await commit({ changed: new Set([it.tok]), deriveOctave: false });
  }

  function prevElement(tok) {
    const { notes, starts, rests } = model();
    let best = null;
    for (const n of notes) if (n.tok < tok && (!best || n.tok > best.tok)) best = { tok: n.tok, rest: false, dur: n.dur, t0: starts[notes.indexOf(n)], step: n.step, curve: n.curve };
    for (const r of rests) if (r.tok < tok && (!best || r.tok > best.tok)) best = { tok: r.tok, rest: true, dur: r.dur, t0: r.t0, step: 0, curve: null };
    return best;
  }

  function nextElement(tok) {
    const { notes, starts, rests } = model();
    let best = null;
    for (const n of notes) if (n.tok > tok && (!best || n.tok < best.tok)) best = { tok: n.tok, rest: false, dur: n.dur, t0: starts[notes.indexOf(n)], step: n.step, curve: n.curve };
    for (const r of rests) if (r.tok > tok && (!best || r.tok < best.tok)) best = { tok: r.tok, rest: true, dur: r.dur, t0: r.t0, step: 0, curve: null };
    return best;
  }
  function restoreSeam() {
    if (!seamDrag) return;
    const { notes, starts, rests } = model();
    const d = seamDrag, i = notes.findIndex((x) => x.tok === d.tok);
    const on = d.other.rest ? null : notes.find((x) => x.tok === d.other.tok);
    const or_ = d.other.rest ? rests.find((x) => x.tok === d.other.tok) : null;
    if (on) { on.dur = d.was.otherDur; on.curve = d.was.otherCurve; const j = notes.indexOf(on); if (j >= 0) starts[j] = d.was.otherT0; }
    if (or_) { or_.dur = d.was.otherDur; or_.t0 = d.was.otherT0; }
    if (i >= 0) { notes[i].dur = d.was.dur; notes[i].curve = d.was.curve; starts[i] = d.was.t0; }
    seamDrag = null;
  }

  const INTENT_LOG = [];              // headless guards read this; nothing else does

  /** A boundary intent — either edge, with or without shift. */
  async function handle(it) {

  const { notes, starts, rests } = model();
  const n = notes.find((x) => x.tok === it.tok);
  const i = n ? notes.indexOf(n) : -1;
  if (i < 0) return;
  if (it.phase === 'cancel') { restorePush(); restoreSeam(); render(); return; }
  if (it.push) { await pushEdge(i, it); return; }
  const near = it.edge !== 'far';

  if (!seamDrag || seamDrag.tok !== it.tok || seamDrag.near !== near) {
    const other = near ? prevElement(it.tok) : nextElement(it.tok);
    if (!other) {
      // No neighbour on this side, so there is no seam. At the FAR edge that leaves
      // the plain length change it always was — the only way to lengthen the piece
      // from the roll — and at the near edge of the very first note, nothing to do.
      seamDrag = null;
      if (near) return;
      const dur = Math.max(beat() || 1, it.t - starts[i]);
      if (it.phase !== 'commit') { notes[i].dur = dur; render(); return; }
      pushUndo(); notes[i].dur = dur;
      await commit({ changed: new Set([it.tok]), deriveOctave: false });
      return;
    }
    // When the neighbour is a REST, the element on ITS far side comes along as
    // context — not as something this drag can change, but because bridging the
    // silence needs the pitch at both ends of it. Without it the gap has only one
    // end and the best it could do is hold one pitch flat across the silence.
    const beyond = other.rest ? (near ? prevElement(other.tok) : nextElement(other.tok)) : null;
    const held = { t0: starts[i], dur: notes[i].dur, step: notes[i].step, curve: notes[i].curve };
    const oth = { t0: other.t0, dur: other.dur, step: other.step, curve: other.curve, rest: other.rest };
    const ctxItem = beyond ? [{ t0: beyond.t0, dur: beyond.dur, step: beyond.step, curve: beyond.curve, rest: beyond.rest }] : [];
    seamDrag = {
      tok: it.tok, near, other,
      t0: near ? other.t0 : held.t0,
      end: near ? held.t0 + held.dur : oth.t0 + oth.dur,
      // Each side keeps its own letter; a rest has no pitch, so the note it is being
      // traded against lends its step to that side of the cut.
      prevStep: near ? (other.rest ? notes[i].step : other.step) : notes[i].step,
      nextStep: near ? notes[i].step : (other.rest ? notes[i].step : other.step),
      points: anchorsOf(near ? [...ctxItem, oth, held] : [held, oth, ...ctxItem]),
      was: { dur: held.dur, curve: held.curve, t0: held.t0,
        otherDur: other.dur, otherCurve: other.curve, otherT0: other.t0 },
    };
  }
  const d = seamDrag;
  const akshara = beat() || 1;        // NOT `beat`: that is the injected accessor
  const out = resplitAt({ points: d.points, t0: d.t0, end: d.end, seam: it.t,
    prevStep: d.prevStep, nextStep: d.nextStep, minDur: akshara,
    swallow: d.near ? 'first' : 'second' });

  // The held note is the SECOND of the pair at its near edge, the FIRST at its far
  // edge. Only the other side can come back null.
  const heldPart = d.near ? out.next : out.prev;
  const otherPart = d.near ? out.prev : out.next;
  const otherNote = d.other.rest ? null : notes.find((x) => x.tok === d.other.tok);
  const otherRest = d.other.rest ? rests.find((x) => x.tok === d.other.tok) : null;

  if (it.phase !== 'commit') {
    // Shown, not recorded. A fully absorbed neighbour is drawn as nothing rather
    // than removed, so the arrays keep their shape until the pointer is up.
    const od = otherPart ? otherPart.dur : 0;
    if (otherNote) { otherNote.dur = od; if (otherPart) otherNote.curve = otherPart.curve; }
    if (otherRest) otherRest.dur = od;
    notes[i].dur = heldPart.dur; notes[i].curve = heldPart.curve;
    // Whichever element sits second in the pair is the one whose start moves.
    if (d.near) starts[i] = d.t0 + od;
    else {
      const j = otherNote ? notes.indexOf(otherNote) : -1;
      if (j >= 0) starts[j] = d.t0 + heldPart.dur;
      if (otherRest) otherRest.t0 = d.t0 + heldPart.dur;
    }
    render(); return;
  }

  pushUndo();
  const changed = new Set([it.tok]);
  if (!otherPart) {
    // Swallowed whole: the neighbour's token goes, its pitch already inside this
    // note's gamaka. deriveOctave, because a dropped token takes its octave marks
    // with it and the register must be re-stated for everything after.
    seamDrag = null;
    await commit({ changed, deletes: new Set([d.other.tok]), deriveOctave: true });
    return;
  }
  seamDrag = null;
  if (d.other.rest) await commit({ changed, deriveOctave: false, restDurs: new Map([[d.other.tok, otherPart.dur]]) });
  else { changed.add(d.other.tok); await commit({ changed, deriveOctave: false }); }
  return;
  }

  // Cut one note into two at `t`, without changing what is heard. The inverse of
  // dragging a seam away, and the same machinery: a note is a list of absolute anchors,
  // and splitting it is choosing where to cut that list. Both halves keep the original's
  // step, so each carries its own part of the ornament and the two played back to back
  // are the note that was there before.
  //
  // No rest is inserted between them. pitchy's split does insert one, because two
  // same-pitch notes there would be re-merged by its segmenter; nothing merges here, and
  // inventing silence would change what is heard.
  async function splitAt(tok, t) {
    const { notes, starts } = model();
    const i = notes.findIndex((x) => x.tok === tok);
    if (i < 0) return;
    const akshara = beat() || 1;
    const t0 = starts[i], end = t0 + notes[i].dur;
    const cut = snapToAkshara(t, akshara);
    // Refuse rather than clamp. Clamping would move the cut somewhere the user did not
    // click and hand back two notes of a length they did not choose; a cut with no room
    // on one side is not a split at all. Same rule as pitchy, which ignores a click
    // inside a note's edge margin.
    if (cut - t0 < akshara || end - cut < akshara) {
      notify('too close to the edge to split — click nearer the middle');
      return;
    }
    const n = notes[i];
    const out = resplitAt({
      points: anchorsOf([{ t0, dur: n.dur, step: n.step, curve: n.curve }]),
      t0, end, seam: cut, prevStep: n.step, nextStep: n.step, minDur: akshara });
    if (!out.prev) return;                      // unreachable given the guard; never a half-note
    pushUndo();
    n.dur = out.prev.dur; n.curve = out.prev.curve;
    const tail = { step: n.step, octave: Math.floor(n.step / EDO) + 5, dur: out.next.dur, curve: out.next.curve };
    // deriveOctave is REQUIRED with a non-empty inserts (serializeModel's contract): a
    // new token shifts the running octave register every later verbatim note reads.
    await commit({ changed: new Set([tok]), inserts: new Map([[tok, [tail]]]), deriveOctave: true });
    notify('split into two notes');
  }

  // A rest's own edge. Silence has a length and nothing else, so that is all that is
  // written back — restDurs, never a re-tokenised note.
  async function resizeRest(it) {
    const { rests } = model();
    const r = rests.find((x) => x.tok === it.tok);
    if (!r) return;
    if (it.phase !== 'commit') { r.dur = it.dur; render(); return; }
    pushUndo();
    await commit({ restDurs: new Map([[it.tok, it.dur]]) });
  }

  /** Put back whatever a dying gesture had already moved. */
  function cancel() { restorePush(); restoreSeam(); }

  // One door for every intent that changes the MUSIC. What it costs — undo,
  // re-serialising, redrawing — is still the host's, through the callbacks above.
  async function dispatch(it) {
    if (it.kind === 'boundary') return handle(it);
    if (it.kind === 'split') return splitAt(it.tok, it.t);
    if (it.kind === 'resize' && it.target === 'rest') return resizeRest(it);
    return undefined;
  }

  return { handle: dispatch, cancel };
}
