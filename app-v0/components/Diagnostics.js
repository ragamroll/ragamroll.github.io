import { html } from '../vendor/htm-preact.js';
export function Diagnostics({ items }) {
  if (!items || items.length === 0) return null;
  return html`<div class="diagnostics">
    <strong>${items.length} notation issue${items.length > 1 ? 's' : ''}:</strong>
    <ul>${items.map(d => html`<li><code>${d.token}</code> — ${d.message}</li>`)}</ul>
  </div>`;
}
