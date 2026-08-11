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
// Not here, on purpose: painting new notes, gamaka strokes, the grid stretch handles
// and the one-note curve editor. Each is the same shape and can follow; keeping them
// out keeps this reviewable against the gestures it replaces.

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
    idleTouchAction = 'pan-y',
    onGrabStart = () => {},    // e.g. unlock audio before a drag makes a sound
  } = opts;

  let grab = null;             // { tok, idx, kind:'move'|'resize', oldStep, oldDur, cur, pid }
  let restGrab = null;         // { tok, oldDur, dur, pid }
  let pressXY = null, pressTimer = 0;
  let justGrabbed = false;     // a real edit happened: swallow the click that follows

  const at = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const own = (pid) => { canvas.style.touchAction = 'none'; try { canvas.setPointerCapture(pid); } catch (_) { /* not captured: the gesture still works */ } };
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

  const onDown = (e) => {
    if (!enabled()) return;
    const { x, y } = at(e);

    // The split is decided BEFORE the edge handles are consulted. Holding the modifier
    // says this click is a split and nothing else, and the edge zones reach a third of
    // the way into a short note — without this, splitting a short note near its middle
    // would silently start a resize instead.
    if (isSplitClick(e)) {
      const i = hitNote(x, y);
      if (i < 0) return;                                   // not on a note: nothing to split
      e.preventDefault();
      justGrabbed = true;                                  // the click that follows is not "open me"
      emit({ kind: 'split', tok: model().notes[i].tok, index: i, t: geometry().tAtY(y) });
      return;
    }

    // A note's edges first — but they only reach across the note's box, so the rest
    // band ending on the same row is still grabbable to either side of it.
    const ne = noteEdgeAt(x, y);
    if (ne) { startGrab(ne.i, y, e.pointerId, ne.kind, e.shiftKey); return; }
    const r = restEdgeAt(x, y);
    if (r) { startRestGrab(r, e.pointerId, y); return; }

    // Defensive: a missed pointerup/cancel (an OS interruption) can leave a stale
    // grab from a previous touch. Undo it before starting a new press, or an early
    // move on THIS touch mutates the note the LAST one was holding.
    if (grab || pressXY) {
      clearTimeout(pressTimer); pressXY = null;
      if (grab) { revert(grab); grab = null; release(); }
    }

    const i = hitNote(x, y);
    if (i < 0) return;                                     // empty grid: let it scroll
    pressXY = { x, y, id: e.pointerId };
    clearTimeout(pressTimer);
    if (e.pointerType === 'mouse') { startGrab(i, y, e.pointerId, null, e.shiftKey); return; }   // desktop: no long-press
    pressTimer = setTimeout(() => { if (pressXY) startGrab(i, y, e.pointerId, null, e.shiftKey); }, LONG_PRESS_MS);
  };

  const onMove = (e) => {
    if (!enabled()) return;
    const { x, y } = at(e);

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
    if (!enabled()) return;
    const { x, y } = at(e);
    const i = hitNote(x, y);
    if (i < 0) return;
    e.preventDefault();
    emit({ kind: 'open', tok: model().notes[i].tok, index: i });
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('dblclick', onDblClick);

  return {
    hitNote, hitRest, restEdgeAt,
    /** True while a gesture is in flight — the host should not fight it. */
    busy: () => !!(grab || restGrab),
    /** The note being dragged, for drawing its handle. -1 when none. */
    grabbedIndex: () => (grab ? grab.idx : -1),
    /**
     * Swallow the click that a host's OWN gesture is about to produce. Painting a
     * note ends in a click on the note just painted, which would otherwise read as
     * "open this one for editing" — a gesture answering itself.
     */
    suppressClick() { justGrabbed = true; },
    /** A real edit just finished; the click that follows is not a selection. */
    consumedClick: () => justGrabbed,
    destroy() {
      clearTimeout(pressTimer);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('click', onClick);
    },
  };
}
