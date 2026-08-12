import { h, render } from './vendor/preact.module.js';
import { useState, useEffect, useMemo, useCallback, useRef } from './vendor/hooks.module.js';
import { html } from './vendor/htm-preact.js';
import { TALA_MAP } from './core/parser.js';
import { setRagas, getRagas } from './core/raga-base.js';
import { setRagaExt } from './core/raga-ext.js';
import { Editor } from './components/Editor.js';
import { RollPane } from './components/RollPane.js';
import { RollTools } from './components/RollTools.js';
import { applyEdit, applyMove, paintEdit, placePaint } from './core/note-edit.js';
import { createSeamHost } from './core/roll-seam.js';
import { stepFreq } from './core/shruti.js';
import { sampleCurve, GAMAKA_SAMPLES } from './core/gamaka-inline.js';
import { buildRagaSteps } from './core/detect-raga-helper.js';
import { Toolbar } from './components/Toolbar.js';
import { Diagnostics } from './components/Diagnostics.js';
import { RagaDialog } from './components/RagaDialog.js';
import { TalaDialog } from './components/TalaDialog.js';
import { ScaleDialog } from './components/ScaleDialog.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';
import { createPlayer } from './audio/player.js';
import { scheduleEvents, totalSeconds, midiToFreq } from './audio/schedule.js';
import { droneFreqs } from './audio/drone.js';
import { melaOfScale } from './core/melakarta.js';
import { saBaseOf, applyPlaybackPitch } from './core/retune.js';
import { shareUrl, readSharedSource, sourceFromShareInput } from './core/share.js';
import { Transport } from './components/Transport.js';
import { Splitter } from './components/Splitter.js';
import { Footer } from './components/Footer.js';

// Example pieces are data-driven: the list comes from examples/index.json
// (regenerated from the folder by tools/gen-examples.sh), so adding a piece
// needs no code edit. EXAMPLES_BASE is where both the manifest and the .srgm
// files are fetched from — point it at a CORS-enabled CDN to decouple later.
const EXAMPLES_BASE = './examples';
const EXAMPLES_FALLBACK = ['swaravali', 'hamsa', 'vathapi', 'varavina'];
const LS_KEY = 'ragamroll.srgm';
const LS_NAME = 'ragamroll.docname';
const DEFAULT_NAME = 'ragamroll';

