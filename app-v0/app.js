import { h, render } from './vendor/preact.module.js';
import { useState, useEffect, useMemo, useCallback, useRef } from './vendor/hooks.module.js';
import { html } from './vendor/htm-preact.js';
import { TALA_MAP } from './core/parser.js';
import { setRagas, getRagas, resolveRagaName } from './core/raga-base.js';
import { setRagaExt } from './core/raga-ext.js';
import { Editor, GkaStrip } from './components/Editor.js';
import { hasLanes } from './components/LanesRail.js';
import { RollPane } from './components/RollPane.js';
import { RollTools } from './components/RollTools.js';
import { EditTools } from './components/EditTools.js';
import { chooseSeed, loadDrafts } from './core/raga-seed.js';
import { getRagaExt } from './core/raga-ext.js';
import { applyEdit, applyMove, paintEdit, placePaint } from './core/note-edit.js';
import { createSeamHost } from './core/roll-seam.js';
import { stepFreq } from './core/shruti.js';
import { sampleCurve, GAMAKA_SAMPLES } from './core/gamaka-inline.js';
import { buildRagaSteps } from './core/detect-raga-helper.js';
import { Toolbar } from './components/Toolbar.js';
import { EditorDrawer } from './components/EditorDrawer.js';
import { Diagnostics } from './components/Diagnostics.js';
import { RagaDialog } from './components/RagaDialog.js';
import { InstrumentDialog } from './components/InstrumentDialog.js';
import { TalaDialog } from './components/TalaDialog.js';
import { ScaleDialog } from './components/ScaleDialog.js';
import { LayoutDialog } from './components/LayoutDialog.js';
import { SettingsDialog } from './components/SettingsDialog.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';
import { createPlayer } from './audio/player.js';
import { isTunable } from './audio/voices.js';
import { audioSupport } from './audio/backend.js';
import { scheduleEvents, totalSeconds, midiToFreq } from './audio/schedule.js';
import { droneFreqs } from './audio/drone.js';
import { saBaseOf, applyPlaybackPitch } from './core/retune.js';
import { shareUrl, readSharedSource, sourceFromShareInput, parseSharedPayload, mixLevels } from './core/share.js';
import { inlineLegacyCurves } from './core/share-legacy.js';
import { BPM_MIN, BPM_MAX } from './components/Controls.js';
import { Splitter } from './components/Splitter.js';
import { Footer } from './components/Footer.js';
import { ChromeRow, ChromeBar } from './components/ChromeBar.js';
import { loadLayout, saveLayout, isDefaultLayout } from './core/chrome-layout.js';
import { PerfDialog } from './components/PerfDialog.js';
import { VERSION } from './version.js';
import { createPerf, watchLongTasks, deviceFacts } from './core/perf.js';
import { loadSync, saveSync, clampSync, SYNC_STEP } from './audio/backend.js';

