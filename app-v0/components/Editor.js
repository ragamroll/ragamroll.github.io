import { html } from '../vendor/htm-preact.js';
export function Editor({ value, onInput }) {
  return html`<textarea class="editor" spellcheck="false"
    value=${value} onInput=${e => onInput(e.target.value)}></textarea>`;
}
