import { html } from '../vendor/htm-preact.js';
import { useRef } from '../vendor/hooks.module.js';

// A draggable divider. orientation 'v' = vertical bar (drag left/right to
// reallocate the editor|roll columns); 'h' = horizontal bar (drag up/down to
// resize the top row). onResize(clientX, clientY) fires on each move; the parent
// computes the new size from a container rect.
//
// Uses pointer capture so move/up/cancel all fire on this element even when the
// pointer leaves it — no window listeners to leak, and touch works (with
// touch-action:none in CSS). pointercancel is handled so a gesture takeover
// (touch pan, OS gesture) can't strand the drag with userSelect off.
export function Splitter({ orientation, onResize }) {
  const dragging = useRef(false);
  const down = (e) => {
    e.preventDefault();
    dragging.current = true;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    document.body.style.userSelect = 'none';
  };
  const move = (e) => { if (dragging.current) onResize(e.clientX, e.clientY); };
  const end = (e) => {
    dragging.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    document.body.style.userSelect = '';
  };
  return html`<div class=${orientation === 'v' ? 'split-v' : 'split-h'}
                   onPointerDown=${down} onPointerMove=${move}
                   onPointerUp=${end} onPointerCancel=${end}
                   title="Drag to resize"></div>`;
}
