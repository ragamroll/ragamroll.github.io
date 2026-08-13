// Shaping ONE note's gamaka by hand: what the pointer means inside the curve editor.
//
// The third of the gesture modules, and the same bargain as core/roll-edit.js: this
// decides what a press MEANS, the host decides what it costs. It never reads the host's
// state and never touches the DOM beyond the canvas it was handed.
//
// Four gestures, told apart by whether the pointer moved and what it went down on:
//
//   drag an anchor    move that point in time and pitch
//   drag elsewhere    freehand — the old curve is discarded and a new one traced
//   tap an anchor     remove it
//   tap the curve     add one there
//
// A curve here is ABSOLUTE 53-EDO steps against `u` in 0..1, which is what the note
// carries and what the renderer draws. Note-relative deltas are a serialisation detail
// and belong to whoever writes the notation.
import { extractAnchors, addAnchor, removeAnchor, moveAnchor, tapAnchor } from './gamaka-curve.js';

const MOVE_EPS = 6;        // px before a press counts as a drag rather than a tap
const HIT_PX = 18;         // anchor grab radius

export function createCurveEdit(canvas, opts) {
  const {
    geometry,              // () -> the roll's geometry (X, Y, stepAtX, tAtY, plot, yRange)
    curve,                 // () -> [[u, step]...] | null   the note being shaped
    setCurve,              // (c|null) -> void              apply a preview to the host
    snapping = () => false,// () -> bool   on: the 53-EDO grid; off: wherever you put it
    enabled = () => true,
    redraw,
    emit,                  // (intent) -> void
    onPitch = () => {},    // (step|null) -> void  live audio + a readout; null = stopped
    onGrabStart = () => {},
  } = opts;

  let g = null;            // { downX, downY, hi, origCurve, mode:'pending'|'drag'|'free' }
  let dragIdx = -1;
  let drawing = false;     // freehand in progress: the host draws no handles meanwhile

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const span = () => geometry().yRange;

  // Where a point lands: the nearest 53-EDO step, or exactly where you put it when snap
  // is off — to two decimals, the precision the notation carries. One rule for both
  // editors, so a curve shaped in one is a curve the other can shape back.
  const place = (step) => (snapping() ? Math.round(step) : Math.round(step * 100) / 100);

  // Which anchor is under the pointer, or -1. NEAREST, not the first within reach: two
  // anchors close together would otherwise let only one of them ever be grabbed.
  function hitHandle(x, y) {
    const c = curve(); if (!c) return -1;
    const geo = geometry(), [t0, t1] = span();
    let best = -1, bd = HIT_PX * HIT_PX;
    for (let k = 0; k < c.length; k++) {
      const cx = geo.X(c[k][1]), cy = geo.Y(t0 + (t1 - t0) * c[k][0]);
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d <= bd) { bd = d; best = k; }
    }
    return best;
  }

  // The anchors in screen pixels, for the tap test. Here a note fills the pane and its
  // points are far apart, so tapAnchor's answer is the same one HIT_PX gave — which is
  // the point: the roll runs the identical rule at a scale where it is not.
  function anchorPx() {
    const c = curve(); if (!c) return [];
    const geo = geometry(), [t0, t1] = span();
    return c.map(([u, st]) => [geo.X(st), geo.Y(t0 + (t1 - t0) * u)]);
  }

  // Is (x,y) on the drawn curve itself? That is where a tap ADDS an anchor, so it is
  // measured against the line the reader can see rather than against the anchors.
  function onCurveLine(x, y, sample) {
    const c = curve(); if (!c) return false;
    const [t0, t1] = span(), geo = geometry();
    const u = Math.max(0, Math.min(1, (geo.tAtY(y) - t0) / Math.max(1e-6, t1 - t0)));
    return Math.abs(geo.X(sample(c, u)) - x) <= 14;
  }

  // Freehand: append, or move the last point when the pointer comes back up the note.
  // A stroke is a single pass down the note, so u never goes backwards.
  function addPoint(x, y) {
    const geo = geometry(), p = geo.plot, [ba, bb] = span();
    const u = Math.max(0, Math.min(1, (geo.tAtY(y) - ba) / (bb - ba)));
    const st = geo.stepAtX(Math.max(p.x, Math.min(p.x + p.w, x)));
    const c = curve();
    if (c.length && u <= c[c.length - 1][0]) c[c.length - 1][1] = st;
    else c.push([u, st]);
    onPitch(st);
  }

  // A freehand stroke is hundreds of samples; the note keeps ANCHORS. Reduced here, and
  // pinned to both ends, because a curve that starts at u=0.03 leaves the note's first
  // moments with no pitch at all.
  function finalize() {
    let c = curve();
    if (!c || c.length < 2) { setCurve(null); return; }
    c = extractAnchors(c);
    c = c.map((pt) => [pt[0], place(pt[1])]);
    if (c[0][0] > 0.001) c = [[0, c[0][1]], ...c];
    if (c[c.length - 1][0] < 0.999) c = [...c, [1, c[c.length - 1][1]]];
    setCurve(c);
  }

  // Where a dragged anchor lands, decided by moveAnchor rather than here — including that
  // an endpoint keeps its u. A curve spans its note; an endpoint dragged inward left the
  // note's opening with no pitch written for it, and what read that gap was a cubic
  // extrapolating backwards into frequencies that are not sound. The array is mutated in
  // place because it IS the note's live curve, which the renderer is already drawing.
  function dragTo(x, y) {
    const c = curve(), geo = geometry(), p = geo.plot, [ba, bb] = span();
    const u = (geo.tAtY(y) - ba) / (bb - ba);
    const st = geo.stepAtX(Math.max(p.x, Math.min(p.x + p.w, x)));
    const moved = moveAnchor(c, dragIdx, u, st);
    c[dragIdx][0] = moved[dragIdx][0]; c[dragIdx][1] = moved[dragIdx][1];
    onPitch(st);
  }

  const onDown = (e) => {
    if (!enabled()) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* the gesture still works */ }
    onGrabStart();
    const { x, y } = at(e);
    const c = curve();
    g = { downX: x, downY: y, hi: c ? hitHandle(x, y) : -1, origCurve: c ? c.map((pt) => pt.slice()) : null, mode: 'pending' };
  };

  const onMove = (e) => {
    if (!enabled() || !g) return;
    const { x, y } = at(e);
    if (g.mode === 'pending' && (Math.abs(x - g.downX) > MOVE_EPS || Math.abs(y - g.downY) > MOVE_EPS)) {
      // The press has become a drag. Which kind was decided when it went down, by what
      // was under it — so a stroke that starts on an anchor never turns into freehand
      // halfway through.
      emit({ kind: 'curve', phase: 'begin' });
      if (g.hi >= 0) { g.mode = 'drag'; dragIdx = g.hi; onPitch(curve()[g.hi][1]); }
      else { g.mode = 'free'; drawing = true; setCurve([]); onPitch(null, true); addPoint(x, y); redraw(); return; }
    }
    if (g.mode === 'drag') { dragTo(x, y); redraw(); return; }
    if (g.mode === 'free') { addPoint(x, y); redraw(); }
  };

  const onUp = (e) => {
    if (!enabled() || !g) return;
    const { x, y } = at(e);
    const done = g; g = null;

    if (done.mode === 'drag') {
      // Snap on release, not during: snapping mid-drag makes the anchor jump under the
      // pointer instead of following it.
      { const c = curve(); c[dragIdx][1] = place(c[dragIdx][1]); }
      dragIdx = -1; onPitch(null);
      redraw(); emit({ kind: 'curve', phase: 'commit' }); return;
    }
    if (done.mode === 'free') {
      drawing = false; onPitch(null); finalize();
      redraw(); emit({ kind: 'curve', phase: 'commit' }); return;
    }
    // A tap. On an anchor it goes; on the line a new one arrives; anywhere else nothing.
    // Judged by tapAnchor rather than by the grab radius that caught the press, so the
    // roll's ✎ mode can answer the same way with its points a few pixels apart.
    const hit = tapAnchor(anchorPx(), x, y);
    if (hit >= 0) {
      emit({ kind: 'curve', phase: 'begin' });
      setCurve(removeAnchor(curve(), hit));
      onPitch(null); redraw(); emit({ kind: 'curve', phase: 'commit' }); return;
    }
    const c = curve();
    if (c && opts.sample && onCurveLine(x, y, opts.sample)) {
      emit({ kind: 'curve', phase: 'begin' });
      const geo = geometry(), [t0, t1] = span();
      const u = Math.max(0, Math.min(1, (geo.tAtY(y) - t0) / Math.max(1e-6, t1 - t0)));
      setCurve(addAnchor(c, u, place(geo.stepAtX(x))));
      redraw(); emit({ kind: 'curve', phase: 'commit' }); return;
    }
    onPitch(null);
  };

  const onCancel = () => {
    if (!g) return;
    // Put back exactly what was there. A half-drawn freehand stroke is not a curve
    // anybody asked for, and there is no commit to undo it with.
    if (g.mode !== 'pending') setCurve(g.origCurve);
    g = null; drawing = false; dragIdx = -1; onPitch(null); redraw();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  return {
    /** True while a freehand stroke is being traced — the host draws no handles then. */
    drawing: () => drawing,
    /** The anchor being dragged, for the host to highlight. -1 when none. */
    draggedIndex: () => dragIdx,
    destroy() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
    },
  };
}
