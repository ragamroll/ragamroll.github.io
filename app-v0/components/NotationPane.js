import { html } from '../vendor/htm-preact.js';
export function NotationPane({ text, scrollRef, style }) {
  return html`<pre class="pane notation" ref=${scrollRef} style=${style}>${'\n\n\n' + text}</pre>`;  // 3-newline prefix as in the Swing UI
}
