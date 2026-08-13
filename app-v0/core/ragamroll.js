// A RagaM-Roll you can put on a page.
//
// This is the component: a piano roll adapted to 22-shruti raga music with gamakas.
// It owns the canvas — its size, its device-pixel scaling, the scroll window that
// keeps a long piece off a canvas too tall to allocate — and it owns the derived
// grid: how much pitch and time to show, and which pitch lines get names.
//
// It does NOT own the clock. The playhead is set from outside, because only the app
// around it knows what time it is: draw counts length-units at a tempo, pitchy
// follows a recording's own seconds. A component that advanced its own playhead
// would have to model all three, and would be wrong for at least two.
//
// It does not own audio, and it does not edit. An editor supplies `hooks` to paint
// its own chrome (see roll-render.js) and reads `geometry()` to hit-test against the
// exact coordinates that were drawn.
import { buildRollModel, gridBounds, gridPitches, isBlackKey } from './roll-model.js';
import { BOXES } from './shruti.js';
import { rollGeometry } from './roll-geometry.js';
import { renderRoll } from './roll-render.js';
import { sampleCurve } from './gamaka-inline.js';

const PAD_T_MIN = 24, LABEL_CHIP_H = 14;
// Time is scaled so the SHORTEST note is at least this tall — below it there is no
// room to print the swara inside the box, mobile portrait included.
const CELL_PX = 24;
const EMPTY = { notes: [], starts: [], rests: [], contentEnd: 0, saRef: 60, raga: '', tempo: 120,
  tala: { measure: 0, accents: [], beat: 0 }, talaProps: null };

