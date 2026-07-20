import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useMemo } from '../vendor/hooks.module.js';
import { parse } from '../core/parser.js';
import { buildSequence } from '../core/midi/sequence.js';
import { scheduleEvents, totalSeconds } from '../audio/schedule.js';
import { saBaseOf, applyPlaybackPitch } from '../core/retune.js';
import { ragaPreviewSrgm } from '../core/raga-preview.js';
import { getRagaExt, deriveArohaAvarohana } from '../core/raga-ext.js';
import { droneFreqs } from '../audio/drone.js';
import { MELA_NAMES } from '../core/melakarta.js';
import { titleCase, padMelaName } from '../core/reference.js';
import { headerColumns, ragaFootprint, ragaMela, ragaVarieties, defaultAb, scaleForAb } from '../core/raga-shruti.js';

// Raga browser. A pinned header shows the SELECTED raga's janaka-mela scale on
// the 22-shruti (53-EDO) grid — fixed S/P, live a/b comma toggles, cents — and
// every list row draws its raga's X footprint on the SAME 22 columns, so a
// raga's swaras line up under their shrutis. Selecting a row (click the name)
// updates the header; ▶ previews (retuned to 53-EDO, over the shared drone).
// Toggling a header comma auditions the retune live on the playing preview.
const hidden = (n) => n === 'c12' || /^mela_\d+$/.test(n);

// Arohana/avarohana text: the authored ext form, else the straight scale.
function arohaAvaroha(ragas, name) {
  const ext = getRagaExt(name);
  if (ext?.arohana) return { aroha: ext.arohana, avaroha: ext.avarohana };
  const d = deriveArohaAvarohana(ragas?.[name]?.C12_SWARAS);
  return { aroha: d.arohana, avaroha: d.avarohana };
}