// Example pieces are data-driven: the list comes from examples/index.json
// (regenerated from the folder by tools/gen-examples.sh), so adding a piece
// needs no code edit. EXAMPLES_BASE is where both the manifest and the .srgm
// files are fetched from — point it at a CORS-enabled CDN to decouple later.
const EXAMPLES_BASE = './examples';
// Only reached when examples/index.json cannot be fetched, which is why it went unnoticed
// that 'hamsa' had stopped being a file: it was a duplicate of the vathapi composition,
// named for its raga hamsadhwani, and was removed to be rid of the duplication. Every name
// here must be a file that is actually ON THE SERVER — this is the one path that exists
// for a broken manifest, and it was offering an entry that 404s.
//
// kalyani-varnam leads because it is the piece that exercises what the app can currently
// do: gamakas on most of its notes, and the source notation each of them came from.
const EXAMPLES_FALLBACK = ['kalyani-varnam', 'swaravali', 'vathapi', 'varavina'];
const LS_KEY = 'ragamroll.srgm';
const LS_NAME = 'ragamroll.docname';
const LS_SWAP = 'ragamroll.rollfirst';   // pane order, once the reader has said which they want
const LS_LANES = 'ragamroll.lanes';      // which side of the roll the sung lanes sit on, and whether
const LS_LANES_ORDER = 'ragamroll.lanesorder';   // and which of the two columns leads
// What happens to a gamaka when its note is dragged to another pitch. The gamaka page's
// key, deliberately: it is one reader's preference about one kind of edit, and the two
// pages are the same editor — being asked twice would be the surprise.
const LS_GMOVE = 'ragamroll.gamakaOnMove';
// What the reader has made of the plucked voice. It belongs to the browser, not to a piece:
// it is how this instrument sounds to this pair of ears, the same class of thing as the
// mixer levels, and no notation should carry it.
const LS_INSTR = 'ragamroll.instrument';
// Asked once: whether this page is allowed to build the voices at all. It cannot change
// while the page is open, and a reader who cannot hear the melody should be told why on the
// page rather than in a console they have no way to open on a phone.
const AUDIO = audioSupport();
const LS_GKA = 'ragamroll.showSource';       // the provenance strip, on or off
const LS_READ = 'ragamroll.reading';         // the notation folded to its swaras
const LS_LOOP = 'ragamroll.loop';            // repeat what is played until Stop
// How the roll spells a pitch on its axis. The reader's, and the browser's — it is about how
// this pair of eyes reads a grid, the same class of thing as the mixer levels, and no
// notation should carry it.
const LS_LABEL_OCT = 'ragamroll.labelOctave';
const LS_LABEL_COMMA = 'ragamroll.labelComma';
const DEFAULT_NAME = 'ragamroll';
// The narrowest the NOTATION column is allowed to get while it is carrying the controls.
// Measured, not guessed: the widest row comes to 386px of controls, and with the row's own
// padding and the gaps between them it wraps at a column width of 396 — checked by dragging
// the divider to the stop, not by reading the CSS. A wrapped row's second line is height
// taken off the notation while the roll gains nothing, so squeezing past here buys nothing.
// The extra over 396 is the margin a font that renders a hair wider elsewhere will need.
const CHROME_MIN_PX = 420;

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
  // `parsed` separates "the piece has no notes" from "the worker has not answered yet".
  // They look identical in the model — this one is a placeholder standing in until the
  // first reply — and anything that treats an unparsed piece as an empty one acts on a
  // blank page that never existed. A saved composition reloads through that gap.
  const [compiled, setCompiled] = useState({
    model: { events: [], seqProps: {}, meta: {}, diagnostics: [] }, notation: '', parsed: false,
  });
  const workerRef = useRef(null);
  const reqRef = useRef(0);
  useEffect(() => {
    const w = new Worker('./worker.js', { type: 'module' });
    w.onmessage = (e) => {
      if (e.data.id === reqRef.current) setCompiled({ model: e.data.model, notation: e.data.notation, parsed: true });
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
  // Out of range is IGNORED rather than clamped, because this runs on every keystroke:
  // clamping would turn the "2" of 240 into 20 before the reader typed the second digit.
  // The box re-reads the accepted value when it loses focus, so a rejected number never
  // stays on screen pretending to be in force.
  const onTempo = useCallback((v) => { if (v >= BPM_MIN && v <= BPM_MAX) setTempoOverride(v); }, []);
  const onResetTempo = useCallback(() => setTempoOverride(null), []);
  const effModel = useMemo(
    () => (tempoOverride ? { ...model, meta: { ...model.meta, tempo: tempoOverride } } : model),
    [model, tempoOverride]);

  const ragaName = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key[0] : ''; }, [model]);
  // The quick raga/tala pickers above the notation box. They apply to a BLANK piece
  // only: changing the raga under written swaras would re-spell every one of them.
  const talaName = useMemo(() => { const e = [...model.events].reverse().find((x) => x.type === 'tala'); return e && e.key ? e.key[0] : ''; }, [model]);
  const [ragaNames, setRagaNames] = useState([]);
  useEffect(() => { setRagaNames(Object.keys(getRagas() || {}).filter((n) => !/^mela_\d+$/i.test(n))
    .sort((a2, b2) => a2.toLowerCase().localeCompare(b2.toLowerCase()))); }, [model]);
  const talaNames = useMemo(() => Object.keys(TALA_MAP), []);

  // Opening a file / picking an example remembers its name, so Save and Export
  // suggest the same base name instead of a fixed "ragamroll".
  // Examples dropdown is controlled so Open (or any load) can reset it to the placeholder.
  const [exampleValue, setExampleValue] = useState('');
  // Bumped whenever a DIFFERENT piece arrives — new, opened, an example, a share link.
  // A grid someone stretched by hand belongs to the piece they stretched it around, and
  // carrying it onto the next one opens it inside acres of empty staves. The reset lives
  // in an effect below rather than in these handlers because the roll instance is created
  // by the pane, and these are declared before it exists.
  const [docEpoch, setDocEpoch] = useState(0);
  const newDoc = useCallback(() => setDocEpoch((n) => n + 1), []);
  // Loading a new composition while playing would leave the old audio playing over
  // the new (misleading) panes — so stop playback on any content swap. onStop is
  // defined later; reach it through a ref that's kept current below.
  const stopRef = useRef(() => {});
  const playRef = useRef(() => {});
  const onOpen = useCallback(async (file) => { stopRef.current(); newDoc(); setExampleValue(''); setDocName(baseName(file.name)); setText(await file.text()); }, []);
  // Blank / New: the skeleton draw writes — a raga, a tala, an octave and a length, and
  // no notes. A piece with no notes is what gives the roll its WIDE grid (two avartanas
  // of empty time, the middle octave with half an octave either side, from gridBounds),
  // so there is a canvas to write on rather than one unit of nothing.
  //
  // It keeps the raga and tala you were already in, where draw always resets to its
  // first-listed raga and adi. Clearing the notes is not a reason to throw away the
  // context, and both pickers unlock the moment the piece is blank, so changing either
  // is one click away. Declared beside onOpen because it closes over ragaName/talaName
  // (declared above) and nothing from the roll state below.
  const onNew = useCallback(() => {
    stopRef.current(); newDoc(); setExampleValue(''); setDocName('untitled');
    const r = ragaName || ragaNames[0] || 'c12';
    setText(`Raga=${r},0\nTala=${talaName || 'adi'},4\nO=5 L=1\n`);
  }, [ragaName, talaName, ragaNames]);
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
    stopRef.current(); newDoc();
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
  // The same piece, handed to the page that aligns it. A link rather than a file: the two
  // pages are two ends of one job, and saving something to find it again in a file picker
  // is the paperwork this removes.
  const onLanes = useCallback(async () => {
    const url = new URL('lanes.html', location.href);
    window.open(url.href + '#' + (await shareUrl(text)).split('#')[1], '_blank', 'noopener');
  }, [text]);
  // Open a pasted share link (from this or any other host). Returns true on
  // success so the menu can close / show an error.
  const onOpenLink = useCallback(async (input) => {
    try {
      openSharedRef.current(await sourceFromShareInput(input), 'shared');
      return true;
    } catch { return false; }
  }, []);
  // Opening a "#pako:" link loads the shared source into the editor, then clears
  // the hash so later edits (persisted to localStorage) aren't overridden on reload.
  // A share link can be older than this app. Three shapes exist — plain notation, the
  // gamaka page's {v:2, srgm, mix}, and a legacy {v, src, g} whose gamakas are keyed by
  // note index — and a link is forever, so all three open. openShared is where that is
  // decided, once, for the hash and for a pasted link alike.
  //
  // Declared as a ref because the two callers are a mount effect and a callback declared
  // above the state it needs; the levels it sets belong to the transport, further down.
  const openSharedRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    readSharedSource().then((src) => {
      if (cancelled || src == null) return;
      openSharedRef.current(src, 'shared');
      try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, []);

  // --- Playback: player instance, scroll refs, rAF loop, transport handlers ---
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createPlayer('tone');
  const rollApiRef = useRef(null);   // the roll instance, driven imperatively (see RollPane)
  // The lane rail's playhead. Driven the same way and for the same reason as the roll's:
  // it is one line moving on the frame the transport clock already ticks, and routing it
  // through props would re-render a column of text sixty times a second to move it.
  const laneHeadRef = useRef(null);
  const setLaneHead = useCallback((units) => {
    const el = laneHeadRef.current, r = rollApiRef.current;
    if (!el) return;
    if (units == null || !r) { el.hidden = true; return; }
    el.hidden = false;
    el.style.transform = `translateY(${r.yVirt(units)}px)`;
  }, []);
  // A–B belongs to the piece it was marked on. Length-units mean nothing across pieces: the
  // range lands wherever those units happen to fall in the new one, so Play quietly starts
  // part-way in, the roll shades a stretch nobody chose, and 🔁 repeats it. Every way a
  // different piece arrives bumps docEpoch — New, a file, an example, a share link — so
  // this clears it once for all of them rather than in four handlers.
  //
  // ITS OWN EFFECT, not folded into the grid reset below: that one returns early when the
  // roll instance does not exist yet, and a piece opened before the pane is ready would
  // keep its predecessor's range.
  useEffect(() => { setMarkA(0); setMarkB(0); }, [docEpoch]);
  // A hand-stretched grid is view state and does not survive a different piece. resize()
  // rather than render(), because the scroll window is sized from the grid and a narrower
  // grid leaves the div taller than there is anything to show.
  useEffect(() => {
    const r = rollApiRef.current; if (!r) return;
    r.setUser({ min: null, max: null, bottom: null }).resize();
  }, [docEpoch]);

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
  // WHAT THIS DEVICE DID. A recorder, not a feature: the roll skipping and the sound
  // crackling on a phone cannot be reproduced anywhere else, and there is no console there
  // to ask. Long-press the version to read it back. Costs one subtraction in a loop that
  // already runs, and a browser-side observer.
  const perfRef = useRef(null);
  if (!perfRef.current) perfRef.current = createPerf();
  const [perfOpen, setPerfOpen] = useState(false);
  const [, setPerfTick] = useState(0);          // the panel reads live numbers; this re-renders it
  useEffect(() => watchLongTasks(perfRef.current), []);
  const onPerf = useCallback(() => {
    const p = playerRef.current;
    // Most of the time this is opened WHILE something is playing — that is when there is
    // anything to look at — so the run in flight has to count, or the report opens on zero.
    const st = playStartRef.current;
    perfRef.current.playing(st ? performance.now() - st.at : 0);
    // The RUNWAY too: how far ahead of now the last run started its first note, and whether
    // that came from a real reading or from the blind floor. A device that reports no output
    // latency takes a different path through play(), and there is no way to tell from here
    // which path a phone took.
    const rw = p && p.startRunway ? p.startRunway() : null;
    perfRef.current.setDevice(deviceFacts(p && p.audioDevice ? p.audioDevice() : null,
      rw ? { runwayMs: rw.runway == null ? null : Math.round(rw.runway * 1000), latencyMeasured: rw.measured } : {}));
    setPerfTick((n) => n + 1);
    setPerfOpen(true);
  }, []);
  const onPerfReset = useCallback(() => {
    perfRef.current.reset();
    playerRef.current?.resetAudioStats?.();   // the note counters live down there
    setPerfTick((n) => n + 1);
  }, []);

  // Repeat until Stop. What it repeats is whatever Play loads — the A-B segment when one is
  // marked, the piece otherwise — so nothing here has to know which, and neither does the
  // backend. Remembered, like the other transport toggles: someone drilling a phrase does
  // not want to arm it again every session.
  const [looping, setLooping] = useState(() => { try { return localStorage.getItem(LS_LOOP) === '1'; } catch { return false; } });
  const loopingRef = useRef(looping);
  loopingRef.current = looping;
  const onToggleLoop = useCallback(() => setLooping((v) => !v), []);
  useEffect(() => { try { localStorage.setItem(LS_LOOP, looping ? '1' : '0'); } catch { /* private mode */ } }, [looping]);
  // Live, so the toggle means something while a piece is running. The backend keeps it as
  // its own state rather than as a load() argument, so an interrupted run that rebuilds
  // itself comes back still looping.
  useEffect(() => { playerRef.current?.setLoop?.(looping); }, [looping]);

  // The reader's A/V trim. Nudged by ear while a piece plays; the backend folds it into
  // latency(), so this state only has to be remembered and pushed.
  const [sync, setSync] = useState(() => loadSync());
  // Written only once it MOVES. Saving on mount would put a 0 in storage for every reader who
  // never touches this, which is a setting where there was none.
  const syncSaved = useRef(sync);
  useEffect(() => {
    playerRef.current?.setSyncOffset?.(sync);
    if (sync !== syncSaved.current) { syncSaved.current = sync; saveSync(sync); }
  }, [sync]);
  // A DIRECTION, not a value: -1 earlier, +1 later, 0 back to none. The caller is a finger on
  // a button and should not have to know what a step is.
  const onSync = useCallback((dir) => {
    setSync((v) => (dir === 0 ? 0 : clampSync(v + dir * SYNC_STEP)));
  }, []);

  const [markA, setMarkA] = useState(0);
  const [markB, setMarkB] = useState(0);            // 0,0 = no segment: play it all
  const hasSeg = markB > markA;
  const [curveHz, setCurveHz] = useState('');       // the pitch under the pointer, while shaping
  const [curveSpan, setCurveSpan] = useState(22);   // how much of the pitch axis the editor shows
  const [curveClip, setCurveClip] = useState(null);   // copied curve, RELATIVE to its note
  // Where the note under the pointer came from: the `gka` fragment of another system's
  // notation. Remembered ON, because someone checking a conversion is checking it for a
  // whole session, not a note.
  const [gkaOn, setGkaOn] = useState(() => localStorage.getItem(LS_GKA) === '1');
  // Reading rather than writing: the swaras with every {…} folded to a mark. Remembered,
  // because someone reading a piece is reading it for a while.
  const [reading, setReading] = useState(() => localStorage.getItem(LS_READ) === '1');
  useEffect(() => { localStorage.setItem(LS_READ, reading ? '1' : '0'); }, [reading]);
  // Pointing at a fold shows what is behind it, in the same strip that shows where a note
  // came from — one place for "what is not on the page", whichever way you asked.
  const onPeek = useCallback((body) => setGkaText(body || ''), []);
  const [gkaText, setGkaText] = useState('');
  useEffect(() => { localStorage.setItem(LS_GKA, gkaOn ? '1' : '0'); }, [gkaOn]);
  // The index is the ROLL's, and it is read back through the roll rather than kept here:
  // the model is rebuilt on every parse and an index held across one means another note.
  const onHoverNote = useCallback((i) => {
    const r = rollApiRef.current; const m = r && r.model();
    const n = m && i >= 0 ? m.notes[i] : null;
    setGkaText(n && n.gka ? n.gka : '');
  }, []);
  const rollMode = curveIdx >= 0 ? 'draw' : 'roll';
  // "+ note": while it is armed a press PLACES something rather than grabbing what is
  // already there, so the two gestures are mutually exclusive by construction.
  const [rollPaint, setRollPaint] = useState(false);
  // ✎ : shape a gamaka in place, without opening the one-note editor. Mutually exclusive
  // with painting — both take a press on a note and mean different things by it.
  const [rollGamaka, setRollGamaka] = useState(false);

  // Read through a ref by the move handler, which is mounted once and would otherwise
  // close over whatever this was when the roll was created.
  const [gmove, setGmove] = useState(() => localStorage.getItem(LS_GMOVE) || 'preserve-pitch');
  const gmoveRef = useRef(gmove); gmoveRef.current = gmove;
  // Offered only when the piece has an ornament for it to apply to: a control whose
  // setting cannot change anything on screen is a question with no consequence.
  // Read the way roll-model reads it: the inline gamaka is a note-relative array on the
  // note event itself, not something under props. Asking the wrong shape made this always
  // false, which hid the control on every piece — including the ones it exists for.
  const hasCurves = useMemo(() => model.events.some((e) => e.type === 'note' && Array.isArray(e.gamaka) && e.gamaka.length), [model]);
  const onGmove = useCallback((v) => { setGmove(v); try { localStorage.setItem(LS_GMOVE, v); } catch (_) { /* private mode */ } }, []);

  const [rollSel, setRollSel] = useState(null);   // { type:'note'|'rest', tok } | null
  // The roll draws one cell per note of typical length; zoom stretches time on top of
  // that, for shaping a long note or reading a crowded phrase. Same range and step draw
  // uses, and the halves are rounded off or 0.5 steps accumulate a float tail.
  const [rollZoom, setRollZoom] = useState(1);
  // Absolute: the slider names a scale rather than nudging one. The − 1× + buttons it
  // replaced nudged, which is why they had to exist in pairs.
  const onRollZoomTo = useCallback((z) =>
    setRollZoom(Math.min(8, Math.max(1, Math.round(z * 10) / 10))), []);
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

  // The note the gamaka controls act on. In the full-screen editor that is the note it was
  // opened on; in ✎ mode there is no editor and no opened note, so it is the SELECTION —
  // which shaping a curve sets, and which is also what the roll highlights. One accessor
  // for both, so Clear, Copy and Paste are the same button wherever they are pressed
  // rather than a second implementation that drifts.
  const curveNote = () => {
    const r = rollApiRef.current; const m = r && r.model();
    if (!m) return null;
    if (curveIdx >= 0) return m.notes[curveIdx];
    return rollSel && rollSel.type === 'note' ? m.notes.find((n) => n.tok === rollSel.tok) || null : null;
  };
  // Hear what was just shaped. draw plays the note after every curve edit, and a gamaka
  // is a thing you judge by ear — reading anchors tells you almost nothing. previewNote
  // is the contract's audition: it sounds one note and cannot disturb the transport, so
  // this works mid-playback too.
  const auditionNote = useCallback((n) => {
    const p = playerRef.current, r = rollApiRef.current;
    if (!p || !r || !n) return;
    const m = r.model();
    const saF = midiToFreq(m.saRef);
    const secPerUnit = 30 / (m.tempo > 0 ? m.tempo : 120);
    let gamaka;
    if (n.curve && n.curve.length >= 2) {
      gamaka = new Float32Array(GAMAKA_SAMPLES);
      for (let k = 0; k < GAMAKA_SAMPLES; k++) gamaka[k] = stepFreq(saF, sampleCurve(n.curve, k / (GAMAKA_SAMPLES - 1)));
    }
    p.previewNote({ freq: stepFreq(saF, n.step), durSec: Math.min(3, n.dur * secPerUnit), gamaka });
  }, []);
  const auditionCurve = useCallback(() => auditionNote(curveNote()), [auditionNote, curveIdx, rollSel]);
  // Commit takes the NOTE, not the selection. The context menu acts on whatever is under
  // the pointer, which is the whole point of it — a menu that could only act on the
  // selected note would need the reader to select first, which is the paperwork it exists
  // to remove. Committing "the selected note" while pasting onto another one would write
  // the wrong token into the notation.
  const commitNote = useCallback((n) => {
    if (!n) return;
    commitRoll({ changed: new Set([n.tok]) });
    auditionNote(n);
  }, [commitRoll, auditionNote]);
  const commitCurve = useCallback(() => commitNote(curveNote()), [commitNote, curveIdx, rollSel]);
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
    // Pressing a note SELECTS it, before any edit and even if none follows. In ✎ mode the
    // roll's own select gesture is off — a press there is shaping a curve — so without
    // this nothing on the strip has a subject to act on, and Clear, Copy and Paste could
    // only ever be offered by opening the editor. It also says which note you are in, on
    // a roll where the ornament may be drawn nowhere near it.
    if (it.phase === 'target') { if (it.tok != null) setRollSel({ type: 'note', tok: it.tok }); return; }
    if (it.phase !== 'commit') return;
    const r = rollApiRef.current; if (!r) return;
    if (it.tok != null) setRollSel({ type: 'note', tok: it.tok });
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
  // Leaving the editor keeps the note SELECTED. You were just working on it, and the roll
  // you come back to is a wall of notes — the highlight is what says which one you were
  // in. It also keeps Delete in reach, instead of putting it back out of reach the moment
  // you step out of an editor you only opened to look. The gamaka page has always done
  // this; the app dropped the selection on the way out.
  const onCurveBack = useCallback(() => {
    if (curveTok >= 0) setRollSel({ type: 'note', tok: curveTok });
    setCurveIdx(-1); setCurveTok(-1);
  }, [curveTok]);

  const onCurveClear = useCallback(() => { const n = curveNote(); if (!n) return; n.curve = null; commitCurve(); }, [commitCurve, curveIdx, rollSel]);
  // Copy and paste BY NOTE. The strip's buttons pass the note they act on; so does the
  // context menu, which is handed an index by the hit-test under the pointer.
  const noteAt = (i) => { const m = rollApiRef.current && rollApiRef.current.model(); return m && m.notes[i] ? m.notes[i] : null; };
  const copyGamakaFrom = useCallback((n) => {
    if (!n || !n.curve) return;
    // Stored RELATIVE to its note's step, so pasting re-anchors it onto the target's
    // pitch instead of carrying the source note's absolute one.
    setCurveClip(n.curve.map(([u, st]) => [u, st - n.step]));
  }, []);
  const pasteGamakaOnto = useCallback((n) => {
    if (!n || !curveClip) return;
    n.curve = curveClip.map(([u, d]) => [u, n.step + d]);
    commitNote(n);
  }, [curveClip, commitNote]);
  const onCurveCopy = useCallback(() => copyGamakaFrom(curveNote()), [copyGamakaFrom, curveIdx, rollSel]);
  const onCurvePaste = useCallback(() => pasteGamakaOnto(curveNote()), [pasteGamakaOnto, curveIdx, rollSel]);
  // What the roll's context menu calls: the note is whichever one the press landed on.
  const onCopyGamakaAt = useCallback((i) => copyGamakaFrom(noteAt(i)), [copyGamakaFrom]);
  const onPasteGamakaAt = useCallback((i) => pasteGamakaOnto(noteAt(i)), [pasteGamakaOnto]);

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
    // The curve is stored ABSOLUTE, so 'preserve pitch' means leaving it alone — the
    // notation emits shifted relative deltas — and 'move with note' shifts it by the
    // same interval, so the deltas stay verbatim and the ornament rides the note.
    const { deriveOctave } = applyMove(n, it.from, ctxOf(), gmoveRef.current);
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
  // MUTED to begin with. The tala is a pulse to check a phrase against, not an accompaniment
  // to hear it over, and a strum on every akshara is the thing that buries the gesture most
  // of this app exists to show. It is one click away, and the level it comes back at is now
  // one you can hear.
  const [talaMuted, setTalaMuted] = useState(true);
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

  // Opening a shared piece, whatever shape the link is in. Declared HERE, below the mixer
  // levels it sets and the document state it replaces — the two callers reach it through
  // the ref above, which is what lets this sit where its dependencies are.
  //
  // A legacy link's index-keyed gamakas are converted to inline notation on the way in,
  // so a reader who opens an old link and saves it has a file in today's format without
  // being told anything about either.
  openSharedRef.current = (decoded, name) => {
    const p = parseSharedPayload(decoded);
    const src = p.kind === 'legacy' ? inlineLegacyCurves(p.srgm, p.curves) : p.srgm;
    const mix = mixLevels(p.mix);
    // A link may set a level; it may not decide that you wanted it muted. Setting the
    // level and clearing the mute is exactly what the sliders do.
    if (mix.drone != null) { setDroneVol(mix.drone); setDroneMuted(false); }
    if (mix.tala != null) { setTalaVol(mix.tala); setTalaMuted(false); }
    stopRef.current(); newDoc(); setExampleValue(''); setDocName(name || 'shared'); setText(src);
  };
  // Melody instrument voice (applies on the next Play — the synth is rebuilt at load).
  // Pluck by default: it is the voice built from parts, the one with a panel, and the one
  // this app sounds like.
  const [timbre, setTimbre] = useState('pluck');
  const onTimbre = useCallback((t) => setTimbre(t), []);
  // The instrument's own settings, remembered and pushed into the voice whenever one is
  // built — a voice is rebuilt on every play, so anything not pushed back would last until
  // the next press of Play and no longer.
  const [instr, setInstr] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_INSTR)) || {}; } catch { return {}; }
  });
  const [instrOpen, setInstrOpen] = useState(false);
  useEffect(() => {
    const p = playerRef.current;
    if (!p || !p.setVoiceParam) return;
    // ONLY into the voice these settings belong to. They are the plucked string's — the
    // panel that writes them exists for it alone — and `out` is a key another voice also
    // owns, so pushing them at whatever is loaded hands Pluckz the string's Level and calls
    // it Pluckz's own. A saved instrument is one instrument's.
    if (!isTunable(timbre)) return;
    for (const [k, val] of Object.entries(instr)) p.setVoiceParam(k, val);
  }, [instr, timbre]);
  const onInstrSet = useCallback((key, value) => {
    playerRef.current?.setVoiceParam?.(key, value);
    setInstr((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(LS_INSTR, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);
  const onInstrReset = useCallback(() => {
    playerRef.current?.resetVoiceParams?.();
    setInstr({});
    try { localStorage.removeItem(LS_INSTR); } catch { /* private mode */ }
  }, []);
  const saBase = useMemo(() => saBaseOf(model, getRagas()), [model]);
  // Sa reference pitch: null = auto (the raga's natural Sa, MIDI 60+saBase, so
  // playback is unshifted and goldens/MIDI stay exact); a MIDI number pins Sa to
  // an absolute 12-EDO note and transposes all audio (melody+drone+retune) to it.
  const autoSaMidi = 60 + saBase;
  const [saPitch, setSaPitch] = useState(null);
  const onSetSa = useCallback((m) => setSaPitch(m), []);
  const saMidi = saPitch != null ? saPitch : autoSaMidi;
  // A note, on the piece's own Sa, so a change in the instrument panel can be heard without
  // a piece playing. Declared HERE and not up with the panel's other handlers: it reads
  // saMidi, and a const below its reader is in the temporal dead zone when that reader runs
  // — the seventh time this file has had that fault, and it takes the app down on load.
  const onInstrAudition = useCallback(() => {
    playerRef.current?.previewNote?.({ freq: midiToFreq(saMidi), durSec: 1.6 });
  }, [saMidi]);
  const shift = saPitch != null ? saPitch - autoSaMidi : 0;
  // WHAT SA IS SOUNDING, told to the voice. Pluckz reads its register tables against Sa
  // rather than against absolute frequency — the same swara then keeps the same tone
  // whatever Sa the piece is played at — so it has to be told where Sa is. Every other
  // voice ignores the key.
  //
  // BELOW saMidi, not above it: this file has paid several times for a hook that reads a
  // const declared under it, which is a temporal-dead-zone crash before the first render.
  useEffect(() => {
    playerRef.current?.setVoiceParam?.('saHz', midiToFreq(saMidi));
  }, [saMidi, timbre]);

  const noteCount = useMemo(() => model.events.filter(e => e.type === 'note' && !e.rest).length, [model]);
  // The roll's time axis is in length-units; this is what one of them is worth in seconds,
  // so the roll can rule a seconds scale beside them. It follows the tempo OVERRIDE as well
  // as the composition's own T — the ruler has to describe what will actually play, or it
  // is measuring a tempo nobody chose.
  const secPerUnit = useMemo(() => 30 / (effModel.meta?.tempo > 0 ? effModel.meta.tempo : 120), [effModel]);
  // Said out loud, because a duration is the thing this app is worst at showing: the roll
  // is scaled by the MEDIAN note, so a piece twice as fast looks identical and takes half
  // as long. One line per parse, with the numbers a tempo argument needs.
  useEffect(() => {
    const r = rollApiRef.current; const m = r && r.model(); if (!m || !m.notes.length) return;
    const units = m.contentEnd, tempo = effModel.meta?.tempo > 0 ? effModel.meta.tempo : 120;
    console.log(`[ragamroll] ${m.notes.length} notes · ${units} units · T=${tempo}`
      + ` · ${secPerUnit.toFixed(4)}s per unit · ${(units * secPerUnit).toFixed(2)}s total`);
  }, [effModel, secPerUnit]);

  // What the reading view needs to group swaras by avartana: how long each note token is,
  // in the order the tokens appear, and the cycle in the same units. From the parsed model,
  // because the notation alone does not say — a bare swara's length is whatever L= last
  // said, and the cycle is the tala's own arithmetic.
  const readingMeta = useMemo(() => {
    const durations = [];
    for (const e of effModel.events) if (e.type === 'note') durations.push(e.absLen || 0);
    const tp = [...effModel.events].reverse().find((e) => e.type === 'tala');
    return { durations, measure: (tp && tp.props && tp.props.measure > 0) ? tp.props.measure : 0 };
  }, [effModel]);

  // The piece's length as a reader would say it: 2:14 above a minute, 57.6s below, and
  // nothing at all when there is nothing to time.
  const duration = useMemo(() => {
    // From the PARSED model, not from the roll: the roll is handed the new model by a
    // child effect, which runs after this render, so reading it here would show the
    // previous piece's length until something else re-rendered.
    let units = 0;
    for (const e of effModel.events) if (e.type === 'note') units += e.absLen || 0;
    if (!(units > 0)) return '';
    const sec = units * secPerUnit;
    if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
    return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }, [effModel, secPerUnit]);

  // Whether this piece carries any provenance at all, so the strip can say "there is none
  // here" rather than "point at a note" about notes that will never answer.
  const hasGka = useMemo(() => model.events.some((e) => e.type === 'note' && typeof e.gka === 'string'), [model]);

  // Below noteCount ON PURPOSE — these close over it. Fourth time in this file that a
  // useCallback declared above what it reads took the app down before first render.
  // A raga pick SEEDS the piece with that raga's own notation — a curated draft when
  // there is one, else a plain scale — so a blank page becomes something to hear.
  const onPickRaga = useCallback(async (name) => {
    if (!name || noteCount > 0) return;
    const cname = resolveRagaName(name) || name;
    const drafts = await loadDrafts();
    const picked = chooseSeed(cname, drafts, getRagaExt(cname), getRagas());
    // Same document, so no docEpoch — but every note in it is about to be replaced, and a
    // range marked on the blank frame would survive onto notation it was never drawn
    // against. The only content swap that does not come through newDoc().
    setMarkA(0); setMarkB(0);
    setText(picked ? picked.srgm : `Raga=${cname},0\nTala=adi,4\nO=5 L=1\n`);
  }, [noteCount]);
  const onPickTala = useCallback((name) => {
    if (!name || noteCount > 0) return;
    const nv = 'Tala=' + name + ',4', re = /(^|\s)Tala=\S+/;
    setText((t) => (re.test(t) ? t.replace(re, (m2, p2) => p2 + nv) : nv + '\n' + t));
  }, [noteCount]);

  // The paper a blank piece is given, kept once someone starts writing on it.
  //
  // gridBounds hands a piece with NO notes a wide frame on purpose — about two avartanas
  // of empty time, and the middle octave with half an octave either side — because a grid
  // the size of nothing cannot be written on. The instant the first note lands, that
  // branch stops applying and the grid becomes the note's own extent: four units of
  // timeline and two pitch rows. The canvas disappears under the first thing put on it,
  // and a four-unit note drawn against a four-unit timeline reads as the whole piece.
  //
  // So a blank piece PINS its frame as user bounds — the same ones the stretch tabs
  // write, which only ever widen. Writing into it now leaves the paper where it is, and
  // the piece grows past the pin exactly as a hand-stretched grid does. This is view
  // state: it never reaches the notation, the tabs can drag it back, and the docEpoch
  // effect above drops it when a different piece arrives.
  //
  // Every way of reaching a blank page comes through here — New, opening a file or a
  // share link that has no notes, an example, and deleting the last note of a piece —
  // because the condition is the model's, not any one handler's.
  //
  // It re-pins on every parse WHILE the piece is blank, because the canvas a blank piece
  // is owed depends on what it says: two avartanas is two avartanas of the tala currently
  // written, and the first render happens before the worker has read any of it. It reads
  // autoBounds rather than bounds — bounds already carries the last pin, so pinning from
  // it would freeze whatever the frame happened to be before the tala arrived — and takes
  // the WIDER of that and the frame on screen, so a grid stretched by hand on a blank page
  // is not pulled back in by the next keystroke.
  useEffect(() => {
    const r = rollApiRef.current;
    if (!r || !compiled.parsed || noteCount !== 0) return;
    // Against the bounds a reader STRETCHED to, never against bounds() — which reports the
    // pitch VIEW when there is one. A view is where someone is looking; pinning it made a
    // pan permanent, so on a phone a pan-and-type-and-pan-again walked the grid out to
    // eight octaves of empty staves that no zoom could get back.
    const auto = r.autoBounds(), u = r.userBounds();
    const lo = u.min != null ? Math.min(auto.stepMin, u.min) : auto.stepMin;
    const hi = u.max != null ? Math.max(auto.stepMax, u.max) : auto.stepMax;
    const bot = u.bottom != null ? Math.max(auto.total, u.bottom) : auto.total;
    r.setUser({ min: lo, max: hi, bottom: bot }).resize();
  }, [docEpoch, noteCount, model, compiled.parsed]);

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
      setLaneHead(units);
      const hd = r.canvas.parentElement.parentElement;
      hd.scrollTop = Math.max(0, Math.min(Math.max(0, r.virtH() - hd.clientHeight),
        r.yVirt(units) - hd.clientHeight * 0.4));
    }
    return pos;
  }, []);

  // Declared ABOVE onStop, which reads it. A `const` below its reader is in the temporal
  // dead zone when that reader runs — the sixth time this file has had that fault, and it
  // takes the app down on the first press rather than failing quietly.
  const playStartRef = useRef(null);   // when this run began, and what it was meant to take

  // Idempotent: may fire from both the rAF pos>=1 guard and the backend's
  // onended callback for the same end — cancel/stop/reset are all safe twice.
  const onStop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    // What the run took, beside what the tempo promised. Reported at the END because that
    // is the only place both numbers exist: a piece can be argued about from the console
    // instead of from memory. Skipped for a run that was paused and resumed, where wall
    // time includes however long the pause was and the comparison would be nonsense.
    const st = playStartRef.current; playStartRef.current = null;
    if (st) { perfRef.current.played(performance.now() - st.at); frameAtRef.current = 0; }
    if (st && st.expect > 0 && !st.resumed) {
      const took = (performance.now() - st.at) / 1000;
      console.log(`[ragamroll] played ${took.toFixed(2)}s · expected ${st.expect.toFixed(2)}s`
        + ` at T=${st.tempo} · ratio ${(took / st.expect).toFixed(2)}`);
    }
    // FADED, not cut. Stopping outright drops whatever is ringing to zero in one sample —
    // measured at a step from 0.155 to 0.062 with the strings mid-decay, which is a click.
    // fadeOutStop ramps the master down over 120ms and then stops; a Play arriving inside
    // that window cancels the teardown and restores the level (see clearFade).
    const pl = playerRef.current;
    if (pl.fadeOutStop) pl.fadeOutStop(); else pl.stop();
    setPlayState('stopped');
    playheadRef.current = null;
    rollApiRef.current?.setPlayhead(null).render();
    setLaneHead(null);
    const hd = rollApiRef.current && rollApiRef.current.canvas.parentElement.parentElement;
    if (hd) hd.scrollTop = 0;
  }, []);
  // Rewind PARKS the playhead at the start — of the A–B segment when there is one — so
  // you can see where the next Play will begin, rather than taking the line off the roll
  // as Stop does. Declared HERE, below onStop and playState: it closes over both, and a
  // useCallback above them reads them in the temporal dead zone and takes the app down
  // before it renders. Third time in this file; the order is not incidental.
  const onRewind = useCallback(() => {
    const at = hasSeg ? markA : 0;
    const wasPlaying = playState === 'playing';
    onStop();                     // also clears a PAUSE: a rewind is not a resume point
    playheadRef.current = at;
    if (rollApiRef.current) rollApiRef.current.setPlayhead(at).render();
    setLaneHead(at);
    // Playing, it plays AGAIN from there. Setting the state back to 'playing' was a lie:
    // onStop had already stopped the audio and cancelled the frame loop, so the app said
    // it was playing while nothing sounded and the playhead sat still.
    if (wasPlaying) playRef.current();
  }, [hasSeg, markA, playState, onStop]);

  stopRef.current = onStop;   // let onOpen/onExample (defined earlier) stop playback on a content swap

  const frameAtRef = useRef(0);
  const loop = useCallback(() => {
    // Before the work, so the gap measured is between frames rather than inside one.
    const now = performance.now();
    if (frameAtRef.current) perfRef.current.frame(now - frameAtRef.current);
    frameAtRef.current = now;
    const p = playerRef.current;
    if (p && p.audioStats) {
      const a = p.audioStats();
      perfRef.current.sources(a.liveSources);
      perfRef.current.audio(a);       // a SNAPSHOT of the backend's own per-note counters
    }
    const pos = applyScroll();
    // A looping run has no end to notice: position wraps at the seam and the piece goes
    // round again. Read from a REF, not from the closure — this callback re-arms itself, so
    // a run started before the toggle was pressed would otherwise keep the old answer for
    // as long as it lasted, and stop at the first seam.
    if (pos >= 1 && !loopingRef.current) { onStop(); return; }
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
        // Told before the load, which then sizes the loop to what it actually scheduled. The
        // effect above only fires when the toggle MOVES; a player built since then would
        // otherwise start a run not knowing.
        player.setLoop?.(looping);
        player.setSyncOffset?.(sync);   // a player built since the effect above ran
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
      // Stamped so the end can report what the run ACTUALLY took against what the tempo
      // said it would. A duration nobody measures is a duration nobody can argue with.
      playStartRef.current = { at: performance.now(), expect: loadedTotalRef.current,
        tempo: loadedTempoRef.current, resumed: playState === 'paused' };
      setPlayState('playing');
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      // Tone.start()/play() can reject (e.g. AudioContext unlock denied);
      // without this it'd be an unhandled rejection with UI stuck mid-state.
      console.error('playback failed', e);
      onStop();
    }
  }, [effModel, playState, loop, onStop, talaLevel, scale, saBase, shift, hasSeg, markA, markB, looping, sync]);

  // Same reason as stopRef, and the same trap: onRewind is declared ABOVE onPlay and has
  // to reach it, so the assignment goes HERE — below onPlay — not up beside stopRef.
  // Reading `onPlay` before its own line runs is a temporal-dead-zone crash that takes the
  // app down before it renders, which this file has now paid for five times.
  playRef.current = onPlay;

  const onPause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.pause();
    setPlayState('paused');
  }, []);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); playerRef.current?.dispose(); }, []);

  // Drone accompanies playback: it starts on Play, and stops whenever the music does —
  // the end of the piece, Stop, or PAUSE. The drone is independent of the transport by
  // contract (see audio/backend.js), so nothing pauses it unless this says so, and it
  // used to hold its note through a pause: silence with a drone still sounding over it
  // is not a pause, it is the piece dropping out. Resuming starts it again, because the
  // effect runs on every change of state.
  // While a piece is going it stays live-adjustable / re-voiced on Sa change.
  useEffect(() => {
    const p = playerRef.current;
    if (playState === 'playing' && droneLevel > 0) p.setDrone(droneFreqs(saMidi), droneLevel);
    else p.droneOff();
  }, [playState, droneLevel, saMidi]);

  useEffect(() => { playerRef.current.setMasterVolume(masterVol); }, [masterVol]);
  useEffect(() => { playerRef.current.setTalaVolume(talaLevel); }, [talaLevel]);
  useEffect(() => { playerRef.current.setTimbre(timbre); }, [timbre]);
  useEffect(() => { playerRef.current.setMelodyMuted(melodyMuted); }, [melodyMuted]);

  // --- Dialogs (one open at a time): read-only raga/tala refs + Scale override ---
  const [dialog, setDialog] = useState(null);   // null | 'ragas' | 'talas' | 'scale' | 'layout'
  const onOpenRagas = useCallback(() => setDialog('ragas'), []);
  const onOpenTalas = useCallback(() => setDialog('talas'), []);
  const onOpenScale = useCallback(() => setDialog('scale'), []);
  const onOpenLayout = useCallback(() => setDialog('layout'), []);
  const onOpenSettings = useCallback(() => setDialog('settings'), []);
  // Both default ON: the octave is the half of the address a reader most often wants, and the
  // comma is what the roll is FOR. Stored as '0' only when turned off, so a browser that has
  // never seen the panel opens with everything named.
  const [labelOct, setLabelOct] = useState(() => localStorage.getItem(LS_LABEL_OCT) !== '0');
  const [labelComma, setLabelComma] = useState(() => localStorage.getItem(LS_LABEL_COMMA) !== '0');
  const onLabelOct = useCallback((on) => { localStorage.setItem(LS_LABEL_OCT, on ? '1' : '0'); setLabelOct(on); }, []);
  const onLabelComma = useCallback((on) => { localStorage.setItem(LS_LABEL_COMMA, on ? '1' : '0'); setLabelComma(on); }, []);
  const onCloseDialog = useCallback(() => setDialog(null), []);

  // --- Draggable pane divider. The workspace is a bounded flex column holding ONE row,
  // editor | roll, so the roll gets the whole height: it is the thing being edited, and
  // a roll that shows a third of a piece cannot be worked in. The textbook line that
  // used to take the lower half is a rendered VIEW of the same notation, and the
  // notation itself is already on screen in the editor beside it. ---
  const colsRef = useRef(null);
  const wsRef = useRef(null);
  const [editorPct, setEditorPct] = useState(50);   // the NOTATION's share, whichever side it is on
  // Stacked, the notation is not a pane at all — it is a drawer, and this is how far up
  // it has been pulled. Shut to start with, so the roll opens with the whole window.
  const [drawerH, setDrawerH] = useState(0);
  // HOW FAR THE GRIP MAY PUSH, and it is the host that knows: exactly the height of what sits
  // below it. Push by that much and the transport, the controls and the footer are gone; push
  // further and the roll would carry the grip itself off the bottom, taking the only way back
  // with it. Measured from the block's own content rather than guessed as a fraction of the
  // window, because it is the block's height that decides, and it changes with the wrapping.
  // The chrome's arrangement, as data. Row 1 is pinned below the roll; the rest is the panel
  // the grip can push away, clipped from the bottom, so the last row goes first.
  const [rows, setRows] = useState(() => loadLayout());
  useEffect(() => { saveLayout(rows); }, [rows]);

  const belowRef = useRef(null);
  const setDrawer = useCallback((v) => setDrawerH(() => {
    if (v >= 0) return v;
    const el = belowRef.current;
    const room = el ? el.scrollHeight - 6 : 200;      // leave the grip a few pixels of daylight
    return Math.max(v, -Math.max(0, room));
  }), []);

  // Two panes, two arrangements. Side by side is this page's shape; stacked is the gamaka
  // page's, and a window holding half a screen is portrait-shaped, so putting the two up
  // next to each other to compare them is exactly when this matters.
  const [stacked, setStacked] = useState(() =>
    window.matchMedia('(max-aspect-ratio: 1/1), (max-width: 700px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-aspect-ratio: 1/1), (max-width: 700px)');
    const on = () => setStacked(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Which pane comes first. The DEFAULT follows the arrangement — editor on the left side
  // by side, roll on top when stacked, which is where each already belongs — and a swap
  // makes the choice explicit and keeps it. null means "still following the arrangement",
  // so someone who never touches the button gets the right order in both.
  const [swapPref, setSwapPref] = useState(() => {
    const v = localStorage.getItem(LS_SWAP); return v === null ? null : v === '1';
  });
  const rollFirst = swapPref === null ? stacked : swapPref;
  const onSwap = useCallback(() => setSwapPref((_) => {
    const next = !(swapPref === null ? stacked : swapPref);
    localStorage.setItem(LS_SWAP, next ? '1' : '0');
    return next;
  }), [swapPref, stacked]);

  // Where the sung lanes sit: left of the roll, right of it, or nowhere. Inside the roll
  // pane, so swapping the panes carries them along — they are a column of the roll's own
  // time axis. Offered only for a piece that HAS an alignment, since a rail of empty
  // columns is width taken from the notes for nothing.
  // 'left' | 'right' | 'off'. One value rather than a side and a flag, because a rail that
  // is away has no side to speak of — and the way back does not need to remember one: the
  // side it returns to is the side it was on, which is what the stored value already said
  // before it was turned off. So the last side rides along in a ref.
  const [lanesSide, setLanesSide] = useState(() => localStorage.getItem(LS_LANES) || 'left');
  const lastSide = useRef(lanesSide === 'off' ? 'left' : lanesSide);
  const putSide = useCallback((next) => {
    if (next !== 'off') lastSide.current = next;
    localStorage.setItem(LS_LANES, next);
    setLanesSide(next);
  }, []);
  const onLanesSide = useCallback(() => putSide(lastSide.current === 'left' ? 'right' : 'left'), [putSide]);
  const onLanesHide = useCallback(() => putSide('off'), [putSide]);
  const onLanesShow = useCallback(() => putSide(lastSide.current), [putSide]);
  // The model the ROLL is given, not the compile flag beside it: `compiled.parsed` says
  // whether the worker has answered, and asking that whether it carries an alignment is
  // a question about a boolean.
  const laneData = useMemo(() => hasLanes(effModel), [effModel]);
  // Which column is nearest the notes. Which one a reader wants there depends on which
  // they are following — the syllables or the written swaras — and both answers are
  // ordinary, so it is a setting rather than a decision made here.
  const [lanesOrder, setLanesOrder] = useState(() => localStorage.getItem(LS_LANES_ORDER) || 'ws');
  const onLanesOrder = useCallback(() => setLanesOrder((v) => {
    const next = v === 'ws' ? 'sw' : 'ws';
    localStorage.setItem(LS_LANES_ORDER, next);
    return next;
  }), []);
  // The divider reports the share of the FIRST column — which is the roll's when the panes
  // are swapped, hence the flip. Side by side only: stacked has a drawer, not a divider.
  const onVDrag = useCallback((clientX) => {
    const el = colsRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const first = Math.max(15, Math.min(85, ((clientX - r.left) / r.width) * 100));
    // The controls ride in this column side by side, so its floor is THEIR floor rather than
    // a share of the window: dragged below CHROME_MIN_PX the rows wrap, and the height they
    // gain comes straight off the notation while the roll gains nothing. Capped at half the
    // window so a small landscape window still has a divider that moves.
    const floor = Math.min(50, (CHROME_MIN_PX / r.width) * 100);
    setEditorPct(Math.max(floor, rollFirst ? 100 - first : first));
  }, [rollFirst]);

  // ONE BAG for every control the layout can place. They all take the same shape rather than
  // their own lists of props — a registry whose members have different signatures cannot be
  // rendered from a loop, and rendering from a loop is what makes the arrangement data.
  const ctl = {
    state: playState, canPlay: noteCount > 0,
    onPlay, onPause, onStop, onRewind, looping, onToggleLoop, hasSeg,
    syncMs: Math.round(sync * 1000), onSync,
    talaVol, onTalaVol, talaMuted, onToggleTala, melodyMuted, onToggleMelody,
    droneVol, onDroneVol, droneMuted, onToggleDrone, masterVol, onMasterVol,
    onSave, onExportMidi, onShare, shared, onLanes,
    compositionTempo, tempoOverride, onTempo, onResetTempo,
    saPitch, autoSaMidi, onSetSa,
    examples, exampleValue, onNew, onOpen, onExample, onOpenLink,
    onOpenRagas, onOpenTalas, onOpenScale, scaleActive: !!scale,
    onOpenLayout, layoutCustom: !isDefaultLayout(rows), onOpenSettings,
    timbre, onTimbre, onOpenInstrument: () => setInstrOpen(true),
  };

  // Headless-guard surface, mirroring draw's window.__rr and pitchy's window.__pv:
  // what the roll is showing and where its playhead is, without scraping pixels.
  useEffect(() => {
    window.__app = {
      roll: () => rollApiRef.current,
      player: () => playerRef.current,   // for guards that watch what reaches the audio layer
      intents: () => intentLog.current.map((i) => ({ ...i })),
      clearIntents: () => { intentLog.current.length = 0; },
      notes: () => (rollApiRef.current ? rollApiRef.current.model().notes.length : 0),
      bounds: () => (rollApiRef.current ? rollApiRef.current.bounds() : null),
      get playhead() { return playheadRef.current; },
      get playState() { return playState; },
      get tempo() { return loadedTempoRef.current; },
      get loadedTotal() { return loadedTotalRef.current; },
      // Which arrangement is on screen and which pane leads it. In the deps below, so a
      // guard that swaps the panes is not told about the layout from before the swap.
      layout: () => ({ stacked, rollFirst, editorPct, drawerH }),
      // Whether the piece carries a sung alignment, and where its rail is — a guard can
      // then check the BOXES against the roll's own yVirt rather than trusting the flag.
      lanes: () => ({ has: laneData, side: laneData ? lanesSide : 'off', order: lanesOrder }),
    };
  }, [playState, stacked, rollFirst, editorPct, drawerH, laneData, lanesSide, lanesOrder]);

  return html`
    ${!AUDIO.ok && html`<div class="audio-warning" role="status">⚠ ${AUDIO.why}</div>`}
    <${Toolbar} docName=${docName} blank=${noteCount === 0} duration=${duration} />
    ${instrOpen && html`<${InstrumentDialog} values=${instr} onSet=${onInstrSet}
                                        onReset=${onInstrReset} onAudition=${onInstrAudition}
                                        playing=${playState === 'playing'}
                                        onClose=${() => setInstrOpen(false)} />`}
    ${dialog === 'ragas' && html`<${RagaDialog} ragas=${getRagas()} player=${playerRef.current}
                                         saMidi=${saMidi} droneLevel=${droneLevel} ragaName=${ragaName}
                                         stopMain=${onStop} onClose=${onCloseDialog}
                                         onEdit=${(src, name) => { openSharedRef.current(src, name); onCloseDialog(); }} />`}
    ${dialog === 'talas' && html`<${TalaDialog} talas=${TALA_MAP} player=${playerRef.current}
                                         saMidi=${saMidi} droneLevel=${droneLevel}
                                         stopMain=${onStop} onClose=${onCloseDialog} />`}
    ${dialog === 'scale' && html`<${ScaleDialog} scale=${scale} onApply=${onApplyScale} onClose=${onCloseDialog}
                                                 ragas=${getRagas()} ragaName=${ragaName} />`}
    ${dialog === 'layout' && html`<${LayoutDialog} rows=${rows} onSet=${setRows} onClose=${onCloseDialog} />`}
    ${dialog === 'settings' && html`<${SettingsDialog} labelOct=${labelOct} labelComma=${labelComma}
                                                      onLabelOct=${onLabelOct} onLabelComma=${onLabelComma}
                                                      onClose=${onCloseDialog} />`}
    <${Diagnostics} items=${model.diagnostics} />
    <div class="workspace" ref=${wsRef}>
      <div class=${'cols' + (stacked ? ' stacked' : '')} ref=${colsRef}
           style=${`flex:1 1 0; grid-template-rows:1fr; grid-template-columns:` + (stacked ? '1fr'
             : `${rollFirst ? 100 - editorPct : editorPct}fr 6px ${rollFirst ? editorPct : 100 - editorPct}fr`)}>
        ${!stacked && html`<div class="editor-pane" style=${`order:${rollFirst ? 3 : 1}`}>
          <${EditTools} ragas=${ragaNames} talas=${talaNames} raga=${ragaName} tala=${talaName}
            blank=${noteCount === 0} onRaga=${onPickRaga} onTala=${onPickTala} />
          <${GkaStrip} on=${gkaOn} onToggle=${() => setGkaOn((v) => !v)} text=${gkaText} has=${hasGka}
            reading=${reading} onReading=${() => setReading((v) => !v)} />
          <${Editor} value=${text} onInput=${setText} readOnly=${reading} onPeek=${gkaOn ? onPeek : null}
            durations=${readingMeta.durations} measure=${readingMeta.measure} />
          <!-- SIDE BY SIDE, THE CONTROLS LIVE WITH THE NOTATION. Full-width rows under both
               panes charge the roll their whole height for nothing: the widest row is 386px
               of controls, so half a window holds them with room to spare, and the roll gets
               all 183px back. Stacked keeps them below, where the column is the only column
               and the grip needs something to push away.

               ROW 1 COMES WITH THEM, and in its own place at the top. Its pinning is about
               the GRIP — it is the row the reader cannot afford to have pushed off the
               screen — and there is no grip here. Left behind as a bar under both panes it
               would have been the one row drawn out of order: the reader arranged the rows
               top to bottom, and row 1 would have appeared last. -->
          <div class="chrome-col">
            <${ChromeRow} ids=${rows[0] || []} p=${ctl} cls="chrome-pinned" />
            <${ChromeBar} rows=${rows.slice(1)} p=${ctl} />
          </div>
        </div>`}
        ${!stacked && html`<${Splitter} orientation="v" onResize=${onVDrag} style="order:2"
          onSwap=${onSwap} swapTitle=${rollFirst ? 'Swap: put the notation on the left' : 'Swap: put the roll on the left'} />`}
        <${RollPane} style=${`order:${rollFirst ? 1 : 3}`}
          model=${effModel} api=${rollApiRef} onIntent=${onRollIntent} allow=${ROLL_EDITS}
          sel=${rollSel} zoom=${rollZoom} onSetZoom=${onRollZoomTo} paint=${rollPaint}
          mode=${rollMode} curveIndex=${curveIdx} onCurveIntent=${onCurveIntent} snapping=${curveSnap}
          gamaka=${rollGamaka} onGamakaIntent=${onGamakaIntent} onGamakaPitch=${onCurvePitch}
          canPasteGamaka=${!!curveClip} onCopyGamakaAt=${onCopyGamakaAt} onPasteGamakaAt=${onPasteGamakaAt}
          secPerUnit=${secPerUnit} saMidi=${saPitch}
          labelOct=${labelOct} labelComma=${labelComma}
          lanes=${laneData ? lanesSide : 'off'} lanesOrder=${lanesOrder} lanesHeadRef=${laneHeadRef}
          onLanesSide=${onLanesSide} onLanesOrder=${onLanesOrder} onLanesHide=${onLanesHide}
          onHoverNote=${gkaOn ? onHoverNote : null}
          onCurvePitch=${onCurvePitch} drawSpan=${curveSpan} markerA=${markA} markerB=${markB}
          tools=${html`<${RollTools} sel=${rollSel} onDelete=${onRollDelete}
            canUndo=${canUndo} onUndo=${onRollUndo}
            paint=${rollPaint} onPaint=${() => { setRollPaint((v) => !v); setRollGamaka(false); }}
            gamaka=${rollGamaka} onGamaka=${() => { setRollGamaka((v) => !v); setRollPaint(false); setCurveHz(''); }}
            gmove=${gmove} onGmove=${hasCurves ? onGmove : null}
            lanes=${laneData ? lanesSide : 'off'} onLanes=${laneData ? onLanesShow : null}
            snap=${curveSnap} onSnap=${() => setCurveSnap((v) => !v)}
            mode=${rollMode} onBack=${onCurveBack}
            hasCurve=${!!(effModel && curveNote() && curveNote().curve)}
            canPaste=${!!curveClip} onClear=${onCurveClear} onCopy=${onCurveCopy} onPaste=${onCurvePaste}
            snap=${curveSnap} onSnap=${() => setCurveSnap((v) => !v)}
            hz=${curveHz} span=${curveSpan}
            onSpan=${(d) => setCurveSpan((v) => Math.min(60, Math.max(10, v + d)))} />`} />
      </div>
    </div>
    <!-- ROW 1, pinned. Outside the panel below, so pushing the grip all the way down cannot
         reach it: room to read is worth nothing if the music cannot be stopped. Stacked only
         — side by side it rides at the top of the notation column with the other rows. -->
    ${stacked && html`<${ChromeRow} ids=${rows[0] || []} p=${ctl} cls="chrome-pinned" />`}
    ${stacked && html`<${EditorDrawer} h=${drawerH} setH=${setDrawer}
      text=${text} onText=${setText}
      gkaOn=${gkaOn} onGkaToggle=${() => setGkaOn((v) => !v)} gkaText=${gkaText} hasGka=${hasGka}
      reading=${reading} onReading=${() => setReading((v) => !v)} onPeek=${gkaOn ? onPeek : null}
      durations=${readingMeta.durations} measure=${readingMeta.measure}
      ragas=${ragaNames} talas=${talaNames} raga=${ragaName} tala=${talaName}
      blank=${noteCount === 0} onRaga=${onPickRaga} onTala=${onPickTala} />`}
    <!-- Pushed off the bottom when the grip goes past shut, and the GRIP IS NOT IN HERE:
         it stays under the roll where a thumb can find it. The first version slid the drawer
         down as well, which sent the only way back off the screen with everything else.

         ONE MOVEMENT, NOT TWO. The negative margin is the whole mechanism: it takes the
         block's height out of the column, the roll's flex claims exactly that much, and the
         block is carried down by the growth. A top: offset on top of that moved it a second
         time — the rows left the screen at twice the rate the roll grew, so they were gone at
         half the travel and the rest of the push opened blank space under the grip. -->
    <div class="below" ref=${belowRef} style=${stacked && drawerH < 0
      ? `margin-bottom:${drawerH}px` : ''}>
    ${stacked && html`<${ChromeBar} rows=${rows.slice(1)} p=${ctl} />`}
    <${Footer} onPerf=${onPerf} />
    </div>
    ${perfOpen && html`<${PerfDialog} perf=${perfRef.current} version=${VERSION}
                                      onReset=${onPerfReset} onClose=${() => setPerfOpen(false)} />`}
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
