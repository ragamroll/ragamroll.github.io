import { html } from '../vendor/htm-preact.js';
import { OpenMenu } from './OpenMenu.js';
export function Toolbar({ raga, tala, onOpen, examples, exampleValue, onExample, onOpenRagas, onOpenTalas }) {
  return html`<div class="toolbar">
    <span class="app-badge">RagaM-Roll</span>
    <${OpenMenu} examples=${examples} exampleValue=${exampleValue} onOpen=${onOpen} onExample=${onExample} />
    <button onClick=${onOpenRagas}>Ragas</button>
    <button onClick=${onOpenTalas}>Talas</button>
    <span class="readout">raga: ${raga || '—'} · tala: ${tala || '—'}</span>
  </div>`;
}
