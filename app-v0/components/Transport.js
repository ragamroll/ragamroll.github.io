import { html } from '../vendor/htm-preact.js';
import { midiToName } from '../core/tuning.js';

// Action bar above the workspace. Wraps on narrow (portrait) screens so no
// control is clipped. Sa + tempo sit on the main UI for easy reach; the mix
// group runs Drone → Melody → Tala → Master (Drone first so mute/unmute is
// closest to hand on mobile).
const pct = (v) => Math.round(v * 100);

const SA_CHOICES = [];
for (let m = 48; m <= 72; m++) SA_CHOICES.push(m);

export function Transport({ state, canPlay, onPlay, onPause, onStop,
  talaVol, onTalaVol, talaMuted, onToggleTala, melodyMuted, onToggleMelody,
  droneVol, onDroneVol, droneMuted, onToggleDrone, masterVol, onMasterVol,
  onSave, onExportMidi, compositionTempo, tempoOverride, onTempo, onResetTempo,
  saPitch, autoSaMidi, onSetSa }) {
  const overridden = tempoOverride != null;
  const eff = overridden ? tempoOverride : compositionTempo;
  // Speed multiplier of the composition tempo, snapped to the 0.2 grid.
  const mult = Math.max(0.2, Math.min(2, Math.round((eff / compositionTempo) / 0.2) * 0.2));

  return html`<span class="transport">
    <button class="doc-btn" title="Save the .srgm source" onClick=${onSave}>Save</button>
    <button class="doc-btn" title="Export the melody as a .mid file" onClick=${onExportMidi}>Export MIDI</button>

    <label class="sapick" title="Sa reference pitch — transposes playback (Auto = the raga's Sa)">
      Sa
      <select value=${saPitch == null ? '' : String(saPitch)}
              onChange=${(e) => onSetSa(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Auto (${midiToName(autoSaMidi)})</option>
        ${SA_CHOICES.map((m) => html`<option key=${m} value=${String(m)}>${midiToName(m)}</option>`)}
      </select>
    </label>

    <label class=${'tempo' + (overridden ? ' on' : '')}
           title=${`Playback tempo. Slider = speed × the composition's ${compositionTempo} BPM (0.2 steps); the box sets an exact BPM. ↺ = back to composition.`}>
      ♩
      <input class="tempo-mult" type="range" min="0.2" max="2" step="0.2" value=${mult}
             onInput=${(e) => onTempo(Math.round(compositionTempo * Number(e.target.value)))} />
      <input class="tempo-num" type="number" min="20" max="400" step="1" placeholder=${String(compositionTempo)}
             value=${overridden ? String(tempoOverride) : ''}
             onInput=${(e) => { const val = e.target.value; if (val === '') onResetTempo(); else onTempo(Number(val)); }} />
      <span class="tempo-state">${overridden ? `${mult.toFixed(1)}×` : `comp ${compositionTempo}`}</span>
      ${overridden ? html`<button class="tempo-reset" title="Use composition tempo" onClick=${onResetTempo}>↺</button>` : ''}
    </label>

    <span class="transport-play">
      <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
      <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
      <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>

      <span class=${'vol' + (droneMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!droneMuted} onClick=${onToggleDrone}
                title=${droneMuted ? 'Drone off — click to turn on (keeps the set level)'
                                   : `Drone on (${pct(droneVol)}%) — click to silence`}>
          ${droneMuted ? '🎵' : '🎶'} Drone
        </button>
        <input type="range" min="0" max="1" step="0.05" value=${droneVol}
               title=${`Drone volume ${pct(droneVol)}%`}
               onInput=${(e) => onDroneVol(Number(e.target.value))} />
      </span>
      <span class=${'vol' + (melodyMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!melodyMuted} onClick=${onToggleMelody}
                title=${melodyMuted ? 'Melody muted — click to unmute'
                                    : 'Melody on — click to mute (solo tala + drone)'}>
          ${melodyMuted ? '🔇' : '🎼'} Melody
        </button>
      </span>
      <span class=${'vol' + (talaMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!talaMuted} onClick=${onToggleTala}
                title=${talaMuted ? 'Tala off — click to unmute (keeps the set level)'
                                  : `Tala on (${pct(talaVol)}%) — click to mute`}>
          ${talaMuted ? '🔇' : '🔊'} Tala
        </button>
        <input type="range" min="0" max="1" step="0.05" value=${talaVol}
               title=${`Tala volume ${pct(talaVol)}%`}
               onInput=${(e) => onTalaVol(Number(e.target.value))} />
      </span>
      <label class="vol" title=${`Master volume ${pct(masterVol)}%`}>
        ${masterVol <= 0 ? '🔇' : '🔈'} Master
        <input type="range" min="0" max="1" step="0.05" value=${masterVol}
               onInput=${(e) => onMasterVol(Number(e.target.value))} />
      </label>
    </span>
  </span>`;
}
