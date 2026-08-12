import { html } from '../vendor/htm-preact.js';

// The row above the notation box: which raga and which tala the piece is in.
//
// Both apply to a BLANK piece only, and say so. Picking a raga does not just set a
// directive — it SEEDS the piece with that raga's own notation, so a blank page becomes
// something to play and then edit rather than an empty box you have to know how to fill.
// Once there are notes the pickers lock, because changing the raga under written swaras
// would re-spell every one of them.
//
// The Ragas and Talas dialogs in the toolbar are the browsers — they show what a raga IS.
// These are the quick pick, for when you already know.
export function EditTools({ ragas, talas, raga, tala, blank, onRaga, onTala }) {
  return html`<div class="edittools">
    <label class="tog">Raga
      <input list="app-ragalist" value=${raga} disabled=${!blank} placeholder="type / pick…"
             autocomplete="off" onChange=${(e) => onRaga(e.target.value.trim())} />
    </label>
    <datalist id="app-ragalist">${ragas.map((n) => html`<option key=${n} value=${n} />`)}</datalist>
    <label class="tog">Tala
      <select value=${tala} disabled=${!blank} onChange=${(e) => onTala(e.target.value)}>
        ${talas.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
      </select>
    </label>
    <span class="hint">${blank
      ? 'pick a raga / tala, then type swaras below'
      : 'raga · tala locked while notes exist'}</span>
  </div>`;
}
