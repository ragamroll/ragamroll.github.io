// Shaping a gamaka WITHOUT leaving the roll: the ✎ mode.
//
// The third gesture module's sibling. core/curve-edit.js zooms onto one note and gives
// the whole canvas to it; this works in place, on whichever note the press lands on,
// with the rest of the piece still around it. Same four gestures — drag an anchor, drag
// elsewhere to trace freehand, tap an anchor to remove it, tap the curve to add one —
// and they are genuinely a different implementation rather than the same one twice:
//
//   the target is PICKED per press, not selected in advance
//   `u` is measured within that note's own span on the roll, not the whole canvas
//   the pitch lands on the 53-EDO grid, or nowhere in particular if snap is off
//   a freehand trace becomes anchors through pointsToAnchors rather than extractAnchors
//     plus the editor's own end-pinning — same result, one call
//
// What a press MEANS, though, is meant to be identical in the two, so that the
// full-screen editor is eventually one way of looking at this rather than a second set of
// rules. Both ask gamaka-curve's tapAnchor which point a tap is on, and it answers by the
// SPACING of the points rather than by a fixed radius — the one thing that cannot be
// shared as a constant, since a note is the whole pane in one editor and 24px in the other.
//
// WHAT COUNTS AS "on" a note here is the note's CURVE, not its column. A gamaka's whole
// purpose is to leave the note's pitch, so its points are mostly nowhere near the note's
// own column — and gating the gesture on the roll's note hit-test made exactly those
// points ungrabbable, which is every point worth reaching. So a press looks for the
// nearest ANCHOR of any note first, then for a curve LINE under the pointer, and only
// then falls back to the note's box, which is what a note with no curve yet needs.
import { addAnchor, removeAnchor, moveAnchor, pointsToAnchors, tapAnchor } from './gamaka-curve.js';

const MOVE_EPS = 6;        // px before a press counts as a drag rather than a tap
const HIT_PX = 16;         // anchor grab radius, on the roll
const LINE_PX = 12;        // how near the drawn curve a tap counts as "on it"

