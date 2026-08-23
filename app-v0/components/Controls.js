import { html } from '../vendor/htm-preact.js';
import { useRef } from '../vendor/hooks.module.js';
import { midiToName } from '../core/tuning.js';
import { isTunable } from '../audio/voices.js';
import { OpenMenu } from './OpenMenu.js';
import { MELODY_VOICES } from '../audio/voices.js';

/**
 * EVERY CONTROL THE CHROME CAN PLACE, one component each, keyed by the id a saved layout
 * stores. The arrangement lives in core/chrome-layout.js as rows of those ids; this file only
 * knows how to draw one.
 *
 * Each takes the same bag of props, `p`, rather than its own list. That is deliberate: a
 * registry whose members all have different signatures cannot be rendered from a loop, and
 * rendering from a loop is the whole point of the arrangement being data.
 *
 * They are COMPONENTS, not functions returning markup, because some of them hold hooks — and
 * a hook inside a plain function called from a loop whose membership changes is a hook whose
 * order changes. Preact gives each component its own.
 */

export const BPM_MIN = 20, BPM_MAX = 600;
const MULT_MIN = 0.25, MULT_MAX = 4, MULT_STEP = 0.25;
const clampBpm = (v) => Math.max(BPM_MIN, Math.min(BPM_MAX, v));
const pct = (v) => Math.round(v * 100);

// Sa reference-pitch choices span the full vocal range of shadja tonics, from the lowest male
// (bass, ~E2) to the highest female (soprano, ~C5).
const SA_CHOICES = [];
for (let m = 40; m <= 72; m++) SA_CHOICES.push(m);

const Open = ({ p }) => html`<${OpenMenu} examples=${p.examples} exampleValue=${p.exampleValue}
  onNew=${p.onNew} onOpen=${p.onOpen} onExample=${p.onExample} onOpenLink=${p.onOpenLink} />`;

const Rewind = ({ p }) => html`<button title="Back to the start (of the A–B segment, if set)"
  onClick=${p.onRewind} disabled=${!p.canPlay}>⏮</button>`;

// ONE button, as on the gamaka page. Play and Pause were never both available: whichever one
// you could press, the other was greyed out beside it, so the pair spent its width saying what
// you cannot do. It says Resume rather than Play after a pause, because that is the difference
// the press will make.
const Play = ({ p }) => html`<button class="pri" onClick=${p.state === 'playing' ? p.onPause : p.onPlay}
  title=${p.state === 'playing' ? 'Pause' : p.state === 'paused' ? 'Resume' : 'Play'}
  disabled=${p.state !== 'playing' && !p.canPlay}>${p.state === 'playing' ? '⏸' : '▶'}</button>`;

const Stop = ({ p }) => html`<button title="Stop" onClick=${p.onStop} disabled=${p.state === 'stopped'}>⏹</button>`;

// What it will repeat is in the title, not left to be inferred: the same toggle means the
// segment or the whole piece depending on whether a range is marked, and a control whose scope
// you have to work out is a control you press twice.
const Loop = ({ p }) => html`<button class=${'loop-btn' + (p.looping ? ' on' : '')}
  aria-pressed=${!!p.looping} onClick=${p.onToggleLoop}
  title=${p.looping ? `Repeating the ${p.hasSeg ? 'A–B segment' : 'piece'} until you stop — click to play it once`
                    : `Play once — click to repeat the ${p.hasSeg ? 'A–B segment' : 'piece'} until you stop`}>🔁</button>`;

const Timbre = ({ p }) => html`<span class="timbre-group">
  <label class="timbre" title="Melody instrument voice (applies on next play)">🎻
    <select value=${p.timbre} onChange=${(e) => p.onTimbre(e.target.value)}>
      ${MELODY_VOICES.map(([v, label]) => html`<option key=${v} value=${v}>${label}</option>`)}
    </select>
  </label>
  ${isTunable(p.timbre) && html`<button class="instr-btn" onClick=${p.onOpenInstrument}
    title="Open this instrument: the string, its body and its room">⚙</button>`}
</span>`;

const Sa = ({ p }) => html`<label class="sapick" title="Sa reference pitch — transposes playback (Auto = the raga's Sa)">
  Sa
  <select value=${p.saPitch == null ? '' : String(p.saPitch)}
          onChange=${(e) => p.onSetSa(e.target.value === '' ? null : Number(e.target.value))}>
    <option value="">Auto (${midiToName(p.autoSaMidi)})</option>
    ${SA_CHOICES.map((m) => html`<option key=${m} value=${String(m)}>${midiToName(m)}</option>`)}
  </select>
</label>`;

