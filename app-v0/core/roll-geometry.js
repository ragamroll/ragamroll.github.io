// Where things sit on a RagaM-Roll: the maps between (pitch, time) and (x, y).
//
// Pure, and shared by whoever draws the roll and whoever hit-tests it. Those two have
// to agree exactly — a note the reader can see at one place and grab at another is
// the failure this prevents by construction, and keeping the maps in the drawing
// module made it a matter of discipline instead.
//
// Two layouts, both here because they answer the same question:
//   roll — the whole piece. Pitch spans [stepMin, stepMax] across the plot; time maps
//          to a VIRTUAL space taller than the canvas (pad.t + t*pxPerUnit) and only
//          the slice under `scrollTop` is drawn, so a long piece needs no giant canvas.
//   draw — one note filling the viewport, pitch centred on it ± span.

export function rollGeometry(v) {
  const { pad, w, h, mode = 'roll' } = v;
  const plot = { x: pad.l, y: pad.t, w: w - pad.l - pad.r, h: h - pad.t - pad.b };

  const xRange = mode === 'draw'
    ? [v.selStep - v.drawSpan, v.selStep + v.drawSpan]
    : [v.stepMin, v.stepMax];
  const yRange = mode === 'draw' ? [v.tStart, v.tEnd] : [0, v.total];

  const [xa, xb] = xRange;
  const X = (s) => plot.x + ((s - xa) / (xb - xa)) * plot.w;
  const stepAtX = (px) => xa + ((px - plot.x) / plot.w) * (xb - xa);

  const [ya, yb] = yRange;
  const Y = mode === 'draw'
    ? (t) => plot.y + ((t - ya) / (yb - ya)) * plot.h
    : (t) => pad.t + t * v.pxPerUnit - v.scrollTop;
  const tAtY = mode === 'draw'
    ? (py) => ya + ((py - plot.y) / plot.h) * (yb - ya)
    : (py) => (py + v.scrollTop - pad.t) / v.pxPerUnit;

  // Content coordinates, before the scroll offset: what the scrollable div is sized to.
  const yVirt = (t) => pad.t + t * v.pxPerUnit;
  const virtH = () => Math.round(pad.t + v.total * v.pxPerUnit + pad.b);

  // The slice of time actually on screen. Drawing everything else is wasted work on a
  // long piece, and the one-note layout has no slice — it IS the note.
  const visibleTime = mode === 'draw'
    ? [ya - 1e-6, yb + 1e-6]
    : [(v.scrollTop - pad.t) / v.pxPerUnit - 1, (v.scrollTop + h - pad.t) / v.pxPerUnit + 1];

  return { plot, xRange, yRange, X, stepAtX, Y, tAtY, yVirt, virtH, visibleTime };
}

// ---- the three grid stretch-handles -------------------------------------------------
//
// Where the tabs that WIDEN the grid sit. One function, because the gamaka page had two
// copies of this arithmetic — one to draw them, one to hit-test them — with a comment
// on each saying it must match the other exactly. A tab you can see at one place and
// grab at another is the same failure this module exists to prevent for notes.
//
//   pmin / pmax   at the two pitch edges, mid-height, dragged sideways
//   bottom        "+ time", pinned to the bottom of the VIEWPORT rather than to the end
//                 of the piece, so it is reachable without scrolling to find it
export const GRIP_THICK = 14, GRIP_LEN = 47;   // 47 = the 18px touch unit × 2.6, rounded

export function gridHandles(geo, size, bounds) {
  const p = geo.plot, yMid = p.y + p.h / 2;
  return {
    // Nudged clear of the plot edge so it does not sit on the A–B gutter's border.
    pmin: { x: Math.max(p.x + GRIP_THICK / 2 + 3, geo.X(bounds.stepMin)), y: yMid, w: GRIP_THICK, h: GRIP_LEN, axis: 'h' },
    pmax: { x: geo.X(bounds.stepMax), y: yMid, w: GRIP_THICK, h: GRIP_LEN, axis: 'h' },
    bottom: { x: p.x + p.w / 2, y: size.h - GRIP_THICK / 2 - 6, w: GRIP_LEN, h: GRIP_THICK, axis: 'v' },
  };
}

// Which handle is under (x, y), or null. A generous radius, and the same boxes the
// renderer drew — the touch slop is the only thing this adds.
export function hitGridHandle(handles, x, y, slop = 18) {
  for (const which of ['pmin', 'pmax', 'bottom']) {
    const t = handles[which];
    const halfW = t.w / 2 + (t.axis === 'h' ? slop : slop * 0.4);
    const halfH = t.h / 2 + (t.axis === 'h' ? slop * 0.4 : slop);
    if (Math.abs(x - t.x) <= halfW && Math.abs(y - t.y) <= halfH) return which;
  }
  return null;
}
