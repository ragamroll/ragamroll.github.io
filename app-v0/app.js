import { h, render } from './vendor/preact.module.js';
import { useState, useEffect, useMemo, useCallback, useRef } from './vendor/hooks.module.js';
import { html } from './vendor/htm-preact.js';
import { parse, TALA_MAP } from './core/parser.js';
import { seqToLine } from './core/renderers/notation.js';
import { seqToRoll } from './core/renderers/roll.js';
import { setRagas, getRagas } from './core/raga-base.js';
import { Editor } from './components/Editor.js';
import { NotationPane } from './components/NotationPane.js';
import { RollPane } from './components/RollPane.js';
import { Toolbar } from './components/Toolbar.js';
import { Diagnostics } from './components/Diagnostics.js';
import { ReferenceDialog } from './components/ReferenceDialog.js';
import { ScaleDialog } from './components/ScaleDialog.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';
import { createPlayer } from './audio/player.js';
import { scheduleEvents, totalSeconds, midiToFreq } from './audio/schedule.js';
import { PITCH_CLASS } from './core/tuning.js';
import { stepForLetter, stepFreq, P_STEP } from './core/shruti.js';
import { melaOfScale } from './core/melakarta.js';
import { scrollPos, playheadScroll } from './audio/scroll.js';
import { buildRowTimes, rowAt } from './audio/rowtimes.js';
import { Transport } from './components/Transport.js';
import { Splitter } from './components/Splitter.js';
import { Footer } from './components/Footer.js';

const EXAMPLES = ['swaravali', 'hamsa', 'vathapi'];
const LS_KEY = 'ragamroll.srgm';
const LS_NAME = 'ragamroll.docname';
const DEFAULT_NAME = 'ragamroll';

// Derive a document base-name (no extension) from an opened file / example name.
function baseName(name) {
  const stripped = String(name || '').replace(/\.[^./\\]+$/, '').trim();
  return stripped || DEFAULT_NAME;
}

const mod12 = (x) => ((x % 12) + 12) % 12;

// 12-TET pitch class of Sa for the model's active raga (incl. Raga transpose).
// Drives both the drone and the 53-EDO retune. Falls back to C / no transpose.
function saBaseOf(model, ragas) {
  const rev = [...model.events].reverse();
  const key = rev.find((e) => e.type === 'raga')?.key || ['c12', '0'];
  const semis = Number.parseInt(key[1], 10) || 0;
  const saNote = ragas?.[key[0]]?.C12_SWARAS?.S ?? 'C';
  return (PITCH_CLASS[saNote] ?? 0) + semis;
}

// Mutate a built sequence's melody notes with an experimental playback pitch
// (n.freq): a 53-EDO scale override and/or a whole-audio semitone transpose
// (from a user-set Sa). MIDI export never reads n.freq, so goldens are
// untouched; only the audio path (schedule.js) carries it. Iterates
// model.events with the SAME filter buildSequence uses → notes align by index.
function applyPlaybackPitch(seq, model, scale, saBase, shift) {
  if (!scale && !shift) return;                 // pure 12-TET, no override → default path
  const notes = seq.tracks[0].notes;
  const PER = seq.ppq / 2;                       // buildSequence: 1 length-unit = eighth
  let i = 0;
  for (const e of model.events) {
    if (e.type !== 'note' || e.rest) continue;
    if (Math.round(e.absLen * PER) <= 0) continue;
    const m = notes[i]?.pitch;
    if (m != null) {
      const step = scale ? stepForLetter(scale, e.swara) : null;
      if (step != null) {
        const saMidi = m - mod12(m - saBase) + shift;   // Sa at this note's octave, transposed
        notes[i].freq = stepFreq(midiToFreq(saMidi), step);
      } else if (shift) {
        notes[i].freq = midiToFreq(m + shift);          // 12-TET note, transposed
      }
    }
    i++;
  }
}

