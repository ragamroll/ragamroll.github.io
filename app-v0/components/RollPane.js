import { html } from '../vendor/htm-preact.js';
import { useRef, useEffect, useState } from '../vendor/hooks.module.js';
import { createRagamRoll } from '../core/ragamroll.js';
import { buildRollModel } from '../core/roll-model.js';
import { createRollEdit } from '../core/roll-edit.js';
import { createCurveEdit } from '../core/curve-edit.js';
import { createGamakaEdit } from '../core/gamaka-edit.js';
import { createGridStretch } from '../core/grid-stretch.js';
import { createRollPan } from '../core/roll-pan.js';
import { sampleCurve } from '../core/gamaka-inline.js';
import { snapToRagaRow, snapToAkshara } from '../core/note-edit.js';
import { EDO } from '../core/shruti.js';
import { LanesRail } from './LanesRail.js';

// The roll, on the app's page. A thin wrapper: Preact owns three elements and
// nothing inside them, because the roll is a canvas and there is no tree to diff —
// every frame of it is imperative drawing. So the instance is created once, told
// about a new piece when one arrives, and otherwise left alone.
//
// It is also why the playhead is NOT a prop. Passing it would re-render through the
// vdom sixty times a second to change one line's position. The parent takes the
// instance out of `api` and drives it directly from its own rAF loop, which is where
// the transport clock already lives.
// The tala's akshara, which is what durations snap to. A piece with no Tala= has none,
// and the caller falls back to a single length-unit.
const beatOf = (r) => { const m = r.model(); return m && m.tala ? m.tala.beat : 0; };

const cssvar = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();

