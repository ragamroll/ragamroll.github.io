import { html } from '../vendor/htm-preact.js';
export function Toolbar({ raga, tala, onOpen, onSave, onExportMidi, examples, onExample, onOpenRagas, onOpenTalas }) {
  return html`<div class="toolbar">
    <button onClick=${onSave}>Save</button>
    <button onClick=${onExportMidi}>Export MIDI</button>
    <button onClick=${onOpenRagas}>Ragas</button>
    <button onClick=${onOpenTalas}>Talas</button>
    <label class="fileopen">Open
      <input type="file" accept=".srgm,.txt" style="display:none"
        onChange=${e => e.target.files[0] && onOpen(e.target.files[0])} />
    </label>
    <select onChange=${e => onExample(e.target.value)}>
      <option value="">Examples…</option>
      ${examples.map(x => html`<option value=${x}>${x}</option>`)}
    </select>
    <span class="readout">raga: ${raga || '—'} · tala: ${tala || '—'}</span>
  </div>`;
}
