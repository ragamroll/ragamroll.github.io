import { html } from '../vendor/htm-preact.js';
// One element per roll line so the rAF playhead can highlight the active row
// imperatively (classList) without a Preact re-render. The trailing '\n' that
// seqToRoll emits is dropped so the div count equals rowTimes.length (the
// playhead's row->time map indexes align 1:1 with the rendered lines).
export function RollPane({ text, scrollRef }) {
  const lines = text.replace(/\n$/, '').split('\n');
  return html`<div class="pane roll" ref=${scrollRef}>
    ${lines.map((ln, i) => html`<div class="roll-line" key=${i}>${ln || ' '}</div>`)}
  </div>`;
}
