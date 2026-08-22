// Editing a RagaM-Roll by hand: what the pointer means.
//
// The gestures — press, drag, release, cancel — and nothing else. This module does
// NOT decide what an edit is worth, whether it can be undone, or how it is saved. It
// emits an INTENT and the host does all of that, because the two apps that mount a
// roll disagree about it: draw re-serialises the whole piece to srgm and re-parses on
// every drop, and an app with a worker and its own undo has no reason to.
//
// Two phases, so a drag can be seen while it happens:
//
//   preview   the gesture is in flight. Apply it, draw it, do NOT record it.
//   commit    the pointer is up and the value changed. Record it.
//   cancel    the gesture died. Put the note back where it was.
//
// A preview is emitted on every move, exactly as draw always mutated its model on
// pointermove — the difference is only that the decision now belongs to the caller.
//
// What it needs from its host is deliberately small: where things are (the roll's own
// geometry, so the note you grab is the note you see), what is there, how to snap, and
// somewhere to send intents. It never reads the host's state and never touches the DOM
// beyond the canvas it was handed.
//
// Not here, on purpose: gamaka strokes, the grid stretch handles and the one-note curve
// editor. Each is the same shape and can follow; keeping them out keeps this reviewable
// against the gestures it replaces.

import { AB_TAB_H } from './roll-render.js';
import { abChipBox, inBox } from './roll-geometry.js';

const HANDLE_PX = 10;          // end-cap grab radius; ×1.4 in use, as draw had it
const LONG_PRESS_MS = 300;     // touch: long-press to grab, so a plain drag still scrolls
const SLOP_PX = 8;             // movement that cancels a pending long-press

