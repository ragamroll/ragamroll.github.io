import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useCallback } from '../vendor/hooks.module.js';
import { OpenMenu } from './OpenMenu.js';
import { MELODY_VOICES, isTunable } from '../audio/voices.js';
// The voices come from the backend's own list. Kept here as a second copy, this menu
// offered two names — `pluck` and `reed-fm` — that no backend case implemented, and both
// played as the bowed synth without a word.

// Fullscreen, which on a phone is what gets rid of the address bar — the gamaka page's
// button, and the reason it has one: that bar is 60-odd pixels of a roll you are trying
// to read. Local state rather than the app's, because it belongs to the BROWSER, not the
// piece; it listens for fullscreenchange so leaving by Escape is reflected here too.
// webkit-prefixed fallbacks for older iOS Safari, where the unprefixed call is missing.
// Fullscreen, asked of BOTH things that can be true. An element can be fullscreen
// (document.fullscreenElement), or the whole window can be — which is what an installed app
// looks like, and which leaves fullscreenElement null.
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement
  || (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches));

function FullscreenButton() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(isFull());
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    // AND THE DISPLAY MODE, which is the one that answers on an installed app. A PWA can be
    // showing fullscreen without document.fullscreenElement being set — the window is
    // fullscreen, not an element — and the button then read as "not fullscreen", offered to
    // enter it again, and left a reader with no way back out. Reported from a phone.
    const mq = window.matchMedia ? window.matchMedia('(display-mode: fullscreen)') : null;
    if (mq && mq.addEventListener) mq.addEventListener('change', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', sync);
    };
  }, []);
  const toggle = useCallback(() => {
    const d = document, el = d.documentElement;
    if (isFull()) {
      // Both spellings, and a promise that may reject — exitFullscreen rejects when the
      // document is not the one that asked, and an unhandled rejection here would be a
      // button that appears to do nothing.
      const exit = (d.exitFullscreen || d.webkitExitFullscreen);
      if (exit) { try { Promise.resolve(exit.call(d)).catch(() => {}); } catch (_) { /* older engine */ } }
    } else {
      const enter = (el.requestFullscreen || el.webkitRequestFullscreen);
      if (enter) { try { Promise.resolve(enter.call(el)).catch(() => {}); } catch (_) { /* refused */ } }
    }
  }, []);
  return html`<button class="fs-btn" onClick=${toggle} aria-pressed=${on}
    title=${on ? 'Leave fullscreen' : 'Fullscreen — hides the address bar'}
    aria-label="Fullscreen">${on ? '⤡' : '⛶'}</button>`;
}

// Two bars, and which one a thing belongs to is decided by what it IS.
//
// The head says what page you are on and WHICH PIECE is open: its name — the one Save
// and Export MIDI will use — or "blank / new" when there is nothing in it yet. It used
// to report the raga and the tala instead, which the notation box now says directly,
// above the swaras they apply to, and which the roll draws as rows and accents. Nothing
// here changes anything. Everything that DOES — Open,
// the browsers, the scale override, the voice, the pane order — is a control, and the
// controls live at the bottom of the screen with the transport, where a thumb reaches
// them. That is the gamaka page's shape, and the reason it holds a phone: the roll is
// the whole middle of the window instead of what is left after the chrome.
export function Toolbar({ docName, blank, duration }) {
  return html`<div class="toolbar">
    <span class="app-badge">RagaM-Roll</span>
    <a class="help-link" href="./help.html" target="_blank" rel="noopener"
       title="Help — notation guide &amp; features">?</a>
    <span class=${'readout' + (blank ? ' blank' : '')}>${blank ? 'blank / new' : docName}</span>
    <!-- HOW LONG THE PIECE IS, beside its name. The roll is scaled by the median note, so
         a piece at twice the tempo draws identically and takes half as long — the duration
         is the one thing about time that nothing on the page showed. Here rather than on
         the roll because it does not change as you scroll and costs no grid at any width,
         which is what a phone needs. It follows a tempo override, like the ruler does. -->
    ${duration && html`<span class="head-dur" title="How long the piece takes at this tempo">${duration}</span>`}
    <${FullscreenButton} />
  </div>`;
}

export function ControlBar({ onNew, onOpen, examples, exampleValue, onExample, onOpenLink,
  onOpenRagas, onOpenTalas, onOpenScale, scaleActive, timbre, onTimbre, onOpenInstrument }) {
  return html`<div class="controlbar">
    <${OpenMenu} examples=${examples} exampleValue=${exampleValue} onNew=${onNew} onOpen=${onOpen} onExample=${onExample} onOpenLink=${onOpenLink} />
    <button onClick=${onOpenRagas}>Ragas</button>
    <button onClick=${onOpenTalas}>Talas</button>
    <button class=${'scale-btn' + (scaleActive ? ' active' : '')} onClick=${onOpenScale}
            title="Experimental: override the scale pitches (53-EDO)">Scale ⚙${scaleActive ? ' •' : ''}</button>
    <label class="timbre" title="Melody instrument voice (applies on next play)">🎻
      <select value=${timbre} onChange=${(e) => onTimbre(e.target.value)}>
        ${MELODY_VOICES.map(([v, label]) => html`<option key=${v} value=${v}>${label}</option>`)}
      </select>
    </label>
    <!-- Only the voice that is built from parts has parts to move. A settings button beside
         a preset would open on an apology. -->
    ${isTunable(timbre) && html`<button class="instr-btn" onClick=${onOpenInstrument}
      title="Open this instrument: the string, its body and its room">⚙</button>`}
  </div>`;
}
