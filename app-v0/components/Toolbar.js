import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useCallback } from '../vendor/hooks.module.js';
import { OpenMenu } from './OpenMenu.js';
const TIMBRES = [
  ['soft-am', 'Soft'],
  ['bowed-fm', 'Bowed'],
  ['reed-fm', 'Reed'],
  ['pluck', 'Pluck'],
];

// Fullscreen, which on a phone is what gets rid of the address bar — the gamaka page's
// button, and the reason it has one: that bar is 60-odd pixels of a roll you are trying
// to read. Local state rather than the app's, because it belongs to the BROWSER, not the
// piece; it listens for fullscreenchange so leaving by Escape is reflected here too.
// webkit-prefixed fallbacks for older iOS Safari, where the unprefixed call is missing.
function FullscreenButton() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);
  const toggle = useCallback(() => {
    const d = document, el = d.documentElement;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
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
export function Toolbar({ docName, blank }) {
  return html`<div class="toolbar">
    <span class="app-badge">RagaM-Roll</span>
    <a class="help-link" href="./help.html" target="_blank" rel="noopener"
       title="Help — notation guide &amp; features">?</a>
    <a class="help-link" href="./draw.html"
       title="Draw gamakas on a pitch roll (experimental)">✎</a>
    <span class=${'readout' + (blank ? ' blank' : '')}>${blank ? 'blank / new' : docName}</span>
    <${FullscreenButton} />
  </div>`;
}

export function ControlBar({ onNew, onOpen, examples, exampleValue, onExample, onOpenLink,
  onOpenRagas, onOpenTalas, onOpenScale, scaleActive, timbre, onTimbre,
  stacked, rollFirst, onSwap }) {
  return html`<div class="controlbar">
    <${OpenMenu} examples=${examples} exampleValue=${exampleValue} onNew=${onNew} onOpen=${onOpen} onExample=${onExample} onOpenLink=${onOpenLink} />
    <button onClick=${onOpenRagas}>Ragas</button>
    <button onClick=${onOpenTalas}>Talas</button>
    <button class=${'scale-btn' + (scaleActive ? ' active' : '')} onClick=${onOpenScale}
            title="Experimental: override the scale pitches (53-EDO)">Scale ⚙${scaleActive ? ' •' : ''}</button>
    <label class="timbre" title="Melody instrument voice (applies on next play)">🎻
      <select value=${timbre} onChange=${(e) => onTimbre(e.target.value)}>
        ${TIMBRES.map(([v, label]) => html`<option key=${v} value=${v}>${label}</option>`)}
      </select>
    </label>
    ${!stacked && html`<button class="swap-btn" onClick=${onSwap}
            title=${rollFirst ? 'Swap: put the notation on the left' : 'Swap: put the roll on the left'}>⇄</button>`}
  </div>`;
}