// THE GLYPH SAYS WHICH, THE STYLING SAYS WHETHER. These carried their names — "🎶 Drone",
// "🔊 Tala" — and four of them came to more than a phone's width, so a row of mixers took
// three lines. The name is in the tooltip and in the Layout panel; what a reader needs here
// is to tell them apart at a glance and hit the right one with a thumb.
//
// So the icon never changes: a control that swaps its glyph when you press it is a control
// you have to read to find again. Off is dim and struck through (.vol-toggle[aria-pressed
// =false]), which is one look for all three rather than a different pair of emoji each.
const Drone = ({ p }) => html`<span class=${'vol' + (p.droneMuted ? ' muted' : '')}>
  <button class="vol-toggle" aria-pressed=${!p.droneMuted} onClick=${p.onToggleDrone}
          aria-label="Drone"
          title=${p.droneMuted ? 'Drone off — click to turn on (keeps the set level)'
                               : `Drone on (${pct(p.droneVol)}%) — click to silence`}>🪕</button>
  <input type="range" min="0" max="1" step="0.05" value=${p.droneVol}
         title=${`Drone volume ${pct(p.droneVol)}%`}
         onInput=${(e) => p.onDroneVol(Number(e.target.value))} />
</span>`;

const Melody = ({ p }) => html`<span class=${'vol' + (p.melodyMuted ? ' muted' : '')}>
  <button class="vol-toggle" aria-pressed=${!p.melodyMuted} onClick=${p.onToggleMelody}
          aria-label="Melody"
          title=${p.melodyMuted ? 'Melody muted — click to unmute'
                                : 'Melody on — click to mute (solo tala + drone)'}>🎼</button>
</span>`;

const Tala = ({ p }) => html`<span class=${'vol' + (p.talaMuted ? ' muted' : '')}>
  <button class="vol-toggle" aria-pressed=${!p.talaMuted} onClick=${p.onToggleTala}
          aria-label="Tala"
          title=${p.talaMuted ? 'Tala off — click to unmute (keeps the set level)'
                              : `Tala on (${pct(p.talaVol)}%) — click to mute`}>🥁</button>
  <input type="range" min="0" max="1" step="0.05" value=${p.talaVol}
         title=${`Tala volume ${pct(p.talaVol)}%`}
         onInput=${(e) => p.onTalaVol(Number(e.target.value))} />
</span>`;

const Master = ({ p }) => html`<label class="vol" title=${`Master volume ${pct(p.masterVol)}% — everything you hear`}>
  <span aria-label="Master volume">${p.masterVol <= 0 ? '🔇' : '🔈'}</span>
  <input type="range" min="0" max="1" step="0.05" value=${p.masterVol}
         onInput=${(e) => p.onMasterVol(Number(e.target.value))} />
</label>`;

// The RATIO is honest and the SLIDER's own position is what gets clamped — pinning the ratio to
// the slider's range read "2.0×" for 240 BPM and for 400 alike, so a tempo typed past the
// slider's end looked like a control that had stopped responding to anything.
const Tempo = ({ p }) => {
  const overridden = p.tempoOverride != null;
  const eff = overridden ? p.tempoOverride : p.compositionTempo;
  const ratio = eff / p.compositionTempo;
  const sliderAt = Math.max(MULT_MIN, Math.min(MULT_MAX, Math.round(ratio / MULT_STEP) * MULT_STEP));
  return html`<label class=${'tempo' + (overridden ? ' on' : '')}
    title=${`Playback tempo. Slider = speed × the composition's ${p.compositionTempo} BPM (${MULT_STEP} steps, ${MULT_MIN}–${MULT_MAX}×); the box sets an exact BPM (${BPM_MIN}–${BPM_MAX}), including past the slider's ends. ↺ = back to composition.`}>
    ♩
    <input class="tempo-mult" type="range" min=${String(MULT_MIN)} max=${String(MULT_MAX)} step=${String(MULT_STEP)} value=${sliderAt}
           onInput=${(e) => p.onTempo(clampBpm(Math.round(p.compositionTempo * Number(e.target.value))))} />
    <input class="tempo-num" type="number" min=${String(BPM_MIN)} max=${String(BPM_MAX)} step="1" placeholder=${String(p.compositionTempo)}
           value=${overridden ? String(p.tempoOverride) : ''}
           onInput=${(e) => { const v = e.target.value; if (v === '') p.onResetTempo(); else p.onTempo(Number(v)); }}
           onBlur=${(e) => { e.target.value = overridden ? String(p.tempoOverride) : ''; }} />
    <span class="tempo-state">${overridden ? `${eff} bpm · ${ratio.toFixed(2)}×` : `comp ${p.compositionTempo}`}</span>
    ${overridden ? html`<button class="tempo-reset" title="Use composition tempo" onClick=${p.onResetTempo}>↺</button>` : ''}
  </label>`;
};

