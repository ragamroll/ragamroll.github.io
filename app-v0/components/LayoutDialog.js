import { html } from '../vendor/htm-preact.js';
import { useState, useRef } from '../vendor/hooks.module.js';
import { DEFAULT_ROWS, readLayout, layoutFile, isDefaultLayout } from '../core/chrome-layout.js';
import { CONTROL_NAMES } from './Controls.js';

/**
 * WHERE THE CONTROLS SIT, and how to keep it.
 *
 * The arrangement is data — rows of control ids in core/chrome-layout.js — remembered in this
 * browser as it changes. That is enough until the browser's storage is cleared, or the reader
 * picks up a different machine, or the arrangement is good enough to be the one everybody
 * gets. So it comes down to a file and goes back up again, the same road the instrument panel
 * takes: ⭳ Save writes layout.json, tools/apply-layout.mjs folds that file into the built-in
 * default, and the next release opens that way for every reader.
 *
 * The rows are shown rather than edited. What they are is the part a reader needs before
 * pressing Save on them — and after a Load, it is the answer to "what did that do", which is a
 * question no message can settle as well as the list itself.
 */
export function LayoutDialog({ rows, onSet, onClose }) {
  // What a load did, said IN the panel, where the reader is looking. A file that was refused,
  // or one that was short a control, is not something to leave in the console.
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const close = (e) => { if (e.target === e.currentTarget) onClose(); };

  const save = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([layoutFile(rows)], { type: 'application/json' }));
    a.download = 'layout.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // And back in again. readLayout is the forgiving one on purpose: it drops ids this build
  // does not have and puts back any it never saw, because a layout's failure mode is a
  // control with no way to reach it. Whatever it had to do, it says so — and the list below
  // then shows the result, which is the check the reader can actually make.
  const load = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';                       // so picking the SAME file again still fires
    if (!f) return;
    let out;
    try { out = readLayout(await f.text()); }
    catch { out = { ok: false, error: 'That file could not be read.' }; }
    if (!out.ok) { setMsg({ bad: true, text: out.error }); return; }
    onSet(out.rows);
    setMsg({ bad: false, text: `Loaded ${f.name}. ${out.notes.length ? out.notes.join('. ') + '. ' : ''}`
      + 'This is the arrangement now — remembered in this browser, so it survives the reload.' });
  };

  const reset = () => { onSet(DEFAULT_ROWS.map((r) => r.slice())); setMsg(null); };

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box layout-box" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true"
         aria-label="Layout">
      <div class="dialog-head">
        <strong>Layout · where the controls sit</strong>
        <button class="instr-save" title="Download this arrangement as a file — tools/apply-layout.mjs makes it the built-in one"
                onClick=${save}>⭳ Save</button>
        <button class="instr-save" title="Load an arrangement from a file saved here before"
                onClick=${() => fileRef.current && fileRef.current.click()}>⭱ Load</button>
        <input ref=${fileRef} class="instr-file" type="file" accept="application/json,.json" onChange=${load} />
        <button title="Back to the built-in arrangement" disabled=${isDefaultLayout(rows)}
                onClick=${reset}>Reset</button>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body">
        ${msg && html`<p class=${'instr-hint instr-msg' + (msg.bad ? ' instr-bad' : '')}>${msg.text}</p>`}
        <p class="instr-hint">Row order is priority order. Pulling the notation grip below shut
        pushes this panel off the bottom of the screen, so the LAST row is the first to go —
        and row 1 sits outside the panel, under the roll, where nothing can push it. That is
        where what you need while a piece is playing belongs.</p>
        ${rows.map((row, i) => html`<div key=${i} class="layout-row">
          <span class="layout-tag">${i === 0 ? 'pinned' : i + 1}</span>
          <span class="layout-ids">${row.length
            ? row.map((id) => html`<code key=${id} title=${id}>${CONTROL_NAMES[id] || id}</code>`)
            : html`<em>empty</em>`}</span>
        </div>`)}
        <p class="instr-hint instr-foot">To change it, edit the saved file and load it back:
        the names above are these ids in the file. A control the file leaves out is not lost —
        it comes back on the last row, because a button with no way to it is worse than a
        button in the wrong place.</p>
      </div>
    </div>
  </div>`;
}
