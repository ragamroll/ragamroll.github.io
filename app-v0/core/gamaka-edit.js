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
//   a freehand trace becomes anchors through pointsToAnchors, not extractAnchors —
//     nothing is pinned to u=0 and u=1, since the note is not being isolated
//
// WHAT COUNTS AS "on" a note here is the note's CURVE, not its column. A gamaka's whole
// purpose is to leave the note's pitch, so its points are mostly nowhere near the note's
// own column — and gating the gesture on the roll's note hit-test made exactly those
// points ungrabbable, which is every point worth reaching. So a press looks for the
// nearest ANCHOR of any note first, then for a curve LINE under the pointer, and only
// then falls back to the note's box, which is what a note with no curve yet needs.
import { addAnchor, removeAnchor, moveAnchor, pointsToAnchors } from './gamaka-curve.js';

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

  // NEAREST, not the first within reach — and within a radius that SHRINKS WITH THE NOTE.
  //
  // A fixed 16px was wider than the note itself: at default zoom a note is about 24px
  // tall, so a traced curve's anchors sit a few pixels apart and every press inside the
  // note landed on one. The consequence was not a near miss but a whole gesture becoming
  // unreachable — a curve could never be RE-TRACED, because the drag that should have
  // replaced it was always read as nudging a point instead. Zoom in and the radius grows
  // back to 16, which is what zoom is for.
  function hitAnchor(i, x, y) {
    const c = noteOf(i).curve; if (!c) return -1;
    const [t0, t1] = spanOf(i), geo = geometry();
    // GENEROUS, and it grows with the note rather than shrinking with it. Shrinking it
    // to fit a 24px note made points almost impossible to hit by eye — the dot is 4px
    // across and a hand is not that precise. There is no ambiguity left to protect
    // against: shift-drag says "re-trace", so a plain drag can simply take the nearest
    // point however far away it is.
    const noteH = Math.abs(geo.Y(t1) - geo.Y(t0));
    const rad = Math.max(HIT_PX, noteH / 3);
    let best = -1, bd = rad * rad;
    for (let k = 0; k < c.length; k++) {
      const cx = geo.X(c[k][1]), cy = geo.Y(t0 + (t1 - t0) * c[k][0]);
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  }
  const onCurveLine = (i, x, y) => {
    const c = noteOf(i).curve; if (!c) return false;
    return Math.abs(geometry().X(sample(c, uAt(i, y))) - x) <= LINE_PX;
  };

  // The nearest anchor of ANY note, with the note it belongs to. Searching across notes
  // rather than within one is the point: a curve's points are out in open grid, and which
  // note owns the one you are reaching for is not something a user should have to aim at.
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
  };

  const onMove = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    const far = Math.abs(x - g.downX) > MOVE_EPS || Math.abs(y - g.downY) > MOVE_EPS;
    if (g.mode === 'anchor') {
      if (!far) return;
      if (!g.moved) { emit({ kind: 'gamaka', phase: 'begin' }); g.moved = true; }
      noteOf(g.i).curve = moveAnchor(noteOf(g.i).curve, g.dragIdx, uAt(g.i, y), stepAt(x));
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
      redraw();
    }
  };

  const onUp = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    const done = g; g = null;
    const moved = Math.abs(x - done.downX) > MOVE_EPS || Math.abs(y - done.downY) > MOVE_EPS;

    if (done.mode === 'free') {
      noteOf(done.i).curve = pointsToAnchors(done.buffer);
      redraw(); emit({ kind: 'gamaka', phase: 'commit' }); return;
    }
    if (done.mode === 'anchor') {
      if (done.moved) { emit({ kind: 'gamaka', phase: 'commit' }); return; }
      emit({ kind: 'gamaka', phase: 'begin' });
      noteOf(done.i).curve = removeAnchor(noteOf(done.i).curve, done.dragIdx);
      redraw(); emit({ kind: 'gamaka', phase: 'commit' }); return;
    }
    if (!moved && noteOf(done.i).curve && onCurveLine(done.i, x, y)) {
      emit({ kind: 'gamaka', phase: 'begin' });
      noteOf(done.i).curve = addAnchor(noteOf(done.i).curve, uAt(done.i, y), stepAt(x));
      redraw(); emit({ kind: 'gamaka', phase: 'commit' });
    }
  };

  const onCancel = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    // Put back exactly what was there: a half-traced stroke is not a curve anyone asked
    // for, and there is no commit to undo it with.
    noteOf(g.i).curve = g.origCurve; g = null; redraw();
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