export function createGamakaEdit(canvas, opts) {
  const {
    geometry,              // () -> the roll's geometry (X, Y, stepAtX, tAtY, plot)
    model,                 // () -> { notes, starts }
    hitNote,               // (x, y) -> index | -1   the roll's own hit-test
    snapping = () => true, // () -> bool   on: the 53-EDO grid; off: wherever you put it
    enabled = () => true,
    redraw,
    emit,                  // (intent) -> void   { kind:'gamaka', phase:'begin'|'commit' }
    sample,                // (curve, u) -> step
    onGrabStart = () => {},
    onPitch = () => {},    // (step|null) -> void  the pitch under the pointer; null = let go
  } = opts;

  let g = null;   // { i, pid, downX, downY, dragIdx, moved, buffer, mode, origCurve }

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const noteOf = (i) => model().notes[i];
  const spanOf = (i) => { const m = model(); return [m.starts[i], m.starts[i] + m.notes[i].dur]; };

  const uAt = (i, y) => {
    const [t0, t1] = spanOf(i);
    return Math.max(0, Math.min(1, (geometry().tAtY(y) - t0) / Math.max(1e-6, t1 - t0)));
  };
  // Where a point lands. Snapped, that is the nearest 53-EDO STEP — the grid the roll
  // actually draws — not the raga's own rows and not the 22 shrutis: a gamaka moves
  // through the pitches between them, and a grid coarser than the drawing is a grid you
  // cannot aim at. Unsnapped it goes exactly where you put it, kept to two decimals
  // because that is the precision the notation carries.
  const stepAt = (x) => {
    const p = geometry().plot;
    const raw = geometry().stepAtX(Math.max(p.x, Math.min(p.x + p.w, x)));
    return snapping() ? Math.round(raw) : Math.round(raw * 100) / 100;
  };

  const onCurveLine = (i, x, y) => {
    const c = noteOf(i).curve; if (!c) return false;
    return Math.abs(geometry().X(sample(c, uAt(i, y))) - x) <= LINE_PX;
  };

  // A note's anchors in screen pixels — what a TAP is judged against. The grab radius
  // below deliberately reaches well past the dots, which is right for a drag and wrong
  // for a tap: see tapAnchor, which measures against the spacing instead.
  const anchorPx = (i) => {
    const c = noteOf(i).curve; if (!c) return [];
    const [t0, t1] = spanOf(i), geo = geometry();
    return c.map(([u, st]) => [geo.X(st), geo.Y(t0 + (t1 - t0) * u)]);
  };

  // The nearest anchor of ANY note, with the note it belongs to — the GRAB test, used to
  // decide what a press has hold of. Searching across notes rather than within one is the
  // point: a curve's points are out in open grid, and which note owns the one you are
  // reaching for is not something a user should have to aim at.
  //
  // GENEROUS, and it grows with the note rather than shrinking with it: the dot is 4px
  // across and a hand is not that precise. Nothing is lost by over-reaching, because a
  // drag on a curve means one thing — shift-drag says "re-trace" — and a TAP is no longer
  // decided here at all.
  function nearestAnchor(x, y) {
    const m = model();
    let best = null, bd = Infinity;
    for (let i = 0; i < m.notes.length; i++) {
      const c = m.notes[i].curve; if (!c) continue;
      const geo = geometry(), t0 = m.starts[i], t1 = t0 + m.notes[i].dur;
      const rad = Math.max(HIT_PX, Math.abs(geo.Y(t1) - geo.Y(t0)) / 3);
      for (let k = 0; k < c.length; k++) {
        const cx = geo.X(c[k][1]), cy = geo.Y(t0 + (t1 - t0) * c[k][0]);
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d <= rad * rad && d < bd) { bd = d; best = { i, k }; }
      }
    }
    return best;
  }
  // Which note's drawn curve passes under the pointer, or -1. This is how a tap adds a
  // point, and how a press away from the note's column still knows what it is aiming at.
  function noteUnderCurve(x, y) {
    const m = model();
    for (let i = 0; i < m.notes.length; i++) {
      const c = m.notes[i].curve; if (!c) continue;
      const t0 = m.starts[i], t1 = t0 + m.notes[i].dur;
      const yy = geometry().tAtY(y);
      if (yy < t0 || yy > t1) continue;                 // the pointer is not in its span
      if (onCurveLine(i, x, y)) return i;
    }
    return -1;
  }

  const onDown = (e) => {
    if (!enabled() || g) return;
    const { x, y } = at(e);

    // SHIFT always re-traces, whatever is under the pointer. Without it a curve can never
    // be redrawn in place: a note is about 24px tall at default zoom and a trace starts
    // at its top, which is exactly where the u=0 anchor is, so every press lands on a
    // point. Shift says which of the two you meant instead of the geometry guessing.
    const near = e.shiftKey ? null : nearestAnchor(x, y);
    const i = near ? near.i : (noteUnderCurve(x, y) >= 0 ? noteUnderCurve(x, y) : hitNote(x, y));
    if (i < 0) return;                       // nothing to shape here
    onGrabStart();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* the gesture still works */ }
    const dragIdx = near ? near.k : -1;
    g = { i, pid: e.pointerId, downX: x, downY: y, dragIdx, moved: false, buffer: null,
      mode: dragIdx >= 0 ? 'anchor' : 'pending', origCurve: noteOf(i).curve };
    // Says which note this press is AIMED at, before anything has been changed and whether
    // or not anything ever is. A host with controls that act on a note — clear it, copy its
    // gamaka, paste one onto it — needs a subject that a press can choose; without this the
    // only way to choose one was to edit it, so a curve could never be pasted onto a note
    // that had none. Not an edit: no undo, nothing to commit.
    emit({ kind: 'gamaka', phase: 'target', index: i, tok: noteOf(i).tok });
  };

  const onMove = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    const far = Math.abs(x - g.downX) > MOVE_EPS || Math.abs(y - g.downY) > MOVE_EPS;
    if (g.mode === 'anchor') {
      if (!far) return;
      if (!g.moved) { emit({ kind: 'gamaka', phase: 'begin' }); g.moved = true; }
      const st = stepAt(x);
      noteOf(g.i).curve = moveAnchor(noteOf(g.i).curve, g.dragIdx, uAt(g.i, y), st);
      onPitch(st);
      redraw();
      return;
    }
    if (g.mode === 'pending' && far) {
      // A drag that did not start on an anchor replaces the curve outright.
      emit({ kind: 'gamaka', phase: 'begin' });
      g.mode = 'free'; g.buffer = []; noteOf(g.i).curve = null;
    }
    if (g.mode === 'free') {
      const u = uAt(g.i, y), st = stepAt(x);
      if (g.buffer.length && u <= g.buffer[g.buffer.length - 1][0]) g.buffer[g.buffer.length - 1][1] = st;
      else g.buffer.push([u, st]);
      noteOf(g.i).curve = g.buffer.slice();
      onPitch(st);
      redraw();
    }
  };

  const onUp = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    const done = g; g = null;
    const moved = Math.abs(x - done.downX) > MOVE_EPS || Math.abs(y - done.downY) > MOVE_EPS;
    onPitch(null);
    // Every commit carries the note it shaped. The host has no other way to know: the
    // gesture writes straight into the model, and which note was under the pointer was
    // decided in here. It is what lets the strip's Clear/Copy/Paste have a subject.
    const commit = () => emit({ kind: 'gamaka', phase: 'commit', index: done.i, tok: noteOf(done.i).tok });

    if (done.mode === 'free') {
      noteOf(done.i).curve = pointsToAnchors(done.buffer);
      redraw(); commit(); return;
    }
    if (done.mode === 'anchor' && done.moved) { commit(); return; }
    if (moved) return;

    // A TAP, and the same three answers the full-screen editor gives, in the same order:
    // on a point it goes, on the line one arrives, anywhere else nothing happens. Which
    // one it is cannot be decided by the radius the PRESS was grabbed with — that radius
    // is generous on purpose, so it swallowed the whole note and every tap read as "on a
    // point", removing one where a new one was being asked for.
    const c = noteOf(done.i).curve;
    if (!c) return;
    const k = tapAnchor(anchorPx(done.i), x, y);
    if (k >= 0) {
      emit({ kind: 'gamaka', phase: 'begin' });
      noteOf(done.i).curve = removeAnchor(c, k);
      redraw(); commit(); return;
    }
    if (onCurveLine(done.i, x, y)) {
      emit({ kind: 'gamaka', phase: 'begin' });
      noteOf(done.i).curve = addAnchor(c, uAt(done.i, y), stepAt(x));
      redraw(); commit();
    }
  };

  const onCancel = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    // Put back exactly what was there: a half-traced stroke is not a curve anyone asked
    // for, and there is no commit to undo it with.
    noteOf(g.i).curve = g.origCurve; g = null; onPitch(null); redraw();
  };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', onUp, true);
  canvas.addEventListener('pointercancel', onCancel, true);

  return {
    /** True while a stroke is in flight — the host should not fight it. */
    busy: () => !!g,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onCancel, true);
    },
  };
}
