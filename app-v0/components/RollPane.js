import { html } from '../vendor/htm-preact.js';
export function RollPane({ text, scrollRef }) {
  return html`<pre class="pane roll" ref=${scrollRef}>${text}</pre>`;
}
