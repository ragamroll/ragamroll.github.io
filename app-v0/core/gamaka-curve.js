// Pure operations on a gamaka curve: an array of [u, step] anchors — u in [0,1]
// ascending, endpoints normally pinned at u=0 and u=1, step = absolute 53-EDO
// pitch. Shared by the full-screen editor and in-roll gamaka drawing so both
// produce identical curves. No DOM, no snap (callers apply snapStep).

// Reduce a raw freehand point list to direction-change anchors. Verbatim from
// draw.js's original extractAnchors (moved here so both editors share one copy).
export function extractAnchors(raw) {
  if (raw.length <= 2) return raw.slice();
  const A = [raw[0]]; let dir = 0;
  for (let i = 1; i < raw.length; i++) {
    const d = raw[i][1] - raw[i - 1][1]; const sd = d > 0.3 ? 1 : (d < -0.3 ? -1 : 0);
    if (sd !== 0) { if (dir !== 0 && sd !== dir && Math.abs(raw[i - 1][1] - A[A.length - 1][1]) >= 2) A.push(raw[i - 1]); dir = sd; }
  }
  A.push(raw[raw.length - 1]); return A;
}

// Freehand finalize: raw points -> anchors with endpoints pinned at u=0/1.
// null if fewer than 2 points (curve cleared).
export function pointsToAnchors(raw) {
  if (!raw || raw.length < 2) return null;
  const sorted = raw.map(p => p.slice()).sort((a, b) => a[0] - b[0]);
  let c = extractAnchors(sorted);
  if (c[0][0] > 0.001) c = [[0, c[0][1]], ...c];
  if (c[c.length - 1][0] < 0.999) c = [...c, [1, c[c.length - 1][1]]];
  return c;
}

// Which anchor a TAP is on, or -1 — as against which anchor a DRAG grabs.
//
// A grab may be generous: a drag on a curve means one thing, so the nearest point however
// far away is the right answer. A tap means two things — remove this point, or add one
// where the line is — and the only honest way to tell them apart is distance measured
// against the SPACING of the points themselves. Half-way between two anchors is where
// "between the points" begins, whatever the zoom.
//
// One fixed radius cannot serve both editors. In the full-screen editor a note fills the
// pane and its anchors sit tens of pixels apart, so 16px means "on the dot". On the roll
// the same curve is 24px tall with its anchors 6px apart, so 16px reached clean across the
// note: every tap between two points removed one instead of adding one, which is exactly
// what it looked like.
//
// `pts` are anchor positions in screen pixels, in curve order.
const DOT_PX = 4;   // the anchor as drawn: two points nearer than this are one dot
export function tapAnchor(pts, x, y, maxPx = 14) {
  let best = -1, bd = Infinity;
  for (let k = 0; k < pts.length; k++) {
    let gap = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (j === k) continue;
      gap = Math.min(gap, Math.hypot(pts[j][0] - pts[k][0], pts[j][1] - pts[k][1]));
    }
    // 0.4 of the gap, not half: the midpoint has to fall OUTSIDE both radii, not on the
    // edge of them. No floor — a floor is a fixed radius wearing a hat, and at the roll's
    // spacing it swallows the gap all over again. Points closer together than the dot they
    // are drawn as have no "between" to protect, so those keep the full radius.
    const r = (gap === Infinity || gap < DOT_PX) ? maxPx : Math.min(maxPx, gap * 0.4);
    const d = Math.hypot(x - pts[k][0], y - pts[k][1]);
    if (d <= r && d < bd) { bd = d; best = k; }
  }
  return best;
}

// Insert an anchor at (u,step), keeping u ascending; u clamped to [0,1].
export function addAnchor(curve, u, step) {
  const c = curve.map(p => p.slice());
  u = Math.max(0, Math.min(1, u));
  let k = c.findIndex(p => p[0] > u); if (k < 0) k = c.length;
  c.splice(k, 0, [u, step]);
  return c;
}

// Remove anchor idx. Fewer than 2 remain -> null (curve cleared). Otherwise
// re-pin the new first/last to u=0/1 so the curve still spans the note.
export function removeAnchor(curve, idx) {
  const c = curve.map(p => p.slice());
  c.splice(idx, 1);
  if (c.length < 2) return null;
  c[0][0] = 0; c[c.length - 1][0] = 1;
  return c;
}

// Move anchor idx to (u,step), u clamped between neighbours.
//
// The ENDPOINTS keep their u. A curve spans its note — removeAnchor re-pins the new first
// and last for exactly that reason — and an endpoint dragged inward left the note's first
// moments with no pitch written for them. Nothing renders that as a gap: sampleCurve was
// asked for the pitch before the curve began and extrapolated its cubic backwards, which
// at u=0 against a first anchor at 0.112 came out fourteen thousand steps above Sa and
// took the audio layer down with an infinite frequency. An endpoint still moves in PITCH,
// which is what dragging one is for; it simply cannot leave the end.
export function moveAnchor(curve, idx, u, step) {
  const c = curve.map(p => p.slice());
  const first = idx === 0, last = idx === c.length - 1;
  if (!first && !last) {
    const lo = c[idx - 1][0] + 0.006, hi = c[idx + 1][0] - 0.006;
    c[idx][0] = Math.max(lo, Math.min(hi, u));
  } else {
    c[idx][0] = first ? 0 : 1;
  }
  c[idx][1] = step;
  return c;
}