export function RollPane({ model, api, style, onIntent, allow, sel, tools, zoom = 1, onSetZoom, paint, chrome = true,
  mode = 'roll', curveIndex = -1, onCurveIntent, snapping, onCurvePitch, drawSpan = 22,
  markerA = 0, markerB = 0, gamaka, onGamakaIntent, onGamakaPitch,
  canPasteGamaka, onCopyGamakaAt, onPasteGamakaAt, onHoverNote, secPerUnit = 0, saMidi = null,
  lanes = 'off', lanesOrder = 'ws', lanesHeadRef,
  labelOct = true, labelComma = true, theme = 'dark', flash = true,
  onLanesSide, onLanesOrder, onLanesHide }) {
  const holder = useRef(null), content = useRef(null), canvas = useRef(null), gutter = useRef(null);
  const roll = useRef(null);
  // The gesture layer reads these through refs, not through its closure: it is mounted
  // once alongside the roll, while the host's handler is a new function on every render.
  const intentRef = useRef(onIntent), allowRef = useRef(allow), paintRef = useRef(paint);
  intentRef.current = onIntent; allowRef.current = allow; paintRef.current = paint;
  const modeRef = useRef(mode), curveRef = useRef(onCurveIntent), snapRef = useRef(snapping), idxRef = useRef(curveIndex);
  modeRef.current = mode; curveRef.current = onCurveIntent; snapRef.current = snapping; idxRef.current = curveIndex;
  const pitchRef = useRef(onCurvePitch); pitchRef.current = onCurvePitch;
  const marksRef = useRef({ a: markerA, b: markerB }); marksRef.current = { a: markerA, b: markerB };
  const chromeRef = useRef(chrome); chromeRef.current = chrome;
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const setZoomRef = useRef(onSetZoom); setZoomRef.current = onSetZoom;
  // The slider shows the span the roll is ACTUALLY drawing, so a pan or a stretch-tab
  // drag moves it too rather than leaving it describing a range nobody is looking at.
  const [pitchSpan, setPitchSpan] = useState(0);
  const [paneW, setPaneW] = useState(0);      // the canvas's own width: the ruler depends on it
  // Where the visible pitch window sits inside the whole grid, as fractions of it. The
  // TIME axis gets this for free: the roll is a tall div in a scroller, so the browser
  // draws the bar and moves it. Pitch is a mapping onto the canvas width — there is no
  // overflowing content for a scrollbar to describe — so the window has to be measured
  // and drawn. null when the whole range is on screen and there is nothing to scroll.
  const [pitchBar, setPitchBar] = useState(null);   // { off, frac } in 0..1, or null
  // The roll's context menu: right-click a note to copy or paste its gamaka, the way the
  // gamaka page has always done it. { x, y, i } in client coordinates, or null.
  //
  // It acts on the note UNDER THE POINTER rather than on the selection, which is the whole
  // of why it feels direct: no arming a mode, no selecting first, no strip to travel to.
  const [menu, setMenu] = useState(null);
  const hitRef = useRef(() => -1);            // the roll-edit hit-test, once it exists
  // Recomputed rather than tracked: the view is moved by a slider, a pan, a stretch tab,
  // a new piece and the editor coming back, and a bar that each of those had to remember
  // to update is a bar that is wrong after whichever one gets forgotten.
  const syncBar = () => {
    const r = roll.current; if (!r) return;
    const e = r.extent(), v = r.pitchView();
    const span = e.stepMax - e.stepMin;
    if (!v || span <= 0 || v.max - v.min >= span) { setPitchBar(null); return; }
    setPitchBar({ off: (v.min - e.stepMin) / span, frac: (v.max - v.min) / span });
  };

  // The pitch window as the READER set it — centre and span, in floats — kept apart from
  // what the roll draws, which is rounded to whole steps. Rounding is for drawing; a
  // control that reads its own rounded output back accumulates the error.
  const pitchWin = useRef(null);          // { c, span } | null — null = the grid's own bounds
  const naturalPitch = useRef({ c: 0, span: 1 });   // what the grid gives this piece
  const returnTo = useRef(null);          // the moment to come back to when the editor closes
  const gamaRef = useRef(gamaka), gamaIntentRef = useRef(onGamakaIntent);
  gamaRef.current = gamaka; gamaIntentRef.current = onGamakaIntent;
  // Its own ref, NOT the curve editor's `pitchRef`: the two report the same thing from
  // different modes, and one name for both is how a collision in here took the app down
  // twice before.
  const gamaPitchRef = useRef(onGamakaPitch); gamaPitchRef.current = onGamakaPitch;
  const hoverRef = useRef(onHoverNote); hoverRef.current = onHoverNote;

  useEffect(() => {
    const hd = holder.current;
    const r = createRagamRoll({ holder: hd, content: content.current, canvas: canvas.current }, {
      // Read from the page, not baked in. A canvas inherits nothing, so a hardcoded
      // palette silently stops matching the CSS around it — and a light theme could
      // never reach it at all. Same variables draw reads, so the two rolls are the same
      // roll to look at.
      palette: () => ({ amber: cssvar('--amber'), amberS: cssvar('--amberSoft'), teal: cssvar('--teal'),
        terra: cssvar('--terra'), hair: cssvar('--hair2'), muted: cssvar('--muted'),
        panel2: cssvar('--panel2'), mono: cssvar('--mono'), bg: cssvar('--bg'), sans: cssvar('--sans'),
        // The roll's own paper. Same colour the pane behind it is painted, so the page looks
        // exactly as it did — but the canvas is now opaque, which is what a screen capture
        // needs and what saves compositing every frame it films.
        paper: cssvar('--panel') }),
    });
    roll.current = r;
    if (api) api.current = r;
    // The pane is resized by the splitters, not only by the window, so the canvas
    // has to follow the element rather than the viewport.
    // Editing gestures, on the same canvas. They are framework-free by design, so the
    // Preact side of this pane owns three elements and still nothing inside them: the
    // pointer never reaches the vdom, and an intent comes back out.
    //
    // Snapping is derived from the roll's OWN model rather than passed in, so the note
    // you drag lands on the row you can see. gridPitches are absolute steps across
    // however many octaves are drawn; snapToRagaRow rebuilds the octave from the step
    // it is given, so it must be handed single-octave classes or the octave counts
    // twice.
    let ed, ced, pan;
    ed = createRollEdit(canvas.current, {
      // The canvas and the no-pan margin strip are siblings; their parent is where a
      // press on either one can be heard.
      surface: content.current,
      geometry: () => r.geometry(),
      model: () => { const m = r.model(); const b = r.bounds();
        return { notes: m.notes, starts: m.starts, rests: m.rests, stepMin: b.stepMin, stepMax: b.stepMax }; },
      snapStep: (step) => snapToRagaRow(step, [...new Set(r.bounds().gridPitches.map((g) => ((g.step % EDO) + EDO) % EDO))]),
      snapDur: (d) => { const beat = beatOf(r) || 1; return Math.max(beat, snapToAkshara(d, beat)); },
      snapTime: (t) => snapToAkshara(t, beatOf(r) || 1),
      // The in-progress paint is the RENDERER's to draw, so it is pushed into the view on
      // the way to every redraw rather than mirrored in app state.
      redraw: () => r.setView({ paint: ed.painting() }).render(),
      painting: () => !!paintRef.current,
      marks: () => marksRef.current,
      // NOT while ✎ is armed: there a press on a note is shaping its curve, and letting
      // the roll gestures run too started a note-move alongside the trace — two commits
      // in one gesture, the second re-serialising against notation the first had already
      // replaced. Draw has always had this guard; the app was missing it.
      // NOT while a pan is in flight: that finger is dragging the paper, not pressing
      // on the note under it.
      enabled: () => !!intentRef.current && modeRef.current === 'roll' && !gamaRef.current
        && !(pan && pan.busy()),
      allow: (kind) => (allowRef.current ? allowRef.current.includes(kind) : true),
      // The only scrolling a gesture is allowed to cause: an A–B sweep dragged past the
      // top or bottom of the window, so a range longer than the window can be marked.
      scrollBy: (dy) => { hd.scrollTop += dy; },
      emit: (it) => { if (intentRef.current) intentRef.current(it); },
    });

    // The curve editor, on the same canvas again. It is live only in draw mode, so the
    // two gesture modules never both answer a press.
    ced = createCurveEdit(canvas.current, {
      geometry: () => r.geometry(),
      curve: () => { const m = r.model(); const i = idxRef.current; return i >= 0 && m.notes[i] ? m.notes[i].curve : null; },
      setCurve: (c) => { const m = r.model(); const i = idxRef.current; if (i >= 0 && m.notes[i]) m.notes[i].curve = c; },
      snapping: () => !!snapRef.current,
      enabled: () => modeRef.current === 'draw' && !!curveRef.current,
      redraw: () => r.setView({ drawing: ced.drawing() }).render(),
      sample: sampleCurve,
      emit: (it) => { if (curveRef.current) curveRef.current(it); },
      onPitch: (st) => { if (pitchRef.current) pitchRef.current(st); },
    });

    // The canvas is viewport-sized and SLICES the piece by scrollTop — so scrolling
    // changes what should be drawn, and nothing else notices. Without this the bar moves
    // and the picture does not: the roll only redrew when the model changed or while the
    // playhead's rAF loop was running, which is why it appeared to work during playback
    // and nowhere else.
    const onScroll = () => r.render();
    hd.addEventListener('scroll', onScroll, { passive: true });

    // In-roll gamaka editing, on the same canvas as everything else. Live only while the
    // ✎ toggle is on, and it takes the press before the roll gestures do — a drag there
    // is shaping a curve, not moving a note.
    const ged = createGamakaEdit(canvas.current, {
      geometry: () => r.geometry(),
      model: () => { const m = r.model(); return { notes: m.notes, starts: m.starts }; },
      hitNote: (x, y) => (gamaRef.current ? ed.hitNote(x, y) : -1),
      snapping: () => !!snapRef.current,
      enabled: () => !!gamaRef.current && modeRef.current === 'roll',
      redraw: () => r.render(),
      sample: sampleCurve,
      emit: (it) => { if (gamaIntentRef.current) gamaIntentRef.current(it); },
      onPitch: (st) => { if (gamaPitchRef.current) gamaPitchRef.current(st); },
    });

    hitRef.current = (x, y) => ed.hitNote(x, y);

    // Right-click: the gamaka page's own gesture. It opens on whatever note the press
    // landed on, in roll mode only — the one-note editor has its whole strip to hand and
    // a menu there would be offering a note the reader is already inside.
    //
    // On the PARENT, not the canvas: the margin strip is a sibling laid over the same
    // area, so the canvas is not what a press lands on — which is why every other gesture
    // in this pane listens here too. Coordinates are still measured against the canvas,
    // because that is what the hit-test was drawn in.
    const onCtx = (e) => {
      if (modeRef.current !== 'roll') return;
      const r2 = canvas.current.getBoundingClientRect();
      const i = ed.hitNote(e.clientX - r2.left, e.clientY - r2.top);
      if (i < 0) return;                       // empty grid keeps the browser's own menu
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, i });
    };
    content.current.addEventListener('contextmenu', onCtx);

    // Which note the POINTER is over, reported only when it changes. A mouse moves in
    // dozens of events a second and the answer is the same note for almost all of them;
    // pushing every one of them into the host's state would re-render the app at the
    // frame rate to say nothing new.
    //
    // Mouse only. A finger has no hover — it is either pressing something or not there —
    // and reporting a touch as a hover would leave the last note pressed showing as
    // "under the pointer" long after the hand had gone.
    let hoverIdx = -1;
    const sayHover = (i) => { if (i !== hoverIdx) { hoverIdx = i; if (hoverRef.current) hoverRef.current(i); } };
    const onHoverMove = (e) => {
      if (e.pointerType !== 'mouse' || !hoverRef.current) return;
      const r2 = canvas.current.getBoundingClientRect();
      sayHover(ed.hitNote(e.clientX - r2.left, e.clientY - r2.top));
    };
    const onHoverOut = () => sayHover(-1);
    content.current.addEventListener('pointermove', onHoverMove);
    content.current.addEventListener('pointerleave', onHoverOut);

    // TOUCH has no right-click. A long press is its stand-in everywhere else, so it is
    // here too — held still on a note, past the moment a drag would have declared itself.
    //
    // 500ms, not the 300ms that arms a grab: by then roll-edit is already HOLDING the note,
    // and a menu that left it held would move the note on the way to the menu item. So the
    // press is taken back with a real pointercancel on the surface both share, which is
    // what roll-edit reverts on — the note goes back where it was and commits nothing.
    //
    // Android fires a contextmenu event of its own after a long press, and that lands in
    // the same setMenu above; iOS fires none, which is what this is for. Either way the
    // menu opens once with the same note under it.
    let lpTimer = null, lp = null;
    const LP_MS = 500, LP_SLOP = 10;
    const lpCancel = () => { clearTimeout(lpTimer); lp = null; };
    const onLpDown = (e) => {
      if (e.pointerType !== 'touch' || modeRef.current !== 'roll') return;
      // Those modes own a press outright: painting places a note, ✎ shapes a curve, and a
      // menu appearing mid-gesture would be taking the press away from what armed it.
      if (paintRef.current || gamaRef.current) return;
      const r2 = canvas.current.getBoundingClientRect();
      const x = e.clientX - r2.left, y = e.clientY - r2.top;
      // An EDGE is not a body. Holding an edge is how a length is grabbed on a touchscreen
      // — the hold IS the gesture, and a menu opening halfway through it would take the
      // press away from a resize already in hand. The note's body has no such claim on a
      // press that never moves.
      if (ed.noteEdgeAt(x, y) || ed.restEdgeAt(x, y)) return;
      const i = ed.hitNote(x, y);
      if (i < 0) return;                       // empty grid stays the scroller's
      lp = { x: e.clientX, y: e.clientY, id: e.pointerId, i };
      clearTimeout(lpTimer);
      lpTimer = setTimeout(() => {
        if (!lp) return;
        const held = lp; lp = null;
        content.current.dispatchEvent(new PointerEvent('pointercancel',
          { pointerId: held.id, pointerType: 'touch', bubbles: true }));
        setMenu({ x: held.x, y: held.y, i: held.i });
      }, LP_MS);
    };
    // Moved is dragged, not held: the finger is scrolling the piece or moving the note.
    const onLpMove = (e) => {
      if (!lp || e.pointerId !== lp.id) return;
      if (Math.abs(e.clientX - lp.x) > LP_SLOP || Math.abs(e.clientY - lp.y) > LP_SLOP) lpCancel();
    };
    const onLpUp = (e) => { if (lp && e.pointerId === lp.id) lpCancel(); };
    content.current.addEventListener('pointerdown', onLpDown);
    content.current.addEventListener('pointermove', onLpMove);
    window.addEventListener('pointerup', onLpUp, true);
    window.addEventListener('pointercancel', onLpUp, true);

    // The three grid stretch-handles. This is VIEW state — how far a reader has widened
    // the grid to write into — so it is applied here and never reaches the notation or a
    // share link. Capture phase, and it stops the event: a tab sits ON the grid, and to
    // the note layer underneath a press on one looks like a press on empty space.
    const gst = createGridStretch(canvas.current, {
      geometry: () => r.geometry(),
      size: () => r.size(),
      bounds: () => r.bounds(),
      snapStep: (step) => snapToRagaRow(step, [...new Set(r.bounds().gridPitches.map((g) => ((g.step % EDO) + EDO) % EDO))]),
      snapTime: (t) => snapToAkshara(t, beatOf(r) || 1),
      beat: () => beatOf(r) || 1,
      measure: () => { const m = r.model(); return m && m.tala ? m.tala.measure : 0; },
      enabled: () => chromeRef.current && modeRef.current === 'roll' && !paintRef.current && !gamaRef.current,
      redraw: () => r.render(),
      emit: (it) => {
        if (it.which === 'pmin') r.setUser({ min: it.step });
        else if (it.which === 'pmax') r.setUser({ max: it.step });
        else if (it.which === 'bottom') r.setUser({ bottom: it.bottom });
        else if (it.which === 'extend') r.setUser({ bottom: (r.bounds().total || 0) + it.by });
        // The scroll window is sized from the grid, so a taller grid has to be told to
        // the div before the roll is redrawn into it — otherwise the new time exists and
        // cannot be scrolled to.
        content.current.style.height = r.virtH() + 'px';
        if (it.which === 'bottom') {
          // Glue the new bottom edge under the finger dragging it, so the time being
          // added is visible while it is being added.
          hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
            r.yVirt(r.bounds().total) - it.y));
        } else if (it.which === 'extend') {
          // A tap adds an avartana BELOW the fold; scroll so the new bottom — with the
          // tab still on it — is where the next tap will be.
          hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
            r.yVirt(r.bounds().total) - (hd.clientHeight - 40)));
        }
        r.render();
      },
    });
    // Panning the pitch axis: one finger, sideways. Time already pans — the roll scrolls
    // and the browser owns that gesture — and pitch could not travel at all, which only
    // became a problem once the axis could be zoomed into.
    pan = createRollPan(canvas.current, {
      geometry: () => r.geometry(),
      bounds: () => r.bounds(),
      extent: () => r.extent(),
      // Desktop gets the gesture only once the axis is zoomed, where it is the only way
      // along it and where a drag on empty grid means nothing else. Unzoomed, the whole
      // pitch range is already on the canvas and a mouse drag stays what it was.
      mousePan: () => !!r.pitchView(),
      hitNote: (x, y) => ed.hitNote(x, y),
      setPitchView: (v) => {
        // A pan moves the centre and keeps the span; carried in floats for the same
        // reason the zoom carries it.
        pitchWin.current = { c: (v.min + v.max) / 2, span: v.max - v.min };
        r.setPitchView(v); setPitchSpan(Math.round(v.max - v.min)); syncBar();
      },
      enabled: () => chromeRef.current && modeRef.current === 'roll'
        && !paintRef.current && !gamaRef.current && !ed.busy(),
      redraw: () => r.render(),
    });

    // Discoverability: a resize cursor over a tab, and only while nothing else is in
    // flight — a cursor that changes mid-drag says the drag has been taken over.
    const onHover = (e) => {
      if (gst.busy() || ed.busy()) return;
      const b = canvas.current.getBoundingClientRect();
      const h = gst.hit(e.clientX - b.left, e.clientY - b.top);
      canvas.current.style.cursor = h ? (h === 'bottom' ? 'pointer' : 'col-resize') : '';
    };
    canvas.current.addEventListener('pointermove', onHover);

    // The strip is exactly as wide as the roll's left margin, which changes with the
    // labels, so it is measured from the roll rather than guessed at.
    const fitGutter = () => { if (gutter.current) gutter.current.style.width = r.geometry().plot.x + 'px'; };
    const ro = new ResizeObserver(() => { r.resize(); fitGutter(); setPaneW(r.size().w || 0); });
    ro.observe(hd);
    r.resize(); fitGutter();
    return () => { hd.removeEventListener('scroll', onScroll); canvas.current && canvas.current.removeEventListener('pointermove', onHover);
      clearTimeout(lpTimer);
      if (content.current) {
        content.current.removeEventListener('contextmenu', onCtx);
        content.current.removeEventListener('pointermove', onHoverMove);
        content.current.removeEventListener('pointerleave', onHoverOut);
        content.current.removeEventListener('pointerdown', onLpDown);
        content.current.removeEventListener('pointermove', onLpMove);
      }
      window.removeEventListener('pointerup', onLpUp, true);
      window.removeEventListener('pointercancel', onLpUp, true);
      ed.destroy(); ced.destroy(); ged.destroy(); gst.destroy(); pan.destroy(); ro.disconnect(); roll.current = null; if (api && api.current === r) api.current = null; };
  }, []);

  useEffect(() => {
    const r = roll.current; if (!r || !model) return;
    try { r.setModel(buildRollModel(model)); } catch { return; }   // a half-typed piece: keep the last good roll
    r.setPlayhead(null).resize();
    // The pitch slider describes the axis as DRAWN, so it starts wherever the piece put
    // it — and follows a stretch tab or a new piece rather than describing a range nobody
    // is looking at.
    // What the grid gives THIS piece: the widest the slider goes, and where the axis
    // returns to. Without it there is no way back — a zoomed-in reader who cannot find
    // the notes again has lost the piece.
    if (!r.pitchView()) {
      const b = r.bounds();
      naturalPitch.current = { c: (b.stepMin + b.stepMax) / 2, span: b.stepMax - b.stepMin };
      setPitchSpan(Math.round(naturalPitch.current.span));
    }
    syncBar();
  }, [model]);

  // Zoom stretches the time axis, so the scroll offset means a different moment
  // afterwards. What is preserved is the moment at the CENTRE of the viewport — read
  // before the rescale, written after it.
  //
  // It used to be the moment at the TOP, which is right for a zoom driven from the top of
  // the page and wrong for one driven from a slider beside the middle of the roll: you
  // zoom in on the phrase you are looking at, and the top edge is not what you are looking
  // at. Keeping the PIXEL rather than either moment is what makes a zoom feel like the
  // piece jumped.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    const hd = holder.current;
    const pad = r.pad ? r.pad.t : 0;
    const mid = hd.clientHeight / 2;
    const was = r.pxPerUnit() > 0 ? (hd.scrollTop + mid - pad) / r.pxPerUnit() : 0;
    r.setView({ zoom }).resize();
    const u = r.pxPerUnit();
    if (u > 0) hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight), pad + was * u - mid));
    r.render();
  }, [zoom]);

  // THE PALETTE CHANGED. The roll reads its colours from the page's CSS variables at draw
  // time — a canvas inherits nothing — so a theme switch is invisible to it until someone
  // says so. This is that someone. A render, not a resize: nothing about the geometry moved.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.render();
  }, [theme]);

  // Whether a note lights up as it is reached. A render: nothing about the geometry moved.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ flash }).render();
  }, [flash]);

  // How a pitch is spelt. A resize, not just a render: the header's depth is measured off the
  // longest label, so dropping the octave gives two characters back to the roll.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ labelOct, labelComma }).resize().render();
  }, [labelOct, labelComma]);

  // What is selected is the roll's to DRAW — it already gives a selected note a heavier
  // border and its end caps — so it is pushed in as view state rather than tracked
  // twice. A note is addressed by index because that is what the renderer compares
  // against; a rest by token, because rests have no index of their own.
  //
  // `sel` is ONE field with two meanings: the selected note in roll mode, and the note
  // being shaped in draw mode. So both are set from the same place — writing the
  // roll-mode selection unconditionally blanked it after every curve edit, and since
  // draw mode draws only that note, the note and its curve vanished and left the grid.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    const m = r.model();
    if (mode === 'draw') {
      const i = curveIndex >= 0 && m.notes[curveIndex] ? curveIndex : -1;
      r.setView({ sel: i, selRest: -1 }).render();
      return;
    }
    const i = sel && sel.type === 'note' ? m.notes.findIndex((n) => n.tok === sel.tok) : -1;
    r.setView({ sel: i, selRest: sel && sel.type === 'rest' ? sel.tok : -1 }).render();
  }, [sel, model, mode, curveIndex]);

  // Draw mode zooms the roll onto ONE note. The renderer already knows how — it is the
  // same layout draw uses — so it is told which note and left to it.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    // `handles`: the stretch tabs are drawn in roll mode only — the one-note layout has
    // no grid to widen, and a tab left on it would be a control that does nothing.
    // `chrome`: a preview roll draws NO controls. The stretch tabs and the A–B chip are
    // things to press, and a roll nobody can edit — the raga browser's — must not offer
    // them. `handles`: roll mode only, since the one-note layout has no grid to widen.
    // Where to come back to. The one-note layout has no scroll of its own — resize()
    // zeroes it — so returning from the editor landed at the top of the piece, however
    // far down the note you had opened was. Remembered as a TIME rather than a scroll
    // offset, because the zoom can change while you are in there and pixels would then
    // mean a different moment.
    if (mode === 'draw' && returnTo.current == null) {
      const m = r.model();
      returnTo.current = (curveIndex >= 0 && m.starts[curveIndex] != null)
        ? m.starts[curveIndex]
        : r.geometry().tAtY(holder.current.clientHeight / 2);
    }
    r.setView({ mode, drawSpan, handles: chrome && mode === 'roll', abChip: chrome });   // `sel` belongs to the effect below, which owns both meanings
    r.resize();
    if (mode === 'roll' && returnTo.current != null) {
      const hd = holder.current, t = returnTo.current;
      returnTo.current = null;
      // A little above centre, so the note you were editing is on screen with what
      // follows it — you came back to put it in context.
      hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
        r.yVirt(t) - hd.clientHeight * 0.4));
      r.render();
    }
  }, [mode, curveIndex, drawSpan, chrome]);

  // The A–B band and its two lines are the renderer's; it only has to be told where.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ markerA, markerB, abTabs: true }).render();   // the app hosts the gesture, so it draws the tabs
  }, [markerA, markerB]);

  // Arming "+ note" shows the rest band, so the roll has to be told.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ paintMode: !!paint }).render();
  }, [paint]);

  // ✎ shows every curve's anchors, so they can be aimed at.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ gamakaMode: !!gamaka }).render();
  }, [gamaka]);

  // The two zoom sliders, framing the roll: time down the right edge, pitch along the
  // bottom. Both keep the CENTRE of what is on screen where it is — the moment and the
  // pitch in the middle of the viewport stay in the middle while the scale changes around
  // them, which is the one thing a zoom has to promise.
  // The slider only names the scale. Holding the centre is the zoom effect's job below —
  // doing it here as well meant two anchors racing, the effect winning, and the slider's
  // work being thrown away a frame later.
  const zoomTime = (z) => { if (setZoomRef.current) setZoomRef.current(z); };
  const zoomPitch = (span) => {
    const r = roll.current; if (!r) return;
    // The centre is CARRIED, not re-read. Reading it back from the roll each time meant
    // reading a rounded number and re-centring on it: setPitchView rounds to whole steps,
    // so every slider event lost up to half a step and the window crept left — a slider
    // dragged across its travel fires dozens of them, and the notes walked off the side.
    const nat = naturalPitch.current;
    if (span >= nat.span) {            // back to the widest: hand the axis back to the grid
      pitchWin.current = null;
      r.setPitchView(null).resize();
      setPitchSpan(nat.span);
      syncBar();
      return;
    }
    const c = pitchWin.current ? pitchWin.current.c : nat.c;
    pitchWin.current = { c, span };
    r.setPitchView({ min: c - span / 2, max: c + span / 2 }).resize();
    setPitchSpan(Math.round(span));
    syncBar();
  };

  // A menu that outlives what it points at is worse than no menu: the roll scrolls, the
  // piece re-parses, and the note under those coordinates is no longer the note the
  // reader right-clicked. So it closes on anything that could move it.
  useEffect(() => {
    if (!menu) return;
    const away = (e) => { if (!e.target.closest || !e.target.closest('.roll-ctx')) setMenu(null); };
    const esc = (e) => { if (e.key === 'Escape') setMenu(null); };
    const hd = holder.current;
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    hd && hd.addEventListener('scroll', () => setMenu(null), { passive: true, once: true });
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  }, [menu]);
  useEffect(() => { setMenu(null); }, [model, mode]);

  // What the menu is about to act on, read at RENDER time from the live model: a curve
  // can be traced or cleared while the menu is open, and an item that lies about what it
  // will do is worse than one that is simply greyed out.
  const menuNote = menu && roll.current ? roll.current.model().notes[menu.i] : null;

  // Moving the window from the bar. In FRACTIONS of the grid, so a drag means the same
  // thing at any zoom, and clamped to the paper by the same rule a pan obeys — the bar
  // cannot ask for a window the grid does not have.
  const scrollPitchTo = (off) => {
    const r = roll.current; if (!r || !pitchBar) return;
    const e = r.extent(), span = e.stepMax - e.stepMin, win = span * pitchBar.frac;
    const min = Math.max(e.stepMin, Math.min(e.stepMax - win, e.stepMin + off * span));
    pitchWin.current = { c: min + win / 2, span: win };
    r.setPitchView({ min, max: min + win }).resize();
    setPitchSpan(Math.round(win));
    syncBar();
  };
  // A press on the THUMB drags it; a press on the track jumps the window there, centred,
  // which is what a scrollbar does when you click beside its thumb.
  const barPress = (e) => {
    const track = e.currentTarget, box = track.getBoundingClientRect();
    if (!pitchBar || box.width <= 0) return;
    const onThumb = e.target !== track;
    const grabAt = onThumb ? (e.clientX - box.left) / box.width - pitchBar.off : pitchBar.frac / 2;
    if (!onThumb) scrollPitchTo((e.clientX - box.left) / box.width - pitchBar.frac / 2);
    try { track.setPointerCapture(e.pointerId); } catch (_) { /* the drag still works */ }
    const move = (ev) => scrollPitchTo((ev.clientX - box.left) / box.width - grabAt);
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  // The seconds ruler costs a margin, and a margin is a different price on every screen.
  //
  // 46px out of a desktop pane is nothing; out of a phone in portrait it is a seventh of
  // the grid, taken from the axis the notes are drawn along. So the ruler is a WIDE-screen
  // control: below the cutoff the roll keeps its width and the piece's length is read from
  // the head bar, which costs nothing at any size and is the number most often wanted.
  //
  // Decided HERE because this is where the width is known — the pane already watches its
  // own box, and the app has no idea how wide the roll ended up after a splitter drag.
  // Where Sa is, in absolute MIDI, when the reader has pinned it. The roll colours its
  // pitch chips by which piano key each shruti is nearest, and that question has no answer
  // without a Sa — so pinning Sa to another note has to re-colour them. Null means auto,
  // and the roll falls back to the piece's own Sa exactly as it did before.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    r.setView({ saMidi }).render();
  }, [saMidi, model]);

  const RULER_MIN_W = 560;
  useEffect(() => {
    const r = roll.current; if (!r) return;
    const wide = (r.size().w || 0) >= RULER_MIN_W;
    // The tempo is ALWAYS told; only the ruler depends on there being room for it. These were
    // one field, so a narrow pane said "no idea how fast this is" — and the note flash, which
    // times itself in seconds, fell back to a fixed number of length-units. On a phone that is
    // every pane, and at a fast tempo the flash lasted two frames.
    r.setView({ secPerUnit, ruler: wide }).resize();
  }, [secPerUnit, model, paneW]);

  return html`<div class="pane roll" style=${style}>
    ${tools}
    <div class="roll-body">
    <!-- What is sung, beside the notes it is sung on. Inside the roll pane rather than
         beside it, so it travels with the roll when the panes are swapped: it is a column
         of the roll's own time axis, and a piece of furniture that could drift away from
         that axis would be worse than none. -->
    ${lanes !== 'off' && html`<${LanesRail} model=${model} rollRef=${roll} holderRef=${holder} side=${lanes} order=${lanesOrder} headRef=${lanesHeadRef}
      onSide=${onLanesSide} onOrder=${onLanesOrder} onHide=${onLanesHide} />`}
    <div class="roll-holder" ref=${holder}><div ref=${content}>
      <canvas ref=${canvas}></canvas>
      <!-- The margin strip: hit-testable, and it forbids panning. touch-action is read
           when the finger LANDS, so an A-B sweep has to start somewhere the browser was
           never going to scroll — setting it on the canvas once the press has arrived is
           already too late. Presses on it bubble to this div, which is where the roll's
           gestures listen. -->
      <div class="roll-gutter" ref=${gutter}></div>
    </div></div>
    ${chrome && html`<input class="roll-zt" type="range" orient="vertical" min="1" max="8" step="0.1"
      value=${zoom} title="Zoom time — the moment at the centre stays there"
      aria-label="Zoom time" onInput=${(e) => zoomTime(parseFloat(e.target.value))} />`}
    </div>
    <!-- The pitch scrollbar. Shown only while there is something off-screen to reach,
         which is the same rule the browser follows for the time axis beside it: a bar
         describing a window that already holds everything is furniture, not information.
         The thumb IS the visible window — its width says how much of the range you are
         looking at, which nothing else on this page says. -->
    ${chrome && pitchBar && html`<div class="roll-hs" onPointerDown=${barPress}
      title="Drag to move along the pitch axis">
      <div class="roll-hs-thumb" style=${`left:${(pitchBar.off * 100).toFixed(2)}%;`
        + `width:${Math.max(6, pitchBar.frac * 100).toFixed(2)}%`}></div>
    </div>`}
    <!-- The pitch slider runs from the piece's own range (left, where the axis is the
         grid's again) to nine steps (right, a couple of swaras filling the screen). The
         value IS the span, reversed by direction so that right means closer. -->
    ${chrome && html`<input class="roll-zp" type="range" min="9" max=${Math.max(10, Math.round(naturalPitch.current.span))} step="1"
      value=${pitchSpan} title="Zoom pitch — the pitch at the centre stays there"
      aria-label="Zoom pitch" onInput=${(e) => zoomPitch(parseFloat(e.target.value))} />`}
    <!-- Clamped to the window, because a menu opened near the right or bottom edge would
         otherwise hang off the screen with its items unreachable — the same clamp the
         Open menu needed for the same reason. -->
    ${menu && html`<div class="roll-ctx" role="menu"
      style=${`left:${Math.min(menu.x, (typeof innerWidth === 'number' ? innerWidth : 1000) - 170)}px;`
        + `top:${Math.min(menu.y, (typeof innerHeight === 'number' ? innerHeight : 800) - 90)}px`}>
      <button role="menuitem" class="ctx-copy" disabled=${!(menuNote && menuNote.curve)}
        onClick=${() => { onCopyGamakaAt && onCopyGamakaAt(menu.i); setMenu(null); }}>Copy gamaka</button>
      <button role="menuitem" class="ctx-paste" disabled=${!canPasteGamaka}
        onClick=${() => { onPasteGamakaAt && onPasteGamakaAt(menu.i); setMenu(null); }}>Paste gamaka</button>
    </div>`}
  </div>`;
}
