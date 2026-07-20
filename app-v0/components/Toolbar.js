import { html } from '../vendor/htm-preact.js';
import { OpenMenu } from './OpenMenu.js';
const TIMBRES = [
  ['soft-am', 'Soft'],
  ['bowed-fm', 'Bowed'],
  ['reed', 'Reed'],
];

export function Toolbar({ raga, tala, onOpen, examples, exampleValue, onExample, onOpenRagas, onOpenTalas, onOpenScale, scaleActive, scaleLabel, timbre, onTimbre }) {
  return html`<div class="toolbar">
    <span class="app-badge">RagaM-Roll</span>
    <a class="help-link" href="./help.html" target="_blank" rel="noopener"
       title="Help — notation guide &amp; features">?</a>
    <${OpenMenu} examples=${examples} exampleValue=${exampleValue} onOpen=${onOpen} onExample=${onExample} />
    <button onClick=${onOpenRagas}>Ragas</button>
    <button onClick=${onOpenTalas}>Talas</button>
    <button class=${'scale-btn' + (scaleActive ? ' active' : '')} onClick=${onOpenScale}
            title="Experimental: override the scale pitches (53-EDO)">Scale ⚙${scaleActive ? ' •' : ''}</button>
    <label class="timbre" title="Melody instrument voice (applies on next play)">🎻
      <select value=${timbre} onChange=${(e) => onTimbre(e.target.value)}>
        ${TIMBRES.map(([v, label]) => html`<option key=${v} value=${v}>${label}</option>`)}
      </select>
    </label>
    <span class="readout">${scaleLabel
      ? html`<span class="ovr">scale: ${scaleLabel}</span>`
      : html`raga: ${raga || '—'}`} · tala: ${tala || '—'}</span>
  </div>`;
}
