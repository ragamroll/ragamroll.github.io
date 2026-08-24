import { html } from '../vendor/htm-preact.js';
import { pitchLabel } from '../core/roll-model.js';

/**
 * HOW THE ROLL SPELLS A PITCH.
 *
 * The axis names every line it draws, and the name has three parts: the swara, the comma, and
 * the octave. "4.R2b" is the second variety of Ri, its upper comma, in the fourth octave.
 *
 * The octave leads. A label is read left to right and the octave is the coarse half of the
 * address — put last, in a spelling that already ends in a digit and a letter, it was the
 * hardest part to pick out and the easiest to read as part of the name.
 *
 * Both parts come off separately because they answer to different readers. The comma is the
 * finest distinction the roll draws — two 53-EDO steps a syntonic comma apart sharing one
 * swara slot — and someone reading the shape of a phrase does not need it on every line. The
 * octave matters when a piece crosses registers and is noise when it does not.
 *
 * The sample below is the point of the panel: it is spelt by the same function that spells the
 * axis, so what is shown here is what will be drawn there, not a description of it.
 */
const SAMPLE = [['S', 4], ['R2b', 4], ['M1a', 5], ['N3a', 5]];

export function SettingsDialog({ labelOct, labelComma, onLabelOct, onLabelComma, flash, onFlash, onClose }) {
  const close = (e) => { if (e.target === e.currentTarget) onClose(); };
  const opts = { octave: labelOct, comma: labelComma };

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box layout-box" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true"
         aria-label="Settings">
      <div class="dialog-head">
        <strong>Settings · how the roll reads</strong>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body">
        <p class="instr-hint">The names down the top of the roll, on the pitch lines.</p>

        <label class="set-row">
          <input type="checkbox" checked=${labelOct} onChange=${(e) => onLabelOct(e.target.checked)} />
          <span class="set-name">Octave</span>
          <span class="instr-hint">Shown first, with a dot: <code>4.R2b</code> rather than
          <code>R2b</code>. Off is quieter when a piece stays in one register.</span>
        </label>

        <label class="set-row">
          <input type="checkbox" checked=${labelComma} onChange=${(e) => onLabelComma(e.target.checked)} />
          <span class="set-name">Comma</span>
          <span class="instr-hint">The trailing <code>a</code> or <code>b</code>: which of the two
          shrutis a comma apart this line is. Off leaves the swara and its variety —
          <code>R2</code> — and changes nothing about the pitch, only what it is called.</span>
        </label>

        <p class="instr-hint" style="margin-top:.9rem">And while a piece plays.</p>

        <label class="set-row">
          <input type="checkbox" checked=${flash} onChange=${(e) => onFlash(e.target.checked)} />
          <span class="set-name">Note flash</span>
          <span class="instr-hint">A note reverses for a tenth of a second as it is reached. The
          white dot on the playhead says the same thing and says it better — on the pitch rather
          than around it, for the whole note, and riding the curve where there is one — so this
          is here to turn off.</span>
        </label>

        <p class="instr-hint instr-foot">On the axis, that reads:
          ${' '}${SAMPLE.map(([n, o], i) => html`<code key=${n}>${pitchLabel(n, o, opts)}</code>${i < SAMPLE.length - 1 ? ' ' : ''}`)}
        </p>
      </div>
    </div>
  </div>`;
}
