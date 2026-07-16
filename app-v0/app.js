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
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';
import { createPlayer } from './audio/player.js';
import { scheduleEvents, totalSeconds } from './audio/schedule.js';
import { scrollPos } from './audio/scroll.js';
import { Transport } from './components/Transport.js';

const EXAMPLES = ['swaravali', 'hamsa', 'vathapi'];
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

  const raga = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key.join(',') : ''; }, [model]);
  const tala = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'tala'); return e ? `beat ${e.props.beat}` : ''; }, [model]);

  // Opening a file / picking an example remembers its name, so Save and Export
  // suggest the same base name instead of a fixed "ragamroll".
  const onOpen = useCallback(async (file) => { setDocName(baseName(file.name)); setText(await file.text()); }, []);
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
    if (!name) return;
    const r = await fetch(`./examples/${name}.srgm`); setDocName(baseName(name)); setText(await r.text());
  }, []);

  // --- Playback: player instance, scroll refs, rAF loop, transport handlers ---
  const playerRef = useRef(null);
  if (!playerRef.current) playerRef.current = createPlayer('tone');
  const rollRef = useRef(null);
  const notationRef = useRef(null);
  const rafRef = useRef(0);
  const [playState, setPlayState] = useState('stopped');

  const noteCount = useMemo(() => model.events.filter(e => e.type === 'note' && !e.rest).length, [model]);

  const applyScroll = useCallback(() => {
    const pos = playerRef.current.position();
    for (const r of [rollRef.current, notationRef.current]) {
      if (r) r.scrollTop = scrollPos(pos, r.scrollHeight, r.clientHeight);
    }
    return pos;
  }, []);

  // Idempotent: may fire from both the rAF pos>=1 guard and the backend's
  // onended callback for the same end — cancel/stop/reset are all safe twice.
  const onStop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.stop();
    setPlayState('stopped');
    for (const r of [rollRef.current, notationRef.current]) { if (r) r.scrollTop = 0; }
  }, []);

  const loop = useCallback(() => {
    const pos = applyScroll();
    if (pos >= 1) { onStop(); return; }
    rafRef.current = requestAnimationFrame(loop);
  }, [applyScroll, onStop]);

  const onPlay = useCallback(async () => {
    const player = playerRef.current;
    try {
      if (playState !== 'paused') { // stopped → build + load; paused → just resume
        const seq = buildSequence(model);
        if (totalSeconds(seq) <= 0) return;
        player.onended = () => onStop();
        player.load(scheduleEvents(seq), totalSeconds(seq));
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
  }, [model, playState, loop, onStop]);

  const onPause = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    playerRef.current.pause();
    setPlayState('paused');
  }, []);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); playerRef.current?.dispose(); }, []);

  // --- Read-only raga/tala reference dialogs (one open at a time) ---
  const [dialog, setDialog] = useState(null);   // null | 'ragas' | 'talas'
  const onOpenRagas = useCallback(() => setDialog('ragas'), []);
  const onOpenTalas = useCallback(() => setDialog('talas'), []);
  const onCloseDialog = useCallback(() => setDialog(null), []);

  return html`
    <${Toolbar} raga=${raga} tala=${tala} examples=${EXAMPLES}
                onOpen=${onOpen} onSave=${onSave} onExportMidi=${onExportMidi} onExample=${onExample}
                onOpenRagas=${onOpenRagas} onOpenTalas=${onOpenTalas} />
    ${dialog && html`<${ReferenceDialog} mode=${dialog} ragas=${getRagas()} talas=${TALA_MAP}
                                         onClose=${onCloseDialog} />`}
    <${Transport} state=${playState} canPlay=${noteCount > 0}
                  onPlay=${onPlay} onPause=${onPause} onStop=${onStop} />
    <${Diagnostics} items=${model.diagnostics} />
    <div class="cols">
      <${Editor} value=${text} onInput=${setText} />
      <${RollPane} text=${roll} scrollRef=${rollRef} />
    </div>
    <${NotationPane} text=${notation} scrollRef=${notationRef} />
  `;
}

// Load raga data (browser), then mount.
fetch('./core/raga-base.json')
  .then(r => r.json())
  .then(data => { setRagas(data); render(h(App, {}), document.getElementById('app')); });
