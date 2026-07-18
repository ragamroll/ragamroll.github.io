import { html } from '../vendor/htm-preact.js';

// Action bar above the workspace. Document actions (Save, Export MIDI) sit on
// the left; the playback group (play/pause/stop/tala) is pushed to the right via
// margin-left:auto so it aligns above the roll it drives.
const pct = (v) => Math.round(v * 100);

export function Transport({ state, canPlay, onPlay, onPause, onStop, talaVol, onTalaVol, talaMuted, onToggleTala, melodyMuted, onToggleMelody, onSave, onExportMidi, droneVol, onDroneVol, droneMuted, onToggleDrone, masterVol, onMasterVol, tempo, onTempo, tempoOverridden, onResetTempo }) {
  return html`<span class="transport">
    <button class="doc-btn" title="Save the .srgm source" onClick=${onSave}>Save</button>
    <button class="doc-btn" title="Export the melody as a .mid file" onClick=${onExportMidi}>Export MIDI</button>
    <label class=${'tempo' + (tempoOverridden ? ' on' : '')}
           title="Tempo (BPM) — overrides the composition's tempo for playback (next play)">
      ♩ <input type="number" min="20" max="400" step="1" value=${tempo}
               onInput=${(e) => onTempo(Number(e.target.value))} />
      ${tempoOverridden ? html`<button class="tempo-reset" title="Reset to composition tempo"
                                        onClick=${onResetTempo}>↺</button>` : ''}
    </label>
    <span class="transport-play">
      <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
      <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
      <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
      <label class="vol" title=${`Master volume ${pct(masterVol)}%`}>
        ${masterVol <= 0 ? '🔇' : '🔈'} Master
        <input type="range" min="0" max="1" step="0.05" value=${masterVol}
               onInput=${(e) => onMasterVol(Number(e.target.value))} />
      </label>
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
    </span>
  </span>`;
}
