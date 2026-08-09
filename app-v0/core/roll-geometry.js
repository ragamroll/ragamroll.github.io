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
