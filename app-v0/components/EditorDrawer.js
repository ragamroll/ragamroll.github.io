import { html } from '../vendor/htm-preact.js';
import { useRef } from '../vendor/hooks.module.js';
import { Editor, GkaStrip } from './Editor.js';
import { EditTools } from './EditTools.js';

// The notation, on a drawer. This is the gamaka page's grip, and its rules are the ones
// that page has always used:
//
//   drag it        the drawer follows your finger, up to 60% of the window
//   tap it         open to a third of the window, or shut if it is open
//   it starts shut so the roll has the whole screen
//
// Drag and tap are told apart by whether the pointer moved more than 3px, which is what
// makes one control do both: on a phone there is no room for a handle AND a button, and
// a drawer you can only toggle cannot be sized to the phrase you are reading.
//
// Shut is height 0 rather than unmounted. The notation is the thing being edited — the
// roll is a view of it — so it stays in the document, keyed and focusable, and a piece
// loaded while the drawer is shut is already there when it opens.
// DOWN PAST SHUT. Below zero the drawer is closed and the grip goes on pushing — the
// transport, the control bar and the footer slide off the bottom of the screen and the roll
// takes the room. On a phone that chrome is about three hundred pixels of eight hundred, and
// a reader following a piece wants none of it. Nothing is lost: pull the grip back up and it
// all returns, and the controls that matter while a piece RUNS are in the top row now, where
// no amount of pushing can reach them.
const MAX_FRAC = 0.6, OPEN_FRAC = 0.35, MOVED_PX = 3, HIDE_FRAC = 0.42;

export function EditorDrawer({ h, setH, text, onText, ragas, talas, raga, tala, blank, onRaga, onTala,
  gkaOn, onGkaToggle, gkaText, hasGka, reading, onReading, onPeek, durations, measure }) {
  const drag = useRef(null);
  const winH = () => window.innerHeight || 600;
  const clamp = (v) => Math.max(-Math.round(winH() * HIDE_FRAC), Math.min(v, Math.round(winH() * MAX_FRAC)));

  const down = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the gesture still works */ }
    drag.current = { y: e.clientY, h, moved: false };
    document.body.style.userSelect = 'none';
  };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const dy = d.y - e.clientY;                 // up is bigger, the drawer comes UP
    if (Math.abs(dy) > MOVED_PX) d.moved = true;
    setH(clamp(d.h + dy));
  };
  const up = () => {
    const d = drag.current; if (!d) return;
    drag.current = null; document.body.style.userSelect = '';
    // A tap from BELOW shut brings the chrome back rather than opening the notation: one
    // step at a time, and the step you are on is the one you undo.
    if (!d.moved) setH(h < 0 ? 0 : (h > 10 ? 0 : Math.round(winH() * OPEN_FRAC)));
  };

  const open = h > 10;
  const body = Math.max(0, h);          // below zero the drawer is shut; the push is the host's
  return html`<div class=${'editor-drawer' + (open ? ' open' : '')}>
    <div class="grip" title="Slide up for the srgm notation · tap to toggle"
         onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}><span /></div>
    <div class="drawer-body" style=${`height:${body}px`}>
      <${EditTools} ragas=${ragas} talas=${talas} raga=${raga} tala=${tala}
        blank=${blank} onRaga=${onRaga} onTala=${onTala} />
      <!-- The same strip as the side-by-side layout, in the same place relative to the
           notation: above it. Shut, the drawer hides it — which is right, because on a
           phone there is no pointer to hover with and nothing would ever fill it. -->
      <${GkaStrip} on=${gkaOn} onToggle=${onGkaToggle} text=${gkaText} has=${hasGka}
        reading=${reading} onReading=${onReading} />
      <${Editor} value=${text} onInput=${onText} readOnly=${reading} onPeek=${onPeek}
        durations=${durations} measure=${measure} />
    </div>
  </div>`;
}
