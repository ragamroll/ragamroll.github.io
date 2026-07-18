import { html } from '../vendor/htm-preact.js';

// Action bar above the workspace. Document actions (Save, Export MIDI) sit on
// the left; the playback group (play/pause/stop/tala) is pushed to the right via
// margin-left:auto so it aligns above the roll it drives.
const pct = (v) => Math.round(v * 100);

export function Transport({ state, canPlay, onPlay, onPause, onStop, talaVol, onTalaVol, onSave, onExportMidi, droneVol, onDroneVol }) {
  return html`<span class="transport">
    <button class="doc-btn" title="Save the .srgm source" onClick=${onSave}>Save</button>
    <button class="doc-btn" title="Export the melody as a .mid file" onClick=${onExportMidi}>Export MIDI</button>
    <span class="transport-play">
      <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
      <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
      <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
      <label class="vol" title=${`Tala volume ${pct(talaVol)}% (applies on next play)`}>
        ${talaVol <= 0 ? '🔇' : '🔊'} Tala
        <input type="range" min="0" max="1" step="0.05" value=${talaVol}
               onInput=${(e) => onTalaVol(Number(e.target.value))} />
      </label>
      <label class="vol" title=${`Drone volume ${pct(droneVol)}% (live)`}>
        ${droneVol <= 0 ? '🎵' : '🎶'} Drone
        <input type="range" min="0" max="1" step="0.05" value=${droneVol}
               onInput=${(e) => onDroneVol(Number(e.target.value))} />
      </label>
    </span>
  </span>`;
}
