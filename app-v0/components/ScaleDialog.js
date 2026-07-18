import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useMemo } from '../vendor/hooks.module.js';
import { EDO } from '../core/shruti.js';
import { midiToName } from '../core/tuning.js';
import { CHAKRAS, MELA_NAMES, MAJOR_MELA, chakraOf, melaVarieties, melaScale, melaOfScale, commaOf, jiAb } from '../core/melakarta.js';

// Experimental scale-pitch override, mela-centric. Pick one of the 72
// melakartas (which fixes the R/G/M/D/N varieties), then choose the a/b comma
// per swara — 72 × 2^5 = 2304 scales. S and P are invariant. Apply pushes the
// 53-EDO scale up as a playback retune; Reset drops back to the ragabase.
const cents = (step) => Math.round((step / EDO) * 1200);
const SLOTS = ['S', 'R', 'G', 'M', 'P', 'D', 'N'];
const VARIABLE = ['R', 'G', 'M', 'D', 'N'];
const SA_CHOICES = [];
for (let m = 48; m <= 72; m++) SA_CHOICES.push(m);

const abFromScale = (scale) =>
  Object.fromEntries(VARIABLE.map((L) => [L, commaOf(scale[L])]));

export function ScaleDialog({ scale, onApply, onClose, saPitch, autoSaMidi, onSetSa, ragas }) {
  const [melaN, setMelaN] = useState(() => melaOfScale(ragas, scale)?.n ?? MAJOR_MELA);
  // Default comma is the just-intonation-nearest shruti for each swara; an
  // existing override keeps its own commas.
  const [ab, setAb] = useState(() => (scale ? abFromScale(scale) : jiAb(ragas, melaOfScale(ragas, scale)?.n ?? MAJOR_MELA)));
  // Switching mela resets the commas to that mela's JI-nearest defaults.
  const pickMela = (n) => { setMelaN(n); setAb(jiAb(ragas, n)); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stop = (e) => e.stopPropagation();
  const v = useMemo(() => melaVarieties(ragas, melaN), [ragas, melaN]);
  const built = useMemo(() => melaScale(ragas, melaN, ab), [ragas, melaN, ab]);
  const ch = chakraOf(melaN);

  const step = melaN;
  const bump = (d) => pickMela(Math.min(72, Math.max(1, melaN + d)));

  // per-swara cell values
  const variety = (L) => (L === 'S' || L === 'P' ? L : `${L}${v[L]}`);
  const cell = (L) => (built ? built[L] : 0);

  return html`<div class="dialog-backdrop" onClick=${onClose}>
    <div class="dialog-box scale-box" onClick=${stop} role="dialog" aria-modal="true" aria-label="Scale pitches">
      <div class="dialog-head">
        <strong>Scale pitches · experimental</strong>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="sa-pitch">
          <label>Sa =
            <select value=${saPitch == null ? '' : String(saPitch)}
                    onChange=${(e) => onSetSa(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">Auto (${midiToName(autoSaMidi)})</option>
              ${SA_CHOICES.map((m) => html`<option key=${m} value=${String(m)}>${midiToName(m)}</option>`)}
            </select>
          </label>
          <span class="sa-note">tonic reference — transposes playback (drone live, melody on next play)</span>
        </div>

        <div class="mela-row">
          <label>Mela =
            <select value=${String(melaN)} onChange=${(e) => pickMela(Number(e.target.value))}>
              ${CHAKRAS.map((cname, ci) => html`<optgroup key=${ci}
                  label=${`${ci + 1} · ${cname} (${ci * 6 + 1}-${ci * 6 + 6})`}>
                ${[1, 2, 3, 4, 5, 6].map((p) => { const n = ci * 6 + p;
                  return html`<option key=${n} value=${String(n)}>${n} · ${MELA_NAMES[n]}</option>`; })}
              </optgroup>`)}
            </select>
          </label>
          <button class="mela-step" title="Previous mela" onClick=${() => bump(-1)} disabled=${step <= 1}>◀</button>
          <button class="mela-step" title="Next mela" onClick=${() => bump(1)} disabled=${step >= 72}>▶</button>
          <span class="mela-chakra">${ch.chakra} · ${ch.name} chakra</span>
        </div>

        <table class="mela-table">
          <tbody>
            <tr class="mt-swara"><th>swara</th>${SLOTS.map((L) => html`<td key=${L}>${L}</td>`)}</tr>
            <tr class="mt-variety"><th>variety</th>${SLOTS.map((L) => html`<td key=${L}>${variety(L)}</td>`)}</tr>
            <tr class="mt-comma"><th>comma</th>${SLOTS.map((L) => html`<td key=${L}>
              ${L === 'S' || L === 'P' ? html`<span class="fixed-dot">·</span>` : html`<span class="ab">
                ${['a', 'b'].map((c) => html`<button key=${c}
                    class=${'ab-btn' + (ab[L] === c ? ' on' : '')}
                    onClick=${() => setAb((p) => ({ ...p, [L]: c }))}>${c}</button>`)}
              </span>`}
            </td>`)}</tr>
            <tr class="mt-edo"><th>53-EDO</th>${SLOTS.map((L) => html`<td key=${L}>${cell(L)}</td>`)}</tr>
            <tr class="mt-cents"><th>cents</th>${SLOTS.map((L) => html`<td key=${L}>${cents(cell(L))}</td>`)}</tr>
          </tbody>
        </table>

        <div class="scale-actions">
          <button onClick=${() => { onApply(null); onClose(); }}>Reset to ragabase</button>
          <button class="primary" disabled=${!built}
                  onClick=${() => { onApply(built); onClose(); }}>Apply override</button>
        </div>
      </div>
    </div>
  </div>`;
}