// A/V TRIM, nudged rather than typed: a value you can only find by ear while a piece runs, and
// a number field makes you leave that loop to guess, type, listen and guess again.
//
// THE TIMER LIVES IN A REF. The first version kept it in a closure built during render — and
// every nudge causes a render, so the handler that ran on pointer-up belonged to a LATER
// closure and cleared a timer that was not the running one. Each tap left a repeater going
// behind it; three taps drove the trim to its limit in the wrong direction.
const Sync = ({ p }) => {
  const hold = useRef({ t: 0, every: 220 });
  const stopHold = () => { clearTimeout(hold.current.t); hold.current.t = 0; hold.current.every = 220; };
  const nudge = (dir) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      stopHold();
      p.onSync(dir);
      const again = () => {
        p.onSync(dir);
        hold.current.every = Math.max(60, hold.current.every * 0.75);
        hold.current.t = setTimeout(again, hold.current.every);
      };
      hold.current.t = setTimeout(again, 420);
    },
    onPointerUp: stopHold, onPointerLeave: stopHold, onPointerCancel: stopHold,
  });
  return html`<span class=${'sync' + (p.syncMs ? ' on' : '')}
    title=${'Line and sound disagree? Nudge the playhead until they meet. Bluetooth and '
      + 'external speakers lag by more than they admit to, and no browser reports it. '
      + 'Remembered for this browser — it belongs to the machine, not the piece.'}>
    <button class="sync-nudge" aria-label="Playhead earlier" ...${nudge(-1)}>◀</button>
    <button class="sync-name" onClick=${() => p.onSync(0)}
            title=${p.syncMs ? 'Back to no trim' : 'No trim'}>${p.syncMs ? `${p.syncMs > 0 ? '+' : ''}${p.syncMs} ms` : 'sync'}</button>
    <button class="sync-nudge" aria-label="Playhead later" ...${nudge(1)}>▶</button>
  </span>`;
};

// The other end of the same piece: the lane editor places the written swaras and the sahitya on
// these notes. It goes by link rather than by file, so nothing has to be saved and found again.
const Lanes = ({ p }) => html`<button class="doc-btn"
  title="Open this piece in the lane editor — where the written swaras and the sahitya are placed on its notes"
  onClick=${p.onLanes}>Lanes ↗</button>`;

const Save = ({ p }) => html`<button class="doc-btn" title="Save the .srgm source" onClick=${p.onSave}>Save</button>`;
const Share = ({ p }) => html`<button class=${'doc-btn' + (p.shared ? ' ok' : '')}
  title="Copy a shareable link (composition packed into the URL)"
  onClick=${p.onShare}>${p.shared ? 'Copied ✓' : 'Share'}</button>`;
const Midi = ({ p }) => html`<button class="doc-btn" title="Export the melody as a .mid file"
  onClick=${p.onExportMidi}>Export MIDI</button>`;

const Ragas = ({ p }) => html`<button onClick=${p.onOpenRagas}>Ragas</button>`;
const Talas = ({ p }) => html`<button onClick=${p.onOpenTalas}>Talas</button>`;
const Scale = ({ p }) => html`<button class=${'scale-btn' + (p.scaleActive ? ' active' : '')}
  onClick=${p.onOpenScale} title="Experimental: override the scale pitches (53-EDO)">Scale ⚙${p.scaleActive ? ' •' : ''}</button>`;

// The arrangement's own control, which is why it can sit anywhere the rest can. The dot says
// this browser is no longer showing the built-in rows — otherwise a reader who moved something
// months ago and forgot has no way to tell their layout from everyone else's.
const Layout = ({ p }) => html`<button class=${'layout-btn' + (p.layoutCustom ? ' active' : '')}
  onClick=${p.onOpenLayout}
  title="Where the controls sit — save this arrangement to a file, or load one back">Layout${p.layoutCustom ? ' •' : ''}</button>`;

export const CONTROL_COMPONENTS = {
  open: Open, rewind: Rewind, play: Play, stop: Stop, loop: Loop, timbre: Timbre, sa: Sa,
  drone: Drone, melody: Melody, tala: Tala,
  master: Master, tempo: Tempo, sync: Sync,
  lanes: Lanes, save: Save, share: Share, midi: Midi,
  ragas: Ragas, talas: Talas, scale: Scale, layout: Layout,
};

// What each is called when a reader is looking at a list of them rather than at the control.
export const CONTROL_NAMES = {
  open: 'Open', rewind: 'Rewind', play: 'Play', stop: 'Stop', loop: 'Loop',
  timbre: 'Instrument', sa: 'Sa', drone: 'Drone', melody: 'Melody', tala: 'Tala',
  master: 'Master', tempo: 'Tempo', sync: 'A/V trim', lanes: 'Lanes', save: 'Save',
  share: 'Share', midi: 'Export MIDI', ragas: 'Ragas', talas: 'Talas', scale: 'Scale',
  layout: 'Layout',
};