export function createRagamRoll(el, opts = {}) {
  const { holder, content, canvas } = el;
  const ctx = canvas.getContext('2d');
  const palette = opts.palette || (() => ({}));
  const hooks = opts.hooks || {};
  const rollTouchAction = opts.touchAction || 'pan-y';

  let model = EMPTY;
  let user = { min: null, max: null, bottom: null };
  let view = { mode: 'roll', sel: -1, selRest: -1, drawSpan: 22, zoom: 1, playPos: null,
    markerA: 0, markerB: 0, saMidi: null, grabIdx: -1, labels: true };
  let bounds = { total: 1, stepMin: -26, stepMax: 66, gridPitches: [] };
  const pad = { l: 40, r: 12, t: PAD_T_MIN, b: 12 };
  let w = 0, h = 0;

  // The header has to be as deep as the longest pitch name is LONG, because the names
  // stand upright along their own grid lines. Horizontal, they were as wide as their
  // text and collided on a narrow screen; upright trades that width for header depth.
  const labelDepth = (gp) => {
    if (!gp || !gp.length) return PAD_T_MIN;
    ctx.save(); ctx.font = 'bold 10px ' + (palette().mono || 'monospace');
    let x = 0; for (const g of gp) x = Math.max(x, ctx.measureText(g.label).width);
    ctx.restore();
    return Math.max(PAD_T_MIN, Math.round(x + 8) + 12);
  };

  // A pitch VIEW, as against the grid's bounds.
  //
  // user bounds only ever widen — gridBounds mins the reader's low with the lowest note
  // and maxes the high with the highest, so no note can be cut off the paper. That is
  // right for the stretch tabs, which are about how much empty grid to write into, and
  // wrong for zooming: magnifying a fifth to place a gamaka by eye MEANS the notes above
  // and below leave the screen. So a view range overrides the bounds outright, and is
  // safe because panning can always reach what it pushed off.
  let pitchView = null;   // { min, max } | null — null = the grid's own bounds
  // The grid's OWN extent, before any view is laid over it. bounds() reports the view when
  // there is one — which is right for drawing and wrong for every question about the paper
  // itself: how far a pan may travel, and what a host is pinning when it pins the grid.
  let extent = { stepMin: -26, stepMax: 66, total: 1 };

  function recompute() {
    const b = gridBounds(model, user);
    extent = { stepMin: b.stepMin, stepMax: b.stepMax, total: b.total };
    const lo = pitchView ? pitchView.min : b.stepMin;
    const hi = pitchView ? pitchView.max : b.stepMax;
    bounds = { ...b, stepMin: lo, stepMax: hi, gridPitches: gridPitches(model.notes, lo, hi, model.raga) };
    pad.t = labelDepth(bounds.gridPitches);
  }

  // How tall a length-unit is drawn: one CELL_PX per note of TYPICAL length.
  //
  // This divided by the SHORTEST note, so that note was always readable. But a minimum
  // is an extreme, and one short note dragged the whole piece with it — shrink a note
  // from 32 units to 1 while moving a seam and the scale went 0.75px to 24px per unit,
  // a 32-fold inflation arriving continuously under the pointer. Nothing about the
  // music changed; the reader simply lost their place.
  //
  // The median is the same number whenever notes share a length, which is every written
  // piece, so nothing looks different there. It does not move when one note is edited:
  // a seam drag trades time between two of them and leaves the middle of the
  // distribution alone. A note far shorter than its neighbours now draws short, which
  // is what it is — and the zoom control is there for reading it.
  const medianDur = () => {
    const d = model.notes.map((n) => n.dur).sort((a, b) => a - b);
    const m = d.length >> 1;
    return d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
  };
  const pxPerUnit = () => (model.notes.length
    ? CELL_PX / Math.max(0.25, medianDur())
    : CELL_PX);
  const pxU = () => pxPerUnit() * view.zoom;
  const scrollTop = () => (view.mode === 'roll' ? holder.scrollTop : 0);
  const virtH = () => Math.round(pad.t + bounds.total * pxU() + pad.b);
  const yVirt = (t) => pad.t + t * pxU();
  const saMidi = () => (view.saMidi == null ? model.saRef : view.saMidi);

  // The 22 shrutis as single-octave positions, for the grid's middle weight.
  const SHRUTI_MODS = [...new Set(BOXES.map((b) => b.step))].sort((a, b) => a - b);

  const asModel = () => ({ notes: model.notes, starts: model.starts, rests: model.rests || [], total: bounds.total,
    shrutiMods: SHRUTI_MODS,
    gridPitches: bounds.gridPitches, stepMin: bounds.stepMin, stepMax: bounds.stepMax,
    tala: model.tala, isBlack: (s) => isBlackKey(s, saMidi()) });

  const asView = () => {
    const draw = view.mode === 'draw' && model.notes[view.sel];
    return { w, h, pad, mode: view.mode, pxPerUnit: pxU(), scrollTop: scrollTop(),
      selStep: draw ? model.notes[view.sel].step : 0, drawSpan: view.drawSpan,
      tStart: draw ? model.starts[view.sel] : 0,
      tEnd: draw ? model.starts[view.sel] + model.notes[view.sel].dur : bounds.total,
      palette: palette(), sel: view.sel, selRest: view.selRest, grabIdx: view.grabIdx, playPos: view.playPos,
      markerA: view.markerA, markerB: view.markerB, labels: view.labels,
      // The gesture layers' in-flight state, which the renderer draws: a paint being
      // dragged, the margin armed to take one, a freehand stroke in progress, and the
      // A–B tabs. This object is a WHITELIST — anything not named here is dropped on the
      // way to the renderer, silently, and the feature simply never appears. Four of
      // these were passed in by both apps and never arrived.
      paint: view.paint, paintMode: view.paintMode, drawing: view.drawing, abTabs: view.abTabs,
      gamakaMode: view.gamakaMode, handles: view.handles, abChip: view.abChip,
      chipH: LABEL_CHIP_H, sample: sampleCurve };
  };

  const api = {
    ctx, canvas, pad,

    // ---- what to draw ----
    // Takes PARSED notation, so every page reads a piece the same way rather than
    // each deriving its own idea of where the notes sit.
    setNotation(parsed) { model = buildRollModel(parsed); recompute(); return api; },
    setModel(m) { model = m || EMPTY; recompute(); return api; },
    // Bounds a reader has stretched to by hand. These only ever widen.
    setUser(u) { user = { ...user, ...u }; recompute(); return api; },
    /**
     * The pitch window to draw, overriding the grid's own bounds — for zooming and
     * panning the pitch axis, which the grid's bounds deliberately refuse to do. null
     * hands the axis back to them. Never widened silently: what is asked for is drawn.
     */
    setPitchView(v) {
      pitchView = v && v.max > v.min ? { min: Math.round(v.min), max: Math.round(v.max) } : null;
      recompute(); return api;
    },
    pitchView: () => (pitchView ? { ...pitchView } : null),
    setView(v) {
      const reBound = v.zoom != null && v.zoom !== view.zoom;
      view = { ...view, ...v };
      if (reBound) pad.t = labelDepth(bounds.gridPitches);
      return api;
    },
    // The playhead is pushed in; the component never advances it.
    setPlayhead(t) { view.playPos = t; return api; },

    // ---- what it worked out ----
    model: () => model,
    bounds: () => bounds,
    // The frame this piece would be drawn in with nothing stretched by hand — which for a
    // piece with no notes is the blank canvas gridBounds hands out. A host that wants to
    // KEEP that canvas has to ask for it separately: bounds() already carries whatever the
    // host pinned last, so reading the pin back through it can only ever confirm itself.
    autoBounds: () => gridBounds(model),
    /** The grid as it would be drawn with no pitch view over it. */
    extent: () => ({ ...extent }),
    /** The bounds a reader has stretched to by hand — never the view. */
    userBounds: () => ({ ...user }),
    // Read-only, for hosts and guards: what the renderer is actually being told to
    // draw. A selection pushed in through setView is only real if it arrives here.
    view: () => ({ ...view }),
    geometry: () => rollGeometry({ ...asView(), stepMin: bounds.stepMin, stepMax: bounds.stepMax, total: bounds.total }),
    pxPerUnit: pxU,
    virtH, yVirt,
    size: () => ({ w, h }),

    // ---- the canvas ----
    resize() {
      const baseH = Math.max(150, holder.clientHeight);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = holder.clientWidth; h = baseH;   // always viewport-sized: a long piece scrolls, so the canvas never overflows the browser's limit
      if (view.mode === 'roll') content.style.height = virtH() + 'px';   // a tall empty div is what gives the scrollbar its range
      else { content.style.height = baseH + 'px'; holder.scrollTop = 0; }   // one note fills the viewport; nothing to scroll
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      canvas.style.touchAction = view.mode === 'draw' ? 'none' : rollTouchAction;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      api.render();
      return api;
    },
    render() { renderRoll(ctx, asModel(), asView(), hooks); return api; },
  };
  return api;
}
