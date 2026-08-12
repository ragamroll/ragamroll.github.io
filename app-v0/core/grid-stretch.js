// Widening the grid by hand: what a press on one of the three tabs means.
//
// The fifth gesture module, and the same bargain as the rest — this decides what a press
// MEANS, the host decides what it costs. It changes no note and no notation: the grid a
// reader has stretched to is a VIEW, which is why nothing here is ever written to a file
// or a share link.
//
//   pmin / pmax   drag sideways. The pitch edge follows your finger and snaps to the
//                 raga's own rows, so a stretched grid is still a grid you can write on.
//   + time        a CLICK, not a drag: one more avartana of empty time each press. Also
//                 draggable, for taking a long stretch in one go.
//
// The pitch drags use a FROZEN px-per-step, taken when the tab is grabbed. The obvious
// way — measure against the live edges — feeds the grid's own rescaling back into the
// number driving it, and the edge crawls away from the finger holding it.
import { gridHandles, hitGridHandle } from './roll-geometry.js';

export function createGridStretch(canvas, opts) {
  const {
    geometry,              // () -> the roll's geometry
    size,                  // () -> { w, h }   the canvas viewport
    bounds,                // () -> { stepMin, stepMax, total }
    snapStep,              // (step) -> step   nearest row of the raga
    snapTime,              // (t) -> t         nearest akshara
    beat = () => 1,        // () -> one akshara in length-units
    measure = () => 0,     // () -> one avartana in length-units (0 = no tala)
    enabled = () => true,
    redraw,
    emit,                  // (intent) -> void
    onGrabStart = () => {},
    idleTouchAction = 'pan-y',
  } = opts;

  let g = null;   // { which, pid, startX, startMin, startMax, pxPerStep, moved }

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const tabs = () => gridHandles(geometry(), size(), bounds());

  /** Which handle is under (x, y), or null. Public so a host can set the cursor. */
  const hit = (x, y) => (enabled() ? hitGridHandle(tabs(), x, y) : null);

  const onDown = (e) => {
    if (!enabled() || g) return;
    const { x, y } = at(e);
    const which = hit(x, y); if (!which) return;
    // Claimed before anything else reads it: a tab sits ON the grid, and to the note
    // layer underneath this looks like a press on empty space.
    e.stopPropagation();
    onGrabStart();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* the gesture still works */ }
    canvas.style.touchAction = 'none';
    const b = bounds(), p = geometry().plot;
    g = { which, pid: e.pointerId, startX: x, startY: y, moved: false,
      startMin: b.stepMin, startMax: b.stepMax,
      pxPerStep: p.w / Math.max(1, b.stepMax - b.stepMin) };
    redraw();
  };

  const onMove = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    if (Math.abs(x - g.startX) > 3 || Math.abs(y - g.startY) > 3) g.moved = true;
    if (g.which === 'bottom') {
      if (!g.moved) return;
      // Never shorter than one akshara, and the host is told the pointer's y as well so
      // it can keep the new bottom edge under the finger that is pulling it.
      const floor = Math.max(1, beat());
      emit({ kind: 'grid', which: 'bottom', bottom: Math.max(snapTime(geometry().tAtY(y)), floor), y });
      return;
    }
    const dSteps = (x - g.startX) / g.pxPerStep;
    const base = g.which === 'pmin' ? g.startMin : g.startMax;
    emit({ kind: 'grid', which: g.which, step: snapStep(Math.round(base + dSteps)) });
  };

  const end = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const done = g; g = null;
    canvas.style.touchAction = idleTouchAction;
    // A tap on "+ time" adds one avartana. This is the ordinary way to use it — the drag
    // is for when one is not enough — so it must survive the tap being a few pixels
    // sloppy, which is what `moved` is measuring.
    if (done.which === 'bottom' && !done.moved) {
      const inc = measure() > 0 ? measure() : 8;
      emit({ kind: 'grid', which: 'extend', by: inc });
    }
    redraw();
  };

  const onCancel = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    g = null; canvas.style.touchAction = idleTouchAction; redraw();
  };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  canvas.addEventListener('pointerup', end, true);
  canvas.addEventListener('pointercancel', onCancel, true);

  return {
    hit,
    /** True while a tab is held — the host should not fight it. */
    busy: () => !!g,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', onCancel, true);
    },
  };
}
