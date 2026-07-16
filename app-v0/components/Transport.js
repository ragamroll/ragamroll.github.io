import { html } from '../vendor/htm-preact.js';

export function Transport({ state, canPlay, onPlay, onPause, onStop, talaMuted, onToggleTalaMute }) {
  return html`<span class="transport">
    <button title="Play"  onClick=${onPlay}  disabled=${state === 'playing' || !canPlay}>▶</button>
    <button title="Pause" onClick=${onPause} disabled=${state !== 'playing'}>⏸</button>
    <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
    <button class="tala-mute" title=${talaMuted ? 'Tala muted — click to unmute (applies on next play)'
                                               : 'Tala audible — click to mute (applies on next play)'}
            aria-pressed=${talaMuted} onClick=${onToggleTalaMute}>
      ${talaMuted ? '🔇' : '🔊'} Tala
    </button>
  </span>`;
}
