import { html } from '../vendor/htm-preact.js';
import { useState, useEffect } from '../vendor/hooks.module.js';
import { STRING_PARAMS, STRING_DEFAULTS, STRING_PRESETS, fromSlider, toSlider } from '../audio/voices.js';

/**
 * The instrument, opened up.
 *
 * The plucked voice is not a preset — it is a string, a body and a room, built from parts
 * whose numbers were chosen by measuring one note and listening to another. Which of them
 * turns a clean string into something with an instrument in it is a question nobody can
 * answer by writing a value down: it depends on the phrase, the tempo, the raga and the
 * ear. So the numbers are here, with the names a player would use for them rather than the
 * ones the code uses.
 *
 * LIVE. Every move reaches the voice as it is made, and playback does not stop: the panel is
 * for turning something while a phrase repeats, which is the only way any of this is judged.
 * The settings are remembered, and outlive the voice being rebuilt on the next play.
 */
export function InstrumentDialog({ values, onSet, onReset, onAudition, playing, onClose }) {
  const [v, setV] = useState({ ...STRING_DEFAULTS, ...values });
  useEffect(() => { setV((prev) => ({ ...prev, ...values })); }, [values]);

  const close = (e) => { if (e.target === e.currentTarget) onClose(); };
  const move = (key, value) => { setV((prev) => ({ ...prev, [key]: value })); onSet(key, value); };
  // A note on RELEASE, not on every pixel of the drag — and only when nothing is playing,
  // since a piece under way is already the sound being judged. Four of these twelve are read
  // when a string is plucked rather than while it rings (sustain, pick length, pick
  // brightness, the pair), so without a note to strike they change nothing you can hear.
  const hear = () => { if (!playing) onAudition(); };
  const reset = () => { setV({ ...STRING_DEFAULTS }); onReset(); };
  // Down to a file, so a setting that took an afternoon of listening can become the one
  // everybody gets. The WHOLE object, not the handful that differ from today's defaults:
  // what is wanted in the repo is an instrument, not a patch against one — and a patch
  // against a default that later moves is a setting that quietly changes underneath you.
  // A named setting, applied whole: every value, including the ones with no slider. Half an
  // instrument laid over another is neither, and the ones without sliders — where the body
  // resonates, how big the room is — are a good part of what tells two of these apart.
  const preset = (p) => {
    const next = p.values ? { ...STRING_DEFAULTS, ...p.values } : { ...STRING_DEFAULTS };
    setV(next);
    for (const [k, val] of Object.entries(next)) onSet(k, val);
    if (!playing) onAudition();
  };
  const save = () => {
    const body = JSON.stringify({ ...STRING_DEFAULTS, ...v }, null, 2) + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = 'pluck-settings.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // Numbers as a player reads them. The audio wants a ratio; a reader wants cents.
  const shown = (p, x) => {
    if (p.key === 'detune') return `${Math.round(Math.log2(x) * 1200)}¢`;
    if (p.unit === 'Hz') return `${Math.round(x)} Hz`;
    if (p.unit === 's') return `${x < 1 ? x.toFixed(2) : x.toFixed(1)} s`;
    if (p.unit === '×') return `${x.toFixed(1)}×`;
    if (p.unit === 'dB') return `${x > 0 ? '+' : ''}${Math.round(x)} dB`;
    return String(Math.round(x * 100) / 100);
  };
  // The slider travels in position, not in value: a control linear in a quantity the ear
  // hears logarithmically spends two thirds of its length doing nothing.
  const round = (p, x) => (p.step ? Math.round(x / p.step) * p.step : x);

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box instr-box" onClick=${(e) => e.stopPropagation()} role="dialog" aria-modal="true"
         aria-label="Instrument">
      <div class="dialog-head">
        <strong>Instrument · plucked string</strong>
        <button title="Play a note with these settings" onClick=${onAudition}>♪</button>
        <button class="instr-save" title="Download these settings as a file — tools/apply-instrument.mjs makes them the built-in ones"
                onClick=${save}>⭳ Save</button>
        <button title="Back to the built-in settings" onClick=${() => { reset(); if (!playing) onAudition(); }}>Reset</button>
        <button title="Close" onClick=${onClose}>✕</button>
      </div>
      <div class="dialog-body instr-body">
        <div class="instr-presets">
          ${STRING_PRESETS.map((p) => html`<button key=${p.name} onClick=${() => preset(p)}
            title=${p.values ? 'Load this setting — every value, including the ones without a slider'
              : 'Back to the built-in setting'}>${p.name}</button>`)}
        </div>
        <p class="instr-hint">${playing
          ? 'The piece is playing: every change is in the next note, and the ones that shape a ringing string are in the note under it now.'
          : 'Each change plays a note so you can hear it. Better still, start a phrase and turn these while it repeats — that is the only way an instrument is really judged.'}</p>
        ${STRING_PARAMS.map((p) => html`
          <label key=${p.key} class="instr-row" title=${p.help}>
            <span class="instr-name">${p.label}</span>
            <input type="range" min="0" max="1" step="0.002" value=${toSlider(p, v[p.key])}
                   onInput=${(e) => move(p.key, round(p, fromSlider(p, parseFloat(e.target.value))))}
                   onChange=${hear} onKeyUp=${hear} />
            <span class="instr-val">${shown(p, v[p.key])}</span>
          </label>`)}
        <p class="instr-hint instr-foot">The body resonances do not follow the note: a box
        rings where it rings whatever is played on it, and that fixed response is most of what
        separates an instrument from a waveform.</p>
      </div>
    </div>
  </div>`;
}
