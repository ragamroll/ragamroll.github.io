// Panning the roll's PITCH axis with one finger.
//
// The seventh gesture module, and the smallest. Time already pans: the roll scrolls, and
// the canvas carries `touch-action: pan-y` so the browser does it with its own momentum.
// Pitch had no equivalent — the axis could be widened by the stretch tabs and never
// travelled along — which was fine while the whole piece was always on screen and is not
// once the pitch axis can be zoomed into.
//
// So: a touch drag that goes SIDEWAYS pans pitch, and the browser keeps the drags that go
// up and down. Which one a drag is gets decided once, by whichever way it left the slop
// radius, so a drag that wanders diagonally does not fight the scroller for the gesture.
//
// It stands off wherever a sideways drag already means something: the A–B margin, a mode
// that is armed to paint or to shape a gamaka, and any grab that has taken the pointer.
const SLOP_PX = 8;

export function createRollPan(canvas, opts) {
  const {
    geometry,              // () -> the roll's geometry
    bounds,                // () -> { stepMin, stepMax }   what is DRAWN — the view, if any
    extent,                // () -> { stepMin, stepMax }   the paper itself, view or no view
    setPitchView,          // ({min, max}) -> void
    enabled = () => true,
    // A mouse pans only where a mouse has nothing else to mean: zoomed in, and not on a
    // note. Desktop has no other way along this axis — the roll fits the pitch axis to the
    // canvas, so there is no scrollbar to reach for, and zooming in without a pan strands
    // a reader in the middle of their own piece.
    mousePan = () => false,
    hitNote = () => -1,
    redraw,
  } = opts;

  let g = null;   // { pid, x0, y0, min0, max0, live }

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onDown = (e) => {
    if (!enabled() || g) return;
    if (e.pointerType !== 'touch' && !mousePan()) return;
    const { x, y } = at(e);
    if (x < geometry().plot.x) return;            // the margin is A–B's
    if (e.pointerType !== 'touch' && hitNote(x, y) >= 0) return;   // that press is the note's
    const b = bounds();
    g = { pid: e.pointerId, x0: x, y0: y, min0: b.stepMin, max0: b.stepMax, live: false };
  };

  const onMove = (e) => {
    if (!g || e.pointerId !== g.pid) return;
    const { x, y } = at(e);
    const dx = x - g.x0, dy = y - g.y0;
    if (!g.live) {
      if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
      // Decided ONCE, on the way out of the slop radius: a drag that starts downward is
      // the browser's to scroll, and taking it back mid-gesture would stutter.
      if (Math.abs(dy) >= Math.abs(dx)) { g = null; return; }
      g.live = true;
    }
    // Pitch is the x axis, so a finger moving right shows LOWER pitches: the paper moves
    // with the finger, as paper does.
    const span = g.max0 - g.min0;
    const perPx = span / Math.max(1, geometry().plot.w);
    const shift = -dx * perPx;
    // CLAMPED to the paper. Panning off the end of the grid showed acres of staves with
    // nothing on them and no landmark to come back by — and if anything downstream then
    // takes the window for a range worth keeping, that emptiness becomes the piece's own
    // grid. A window wider than the paper simply sits on it.
    const ext = extent ? extent() : null;
    let min = g.min0 + shift, max = g.max0 + shift;
    if (ext && ext.stepMax > ext.stepMin) {
      if (max - min >= ext.stepMax - ext.stepMin) { min = ext.stepMin; max = ext.stepMax; }
      else if (min < ext.stepMin) { min = ext.stepMin; max = min + span; }
      else if (max > ext.stepMax) { max = ext.stepMax; min = max - span; }
    }
    setPitchView({ min, max });
    redraw();
  };

  const end = (e) => { if (g && e.pointerId === g.pid) g = null; };

  canvas.addEventListener('pointerdown', onDown, true);
  canvas.addEventListener('pointermove', onMove, true);
  // On the window, not the canvas: a grab that captures this pointer retargets its later
  // events to the capturing element, and a canvas listener would never hear the release.
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);

  return {
    /** True while a pan is in flight — the host's other gestures should stand off. */
    busy: () => !!(g && g.live),
    destroy() {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    },
  };
}
