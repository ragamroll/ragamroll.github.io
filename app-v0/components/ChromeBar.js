import { html } from '../vendor/htm-preact.js';
import { CONTROL_COMPONENTS } from './Controls.js';

/**
 * The chrome under the roll, drawn from the layout rather than written out.
 *
 * ROW ORDER IS PRIORITY ORDER. The panel below is clipped from the bottom when the notation
 * grip is pushed past shut, so the last row is the first to go. Row 1 is not in the panel at
 * all: it sits directly beneath the roll and is never clipped, which is what makes it safe to
 * push everything else away — a reader who cannot stop the music has been given no room, only
 * a problem.
 */
export function ChromeRow({ ids, p, cls = '' }) {
  return html`<div class=${'chrome-row ' + cls}>
    ${ids.map((id) => {
      const C = CONTROL_COMPONENTS[id];
      return C ? html`<${C} key=${id} p=${p} />` : null;
    })}
  </div>`;
}

export function ChromeBar({ rows, p }) {
  return html`${rows.map((ids, i) => html`<${ChromeRow} key=${i} ids=${ids} p=${p} />`)}`;
}
