import { html } from '../vendor/htm-preact.js';
import { useState, useEffect } from '../vendor/hooks.module.js';
import { formatSwaraSeq, formatIntervalNumbers, formatTala, padMelaName } from '../core/reference.js';

// A read-only modal reference: mode 'ragas' shows a searchable raga list,
// mode 'talas' shows the tala list. Closes on ✕, backdrop click, or Escape.
// It is a reference overlay — it does NOT change the current composition.
export function ReferenceDialog({ mode, ragas, talas, onClose }) {
  const [q, setQ] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = (e) => e.stopPropagation();   // clicks inside the box don't close it

  let title, body;
  if (mode === 'ragas') {
    title = 'Ragas';
    const names = Object.keys(ragas || {}).sort((a, b) => padMelaName(a).localeCompare(padMelaName(b)));
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? names.filter((n) => padMelaName(n).toLowerCase().includes(needle) || n.toLowerCase().includes(needle))
      : names;
    body = html`<div>
      <div class="ref-controls">
        <input class="dialog-search" type="search" placeholder="filter ragas…" value=${q}
               autofocus onInput=${(e) => setQ(e.target.value)} />
        <div class="dialog-count">${filtered.length} / ${names.length} ragas</div>
      </div>
      <ul class="ref-list">
        ${filtered.map((n) => html`<li key=${n}>
          <span class="ref-name">${padMelaName(n)}</span>
          <div class="ref-cols">
            <span class="ref-seq">${formatSwaraSeq(ragas[n].C12_SWARAS)}</span>
            <span class="ref-int">${formatIntervalNumbers(ragas[n].C12_SWARAS)}</span>
          </div>
        </li>`)}
      </ul>
    </div>`;
  } else {
    title = 'Talas';
    const names = Object.keys(talas || {}).sort((a, b) => a.localeCompare(b));
    body = html`<ul class="ref-list">
      ${names.map((n) => html`<li key=${n}>
        <span class="ref-name">${n}</span>
        <span class="ref-map">${formatTala(talas[n])}</span>
      </li>`)}
    </ul>`;
  }

  return html`<div class="dialog-backdrop" onClick=${onClose}>
    <div class="dialog-box" onClick=${stop} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="dialog-head">
        <strong>${title}</strong>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body">${body}</div>
    </div>
  </div>`;
}
