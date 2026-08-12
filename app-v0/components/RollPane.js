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
  markerA = 0, markerB = 0, gamaka, onGamakaIntent }) {
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
  // The pitch window as the READER set it — centre and span, in floats — kept apart from
  // what the roll draws, which is rounded to whole steps. Rounding is for drawing; a
  // control that reads its own rounded output back accumulates the error.
  const pitchWin = useRef(null);          // { c, span } | null — null = the grid's own bounds
  const naturalPitch = useRef({ c: 0, span: 1 });   // what the grid gives this piece
  const returnTo = useRef(null);          // the moment to come back to when the editor closes
  const gamaRef = useRef(gamaka), gamaIntentRef = useRef(onGamakaIntent);
  gamaRef.current = gamaka; gamaIntentRef.current = onGamakaIntent;

  useEffect(() => {
    const hd = holder.current;
    const r = createRagamRoll({ holder: hd, content: content.current, canvas: canvas.current }, {
      // Read from the page, not baked in. A canvas inherits nothing, so a hardcoded
      // palette silently stops matching the CSS around it — and a light theme could
      // never reach it at all. Same variables draw reads, so the two rolls are the same
      // roll to look at.
      palette: () => ({ amber: cssvar('--amber'), amberS: cssvar('--amberSoft'), teal: cssvar('--teal'),
        terra: cssvar('--terra'), hair: cssvar('--hair2'), muted: cssvar('--muted'),
        panel2: cssvar('--panel2'), mono: cssvar('--mono'), bg: cssvar('--bg'), sans: cssvar('--sans') }),
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
    });

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
      setPitchView: (v) => {
        // A pan moves the centre and keeps the span; carried in floats for the same
        // reason the zoom carries it.
        pitchWin.current = { c: (v.min + v.max) / 2, span: v.max - v.min };
        r.setPitchView(v); setPitchSpan(Math.round(v.max - v.min));
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
    const ro = new ResizeObserver(() => { r.resize(); fitGutter(); });
    ro.observe(hd);
    r.resize(); fitGutter();
    return () => { hd.removeEventListener('scroll', onScroll); canvas.current && canvas.current.removeEventListener('pointermove', onHover);
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
      return;
    }
    const c = pitchWin.current ? pitchWin.current.c : nat.c;
    pitchWin.current = { c, span };
    r.setPitchView({ min: c - span / 2, max: c + span / 2 }).resize();
    setPitchSpan(Math.round(span));
  };

  return html`<div class="pane roll" style=${style}>
    ${tools}
    <div class="roll-body">
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
    <!-- The pitch slider runs from the piece's own range (left, where the axis is the
         grid's again) to nine steps (right, a couple of swaras filling the screen). The
         value IS the span, reversed by direction so that right means closer. -->
    ${chrome && html`<input class="roll-zp" type="range" min="9" max=${Math.max(10, Math.round(naturalPitch.current.span))} step="1"
      value=${pitchSpan} title="Zoom pitch — the pitch at the centre stays there"
      aria-label="Zoom pitch" onInput=${(e) => zoomPitch(parseFloat(e.target.value))} />`}
  </div>`;
}