export function createRollEdit(canvas, opts) {
  const {
    geometry,                  // () -> the roll's geometry (X, Y, stepAtX, tAtY, plot)
    model,                     // () -> { notes, starts, rests }
    snapStep,                  // (step) -> step   e.g. onto the raga's rows
    snapDur,                   // (dur)  -> dur    e.g. onto the tala akshara
    snapTime = (t) => t,       // (t)    -> t      absolute time, for a shared boundary
    emit,                      // (intent) -> void
    redraw,                    // () -> void       the host owns rendering
    enabled = () => true,      // () -> bool       host decides when editing is live
    // Which gestures this host actually implements. A host that ignores an intent it
    // never asked for still gets the GESTURE — the grab, the handles, the redraw — and
    // a drag that visibly starts and then does nothing reads as broken rather than as
    // unimplemented. So a host declares what it handles and the rest stay inert.
    allow = () => true,        // (kind) -> bool   'move'|'boundary'|'resize'|'open'|'split'|'paint'|'range'
    painting: paintArmed = () => false,   // () -> bool   the host's "+ note" toggle
    marks = () => ({ a: 0, b: 0 }),       // () -> {a,b}  the A–B range, in length-units
    idleTouchAction = 'pan-y',
    // Scroll the roll's own window by dy pixels. Sweeping A–B past the top or bottom of
    // the viewport is the ONLY thing that scrolls during a gesture — the host owns the
    // scroller, so it is asked rather than reached for.
    scrollBy = null,           // (dy) -> void
    // Where the pointer listeners actually go. The canvas by default; a host that puts a
    // no-pan strip over the margin passes their common parent instead, so a press on
    // EITHER arrives here. Coordinates are still measured against the canvas, so nothing
    // downstream can tell the difference.
    surface = canvas,
    onGrabStart = () => {},    // e.g. unlock audio before a drag makes a sound
  } = opts;

  let grab = null;             // { tok, idx, kind:'move'|'resize', oldStep, oldDur, cur, pid }
  let paint = null;            // { ts, step?, rest?, dur, pid } — a note being drawn
  let ab = null;               // { end:'a'|'b'|'sweep', from, pid } — an A–B range being set
  let abChipPress = null;      // the pointer holding the A–B chip, which clears the range
  let restGrab = null;         // { tok, oldDur, dur, pid }
  let pressXY = null, pressTimer = 0;
  let justGrabbed = false;     // a real edit happened: swallow the click that follows

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const own = (pid) => { canvas.style.touchAction = 'none'; try { surface.setPointerCapture(pid); } catch (_) { /* not captured: the gesture still works */ } };
  const release = () => { canvas.style.touchAction = idleTouchAction; };

  // ---- what is under the pointer ----

  function hitNote(x, y) {
    const g = geometry(), m = model();
    const w = Math.max(16, g.plot.w / (m.stepMax - m.stepMin) * 4);
    for (let i = 0; i < m.notes.length; i++) {
      const y0 = g.Y(m.starts[i]), y1 = g.Y(m.starts[i] + m.notes[i].dur), xc = g.X(m.notes[i].step);
      if (y >= y0 && y <= y1 && x >= xc - w / 2 - 6 && x <= xc + w / 2 + 6) return i;
    }
    return -1;
  }

  // A rest spans the width, so anywhere on its band is the target the eye sees.
  function hitRest(x, y) {
    const g = geometry(), m = model();
    if (x < g.plot.x || x > g.plot.x + g.plot.w) return null;
    for (const r of m.rests) if (y >= g.Y(r.t0) && y <= g.Y(r.t0 + r.dur)) return r;
    return null;
  }

  // A rest's far edge. It runs the FULL WIDTH of the plot, unlike a note's handles,
  // which reach only across the note's own box — so the two never really collide. On
  // the row they share, inside the note's column the note owns it; anywhere else along
  // that row the rest still does.
  function restEdgeAt(x, y) {
    const g = geometry(), m = model();
    if (x < g.plot.x || x > g.plot.x + g.plot.w) return null;
    for (const r of m.rests) if (Math.abs(y - g.Y(r.t0 + r.dur)) <= HANDLE_PX * 1.4) return r;
    return null;
  }

  // A note's own edges, which reach only across its box. Prefers the note that STARTS
  // here: where two notes share a seam, the later one's near edge owns it, so dragging
  // a boundary always means the same thing — move the seam — instead of depending on
  // which of the two you happened to land on.
  function noteEdgeAt(x, y) {
    const g = geometry(), m = model();
    const w = Math.max(16, g.plot.w / (m.stepMax - m.stepMin) * 4);
    let far = null;
    for (let i = 0; i < m.notes.length; i++) {
      const xc = g.X(m.notes[i].step);
      if (x < xc - w / 2 - 6 || x > xc + w / 2 + 6) continue;
      const y0 = g.Y(m.starts[i]), y1 = g.Y(m.starts[i] + m.notes[i].dur);
      const z = edgeZone(y0, y1);
      if (Math.abs(y - y0) <= z) return { i, kind: 'boundary' };
      if (!far && Math.abs(y - y1) <= z) far = { i, kind: 'resize' };
    }
    return far;
  }

  // ---- starting a gesture ----

  // Both ends of a note are grab zones, but a short note must still be MOVABLE: at
  // default zoom an `8` note is 24px tall, so two fixed 14px caps would leave nothing
  // in between and a note could only ever be resized. The zone shrinks with the note
  // so a third of it always remains the body.
  function edgeZone(y0, y1) { return Math.min(HANDLE_PX * 1.4, Math.max(3, (y1 - y0) / 3)); }

  // The time scale is FROZEN when a drag starts, and the whole gesture is measured
  // against that snapshot.
  //
  // It has to be. Pixels-per-unit is derived from the SHORTEST note in the piece, so
  // shrinking a note rescales the entire time axis — while you are dragging it. Read
  // live, the same pointer position means a different time on the next move, and the
  // drag chases itself: one smooth 60px drag produced t0 = 72, 60, 77, 57, 81, 53, 79,
  // 68, 119, 5. Draw already learned this on the pitch axis, where the grid handles
  // freeze px-per-step at grab start for exactly this reason.
  function frozenTime(y) {
    const g = geometry();
    const t = g.tAtY(y), px = g.Y(t + 1) - g.Y(t);        // units -> pixels, right now
    return { anchorY: y, anchorT: t, pxPerUnit: px > 0 ? px : 1 };
  }
  const timeAt = (g, y) => (g && g.anchorT != null ? g.anchorT + (y - g.anchorY) / g.pxPerUnit : 0);

  // Both edges move a SEAM: the one this note shares with the neighbour on that side.
  // A note has no start of its own, only the sum of what came before, so neither edge
  // can move without the neighbour giving up or taking on the same time. Which edge it
  // is travels with the intent as `edge`; `forced` comes from noteEdgeAt, which has
  // already decided which one the pointer is on.
  function startGrab(i, y, pid, forced, shift) {
    onGrabStart();
    const m = model();
    const kind = forced || 'move';
    const t0 = m.starts[i];
    // SHIFT means push, not trade: the edge changes a length and everything after it
    // moves, instead of the neighbour giving up the same time. Read once, at grab
    // start — a modifier that changes what a gesture means halfway through it is a
    // gesture you cannot commit to. Same reason the time scale is frozen here.
    grab = { idx: i, tok: m.notes[i].tok, kind, push: !!shift,
      oldStep: m.notes[i].step, oldDur: m.notes[i].dur,
      oldT0: t0, ...frozenTime(y),
      cur: kind === 'move' ? m.notes[i].step : (kind === 'resize' ? m.notes[i].dur : t0), pid };
    own(pid);                 // a RESIZE is a vertical drag, exactly the axis 'pan-y' permits,
    redraw();                 // so without this the native touch-scroll fights it
  }

  function startRestGrab(r, pid, y) {
    onGrabStart();
    restGrab = { tok: r.tok, oldDur: r.dur, dur: r.dur, t0: r.t0, ...frozenTime(y), pid };
    emit({ kind: 'select', target: { type: 'rest', tok: r.tok } });
    own(pid);
    redraw();
  }

  // ARM, don't grab — on touch. A finger that lands and drags is SCROLLING; only a finger
  // that stays put for a moment is reaching for the thing under it.
  //
  // This rule already existed, for moving a note, and the edge grabs jumped ahead of it
  // and started on contact. A rest spans the whole width, so its edge is a full-width
  // strip and any touch near it resized the silence instead of scrolling the piece; a
  // note's edge band is a few pixels, which a fingertip covers whole. One rule for every
  // grab now, and the mouse keeps its immediacy — a pointer is precise and a click is
  // not a scroll.
  function arm(e, x, y, run) {
    if (e.pointerType === 'mouse') { run(); return; }
    pressXY = { x, y, id: e.pointerId, run };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { if (pressXY && pressXY.run) pressXY.run(); }, LONG_PRESS_MS);
  }

  // Undo an in-flight change without recording anything.
  function revert(g) {
    if (!g) return;
    if (g.kind === 'move') emit({ kind: 'move', phase: 'cancel', tok: g.tok, step: g.oldStep, from: g.oldStep });
    else if (g.kind === 'boundary') emit({ kind: 'boundary', phase: 'cancel', edge: 'near', push: g.push, tok: g.tok, t: g.oldT0, from: g.oldT0 });
    else emit({ kind: 'boundary', phase: 'cancel', edge: 'far', push: g.push, tok: g.tok, t: g.oldT0 + g.oldDur, from: g.oldT0 + g.oldDur });
  }

  // ---- the pointer ----

  // Splitting a note in two, on the gesture pitchy already uses for it: ctrl/cmd +
  // shift-click, with alt-click as the fallback for the window managers that swallow
  // the first. The same hand learns one gesture for both halves of the workflow —
  // pitchy proposes the boundaries, draw corrects them.
  const isSplitClick = (e) => ((e.ctrlKey || e.metaKey) && e.shiftKey) || e.altKey;

  // A-B follows the pointer CONTINUOUSLY, with a magnet to the note boundaries near it.
  // It used to land on the nearest akshara, which is a coarse grid to aim a phrase with —
  // the range jumped between beats and could not be put where a note actually begins. The
  // magnet is measured in PIXELS, so it stays a fixed reach on screen at any zoom.
  const MAGNET_PX = 10;
  function abTime(y) {
    const g = geometry(), t = Math.max(0, g.tAtY(y));
    const m = model();
    let best = t, bd = MAGNET_PX;
    for (let i = 0; i < m.notes.length; i++) {
      for (const edge of [m.starts[i], m.starts[i] + m.notes[i].dur]) {
        // Near in PIXELS, so the reach is the same on screen at any zoom — AND within a
        // quarter of the note itself, so it stays a nudge rather than a grid. Ten pixels
        // is five length-units at the default zoom, which swallowed most of a note: every
        // point inside one landed on its edge, which is the snapping this replaces.
        const dpx = Math.abs(g.Y(edge) - y);
        if (dpx <= bd && Math.abs(edge - t) <= m.notes[i].dur * 0.25) { bd = dpx; best = edge; }
      }
    }
    return Math.max(0, best);
  }

  // The A-B chip at the head of the margin: pressing it clears the range. Same box the
  // renderer draws, from roll-geometry.
  const onAbChip = (x, y) => allow('range') && inBox(abChipBox(geometry(), geometry().plot.x), x, y);

  const onDown = (e) => {
    if (!enabled()) return;
    const { x, y } = at(e);

    // The chip first: it sits in the margin's header, where a press would otherwise be
    // read as the start of a sweep.
    if (onAbChip(x, y)) { abChipPress = e.pointerId; own(e.pointerId); return; }

    // The MARGIN, left of the grid, when painting is not armed: A–B lives there. Same
    // shape pitchy uses — grabbing a tab moves that end, pressing anywhere else marks a
    // new range, and the two ends may not cross. Without the tabs there is no way to
    // nudge one end: every press would throw both markers away and start over.
    //
    // A PRESS is already a range: A where it landed, B at the end of the piece — so
    // "play from here" needs one tap, and a drag only refines the far end. It used to
    // preview a zero-length range and commit it as a CLEAR, which is why nothing but a
    // drag could mark anything. Clearing has its own affordance, the A–B chip above.
    if (!paintArmed() && allow('range') && x < geometry().plot.x) {
      onGrabStart();
      const gg = geometry(), t = abTime(y);
      const m = marks();
      const near = (mm) => m.b > m.a && Math.abs(y - gg.Y(mm)) <= AB_TAB_H;
      ab = near(m.a) ? { end: 'a', pid: e.pointerId }
        : near(m.b) ? { end: 'b', pid: e.pointerId }
        : { end: 'sweep', from: t, pid: e.pointerId, y0: y, moved: false };
      ab.y = y;
      // yRange[1] is the whole piece in roll mode, which is the only mode this runs in.
      // Pressed at or past the end there is nothing to mark, and the zero-length range
      // that leaves is committed as a clear by onUp.
      if (ab.end === 'sweep') emit({ kind: 'range', phase: 'preview', a: t, b: Math.max(t, gg.yRange[1]) });
      own(e.pointerId); redraw();
      return;
    }

    // Painting comes FIRST and takes the whole canvas: while it is armed, a press is
    // placing something new, never grabbing what is already there. The two gestures
    // start the same way, so they cannot both be live.
    if (paintArmed() && allow('paint')) {
      if (paint) return;                                   // a second finger: ignore
      onGrabStart();
      const g = geometry();
      const ts = Math.max(0, snapTime(g.tAtY(y)));
      // Left of the grid — the gutter the tala marks live in — paints SILENCE. The plot
      // itself is entirely notes now, so its leftmost pitch row can be painted on like
      // any other; it used to be covered by a rest band.
      paint = x < g.plot.x
        ? { ts, rest: true, dur: snapDur(0), pid: e.pointerId }
        : { ts, step: snapStep(Math.round(g.stepAtX(x))), dur: snapDur(0), pid: e.pointerId };
      own(e.pointerId);
      redraw();
      return;
    }

    // The split is decided BEFORE the edge handles are consulted. Holding the modifier
    // says this click is a split and nothing else, and the edge zones reach a third of
    // the way into a short note — without this, splitting a short note near its middle
    // would silently start a resize instead.
    if (isSplitClick(e) && allow('split')) {
      const i = hitNote(x, y);
      if (i < 0) return;                                   // not on a note: nothing to split
      e.preventDefault();
      justGrabbed = true;                                  // the click that follows is not "open me"
      emit({ kind: 'split', tok: model().notes[i].tok, index: i, t: geometry().tAtY(y) });
      return;
    }

    // A note's edges first — but they only reach across the note's box, so the rest
    // band ending on the same row is still grabbable to either side of it.
    // An edge the host cannot act on is not an edge: fall through, so the press lands
    // on the note itself rather than starting a drag that can only be cancelled.
    const ne = allow('boundary') ? noteEdgeAt(x, y) : null;
    if (ne) { arm(e, x, y, () => startGrab(ne.i, y, e.pointerId, ne.kind, e.shiftKey)); return; }
    const r = allow('resize') ? restEdgeAt(x, y) : null;
    if (r) { arm(e, x, y, () => startRestGrab(r, e.pointerId, y)); return; }

    // Defensive: a missed pointerup/cancel (an OS interruption) can leave a stale
    // grab from a previous touch. Undo it before starting a new press, or an early
    // move on THIS touch mutates the note the LAST one was holding.
    if (grab || pressXY) {
      clearTimeout(pressTimer); pressXY = null;
      if (grab) { revert(grab); grab = null; release(); }
    }

    const i = hitNote(x, y);
    if (i < 0) return;                                     // empty grid: let it scroll
    clearTimeout(pressTimer);
    if (!allow('move')) { pressXY = null; return; }         // nothing to drag a note into
    arm(e, x, y, () => startGrab(i, y, e.pointerId, null, e.shiftKey));
  };

  const onMove = (e) => {
    if (!enabled()) return;
    const { x, y } = at(e);

    if (ab) {
      if (e.pointerId !== ab.pid) return;
      ab.y = y; edgeScroll(y);
      const t = abTime(y);
      const m = marks();
      // The ends may not meet, let alone cross: a zero-length range plays nothing, and
      // an end dragged onto the other would be indistinguishable from clearing.
      const gap = snapDur(0) || 1;
      if (ab.end === 'sweep') {
        // A finger is never still. Until the press leaves the slop it is still a press,
        // and A–B stays where pointerdown put it: without this, the wobble of a tap
        // collapses the range onto its own start and onUp reads that as a clear.
        if (!ab.moved && Math.abs(y - ab.y0) > SLOP_PX) ab.moved = true;
        if (!ab.moved) return;
        emit({ kind: 'range', phase: 'preview', a: Math.min(ab.from, t), b: Math.max(ab.from, t) });
      }
      else if (ab.end === 'a') emit({ kind: 'range', phase: 'preview', a: Math.min(t, m.b - gap), b: m.b });
      else emit({ kind: 'range', phase: 'preview', a: m.a, b: Math.max(t, m.a + gap) });
      return;
    }

    if (paint) {
      if (e.pointerId !== paint.pid) return;
      const dur = snapDur(geometry().tAtY(y) - paint.ts);
      if (dur === paint.dur) return;
      paint.dur = dur;
      redraw();
      return;
    }

    if (restGrab) {
      if (e.pointerId !== restGrab.pid) return;
      const dur = snapDur(timeAt(restGrab, y) - restGrab.t0);
      if (dur === restGrab.dur) return;
      restGrab.dur = dur;
      emit({ kind: 'resize', phase: 'preview', target: 'rest', tok: restGrab.tok, dur, from: restGrab.oldDur });
      return;
    }

    if (!grab) {
      // Moving away from a pending long-press means a scroll, not a grab.
      if (pressXY && (Math.abs(x - pressXY.x) > SLOP_PX || Math.abs(y - pressXY.y) > SLOP_PX)) {
        clearTimeout(pressTimer); pressXY = null;
      }
      return;
    }
    if (e.pointerId !== grab.pid) return;                  // a second concurrent touch: ignored

    const g = geometry();
    if (grab.kind === 'move') {
      const raw = g.stepAtX(Math.max(g.plot.x, Math.min(g.plot.x + g.plot.w, x)));
      const step = snapStep(Math.round(raw));
      if (step === grab.cur) return;
      grab.cur = step;
      emit({ kind: 'move', phase: 'preview', tok: grab.tok, step, from: grab.oldStep });
    } else if (grab.kind === 'boundary') {
      const t0 = snapTime(timeAt(grab, y));
      if (t0 === grab.cur) return;
      grab.cur = t0;
      emit({ kind: 'boundary', phase: 'preview', edge: 'near', push: grab.push, tok: grab.tok, t: t0, from: grab.oldT0 });
    } else {
      const dur = snapDur(timeAt(grab, y) - grab.oldT0);
      if (dur === grab.cur) return;
      grab.cur = dur;
      emit({ kind: 'boundary', phase: 'preview', edge: 'far', push: grab.push, tok: grab.tok, t: grab.oldT0 + dur, from: grab.oldT0 + grab.oldDur });
    }
  };

  const onUp = (e) => {
    if (!enabled()) return;

    if (restGrab) {
      if (e.pointerId !== restGrab.pid) return;
      const g = restGrab; restGrab = null; release();
      if (g.dur === g.oldDur) { redraw(); return; }        // no change: nothing to record
      justGrabbed = true;
      emit({ kind: 'resize', phase: 'commit', target: 'rest', tok: g.tok, dur: g.dur, from: g.oldDur });
      return;
    }

    if (abChipPress === e.pointerId) {
      abChipPress = null; release();
      const m = marks();
      // Only when there is something to clear: a press on a dark chip should not push a
      // commit that the host would record as an edit.
      if (m.b > m.a) { justGrabbed = true; emit({ kind: 'range', phase: 'commit', a: 0, b: 0 }); }
      return;
    }

    if (ab && e.pointerId === ab.pid) {
      const g = ab; ab = null; stopEdge(); release(); redraw();
      const m = marks();
      // A sweep that ended where it began — dragged back to its own start, or pressed at
      // or past the end of the piece — leaves nothing to play, so it is cleared rather
      // than left as a zero-length segment. A plain press is NOT that case: pointerdown
      // already previewed A-to-the-end. A tab drag is never a clear either — dragging an
      // end is how a range is adjusted, not how it is thrown away.
      justGrabbed = true;
      const dead = g.end === 'sweep' && !(m.b > m.a);
      emit({ kind: 'range', phase: 'commit', a: dead ? 0 : m.a, b: dead ? 0 : m.b });
      return;
    }

    if (paint && e.pointerId === paint.pid) {
      const p = paint; paint = null; release(); redraw();
      // Disarmed mid-drag: abort rather than commit something the user stopped asking
      // for. And the press ends in a click ON what was just painted, which is not a
      // request to select it.
      if (!paintArmed()) return;
      justGrabbed = true;
      emit({ kind: 'paint', ts: p.ts, dur: p.dur, step: p.step, rest: !!p.rest });
      return;
    }
    if (grab && e.pointerId !== grab.pid) return;          // the owning grab stays live
    clearTimeout(pressTimer);
    const g = grab; pressXY = null; grab = null;
    if (!g) return;                                        // a plain tap: the click handler selects
    release();

    if (g.kind === 'move') {
      if (g.cur === g.oldStep) { redraw(); return; }       // e.g. a plain mouse click
      justGrabbed = true;                                  // a real edit: swallow the click that follows
      emit({ kind: 'move', phase: 'commit', tok: g.tok, step: g.cur, from: g.oldStep });
    } else if (g.kind === 'boundary') {
      if (g.cur === g.oldT0) { redraw(); return; }
      justGrabbed = true;
      emit({ kind: 'boundary', phase: 'commit', edge: 'near', push: g.push, tok: g.tok, t: g.cur, from: g.oldT0 });
    } else {
      if (g.cur === g.oldDur) { redraw(); return; }
      justGrabbed = true;
      emit({ kind: 'boundary', phase: 'commit', edge: 'far', push: g.push, tok: g.tok, t: g.oldT0 + g.cur, from: g.oldT0 + g.oldDur });
    }
  };

  const onCancel = (e) => {
    if (!enabled()) return;
    // An OS-interrupted paint must not leave the preview on screen with no gesture left
    // to dismiss it.
    if (abChipPress === e.pointerId) { abChipPress = null; release(); return; }
    if (ab && e.pointerId === ab.pid) { ab = null; stopEdge(); release(); redraw(); return; }
    if (paint && e.pointerId === paint.pid) { paint = null; release(); redraw(); return; }
    if (restGrab && e.pointerId === restGrab.pid) {
      emit({ kind: 'resize', phase: 'cancel', target: 'rest', tok: restGrab.tok, dur: restGrab.oldDur, from: restGrab.oldDur });
      restGrab = null; release(); redraw(); return;
    }
    if (grab && e.pointerId !== grab.pid) return;
    clearTimeout(pressTimer); pressXY = null;
    if (grab) { revert(grab); grab = null; release(); redraw(); }
  };

  // A tap SELECTS — a note exactly as much as a rest. It used to open a note's curve
  // editor outright, which meant a note had no selected state at all: anything offered
  // for "the thing you are pointing at", deleting first among them, was reachable only
  // by entering an editor you did not ask for. Opening is the heavier action and takes
  // the more deliberate gesture.
  const onClick = (e) => {
    if (!enabled()) return;
    if (justGrabbed) { justGrabbed = false; return; }
    onGrabStart();
    const { x, y } = at(e);
    const i = hitNote(x, y);
    if (i >= 0) { emit({ kind: 'select', target: { type: 'note', tok: model().notes[i].tok, index: i } }); return; }
    const r = hitRest(x, y);
    emit({ kind: 'select', target: r ? { type: 'rest', tok: r.tok } : null });
  };

  // Double-click opens the note for curve editing. The two clicks that precede it have
  // already selected it, which is what you want either way.
  const onDblClick = (e) => {
    if (!enabled() || !allow('open')) return;
    const { x, y } = at(e);
    const i = hitNote(x, y);
    if (i < 0) return;
    e.preventDefault();
    emit({ kind: 'open', tok: model().notes[i].tok, index: i });
  };

  // ---- sweeping past the edge ----
  //
  // A drag in the margin marks A–B; it does not scroll. But a range longer than the
  // window has to be reachable, so the ONE thing that does scroll is the drag arriving
  // at the top or bottom edge — and then it scrolls for as long as it stays there,
  // rather than one notch per pixel of finger movement there is no room left to make.
  const EDGE_PX = 30;          // how near the edge counts as "at" it
  const EDGE_MAX = 14;         // px per frame at full tilt
  let edgeRaf = 0, edgeDy = 0;

  function edgeScroll(y) {
    const h = canvas.getBoundingClientRect().height;
    const over = y < EDGE_PX ? y - EDGE_PX : (y > h - EDGE_PX ? y - (h - EDGE_PX) : 0);
    // Proportional: just past the edge creeps, right off it runs.
    edgeDy = over === 0 ? 0 : Math.max(-EDGE_MAX, Math.min(EDGE_MAX, over / 2));
    if (edgeDy && !edgeRaf && scrollBy) edgeRaf = requestAnimationFrame(edgeStep);
  }
  function edgeStep() {
    edgeRaf = 0;
    if (!ab || !edgeDy || !scrollBy) return;
    if (ab.end === 'sweep' && !ab.moved) return;      // a press near the edge is still a press
    scrollBy(edgeDy);
    // The pointer has not moved — the GRID has — so the time under it is a new time, and
    // the range has to be re-emitted from the same y or the sweep stops at the old edge.
    const t = abTime(ab.y);
    const m = marks(), gap = snapDur(0) || 1;
    if (ab.end === 'sweep') emit({ kind: 'range', phase: 'preview', a: Math.min(ab.from, t), b: Math.max(ab.from, t) });
    else if (ab.end === 'a') emit({ kind: 'range', phase: 'preview', a: Math.min(t, m.b - gap), b: m.b });
    else emit({ kind: 'range', phase: 'preview', a: m.a, b: Math.max(t, m.a + gap) });
    edgeRaf = requestAnimationFrame(edgeStep);
  }
  const stopEdge = () => { if (edgeRaf) cancelAnimationFrame(edgeRaf); edgeRaf = 0; edgeDy = 0; };

  // touch-action is read when the finger LANDS, so setting it to 'none' in pointerdown is
  // already too late for the gesture that press begins: the browser has committed to
  // panning and the sweep rides a scrolling page. Cancelling the touch itself is what
  // actually stops it, and it must be non-passive to be allowed to.
  const onTouchMove = (e) => { if (ab || grab || paint || restGrab) e.preventDefault(); };
  surface.addEventListener('touchmove', onTouchMove, { passive: false });

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('pointermove', onMove);
  surface.addEventListener('pointerup', onUp);
  surface.addEventListener('pointercancel', onCancel);
  surface.addEventListener('click', onClick);
  surface.addEventListener('dblclick', onDblClick);

  return {
    // noteEdgeAt is exposed for the same reason restEdgeAt is: a host that wants to know
    // what a press would MEAN before it means it — the long-press menu asks, because an
    // edge press is how a length is grabbed on a touchscreen and a menu must not take it.
    hitNote, hitRest, restEdgeAt, noteEdgeAt,
    /** True while a gesture is in flight — the host should not fight it. */
    busy: () => !!(grab || restGrab || paint || ab),
    /** The note being dragged, for drawing its handle. -1 when none. */
    grabbedIndex: () => (grab ? grab.idx : -1),
    /** The paint in progress, for the renderer to preview. null when none. */
    painting: () => (paint ? { ...paint } : null),
    /**
     * Swallow the click that a host's OWN gesture is about to produce. Painting a
     * note ends in a click on the note just painted, which would otherwise read as
     * "open this one for editing" — a gesture answering itself.
     */
    suppressClick() { justGrabbed = true; },
    /** A real edit just finished; the click that follows is not a selection. */
    consumedClick: () => justGrabbed,
    destroy() {
      stopEdge();
      surface.removeEventListener('touchmove', onTouchMove);
      clearTimeout(pressTimer);
      surface.removeEventListener('dblclick', onDblClick);
      surface.removeEventListener('pointerdown', onDown);
      surface.removeEventListener('pointermove', onMove);
      surface.removeEventListener('pointerup', onUp);
      surface.removeEventListener('pointercancel', onCancel);
      surface.removeEventListener('click', onClick);
    },
  };
}