// Derive a document base-name (no extension) from an opened file / example name.
function baseName(name) {
  const stripped = String(name || '').replace(/\.[^./\\]+$/, '').trim();
  return stripped || DEFAULT_NAME;
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function App({ examples }) {
  const [text, setText] = useState(() => localStorage.getItem(LS_KEY) || '');
  const [docName, setDocName] = useState(() => localStorage.getItem(LS_NAME) || DEFAULT_NAME);
  const debounced = useDebounced(text, 150);

  useEffect(() => { localStorage.setItem(LS_KEY, text); }, [text]);
  useEffect(() => { localStorage.setItem(LS_NAME, docName); }, [docName]);

  // Parse + the heavy ascii renderers run in a web worker, so a large or
  // malformed composition can never block the UI thread. The worker returns the
  // parsed model (used by the playback / export path on the main thread) plus
  // the notation string. Stale replies are dropped by request id.
  const [compiled, setCompiled] = useState({
    model: { events: [], seqProps: {}, meta: {}, diagnostics: [] }, notation: '',
  });
  const workerRef = useRef(null);
  const reqRef = useRef(0);
  useEffect(() => {
    const w = new Worker('./worker.js', { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.id === reqRef.current) setCompiled({ model: e.data.model, notation: e.data.notation });
    };
    workerRef.current = w;
    return () => w.terminate();
  }, []);
  useEffect(() => {
    reqRef.current += 1;
    workerRef.current?.postMessage({ id: reqRef.current, text: debounced });
  }, [debounced]);
  const model = compiled.model;
  // Tempo override (null = the composition's T directive, else 120). Applied by
  // cloning the model with meta.tempo replaced, so audio (buildSequence) and the
  // playhead both use it and stay in sync.
  const compositionTempo = useMemo(() => (model.meta?.tempo > 0 ? model.meta.tempo : 120), [model]);
  const [tempoOverride, setTempoOverride] = useState(null);
  const onTempo = useCallback((v) => { if (v >= 20 && v <= 400) setTempoOverride(v); }, []);
  const onResetTempo = useCallback(() => setTempoOverride(null), []);
  const effModel = useMemo(
    () => (tempoOverride ? { ...model, meta: { ...model.meta, tempo: tempoOverride } } : model),
    [model, tempoOverride]);

  const raga = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key.join(',') : ''; }, [model]);
  const ragaName = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key[0] : ''; }, [model]);
  const tala = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'tala'); return e ? `beat ${e.props.beat}` : ''; }, [model]);

  // Opening a file / picking an example remembers its name, so Save and Export
  // suggest the same base name instead of a fixed "ragamroll".
  // Examples dropdown is controlled so Open (or any load) can reset it to the placeholder.
  const [exampleValue, setExampleValue] = useState('');
  // Loading a new composition while playing would leave the old audio playing over
  // the new (misleading) panes — so stop playback on any content swap. onStop is
  // defined later; reach it through a ref that's kept current below.
  const stopRef = useRef(() => {});
  const onOpen = useCallback(async (file) => { stopRef.current(); setExampleValue(''); setDocName(baseName(file.name)); setText(await file.text()); }, []);
  const onSave = useCallback(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = docName + '.srgm'; a.click();
    URL.revokeObjectURL(a.href);
  }, [text, docName]);
  const onExportMidi = useCallback(() => {
    const bytes = writeSMF(buildSequence(model));
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = docName + '.mid';
    a.click();
    URL.revokeObjectURL(a.href);
  }, [model, docName]);
  const onExample = useCallback(async (name) => {
    if (!name) { setExampleValue(''); return; }
    stopRef.current();
    const r = await fetch(`${EXAMPLES_BASE}/${name}.srgm`); setExampleValue(name); setDocName(baseName(name)); setText(await r.text());
  }, []);
  // Share: copy a self-contained "#pako:" link (the source, zlib-deflated) to the
  // clipboard; the button flashes "Copied". Falls back to a prompt if the
  // clipboard is blocked (e.g. non-secure context).
  const [shared, setShared] = useState(false);
  const onShare = useCallback(async () => {
    const url = await shareUrl(text);
    try {
      await navigator.clipboard.writeText(url);
      setShared(true); setTimeout(() => setShared(false), 1500);
    } catch { try { window.prompt('Copy this share link:', url); } catch { /* ignore */ } }
  }, [text]);
  // Open a pasted share link (from this or any other host). Returns true on
  // success so the menu can close / show an error.
  const onOpenLink = useCallback(async (input) => {
    try {
      const src = await sourceFromShareInput(input);
      stopRef.current(); setExampleValue(''); setDocName('shared'); setText(src);
      return true;
    } catch { return false; }
  }, []);
  // Opening a "#pako:" link loads the shared source into the editor, then clears
  // the hash so later edits (persisted to localStorage) aren't overridden on reload.
  useEffect(() => {
    let cancelled = false;
    readSharedSource().then((src) => {
      if (cancelled || src == null) return;
      stopRef.current(); setExampleValue(''); setDocName('shared'); setText(src);
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, []);

  // --- Playback: player instance, scroll refs, rAF loop, transport handlers ---
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createPlayer('tone');
  const rollApiRef = useRef(null);   // the roll instance, driven imperatively (see RollPane)

  // Editing the roll. The gesture layer says what a drag MEANS; this decides what it
  // costs — which here is a new notation string, because the notation is the source of
  // truth and everything else in this app is derived from it. So a commit ends at
  // setText and the worker re-parses, exactly as if the string had been typed.
  //
  // The preview does NOT go through state: it mutates the roll's own model and redraws.
  // A drag that re-parsed on every pointermove would run the worker sixty times a
  // second and lag a whole round trip behind the pointer.
  //
  // A host that ignores an intent still gets the gesture, so the pane is told what is
  // handled; anything not listed stays genuinely inert rather than starting a drag that
  // can only be cancelled.
  const ROLL_EDITS = ['move', 'boundary', 'split', 'resize', 'select', 'paint', 'open', 'range'];
  // The curve editor: the roll zooms onto ONE note and a drag shapes its gamaka.
  // `curveIdx` is an INDEX because that is what the renderer's one-note layout compares
  // against; it is re-found by token whenever the piece is re-parsed.
  const [curveIdx, setCurveIdx] = useState(-1);
  const [curveTok, setCurveTok] = useState(-1);
  const [curveSnap, setCurveSnap] = useState(true);
  // A–B: play a stretch instead of the whole piece. In LENGTH-UNITS, like everything on
  // the roll; the audio side takes seconds, and 30/tempo is where the two meet.
  const [markA, setMarkA] = useState(0);
  const [markB, setMarkB] = useState(0);            // 0,0 = no segment: play it all
  const hasSeg = markB > markA;
  const [curveHz, setCurveHz] = useState('');       // the pitch under the pointer, while shaping
  const [curveSpan, setCurveSpan] = useState(22);   // how much of the pitch axis the editor shows
  const [curveClip, setCurveClip] = useState(null);   // copied curve, RELATIVE to its note
  const rollMode = curveIdx >= 0 ? 'draw' : 'roll';
  // "+ note": while it is armed a press PLACES something rather than grabbing what is
  // already there, so the two gestures are mutually exclusive by construction.
  const [rollPaint, setRollPaint] = useState(false);
  // ✎ : shape a gamaka in place, without opening the one-note editor. Mutually exclusive
  // with painting — both take a press on a note and mean different things by it.
  const [rollGamaka, setRollGamaka] = useState(false);

  const [rollSel, setRollSel] = useState(null);   // { type:'note'|'rest', tok } | null
  // The roll draws one cell per note of typical length; zoom stretches time on top of
  // that, for shaping a long note or reading a crowded phrase. Same range and step draw
  // uses, and the halves are rounded off or 0.5 steps accumulate a float tail.
  const [rollZoom, setRollZoom] = useState(1);
  const onRollZoom = useCallback((d) => setRollZoom((z) =>
    Math.min(8, Math.max(1, Math.round((z + d) * 10) / 10))), []);
  // A selection is a token, and tokens do not survive a piece being retyped or reopened.
  // Kept while it still points at something — so it lives through the app's own edits —
  // and dropped the moment it does not, because Delete acting on a stale token would
  // remove something other than what is drawn as selected.
  useEffect(() => {
    if (!rollSel) return;
    const r = rollApiRef.current; if (!r) return;
    const m = r.model();
    const alive = rollSel.type === 'rest'
      ? m.rests.some((x) => x.tok === rollSel.tok)
      : m.notes.some((x) => x.tok === rollSel.tok);
    if (!alive) setRollSel(null);
  }, [effModel, rollSel]);

  // The latest text and raga, for handlers that are mounted once and must not close
  // over a stale render. The seam host below lives for the life of the pane.
  const textRef = useRef(text); textRef.current = text;
  const ragaRef = useRef(ragaName); ragaRef.current = ragaName;
  const ctxOf = () => {
    const { ragaSteps, ragaSwaraName } = buildRagaSteps(ragaRef.current || '');
    return { useRaga: !!(ragaRef.current && ragaSteps), ragaSteps, ragaSwaraName };
  };
  // Commit: re-serialise against the CURRENT text and hand it back as if typed.
  // Undo for roll edits, which the textarea's own history cannot cover: a drag changes
  // the notation programmatically, and the browser only tracks what was typed into the
  // box. Each committed edit records the notation BEFORE it and the notation it
  // produced.
  //
  // The `after` is what makes this safe. An entry is only usable while the notation is
  // still exactly what that edit produced — type in the editor and the roll's history
  // no longer describes the file, so it is discarded rather than used to overwrite what
  // was typed. Undo is for the last thing done to the roll, not a way to lose a
  // paragraph.
  const [undoStack, setUndoStack] = useState([]);   // [{ before, after }], newest last
  const commitRoll = useCallback((spec) => {
    const r = rollApiRef.current; if (!r) return Promise.resolve();
    const rm = r.model();
    const byTok = new Map(rm.notes.map((x) => [x.tok, { step: x.step, dur: x.dur, octave: x.octave, curve: x.curve }]));
    const before = textRef.current;
    const after = applyEdit(before, { ...spec, model: byTok, ctx: ctxOf() });
    if (after === before) return Promise.resolve();          // nothing moved: nothing to undo
    setUndoStack((st) => [...st, { before, after }].slice(-50));
    setText(after);
    return Promise.resolve();
  }, []);
  const canUndo = undoStack.length > 0 && undoStack[undoStack.length - 1].after === text;
  const onRollUndo = useCallback(() => {
    setUndoStack((st) => {
      const top = st[st.length - 1];
      if (!top) return st;
      if (top.after !== textRef.current) return [];          // the file moved on: history is stale
      setText(top.before);
      return st.slice(0, -1);
    });
  }, []);
  // The boundary drags — seam, absorb, shift-push — are core/roll-seam.js's, the same
  // module draw uses. Created once: a drag is a conversation and it holds the contour
  // captured when the pointer went down.
  const seamRef = useRef(null);
  if (!seamRef.current) {
    seamRef.current = createSeamHost({
      model: () => { const r = rollApiRef.current; const m = r ? r.model() : null;
        return m ? { notes: m.notes, starts: m.starts, rests: m.rests } : { notes: [], starts: [], rests: [] }; },
      beat: () => { const r = rollApiRef.current; const m = r && r.model(); return m && m.tala ? m.tala.beat : 0; },
      // Undo is recorded in commitRoll, where BOTH the notation before the edit and the
      // one it produced are in hand; a marker on its own could not tell a stale history
      // from a live one.
      pushUndo: () => {},
      commit: (spec) => commitRoll(spec),
      render: () => { const r = rollApiRef.current; if (r) r.render(); },
    });
  }
  // Deleting drops the token outright, so the piece gets SHORTER and everything after
  // moves earlier — unlike an edge drag, which trades the time with a neighbour.
  // deriveOctave because a dropped token takes its octave marks with it, and the running
  // register every later verbatim note reads has to be re-stated.
  // A–B is swept in the MARGIN, the way pitchy's gutter works: press and drag to set a
  // range, grab a tab to nudge one end. Selecting a note to mark it was a workaround for
  // not having a gesture, and it could only ever land on note boundaries.
  const onRange = useCallback((it) => { setMarkA(it.a); setMarkB(it.b); }, []);

  const onRollDelete = useCallback(() => {
    if (!rollSel) return;
    commitRoll({ deletes: new Set([rollSel.tok]), deriveOctave: true });
    setRollSel(null);
  }, [rollSel, commitRoll]);

  // Ctrl/Cmd-Z, but NEVER while the srgm box has focus — there it belongs to the text
  // the user is typing, and the browser's own history is the right thing to fire.
  useEffect(() => {
    const onKey = (e) => {
      if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z'))) return;
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
      e.preventDefault();
      onRollUndo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onRollUndo]);

  // The note being shaped is followed by TOKEN across re-parses: every commit rebuilds
  // the model, and an index would quietly come to mean a different note.
  useEffect(() => {
    if (curveTok < 0) return;
    const r = rollApiRef.current; if (!r) return;
    const i = r.model().notes.findIndex((n) => n.tok === curveTok);
    if (i !== curveIdx) setCurveIdx(i);          // -1 if it is gone: that closes the editor
    if (i < 0) setCurveTok(-1);
  }, [effModel, curveTok, curveIdx]);

  const curveNote = () => {
    const r = rollApiRef.current; const m = r && r.model();
    return m && curveIdx >= 0 ? m.notes[curveIdx] : null;
  };
  // Hear what was just shaped. draw plays the note after every curve edit, and a gamaka
  // is a thing you judge by ear — reading anchors tells you almost nothing. previewNote
  // is the contract's audition: it sounds one note and cannot disturb the transport, so
  // this works mid-playback too.
  const auditionCurve = useCallback(() => {
    const p = playerRef.current, r = rollApiRef.current;
    const n = curveNote(); if (!p || !r || !n) return;
    const m = r.model();
    const saF = midiToFreq(m.saRef);
    const secPerUnit = 30 / (m.tempo > 0 ? m.tempo : 120);
    let gamaka;
    if (n.curve && n.curve.length >= 2) {
      gamaka = new Float32Array(GAMAKA_SAMPLES);
      for (let k = 0; k < GAMAKA_SAMPLES; k++) gamaka[k] = stepFreq(saF, sampleCurve(n.curve, k / (GAMAKA_SAMPLES - 1)));
    }
    p.previewNote({ freq: stepFreq(saF, n.step), durSec: Math.min(3, n.dur * secPerUnit), gamaka });
  }, [curveIdx]);
  const commitCurve = useCallback(() => {
    const n = curveNote(); if (!n) return;
    commitRoll({ changed: new Set([n.tok]) });
    auditionCurve();
  }, [commitRoll, curveIdx, auditionCurve]);
  // The pitch under the pointer, in Hz. A gamaka is written in 53-EDO steps, which say
  // nothing to the ear; the frequency is the part a musician can check against an
  // instrument.
  const onCurvePitch = useCallback((st) => {
    const r = rollApiRef.current;
    if (st == null || !r) { setCurveHz(''); return; }
    setCurveHz('≈' + stepFreq(midiToFreq(r.model().saRef), st).toFixed(0) + ' Hz');
  }, []);
  // Declared HERE, not beside the ✎ toggle it belongs to: it closes over commitRoll,
  // and a useCallback above that definition reads it in the temporal dead zone and
  // takes the whole app down before it renders.
  const onGamakaIntent = useCallback((it) => {
    if (it.phase !== 'commit') return;
    const r = rollApiRef.current; if (!r) return;
    // Which note changed is not in the intent; the gesture writes straight into the
    // model, so every note is re-serialised. deriveOctave stays off — nothing moved in
    // pitch class, only the ornament riding on it.
    commitRoll({ changed: new Set(r.model().notes.map((n) => n.tok)) });
  }, [commitRoll]);

  const onCurveIntent = useCallback((it) => {
    // 'begin' says a press became a real edit. Undo is recorded at commit, where both
    // versions of the notation are in hand, so there is nothing to do until then.
    if (it.phase === 'commit') commitCurve();
  }, [commitCurve]);
  const onCurveClear = useCallback(() => { const n = curveNote(); if (!n) return; n.curve = null; commitCurve(); }, [commitCurve, curveIdx]);
  const onCurveCopy = useCallback(() => { const n = curveNote(); if (!n || !n.curve) return;
    // Stored RELATIVE to its note's step, so pasting re-anchors it onto the target's
    // pitch instead of carrying the source note's absolute one.
    setCurveClip(n.curve.map(([u, st]) => [u, st - n.step])); }, [curveIdx]);
  const onCurvePaste = useCallback(() => { const n = curveNote(); if (!n || !curveClip) return;
    n.curve = curveClip.map(([u, d]) => [u, n.step + d]); commitCurve(); }, [curveClip, commitCurve, curveIdx]);

  const intentLog = useRef([]);       // headless guards read this; nothing else does
  const onRollIntent = useCallback((it) => {
    const r = rollApiRef.current; if (!r) return;
    intentLog.current.push({ ...it }); if (intentLog.current.length > 200) intentLog.current.shift();
    if (it.kind === 'open') { setCurveIdx(it.index); setCurveTok(it.tok); setRollSel(null); return; }
    if (it.kind === 'range') { onRange(it); return; }
    if (it.kind === 'select') { setRollSel(it.target ? { ...it.target } : null); return; }
    if (it.kind === 'paint') {
      const rm = r.model();
      const place = placePaint({ ts: it.ts, dur: it.dur, notes: rm.notes, starts: rm.starts,
        durs: rm.notes.map((n) => n.dur), total: r.bounds().total });
      const byTok = new Map(rm.notes.map((x) => [x.tok, { step: x.step, dur: x.dur, octave: x.octave, curve: x.curve }]));
      const spec = paintEdit({ place, ts: it.ts, dur: it.dur, step: it.step, rest: it.rest,
        model: byTok, notes: rm.notes, starts: rm.starts, contentEnd: rm.contentEnd, ctx: ctxOf() });
      // An empty piece has no token to anchor against, so the notation is appended to
      // rather than edited. Recorded for undo the same way, since it is still an edit.
      if (spec.seed) {
        const before = textRef.current;
        const after = before.replace(/\s*$/, '') + '\n' + spec.seed + '\n';
        setUndoStack((st) => [...st, { before, after }].slice(-50));
        setText(after);
        return;
      }
      // paintEdit already mutated the host note's duration in `byTok` for a split, so
      // this commit has to serialise THAT map rather than build a fresh one.
      const beforeSrc = textRef.current;
      const afterSrc = applyEdit(beforeSrc, { ...spec, model: byTok, ctx: ctxOf() });
      if (afterSrc !== beforeSrc) {
        setUndoStack((st) => [...st, { before: beforeSrc, after: afterSrc }].slice(-50));
        setText(afterSrc);
      }
      return;
    }
    // boundary / split / rest-resize are all core/roll-seam.js's — the same module draw
    // mounts. Only 'move' is the app's own, because it is the one that re-spells a note.
    if (it.kind === 'boundary' || it.kind === 'split' || it.kind === 'resize') {
      seamRef.current.handle(it); return;
    }
    if (it.kind !== 'move') return;
    const rm = r.model(); const n = rm.notes.find((x) => x.tok === it.tok);
    if (!n) return;
    if (it.phase !== 'commit') { n.step = it.step; r.render(); return; }
    const { deriveOctave } = applyMove(n, it.from, ctxOf());
    commitRoll({ changed: new Set([it.tok]), deriveOctave });
  }, [commitRoll]);
  const playheadRef = useRef(null);
  const rafRef = useRef(0);
  // Snapshots taken when a sequence is LOADED (Play from stopped): the seconds and
  // the tempo of what is actually playing. Editing mid-play rebuilds the model, but
  // the audio keeps playing the loaded sequence — these keep the playhead in sync
  // with the sound rather than with the edit.
  const loadedTotalRef = useRef(0);
  const loadedOffsetRef = useRef(0);   // where the loaded segment starts, in length-units
  const loadedTempoRef = useRef(120);   // tempo of the LOADED audio: the playhead follows what is playing, not a mid-playback edit
  const [playState, setPlayState] = useState('stopped');
  // Playback-only: drops tala events from the player schedule on the next
  // Play-from-stopped. Does not affect MIDI export, rendering, or timeline
  // length (totalSeconds is melody-cursor-based).
  // Master output level 0..1 (live) — scales melody + tala + drone together.
  const [masterVol, setMasterVol] = useState(1);
  const onMasterVol = useCallback((v) => setMasterVol(v), []);

  // Tala volume 0..1 (live, own synth) plus a mute toggle that keeps the set
  // level so the user need not slide back to zero and up again. Dragging the
  // slider also unmutes (intent to hear). Effective level = muted ? 0 : vol.
  const [talaVol, setTalaVol] = useState(0.5);
  const [talaMuted, setTalaMuted] = useState(false);
  const onTalaVol = useCallback((v) => { setTalaVol(v); setTalaMuted(false); }, []);
  const onToggleTala = useCallback(() => setTalaMuted((m) => !m), []);
  const talaLevel = talaMuted ? 0 : talaVol;

  // Melody mute — solo tala + drone to dial their levels. Live during playback.
  const [melodyMuted, setMelodyMuted] = useState(false);
  const onToggleMelody = useCallback(() => setMelodyMuted((m) => !m), []);

  // Experimental 53-EDO scale override (null = ragabase 12-TET) and a constant
  // Sa/Pa drone. Drone has a set level + a mute toggle (default off but level
  // preset), so one click turns it on at the chosen volume. Playback-only.
  const [scale, setScale] = useState(null);
  const onApplyScale = useCallback((s) => setScale(s), []);
  const [droneVol, setDroneVol] = useState(0.5);
  const [droneMuted, setDroneMuted] = useState(false);   // drone accompanies playback by default
  const onDroneVol = useCallback((v) => { setDroneVol(v); setDroneMuted(false); }, []);
  const onToggleDrone = useCallback(() => setDroneMuted((m) => !m), []);
  const droneLevel = droneMuted ? 0 : droneVol;
  // Melody instrument voice (applies on the next Play — the synth is rebuilt at load).
  const [timbre, setTimbre] = useState('soft-am');
  const onTimbre = useCallback((t) => setTimbre(t), []);
  const saBase = useMemo(() => saBaseOf(model, getRagas()), [model]);
  // When a scale override is active, the toolbar shows IT (the mela) instead of
  // the composition's raga — the pitches you actually hear.
  const scaleLabel = useMemo(() => {
    if (!scale) return null;
    const m = melaOfScale(getRagas(), scale);
    return m ? `${m.n} · ${m.name}` : 'custom';
  }, [scale]);
  // Sa reference pitch: null = auto (the raga's natural Sa, MIDI 60+saBase, so
  // playback is unshifted and goldens/MIDI stay exact); a MIDI number pins Sa to
  // an absolute 12-EDO note and transposes all audio (melody+drone+retune) to it.
  const autoSaMidi = 60 + saBase;
  const [saPitch, setSaPitch] = useState(null);
  const onSetSa = useCallback((m) => setSaPitch(m), []);
  const saMidi = saPitch != null ? saPitch : autoSaMidi;
  const shift = saPitch != null ? saPitch - autoSaMidi : 0;

  const noteCount = useMemo(() => model.events.filter(e => e.type === 'note' && !e.rest).length, [model]);

  const applyScroll = useCallback(() => {
    const pos = playerRef.current.position();
    // The roll draws the playhead; this decides where it is. Transport seconds minus
    // output latency is the AUDIBLE instant, and the roll's axis is length-units, so
    // the two meet at 30/tempo — the same seconds-per-unit buildRowTimes uses for the
    // audio, which is what keeps the line on the note you are hearing.
    const r = rollApiRef.current;
    if (r) {
      const t = pos * loadedTotalRef.current - playerRef.current.latency();
      // position() is 0..1 of the SEGMENT, so the playhead has to be put back where the
      // segment actually starts — otherwise a range plays correctly and draws at the
      // top of the piece.
      const units = loadedOffsetRef.current + Math.max(0, t) / (30 / (loadedTempoRef.current || 120));
      playheadRef.current = units;
      r.setPlayhead(units).render();
      const hd = r.canvas.parentElement.parentElement;
      hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
        r.yVirt(units) - hd.clientHeight * 0.4));
    }
    return pos;
  }, []);

  // Idempotent: may fire from both the rAF pos>=1 guard and the backend's
  // onended callback for the same end — cancel/stop/reset are all safe twice.
  const onStop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.stop();
    setPlayState('stopped');
    playheadRef.current = null;
    rollApiRef.current?.setPlayhead(null).render();
    const hd = rollApiRef.current && rollApiRef.current.canvas.parentElement.parentElement;
    if (hd) hd.scrollTop = 0;
  }, []);
  stopRef.current = onStop;   // let onOpen/onExample (defined earlier) stop playback on a content swap

  const loop = useCallback(() => {
    const pos = applyScroll();
    if (pos >= 1) { onStop(); return; }
    rafRef.current = requestAnimationFrame(loop);
  }, [applyScroll, onStop]);

  const onPlay = useCallback(async () => {
    const player = playerRef.current;
    try {
      if (playState !== 'paused') { // stopped → build + load; paused → just resume
        const seq = buildSequence(effModel);
        if (totalSeconds(seq) <= 0) return;
        applyPlaybackPitch(seq, effModel, scale, saBase, shift);   // scale override + Sa transpose (audio only)
        player.onended = () => onStop();
        // Tala keeps its own live-adjustable track volume — schedule every event
        // (even at 0) so raising the slider mid-playback brings the tala in.
        // A segment is expressed by scheduling only that stretch, shifted to start at 0 —
        // the backend never learns what a marker is. secPerUnit converts the roll's
        // units into the seconds scheduleEvents works in.
        const spu = 30 / (effModel.meta?.tempo > 0 ? effModel.meta.tempo : 120);
        const range = hasSeg ? { from: markA * spu, to: markB * spu } : undefined;
        player.load(scheduleEvents(seq, range), totalSeconds(seq, range), { talaGain: talaLevel });
        // Snapshot what was loaded: the playhead must follow the PLAYING audio
        // even if the user edits mid-playback.
        loadedTotalRef.current = totalSeconds(seq, range);
        loadedOffsetRef.current = hasSeg ? markA : 0;
        loadedTempoRef.current = effModel.meta?.tempo > 0 ? effModel.meta.tempo : 120;
      }
      await player.play();
      setPlayState('playing');
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      // Tone.start()/play() can reject (e.g. AudioContext unlock denied);
      // without this it'd be an unhandled rejection with UI stuck mid-state.
      console.error('playback failed', e);
      onStop();
    }
  }, [effModel, playState, loop, onStop, talaLevel, scale, saBase, shift, hasSeg, markA, markB]);

  const onPause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.pause();
    setPlayState('paused');
  }, []);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); playerRef.current?.dispose(); }, []);

  // Drone accompanies playback: it starts on Play and stops when the piece ends
  // (or on Stop). While a piece is going it stays live-adjustable / re-voiced on
  // Sa change; when stopped it's silent.
  useEffect(() => {
    const p = playerRef.current;
    if (playState !== 'stopped' && droneLevel > 0) p.setDrone(droneFreqs(saMidi), droneLevel);
    else p.droneOff();
  }, [playState, droneLevel, saMidi]);

  useEffect(() => { playerRef.current.setMasterVolume(masterVol); }, [masterVol]);
  useEffect(() => { playerRef.current.setTalaVolume(talaLevel); }, [talaLevel]);
  useEffect(() => { playerRef.current.setTimbre(timbre); }, [timbre]);
  useEffect(() => { playerRef.current.setMelodyMuted(melodyMuted); }, [melodyMuted]);

  // --- Dialogs (one open at a time): read-only raga/tala refs + Scale override ---
  const [dialog, setDialog] = useState(null);   // null | 'ragas' | 'talas' | 'scale'
  const onOpenRagas = useCallback(() => setDialog('ragas'), []);
  const onOpenTalas = useCallback(() => setDialog('talas'), []);
  const onOpenScale = useCallback(() => setDialog('scale'), []);
  const onCloseDialog = useCallback(() => setDialog(null), []);

  // --- Draggable pane divider. The workspace is a bounded flex column holding ONE row,
  // editor | roll, so the roll gets the whole height: it is the thing being edited, and
  // a roll that shows a third of a piece cannot be worked in. The textbook line that
  // used to take the lower half is a rendered VIEW of the same notation, and the
  // notation itself is already on screen in the editor beside it. ---
  const colsRef = useRef(null);
  const wsRef = useRef(null);
  const [leftPct, setLeftPct] = useState(50);    // editor width fraction of the top row
  const onVDrag = useCallback((clientX) => {
    const el = colsRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setLeftPct(Math.max(15, Math.min(85, ((clientX - r.left) / r.width) * 100)));
  }, []);

  // Headless-guard surface, mirroring draw's window.__rr and pitchy's window.__pv:
  // what the roll is showing and where its playhead is, without scraping pixels.
  useEffect(() => {
    window.__app = {
      roll: () => rollApiRef.current,
      intents: () => intentLog.current.map((i) => ({ ...i })),
      clearIntents: () => { intentLog.current.length = 0; },
      notes: () => (rollApiRef.current ? rollApiRef.current.model().notes.length : 0),
      bounds: () => (rollApiRef.current ? rollApiRef.current.bounds() : null),
      get playhead() { return playheadRef.current; },
      get playState() { return playState; },
      get tempo() { return loadedTempoRef.current; },
      get loadedTotal() { return loadedTotalRef.current; },
    };
  }, [playState]);

  return html`
    <${Toolbar} raga=${raga} tala=${tala} examples=${examples} exampleValue=${exampleValue}
                onOpen=${onOpen} onExample=${onExample} onOpenLink=${onOpenLink}
                onOpenRagas=${onOpenRagas} onOpenTalas=${onOpenTalas}
                onOpenScale=${onOpenScale} scaleActive=${!!scale} scaleLabel=${scaleLabel}
                timbre=${timbre} onTimbre=${onTimbre} />
    ${dialog === 'ragas' && html`<${RagaDialog} ragas=${getRagas()} player=${playerRef.current}
                                         saMidi=${saMidi} droneLevel=${droneLevel} ragaName=${ragaName}
                                         stopMain=${onStop} onClose=${onCloseDialog} />`}
    ${dialog === 'talas' && html`<${TalaDialog} talas=${TALA_MAP} player=${playerRef.current}
                                         saMidi=${saMidi} droneLevel=${droneLevel}
                                         stopMain=${onStop} onClose=${onCloseDialog} />`}
    ${dialog === 'scale' && html`<${ScaleDialog} scale=${scale} onApply=${onApplyScale} onClose=${onCloseDialog}
                                                 ragas=${getRagas()} ragaName=${ragaName} />`}
    <${Transport} state=${playState} canPlay=${noteCount > 0}
                  onPlay=${onPlay} onPause=${onPause} onStop=${onStop}
                  compositionTempo=${compositionTempo} tempoOverride=${tempoOverride} onTempo=${onTempo} onResetTempo=${onResetTempo}
                  saPitch=${saPitch} autoSaMidi=${autoSaMidi} onSetSa=${onSetSa}
                  masterVol=${masterVol} onMasterVol=${onMasterVol}
                  melodyMuted=${melodyMuted} onToggleMelody=${onToggleMelody}
                  talaVol=${talaVol} onTalaVol=${onTalaVol} talaMuted=${talaMuted} onToggleTala=${onToggleTala}
                  droneVol=${droneVol} onDroneVol=${onDroneVol} droneMuted=${droneMuted} onToggleDrone=${onToggleDrone}
                  onSave=${onSave} onExportMidi=${onExportMidi} onShare=${onShare} shared=${shared} />
    <${Diagnostics} items=${model.diagnostics} />
    <div class="workspace" ref=${wsRef}>
      <div class="cols" ref=${colsRef}
           style=${`flex:1 1 0; grid-template-columns:${leftPct}fr 6px ${100 - leftPct}fr`}>
        <${Editor} value=${text} onInput=${setText} />
        <${Splitter} orientation="v" onResize=${onVDrag} />
        <${RollPane} model=${effModel} api=${rollApiRef} onIntent=${onRollIntent} allow=${ROLL_EDITS}
          sel=${rollSel} zoom=${rollZoom} paint=${rollPaint}
          mode=${rollMode} curveIndex=${curveIdx} onCurveIntent=${onCurveIntent} snapping=${curveSnap}
          gamaka=${rollGamaka} onGamakaIntent=${onGamakaIntent}
          onCurvePitch=${onCurvePitch} drawSpan=${curveSpan} markerA=${markA} markerB=${markB}
          tools=${html`<${RollTools} sel=${rollSel} onDelete=${onRollDelete}
            canUndo=${canUndo} onUndo=${onRollUndo} zoom=${rollZoom} onZoom=${onRollZoom}
            paint=${rollPaint} onPaint=${() => { setRollPaint((v) => !v); setRollGamaka(false); }}
            gamaka=${rollGamaka} onGamaka=${() => { setRollGamaka((v) => !v); setRollPaint(false); }}
            snap=${curveSnap} onSnap=${() => setCurveSnap((v) => !v)}
            hasSeg=${hasSeg} onClearMarks=${() => { setMarkA(0); setMarkB(0); }}
            mode=${rollMode} onBack=${() => { setCurveIdx(-1); setCurveTok(-1); }}
            hasCurve=${!!(curveIdx >= 0 && effModel && curveNote() && curveNote().curve)}
            canPaste=${!!curveClip} onClear=${onCurveClear} onCopy=${onCurveCopy} onPaste=${onCurvePaste}
            snap=${curveSnap} onSnap=${() => setCurveSnap((v) => !v)}
            hz=${curveHz} span=${curveSpan}
            onSpan=${(d) => setCurveSpan((v) => Math.min(60, Math.max(10, v + d)))} />`} />
      </div>

    </div>
    <${Footer} />
  `;
}

// Load raga data + the extended-raga overlay + the example manifest
// (data-driven), then mount. Each optional feed falls back gracefully.
Promise.all([
  // One database: scale, mela, shrutis and arohana on the same record, with the
  // duplicate spellings folded into aliases. It used to be three fetches whose keys
  // never lined up.
  fetch('./core/raga-db.json').then(r => r.json()),
  fetch(`${EXAMPLES_BASE}/index.json`).then(r => r.json()).catch(() => EXAMPLES_FALLBACK),
]).then(([db, examples]) => {
  setRagas(db);
  setRagaExt(db);
  render(h(App, { examples: Array.isArray(examples) && examples.length ? examples : EXAMPLES_FALLBACK }),
         document.getElementById('app'));
});
