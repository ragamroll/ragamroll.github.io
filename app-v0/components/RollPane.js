import { html } from '../vendor/htm-preact.js';
import { useRef, useEffect } from '../vendor/hooks.module.js';
import { createRagamRoll } from '../core/ragamroll.js';
import { buildRollModel } from '../core/roll-model.js';
import { createRollEdit } from '../core/roll-edit.js';
import { createCurveEdit } from '../core/curve-edit.js';
import { createGamakaEdit } from '../core/gamaka-edit.js';
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

export function RollPane({ model, api, style, onIntent, allow, sel, tools, zoom = 1, paint,
  mode = 'roll', curveIndex = -1, onCurveIntent, snapping, onCurvePitch, drawSpan = 22,
  markerA = 0, markerB = 0, gamaka, onGamakaIntent }) {
  const holder = useRef(null), content = useRef(null), canvas = useRef(null);
  const roll = useRef(null);
  // The gesture layer reads these through refs, not through its closure: it is mounted
  // once alongside the roll, while the host's handler is a new function on every render.
  const intentRef = useRef(onIntent), allowRef = useRef(allow), paintRef = useRef(paint);
  intentRef.current = onIntent; allowRef.current = allow; paintRef.current = paint;
  const modeRef = useRef(mode), curveRef = useRef(onCurveIntent), snapRef = useRef(snapping), idxRef = useRef(curveIndex);
  modeRef.current = mode; curveRef.current = onCurveIntent; snapRef.current = snapping; idxRef.current = curveIndex;
  const pitchRef = useRef(onCurvePitch); pitchRef.current = onCurvePitch;
  const marksRef = useRef({ a: markerA, b: markerB }); marksRef.current = { a: markerA, b: markerB };
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
    let ed, ced;
    ed = createRollEdit(canvas.current, {
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
      enabled: () => !!intentRef.current && modeRef.current === 'roll' && !gamaRef.current,
      allow: (kind) => (allowRef.current ? allowRef.current.includes(kind) : true),
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

    const ro = new ResizeObserver(() => r.resize());
    ro.observe(hd);
    r.resize();
    return () => { hd.removeEventListener('scroll', onScroll); ed.destroy(); ced.destroy(); ged.destroy(); ro.disconnect(); roll.current = null; if (api && api.current === r) api.current = null; };
  }, []);

  useEffect(() => {
    const r = roll.current; if (!r || !model) return;
    try { r.setModel(buildRollModel(model)); } catch { return; }   // a half-typed piece: keep the last good roll
    r.setPlayhead(null).resize();
  }, [model]);

  // Zoom stretches the time axis, so the scroll offset means a different moment
  // afterwards. What is preserved is the TIME at the top of the viewport, not the
  // pixel — keeping the pixel is what makes a zoom feel like the piece jumped. Read
  // before the rescale, written after it.
  useEffect(() => {
    const r = roll.current; if (!r) return;
    const hd = holder.current;
    const pad = r.pad ? r.pad.t : 0;
    const was = r.pxPerUnit() > 0 ? (hd.scrollTop - pad) / r.pxPerUnit() : 0;
    r.setView({ zoom }).resize();
    const u = r.pxPerUnit();
    if (u > 0) hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight), pad + was * u));
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
    r.setView({ mode, drawSpan });   // `sel` belongs to the effect below, which owns both meanings
    r.resize();
  }, [mode, curveIndex, drawSpan]);

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

  return html`<div class="pane roll" style=${style}>
    ${tools}
    <div class="roll-holder" ref=${holder}><div ref=${content}><canvas ref=${canvas}></canvas></div></div>
  </div>`;
}
