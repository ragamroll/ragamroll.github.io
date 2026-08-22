import { html } from '../vendor/htm-preact.js';
import { useState } from '../vendor/hooks.module.js';

/**
 * WHAT THIS DEVICE DID, on the device it did it on.
 *
 * There is no console on a phone, and the fault this exists for cannot be reproduced on a
 * desktop — measured, at twenty times the CPU throttling. So the numbers have to come back
 * some other way, and the panel is built around that: the summary line at the top is the
 * whole report, short enough to retype off a screen if nothing else survives the journey.
 * Copy and Share are conveniences on top of it, not the plan.
 */
export function PerfDialog({ perf, version, onReset, onClose }) {
  const [said, setSaid] = useState('');
  const d = perf.detail();
  const line = `${version} ${perf.summary()}`;

  const say = (t) => { setSaid(t); setTimeout(() => setSaid(''), 1600); };
  const full = () => line + '\n' + JSON.stringify(d);
  const copy = async () => {
    try { await navigator.clipboard.writeText(full()); say('Copied'); }
    catch (_) { say('Select the line above and copy it by hand'); }
  };
  // The share sheet is the one route off a phone that needs no clipboard sync: mail or
  // message it to yourself and it is on the other machine.
  const share = async () => {
    try { await navigator.share({ title: 'ragamroll timing', text: full() }); }
    catch (_) { /* dismissed, or not offered here */ }
  };

  const close = (e) => { if (e.target === e.currentTarget) onClose(); };
  const row = (k, v, note) => html`<tr><th>${k}</th><td>${v}</td><td class="perf-note">${note || ''}</td></tr>`;

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box perf-box" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true"
         aria-label="Timing">
      <div class="dialog-head">
        <strong>Timing on this device</strong>
        <button title="Start counting again from now" onClick=${onReset}>Reset</button>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body perf-body">
        <p class="perf-line" onClick=${(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); }}>${line}</p>
        <div class="perf-acts">
          <button onClick=${copy}>Copy</button>
          ${typeof navigator !== 'undefined' && navigator.share
            && html`<button onClick=${share}>Share…</button>`}
          <span class="perf-said">${said}</span>
        </div>
        <p class="instr-hint">Play for a minute — including whatever made it skip — then come
        back here. The line above is the whole report; everything below it is the same numbers
        spelled out.</p>
        <table class="perf-table">
          ${row('played', `${d.playSeconds}s over ${d.plays + (d.playingNow ? 1 : 0)} run${d.plays + (d.playingNow ? 1 : 0) === 1 ? '' : 's'}`,
                d.playingNow ? 'still playing — these numbers are from the run under way' : '')}
          ${row('long tasks', `${d.longTasks}, worst ${d.longestMs}ms, ${d.blockedMs}ms total`,
                'the main thread blocked — this is a skip you can see')}
          ${row('frames', `p50 ${d.framesP50}ms · p95 ${d.framesP95}ms · worst ${d.frameMaxMs}ms`,
                `${d.overOneFrame} of ${d.frames} took longer than one frame`)}
          ${row('notes late', `${d.lateNotes} of ${d.notes}`,
                'scheduled after the moment they were for — this is a crackle')}
          ${row('worst margin', d.worstMarginMs == null ? '—' : `${d.worstMarginMs}ms`,
                'how little warning the closest note had')}
          ${row('live sources', `${d.liveSources} now, ${d.mostSources} at most`,
                'climbing over a session would be a leak')}
          ${row('audio', d.device ? `${d.device.sampleRate}Hz · base ${d.device.baseLatencyMs}ms · out ${d.device.outputLatencyMs}ms` : '—')}
          ${row('start', d.device && d.device.runwayMs != null
                ? `${d.device.runwayMs}ms ahead · latency ${d.device.latencyMeasured ? 'measured' : 'NOT reported by this device'}`
                : '—', 'how much warning the first note of a run got')}
          ${row('screen', d.device ? `${d.device.viewport} @${d.device.dpr}x · ${d.device.cores || '?'} cores${d.device.installed ? ' · installed' : ''}` : '—')}
        </table>
        <p class="instr-hint perf-hist">frame gaps, ms: ${d.histogram.map(([e, n]) => `${e}:${n}`).join('  ')}</p>
      </div>
    </div>
  </div>`;
}
