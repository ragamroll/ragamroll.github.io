import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useMemo } from '../vendor/hooks.module.js';
import { BOXES, EDO, twin, regionOf, selectionToScale, nameForSlot } from '../core/shruti.js';

// Experimental scale-pitch override. A linear strip of the 22 shrutis (53-EDO);
// tick two in R/G (lower→R, higher→G), one M, two in D/N (lower→D, higher→N).
// S and P are fixed. "Apply" pushes the 53-EDO scale up as a playback retune;
// "Reset" removes the override (back to the ragabase 12-TET pitches).
const cents = (step) => Math.round((step / EDO) * 1200);

export function ScaleDialog({ scale, onApply, onClose }) {
  const [sel, setSel] = useState(() =>
    scale ? new Set([scale.R, scale.G, scale.M, scale.D, scale.N]) : new Set());

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (step) => setSel((prev) => {
    const next = new Set(prev);
    if (next.has(step)) { next.delete(step); return next; }
    const t = twin(step);
    if (t != null) next.delete(t);                 // a/b of one variety are exclusive
    const region = regionOf(step);
    const cap = region === 'M' ? 1 : 2;
    const inRegion = [...next].filter((s) => regionOf(s) === region);
    if (inRegion.length >= cap) next.delete(inRegion[0]);   // drop oldest (Set keeps insertion order)
    next.add(step);
    return next;
  });

  const built = useMemo(() => selectionToScale(sel), [sel]);
  // step -> slot letter, for per-box highlight of which swara each pick became
  const slotOf = useMemo(() => {
    const m = new Map();
    if (built) for (const L of ['R', 'G', 'M', 'D', 'N']) m.set(built[L], L);
    return m;
  }, [built]);

  const stop = (e) => e.stopPropagation();

  const boxEl = (bx) => {
    if (bx.fixed) {
      return html`<div class="shruti-box fixed" key=${bx.step} title=${'fixed · ' + cents(bx.step) + '¢'}>
        <span class="sh-step">${bx.step}</span>
        <span class="sh-name">${bx.names[0]}</span>
        <span class="sh-mark">●</span>
      </div>`;
    }
    const picked = sel.has(bx.step);
    const twinOff = !picked && twin(bx.step) != null && sel.has(twin(bx.step));
    const slot = slotOf.get(bx.step);
    const cls = 'shruti-box r-' + bx.region.toLowerCase()
      + (picked ? ' picked' + (slot ? ' slot-' + slot : '') : '')
      + (twinOff ? ' twin-off' : '');
    return html`<button class=${cls} key=${bx.step} onClick=${() => toggle(bx.step)}
                        title=${bx.names.join(' / ') + ' · ' + cents(bx.step) + '¢'}>
      <span class="sh-step">${bx.step}</span>
      <span class="sh-name">${bx.names[0]}</span>
      <span class="sh-alt">${bx.names[1] || ''}</span>
      <span class="sh-mark">${picked ? (slot || '✓') : ''}</span>
    </button>`;
  };

  const readout = built
    ? ['S', 'R', 'G', 'M', 'P', 'D', 'N'].map((L) => nameForSlot(built[L], L)).join('  ')
    : '— pick 2 in R/G, 1 in M, 2 in D/N —';
  const stepsLine = built
    ? ['S', 'R', 'G', 'M', 'P', 'D', 'N'].map((L) => built[L]).join('  ')
    : '';

  return html`<div class="dialog-backdrop" onClick=${onClose}>
    <div class="dialog-box scale-box" onClick=${stop} role="dialog" aria-modal="true" aria-label="Scale pitches">
      <div class="dialog-head">
        <strong>Scale pitches · experimental</strong>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="scale-hint">Override the ragabase pitches for playback (53-EDO). Lower pick →
          R/D, higher → G/N; a and b of one variety are exclusive.</div>
        <div class="shruti-strip">
          ${BOXES.map(boxEl)}
        </div>
        <div class="scale-readout">
          <div><span class="lbl">scale</span> <span class="val">${readout}</span></div>
          ${built && html`<div><span class="lbl">53-EDO</span> <span class="val">${stepsLine}</span></div>`}
        </div>
        <div class="scale-actions">
          <button onClick=${() => { onApply(null); onClose(); }}>Reset to ragabase</button>
          <button class="primary" disabled=${!built}
                  onClick=${() => { onApply(built); onClose(); }}>Apply override</button>
        </div>
      </div>
    </div>
  </div>`;
}
