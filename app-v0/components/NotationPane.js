import { html } from '../vendor/htm-preact.js';
export function NotationPane({ text }) {
  return html`<pre class="pane notation">${'\n\n\n' + text}</pre>`;  // 3-newline prefix as in the Swing UI
}
