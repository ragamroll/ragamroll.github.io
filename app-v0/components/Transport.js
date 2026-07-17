import { html } from '../vendor/htm-preact.js';

// Action bar above the workspace. Document actions (Save, Export MIDI) sit on
// the left; the playback group (play/pause/stop/tala) is pushed to the right via
// margin-left:auto so it aligns above the roll it drives.
export function Transport({ state, canPlay, onPlay, onPause, onStop, talaMuted, onToggleTalaMute, onSave, onExportMidi }) {
  return html`<span class="transport">
    <button class="doc-btn" title="Save the .srgm source" onClick=${onSave}>Save</button>
    <button class="doc-btn" title="Export the melody as a .mid file" onClick=${onExportMidi}>Export MIDI</button>
    <span class="transport-play">
      <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
      <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
      <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
      <button class="tala-mute" title=${talaMuted ? 'Tala muted — click to unmute (applies on next play)'
                                                 : 'Tala audible — click to mute (applies on next play)'}
              aria-pressed=${talaMuted} onClick=${onToggleTalaMute}>
        ${talaMuted ? '🔇' : '🔊'} Tala
      </button>
    </span>
  </span>`;
}
