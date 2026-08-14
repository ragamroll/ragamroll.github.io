import { html } from '../vendor/htm-preact.js';
export function Editor({ value, onInput }) {
  return html`<textarea class="editor" spellcheck="false"
    value=${value} onInput=${e => onInput(e.target.value)}></textarea>`;
}

/**
 * Where a note came from, above the notation it is written in.
 *
 * Another system renders its own notation as srgm and writes, on each note, the fragment
 * of ITS notation that produced this one — the `gka` attribute. This is where that
 * fragment is shown: point at a note on the roll and the strip says what produced it, so
 * a conversion can be checked by eye rather than by reading two notations side by side
 * and holding the correspondence in your head.
 *
 * It is a STRIP, not a tooltip, for two reasons. A tooltip sits over the roll, covering
 * the neighbouring notes you are comparing against; and the fragment can be long, where a
 * tooltip has to be short. It is also the surface a future read-only view will want — one
 * that hides every {…} block and shows bare swaras — which is the same question asked the
 * other way round: what is behind what I am reading.
 *
 * Off by default: most pieces carry no provenance at all, and a permanent empty box at
 * the top of the notation is a cost paid by everyone for a feature few are using.
 */
export function GkaStrip({ on, onToggle, text, has }) {
  return html`<div class=${'gka-strip' + (on ? ' on' : '')}>
    <label class="gka-toggle" title="Show where each note came from — the source notation that produced it">
      <input type="checkbox" checked=${on} onChange=${onToggle} /> source
    </label>
    ${on && html`<div class="gka-value" title=${text || ''}>
      ${text
        ? html`<code>${text}</code>`
        : html`<span class="gka-hint">${has
          ? 'point at a note to see the notation it came from'
          : 'this piece carries no source notation'}</span>`}
    </div>`}
  </div>`;
}