// Sustained drone voices (frequencies) for a given Sa MIDI: S · P · >S
// (Sa, Pa above Sa, upper Sa an octave up).
function droneFreqs(saMidi) {
  const saFreq = midiToFreq(saMidi);
  return [saFreq, stepFreq(saFreq, P_STEP), saFreq * 2];   // S, P, >S
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function App() {
  const [text, setText] = useState(() => localStorage.getItem(LS_KEY) || '');
  const [docName, setDocName] = useState(() => localStorage.getItem(LS_NAME) || DEFAULT_NAME);
  const debounced = useDebounced(text, 150);

  useEffect(() => { localStorage.setItem(LS_KEY, text); }, [text]);
  useEffect(() => { localStorage.setItem(LS_NAME, docName); }, [docName]);

  const model = useMemo(() => {
    try { return parse(debounced); } catch { return { events: [], seqProps: {}, diagnostics: [] }; }
  }, [debounced]);

  const notation = useMemo(() => { try { return seqToLine(model.events, 1, 3, true); } catch { return ''; } }, [model]);
  const roll = useMemo(() => { try { return seqToRoll(model.events, model.seqProps); } catch { return ''; } }, [model]);
  // Tempo override (null = the composition's T directive, else 120). Applied by
  // cloning the model with meta.tempo replaced, so audio (buildSequence) and the
  // playhead (buildRowTimes) both use it and stay in sync.
  const compositionTempo = useMemo(() => (model.meta?.tempo > 0 ? model.meta.tempo : 120), [model]);
  const [tempoOverride, setTempoOverride] = useState(null);
  const effectiveTempo = tempoOverride ?? compositionTempo;
  const onTempo = useCallback((v) => { if (v >= 20 && v <= 400) setTempoOverride(v); }, []);
  const onResetTempo = useCallback(() => setTempoOverride(null), []);
  const effModel = useMemo(
    () => (tempoOverride ? { ...model, meta: { ...model.meta, tempo: tempoOverride } } : model),
    [model, tempoOverride]);

  // Exact audio start-second of each roll row (rests included) — the playhead's
  // row->time map. Same (tempo-effective) model as the audio, so the two can't drift.
  const rowTimes = useMemo(() => { try { return buildRowTimes(effModel); } catch { return []; } }, [effModel]);

  const raga = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key.join(',') : ''; }, [model]);
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
    const r = await fetch(`./examples/${name}.srgm`); setExampleValue(name); setDocName(baseName(name)); setText(await r.text());
  }, []);

  // --- Playback: player instance, scroll refs, rAF loop, transport handlers ---
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createPlayer('tone');
  const rollRef = useRef(null);
  const notationRef = useRef(null);
  const rafRef = useRef(0);
  // Index of the roll line currently carrying the .active highlight (-1 = none).
  // Updated imperatively per frame — never via re-render.
  const activeRowRef = useRef(-1);
  // Snapshots taken when a sequence is LOADED (Play from stopped): total seconds
  // and the row->time map of what is actually playing. Editing mid-play rebuilds
  // the live `rowTimes`, but the audio keeps playing the loaded sequence — these
  // refs keep the highlight in sync with the sound, not with the edit.
  const loadedTotalRef = useRef(0);
  const loadedRowTimesRef = useRef([]);
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
  const [droneMuted, setDroneMuted] = useState(true);
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

  // Roll text change re-renders the line divs (Preact may reuse nodes, which
  // would keep an imperatively-added .active class): drop any lingering
  // highlight and forget the index so a stale row isn't left marked. If
  // playback is running, the next rAF frame re-applies the highlight.
  useEffect(() => {
    rollRef.current?.children[activeRowRef.current]?.classList.remove('active');
    activeRowRef.current = -1;
  }, [roll]);

  const applyScroll = useCallback(() => {
    const pos = playerRef.current.position();
    // Roll: highlight the row whose exact start time has been reached at the
    // AUDIBLE instant (transport seconds minus output latency), and keep it
    // centered (clamped at the ends).
    const el = rollRef.current;
    const rt = loadedRowTimesRef.current;
    if (el && rt && rt.length) {
      const rows = el.children;
      const totalRows = rows.length;
      const rowH = rows[0] ? rows[0].offsetHeight : 0;
      const t = pos * loadedTotalRef.current - playerRef.current.latency();
      const activeRow = Math.min(totalRows - 1, Math.max(0, rowAt(rt, t)));
      if (activeRowRef.current !== activeRow) {
        rows[activeRowRef.current]?.classList.remove('active');
        rows[activeRow]?.classList.add('active');
        activeRowRef.current = activeRow;
      }
      el.scrollTop = playheadScroll(activeRow, rowH, el.scrollHeight, el.clientHeight);
    }
    // Notation: keeps its linear position-proportional scroll.
    const n = notationRef.current;
    if (n) n.scrollTop = scrollPos(pos, n.scrollHeight, n.clientHeight);
    return pos;
  }, []);

  // Idempotent: may fire from both the rAF pos>=1 guard and the backend's
  // onended callback for the same end — cancel/stop/reset are all safe twice.
  const onStop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.stop();
    setPlayState('stopped');
    const el = rollRef.current;
    if (el) el.children[activeRowRef.current]?.classList.remove('active');
    activeRowRef.current = -1;
    for (const r of [rollRef.current, notationRef.current]) { if (r) r.scrollTop = 0; }
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
        player.load(scheduleEvents(seq), totalSeconds(seq), { talaGain: talaLevel });
        // Snapshot what was loaded: the playhead must follow the PLAYING audio
        // even if the user edits (and rowTimes rebuilds) mid-playback.
        loadedTotalRef.current = totalSeconds(seq);
        loadedRowTimesRef.current = rowTimes;
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
  }, [effModel, rowTimes, playState, loop, onStop, talaLevel, scale, saBase, shift]);

  const onPause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.pause();
    setPlayState('paused');
  }, []);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); playerRef.current?.dispose(); }, []);

  // Constant drone: on/off toggle, re-voiced when the raga's Sa changes. Kept
  // outside the transport so it plays independently of start/stop.
  useEffect(() => {
    playerRef.current.setDrone(droneLevel > 0 ? droneFreqs(saMidi) : null, droneLevel);
  }, [droneLevel, saMidi]);

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

  // --- Draggable pane dividers (like the original JSplitPane). The workspace is
  // a bounded flex column: the top row (editor|roll) and the notation pane SHARE
  // the available height via topFrac, so a divider drag reallocates between them
  // rather than growing the page; the footer stays put. ---
  const colsRef = useRef(null);
  const wsRef = useRef(null);
  const [leftPct, setLeftPct] = useState(50);    // editor width fraction of the top row
  const [topFrac, setTopFrac] = useState(0.6);   // top row's share of the workspace height
  const onVDrag = useCallback((clientX) => {
    const el = colsRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setLeftPct(Math.max(15, Math.min(85, ((clientX - r.left) / r.width) * 100)));
  }, []);
  const onHDrag = useCallback((clientX, clientY) => {
    const el = wsRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setTopFrac(Math.max(0.15, Math.min(0.85, (clientY - r.top) / r.height)));
  }, []);

  return html`
    <${Toolbar} raga=${raga} tala=${tala} examples=${EXAMPLES} exampleValue=${exampleValue}
                onOpen=${onOpen} onExample=${onExample}
                onOpenRagas=${onOpenRagas} onOpenTalas=${onOpenTalas}
                onOpenScale=${onOpenScale} scaleActive=${!!scale} scaleLabel=${scaleLabel}
                timbre=${timbre} onTimbre=${onTimbre} />
    ${(dialog === 'ragas' || dialog === 'talas') && html`<${ReferenceDialog} mode=${dialog}
                                         ragas=${getRagas()} talas=${TALA_MAP} onClose=${onCloseDialog} />`}
    ${dialog === 'scale' && html`<${ScaleDialog} scale=${scale} onApply=${onApplyScale} onClose=${onCloseDialog}
                                                 saPitch=${saPitch} autoSaMidi=${autoSaMidi} onSetSa=${onSetSa}
                                                 ragas=${getRagas()} />`}
    <${Transport} state=${playState} canPlay=${noteCount > 0}
                  onPlay=${onPlay} onPause=${onPause} onStop=${onStop}
                  tempo=${effectiveTempo} onTempo=${onTempo} tempoOverridden=${tempoOverride != null} onResetTempo=${onResetTempo}
                  masterVol=${masterVol} onMasterVol=${onMasterVol}
                  melodyMuted=${melodyMuted} onToggleMelody=${onToggleMelody}
                  talaVol=${talaVol} onTalaVol=${onTalaVol} talaMuted=${talaMuted} onToggleTala=${onToggleTala}
                  droneVol=${droneVol} onDroneVol=${onDroneVol} droneMuted=${droneMuted} onToggleDrone=${onToggleDrone}
                  onSave=${onSave} onExportMidi=${onExportMidi} />
    <${Diagnostics} items=${model.diagnostics} />
    <div class="workspace" ref=${wsRef}>
      <div class="cols" ref=${colsRef}
           style=${`flex:${topFrac} 1 0; grid-template-columns:${leftPct}fr 6px ${100 - leftPct}fr`}>
        <${Editor} value=${text} onInput=${setText} />
        <${Splitter} orientation="v" onResize=${onVDrag} />
        <${RollPane} text=${roll} scrollRef=${rollRef} />
      </div>
      <${Splitter} orientation="h" onResize=${onHDrag} />
      <${NotationPane} text=${notation} scrollRef=${notationRef} style=${`flex:${1 - topFrac} 1 0`} />
    </div>
    <${Footer} />
  `;
}

// Load raga data (browser), then mount.
fetch('./core/raga-base.json')
  .then(r => r.json())
  .then(data => { setRagas(data); render(h(App, {}), document.getElementById('app')); });
