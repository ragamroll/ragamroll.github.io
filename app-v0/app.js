import { h, render } from './vendor/preact.module.js';
import { useState, useEffect, useMemo, useCallback } from './vendor/hooks.module.js';
import { html } from './vendor/htm-preact.js';
import { parse } from './core/parser.js';
import { seqToLine } from './core/renderers/notation.js';
import { seqToRoll } from './core/renderers/roll.js';
import { setRagas } from './core/raga-base.js';
import { Editor } from './components/Editor.js';
import { NotationPane } from './components/NotationPane.js';
import { RollPane } from './components/RollPane.js';
import { Toolbar } from './components/Toolbar.js';
import { Diagnostics } from './components/Diagnostics.js';
import { buildSequence } from './core/midi/sequence.js';
import { writeSMF } from './core/midi/smf.js';

const EXAMPLES = ['swaravali', 'hamsa', 'vathapi'];
const LS_KEY = 'ragamroll.srgm';

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function App() {
  const [text, setText] = useState(() => localStorage.getItem(LS_KEY) || '');
  const debounced = useDebounced(text, 150);

  useEffect(() => { localStorage.setItem(LS_KEY, text); }, [text]);

  const model = useMemo(() => {
    try { return parse(debounced); } catch { return { events: [], seqProps: {}, diagnostics: [] }; }
  }, [debounced]);

  const notation = useMemo(() => { try { return seqToLine(model.events, 1, 3, true); } catch { return ''; } }, [model]);
  const roll = useMemo(() => { try { return seqToRoll(model.events, model.seqProps); } catch { return ''; } }, [model]);

  const raga = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'raga'); return e ? e.key.join(',') : ''; }, [model]);
  const tala = useMemo(() => { const e = [...model.events].reverse().find(e => e.type === 'tala'); return e ? `beat ${e.props.beat}` : ''; }, [model]);

  const onOpen = useCallback(async (file) => setText(await file.text()), []);
  const onSave = useCallback(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ragamroll.srgm'; a.click();
    URL.revokeObjectURL(a.href);
  }, [text]);
  const onExportMidi = useCallback(() => {
    const bytes = writeSMF(buildSequence(model));
    const blob = new Blob([bytes], { type: 'audio/midi' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ragamroll-' + new Date().toISOString().replace(/[:.]/g, '-') + '.mid';  // spec §4.5: timestamped export
    a.click();
    URL.revokeObjectURL(a.href);
  }, [model]);
  const onExample = useCallback(async (name) => {
    if (!name) return;
    const r = await fetch(`./examples/${name}.srgm`); setText(await r.text());
  }, []);

  return html`
    <${Toolbar} raga=${raga} tala=${tala} examples=${EXAMPLES}
                onOpen=${onOpen} onSave=${onSave} onExportMidi=${onExportMidi} onExample=${onExample} />
    <${Diagnostics} items=${model.diagnostics} />
    <div class="cols">
      <${Editor} value=${text} onInput=${setText} />
      <${RollPane} text=${roll} />
    </div>
    <${NotationPane} text=${notation} />
  `;
}

// Load raga data (browser), then mount.
fetch('./core/raga-base.json')
  .then(r => r.json())
  .then(data => { setRagas(data); render(h(App, {}), document.getElementById('app')); });
