import { html } from '../vendor/htm-preact.js';
import { readingBlocks } from '../core/gamaka-inline.js';

/**
 * The notation, to write in or to read.
 *
 * READING is a different job from writing, and the notation is written for the writer: one
 * gamaka is ten pairs of numbers, so a line of eight ornamented swaras runs to four hundred
 * characters of which eight are the music. You cannot see the phrase for the curves.
 *
 * So the read-only view prints the swaras and folds every {…} to a mark — ∿ where the block
 * holds a pitch curve, · where it holds anything else. The mark is the point: it says a note
 * is ornamented without saying how, and it can be pointed at to see what is behind it. The
 * source is untouched; this is a way of looking, not an edit.
 */
export function Editor({ value, onInput, readOnly, onPeek, durations, measure }) {
  if (!readOnly) {
    return html`<textarea class="editor" spellcheck="false"
      value=${value} onInput=${e => onInput(e.target.value)}></textarea>`;
  }
  // Swara lines FLOW into each other; everything else keeps the line it was written on.
  // Folding turns a four-hundred-character line into a dozen characters, which would
  // otherwise leave the pane four-fifths empty and the piece as long to scroll as before.
  const mark = (p, k) => html`<span key=${k} class=${'fold' + (p.curve ? ' curve' : '')} title=${p.body}
    onMouseEnter=${() => onPeek && onPeek(p.body)}
    onMouseLeave=${() => onPeek && onPeek('')}>${p.curve ? '∿' : '·'}</span>`;
  // Grouped by AVARTANA where the tala allows it: a line of swaras begins where a cycle
  // begins, which is how the notation is read. A group that could not close on a boundary
  // says so — the piece does not line up there, and drawing a cycle mark where there is
  // none would be worse than admitting it.
  const blocks = readingBlocks(value, { durations, measure });
  return html`<div class="editor reading" aria-readonly="true">${blocks.map((bk, i) => html`<div
    key=${i} class=${'ln ' + bk.kind + (bk.ragged ? ' ragged' : '')}
    title=${bk.kind === 'notes' && bk.cycles ? (bk.ragged ? 'does not close on a tala cycle' : `${bk.cycles} avartana${bk.cycles > 1 ? 's' : ''}`) : null}
    >${bk.parts.map((p, k) => (p.text !== undefined ? p.text : mark(p, k)))}</div>`)}</div>`;
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
export function GkaStrip({ on, onToggle, text, has, reading, onReading }) {
  return html`<div class=${'gka-strip' + (on ? ' on' : '')}>
    <!-- Two ways of looking at the same notation, in one row: what is folded away, and what
         is behind the fold. They belong together — turning the first on is what makes the
         second worth having. -->
    <label class="gka-toggle" title="Read the swaras with every {…} folded to a mark. The notation itself is not changed.">
      <input class="gka-read" type="checkbox" checked=${reading} onChange=${onReading} /> read
    </label>
    <label class="gka-toggle" title="Show where each note came from — the source notation that produced it">
      <input class="gka-source" type="checkbox" checked=${on} onChange=${onToggle} /> source
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
