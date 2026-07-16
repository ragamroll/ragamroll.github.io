import { html } from '../vendor/htm-preact.js';

export function Transport({ state, canPlay, onPlay, onPause, onStop }) {
  return html`<span class="transport">
    <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
    <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
    <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
  </span>`;
}
