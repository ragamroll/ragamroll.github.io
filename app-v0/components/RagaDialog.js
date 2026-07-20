import { html } from '../vendor/htm-preact.js';
import { useState, useEffect } from '../vendor/hooks.module.js';
import { parse } from '../core/parser.js';
import { buildSequence } from '../core/midi/sequence.js';
import { scheduleEvents, totalSeconds } from '../audio/schedule.js';
import { droneFreqs } from '../audio/drone.js';
import { saBaseOf, applyPlaybackPitch } from '../core/retune.js';
import { ragaPreviewSrgm, ragaPreviewScale } from '../core/raga-preview.js';
import { getRagaExt } from '../core/raga-ext.js';
import { MELA_NAMES } from '../core/melakarta.js';
import { formatSwaraSeq, formatIntervalNumbers, padMelaName, titleCase } from '../core/reference.js';

// Searchable raga browser with an audio preview. ▶ plays the raga's arohana /
// avarohana (+ any phrases; straight scale up/down when none authored) through
// the shared player, retuned to its 53-EDO shrutis. Read-only otherwise. The
// drone reuses the app's global voicing + level, so it matches the composition.

export function RagaDialog({ ragas, player, saMidi = 60, droneLevel = 0.5, stopMain, onClose }) {
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState(null);

  const stop = () => {
    try { player.fadeOutStop(0.12); } catch { try { player.stop(); player.droneOff(); } catch { /* mid-teardown */ } }
    setPlaying(null);
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { stop(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); stop(); };
  }, []);

  const play = async (name) => {
    stopMain?.();
    stop();
    const ext = getRagaExt(name);
    const model = parse(ragaPreviewSrgm(name, ext, ragas));
    const seq = buildSequence(model);
    if (totalSeconds(seq) <= 0) return;
    const saBase = saBaseOf(model, ragas);
    // Transpose the sample so Sa lands on the app's selected pitch (the preview's
    // natural Sa is 60 + saBase at O=5).
    const shift = saMidi - (60 + saBase);
    applyPlaybackPitch(seq, model, ragaPreviewScale(name, ext, ragas), saBase, shift);
    player.onended = () => stop();
    // Raga preview is the melody only — drop the (default) tala strums.
    player.load(scheduleEvents(seq).filter((e) => e.track !== 'tala'), totalSeconds(seq));
    setPlaying(name);
    try {
      await player.play();            // resume/unlock the AudioContext BEFORE the drone
      // Same global drone as the composition — matching Sa, octave and level.
      if (droneLevel > 0) player.setDrone(droneFreqs(saMidi), droneLevel);
      player.fadeIn(0.06);            // click-free start
    } catch { stop(); }
  };

  const stopEvt = (e) => e.stopPropagation();
  const close = () => { stop(); onClose(); };

  // c12 (chromatic) is a hidden power-user notation — not a raga to browse.
  const names = Object.keys(ragas || {}).filter((n) => n !== 'c12')
    .sort((a, b) => padMelaName(a).localeCompare(padMelaName(b)));
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? names.filter((n) => padMelaName(n).toLowerCase().includes(needle) || n.toLowerCase().includes(needle))
    : names;

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box" onClick=${stopEvt} role="dialog" aria-modal="true" aria-label="Ragas">
      <div class="dialog-head">
        <strong>Ragas</strong>
        <button title="Close" onClick=${close}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="ref-controls">
          <input class="dialog-search" type="search" placeholder="filter ragas…" value=${q}
                 autofocus onInput=${(e) => setQ(e.target.value)} />
          <div class="dialog-count">${filtered.length} / ${names.length} ragas · ▶ previews in 53-EDO</div>
        </div>
        <ul class="ref-list raga-list">
          ${filtered.map((n) => {
            const ext = getRagaExt(n);
            const isPlaying = playing === n;
            return html`<li key=${n} class=${isPlaying ? 'playing' : ''}>
              <button class=${'raga-play' + (isPlaying ? ' on' : '')}
                      title=${isPlaying ? 'Stop' : 'Preview'}
                      onClick=${() => (isPlaying ? stop() : play(n))}>${isPlaying ? '⏹' : '▶'}</button>
              <div class="raga-main">
                <span class="ref-name">${titleCase(padMelaName(n))}</span>
                <div class="ref-cols">
                  <span class="ref-seq">${formatSwaraSeq(ragas[n].C12_SWARAS)}</span>
                  <span class="ref-int">${formatIntervalNumbers(ragas[n].C12_SWARAS)}</span>
                  ${ext && html`<span class="ref-mela">mela ${ext.mela} · ${MELA_NAMES[ext.mela]}${ext.source === 'auto' ? ' ~' : ''}</span>`}
                  ${ext && html`<span class="ref-aroha">↑ ${ext.arohana}   ↓ ${ext.avarohana}</span>`}
                </div>
              </div>
            </li>`;
          })}
        </ul>
      </div>
    </div>
  </div>`;
}
