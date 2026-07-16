import { html } from '../vendor/htm-preact.js';
import { useState } from '../vendor/hooks.module.js';
import { formatSwaraSeq, formatRagaSwaras, formatTala } from '../core/reference.js';

export function ReferencePanel({ ragas, talas, onClose }) {
  const [q, setQ] = useState('');
  const ragaNames = Object.keys(ragas || {}).sort();
  const needle = q.trim().toLowerCase();
  const filtered = needle ? ragaNames.filter((n) => n.toLowerCase().includes(needle)) : ragaNames;
  const talaNames = Object.keys(talas || {});

  return html`<div class="reference">
    <div class="reference-head">
      <strong>Ragas & Talas</strong>
      <button title="Close" onClick=${onClose}>✕</button>
    </div>
    <div class="reference-body">
      <section class="ref-ragas">
        <h4>Ragas (${filtered.length}/${ragaNames.length})</h4>
        <input type="search" placeholder="filter ragas…" value=${q}
               onInput=${(e) => setQ(e.target.value)} />
        <ul class="ref-list">
          ${filtered.map((n) => html`<li key=${n}>
            <span class="ref-name">${n}</span>
            <span class="ref-seq">${formatSwaraSeq(ragas[n].C12_SWARAS)}</span>
            <span class="ref-map">${formatRagaSwaras(ragas[n].C12_SWARAS)}</span>
          </li>`)}
        </ul>
      </section>
      <section class="ref-talas">
        <h4>Talas (${talaNames.length})</h4>
        <ul class="ref-list">
          ${talaNames.map((n) => html`<li key=${n}>
            <span class="ref-name">${n}</span>
            <span class="ref-map">${formatTala(talas[n])}</span>
          </li>`)}
        </ul>
      </section>
    </div>
  </div>`;
}
