import { html } from '../vendor/htm-preact.js';

// A draggable divider. orientation 'v' = vertical bar (drag left/right to
// reallocate the editor|roll columns); 'h' = horizontal bar (drag up/down to
// resize the top row's height). onResize(clientX, clientY) fires on each move;
// the parent computes the new size from a container rect.
export function Splitter({ orientation, onResize }) {
  const onPointerDown = (e) => {
    e.preventDefault();
    const move = (ev) => onResize(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.style.userSelect = 'none';   // no text selection while dragging
  };
  return html`<div class=${orientation === 'v' ? 'split-v' : 'split-h'}
                   onPointerDown=${onPointerDown} title="Drag to resize"></div>`;
}