export function RagaDialog({ ragas, player, saMidi = 60, droneLevel = 0.5, ragaName, stopMain, onClose }) {
  const names = useMemo(() => Object.keys(ragas || {}).filter((n) => !hidden(n))
    .sort((a, b) => padMelaName(a).localeCompare(padMelaName(b))), [ragas]);

  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState(null);
  // Selection drives the header. It defaults to (and re-syncs with) the first
  // raga currently shown in the list — see the filter effect below.
  const [selected, setSelected] = useState(() => names[0]);
  const [ab, setAb] = useState(() => defaultAb(ragaVarieties(ragas, names[0]).varieties));

  const stop = () => {
    try { player.fadeOutStop(0.12); } catch { try { player.stop(); player.droneOff(); } catch { /* mid-teardown */ } }
    setPlaying(null);
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { stop(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); stop(); };
  }, []);

  // Selecting a new raga resets the header commas to that raga's JI defaults.
  const select = (name) => {
    if (name === selected) return;
    setSelected(name);
    setAb(defaultAb(ragaVarieties(ragas, name).varieties));
  };

  const play = async (name, abOverride = null) => {
    stopMain?.();
    stop();
    const ext = getRagaExt(name);
    const model = parse(ragaPreviewSrgm(name, ext, ragas));
    const seq = buildSequence(model);
    if (totalSeconds(seq) <= 0) return;
    const saBase = saBaseOf(model, ragas);
    const shift = saMidi - (60 + saBase);         // land Sa on the selected pitch
    const { varieties } = ragaVarieties(ragas, name);
    // Playing a raga also selects it, so the header always reflects what's heard.
    let useAb = abOverride;
    if (!useAb) {
      if (name === selected) useAb = ab;
      else { useAb = defaultAb(varieties); setSelected(name); setAb(useAb); }
    }
    applyPlaybackPitch(seq, model, scaleForAb(varieties, useAb), saBase, shift);
    player.onended = () => stop();
    player.load(scheduleEvents(seq).filter((e) => e.track !== 'tala'), totalSeconds(seq));
    setPlaying(name);
    try {
      await player.play();                        // unlock the AudioContext before the drone
      if (droneLevel > 0) player.setDrone(droneFreqs(saMidi), droneLevel);
      player.fadeIn(0.06);
    } catch { stop(); }
  };

  // Live audition: flip a header comma; if the selected raga is playing, retune
  // it immediately with the new commas.
  const setComma = (letter, comma) => {
    const next = { ...ab, [letter]: comma };
    setAb(next);
    if (playing === selected) play(selected, next);
  };

  const stopEvt = (e) => e.stopPropagation();
  const close = () => { stop(); onClose(); };

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? names.filter((n) => padMelaName(n).toLowerCase().includes(needle) || n.toLowerCase().includes(needle))
    : names;

  // Keep the header on the first raga of the current list: on mount and whenever
  // filtering changes which raga sits at the top. Manual clicks (which don't move
  // the top row) are left alone until the next filter change.
  const firstName = filtered[0];
  useEffect(() => {
    if (firstName && firstName !== selected) {
      setSelected(firstName);
      setAb(defaultAb(ragaVarieties(ragas, firstName).varieties));
    }
  }, [firstName]);

  const cols = selected ? headerColumns(ragas, selected, ab) : [];
  const mela = selected ? ragaMela(ragas, selected) : null;

  // Each cell is a DIRECT grid child (no wrapper) so the grid stretches it to the
  // full column and its flex-centering lines the glyph up under the header column.
  // Each cell is a DIRECT grid child (no wrapper) so the grid stretches it to the
  // full column and its flex-centering lines the glyph up under the header column.
  // Only the swara letter, a/b button and X are in the grid (all single-char), so
  // the 22 columns stay narrow enough for mobile; cents live in a summary line
  // above the grid (see centsLine) rather than widening a column.
  const swaraCell = (c) => html`<span key=${'s' + c.i} class=${'rr-cell rr-swara' + (c.present === false ? ' dim' : '')}>
    ${c.kind === 'fixed' || (c.kind === 'active' && c.chosen) ? c.letter : ''}</span>`;
  const commaCell = (c) => (c.kind === 'active'
    ? html`<button key=${'c' + c.i} class=${'rr-cell rr-comma' + (c.chosen ? ' on' : '') + (c.present === false ? ' dim' : '')}
             title=${`${c.letter} comma ${c.comma}`} onClick=${() => setComma(c.letter, c.comma)}>${c.comma}</button>`
    : html`<span key=${'c' + c.i} class=${'rr-cell rr-comma ' + (c.kind === 'fixed' ? 'anchor' : 'gap')}>·</span>`);
  // Per-swara cents (the chosen shruti of each swara), in swara order, for the
  // free-flowing summary line — not column-bound.
  const cented = cols.filter((c) => c.kind === 'fixed' || (c.kind === 'active' && c.chosen));

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box raga2-box" onClick=${stopEvt} role="dialog" aria-modal="true" aria-label="Ragas">
      <div class="dialog-head">
        <strong>Ragas</strong>
        <button title="Close" onClick=${close}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="ref-controls">
          <input class="dialog-search" type="search" placeholder="filter ragas…" value=${q}
                 autofocus onInput=${(e) => setQ(e.target.value)} />
          <div class="dialog-count">${filtered.length} / ${names.length} ragas · ▶ previews in 53-EDO · toggle a/b to audition</div>
        </div>

        <div class="rr-scroll">
          <div class="rr-header">
            <div class="rr-melaline">
              ${mela ? html`<b>Mela ${mela.n}</b> · ${MELA_NAMES[mela.n]}` : html`<span class="dim">no melakarta match</span>`}
              <span class="rr-selname">${selected ? titleCase(padMelaName(selected)) : ''}</span>
            </div>
            <div class="rr-cents-line">
              ${cented.map((c) => html`<span key=${'cl' + c.i} class=${'rr-cl' + (c.present === false ? ' dim' : '')}>${c.letter}<b>${c.cents}</b></span>`)}
            </div>
            <div class="rr-grid rr-head-grid">
              <div class="rr-rowlab">swara</div>${cols.map(swaraCell)}
              <div class="rr-rowlab">comma</div>${cols.map(commaCell)}
            </div>
          </div>

          <ul class="rr-list">
            ${filtered.map((n) => {
              const isPlaying = playing === n;
              const isSel = selected === n;
              const fp = ragaFootprint(ragas, n);
              const { aroha, avaroha } = arohaAvaroha(ragas, n);
              return html`<li key=${n} class=${'rr-raga' + (isSel ? ' sel' : '')}>
                <div class="rr-namecell">
                  <div class="rr-nameline">
                    <button class=${'raga-play' + (isPlaying ? ' on' : '')} title=${isPlaying ? 'Stop' : 'Preview'}
                            onClick=${() => (isPlaying ? stop() : play(n))}>${isPlaying ? '⏹' : '▶'}</button>
                    <span class="ref-name" title="Select (show in header)" onClick=${() => select(n)}>${titleCase(padMelaName(n))}</span>
                  </div>
                  <div class="rr-aroha">${aroha}</div>
                  <div class="rr-avaroha">${avaroha}</div>
                </div>
                ${Array.from({ length: cols.length || 22 }, (_, i) => html`<span key=${i}
                    class=${'rr-cell rr-x' + (fp.has(i) ? ' on' : '')}>${fp.has(i) ? 'X' : ''}</span>`)}
              </li>`;
            })}
          </ul>
        </div>
      </div>
    </div>
  </div>`;
}
