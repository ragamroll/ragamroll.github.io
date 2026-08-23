import { html } from '../vendor/htm-preact.js';

/**
 * The controls you press WHILE a piece is running: rewind, play/pause, stop, loop.
 *
 * The A/V trim is NOT here, though it too is set by ear while playing. It is a label and two
 * buttons wide, and bringing it up took the top row from one line to three on a narrow screen
 * — more of the phone than the transport it was meant to save. It is set once for a pair of
 * headphones, and setting it is a moment when the chrome is up anyway.
 *
 * They live in the top row rather than with the rest of the transport, and that is the whole
 * point of them being a component. On a phone the notation drawer can be pulled down far
 * enough to push the transport, the control bar and the footer off the bottom of the screen —
 * which is what a reader wants when the roll is the thing being read. These stay put.
 *
 * `transport-play` is kept as the class name deliberately: fourteen guards reach for it, and
 * moving a button is not a reason to make them all lie about where it is.
 */
export function PlayBar({ state, canPlay, onPlay, onPause, onStop, onRewind,
  looping, onToggleLoop, hasSeg }) {
  return html`<span class="transport-play">
      <button title="Back to the start (of the A–B segment, if set)" onClick=${onRewind} disabled=${!canPlay}>⏮</button>
      <!-- ONE button, as on the gamaka page. Play and Pause were never both available:
           whichever one you could press, the other was greyed out beside it, so the pair
           spent its width saying what you cannot do. It says Resume rather than Play
           after a pause, because that is the difference the press will make — playback
           carries on from where it stopped rather than from the top. -->
      <button class="pri" onClick=${state === 'playing' ? onPause : onPlay}
              title=${state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Play'}
              disabled=${state !== 'playing' && !canPlay}>${state === 'playing' ? '⏸' : '▶'}</button>
      <button title="Stop"  onClick=${onStop}  disabled=${state === 'stopped'}>⏹</button>
      <button class=${'loop-btn' + (looping ? ' on' : '')} aria-pressed=${!!looping}
              onClick=${onToggleLoop}
              title=${looping
                ? `Repeating the ${hasSeg ? 'A–B segment' : 'piece'} until you stop — click to play it once`
                : `Play once — click to repeat the ${hasSeg ? 'A–B segment' : 'piece'} until you stop`}>🔁</button>
    </span>`;
}
