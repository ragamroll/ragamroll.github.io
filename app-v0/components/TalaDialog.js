import { html } from '../vendor/htm-preact.js';
import { useState, useEffect, useRef } from '../vendor/hooks.module.js';
import { talaMarks, talaPreview } from '../core/tala-preview.js';
import { droneFreqs } from '../audio/drone.js';
import { titleCase } from '../core/reference.js';

// Audio-visual tala browser: each tala shows its aksharas as a row of boxes
// carrying the traditional anga glyphs (I laghu, O drutam, U anudrutam) at each
// limb start; the cycle start (first laghu) is highlighted. ▶ plays the cycle as
// strums through the shared player and lights each box (rAF off player.position).
export function TalaDialog({ talas, player, saMidi = 60, droneLevel = 0.5, stopMain, onClose }) {
  const [playing, setPlaying] = useState(null);
  const rafRef = useRef(0);
  const contRef = useRef(null);    // the active box-row element
  const idxRef = useRef(-1);

  const clearActive = () => {
    contRef.current?.children[idxRef.current]?.classList.remove('on');
    contRef.current = null;
    idxRef.current = -1;
  };
  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    try { player.stop(); player.droneOff(); } catch { /* backend may be mid-teardown */ }
    clearActive();
    setPlaying(null);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { stop(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); stop(); };   // stop on unmount/close
  }, []);

  const play = async (name, contEl) => {
    stopMain?.();     // free the shared transport from any composition playback
    stop();
    const prev = talaPreview(talas[name], { bpm: 110, cycles: 3, saMidi });
    if (prev.totalSec <= 0) return;
    player.onended = () => stop();
    player.load(prev.events, prev.totalSec);
    setPlaying(name);
    contRef.current = contEl;
    try {
      await player.play();            // resume/unlock the AudioContext before the drone
      // Same global drone as the composition, so the cycle is heard against S–P–S.
      if (droneLevel > 0) player.setDrone(droneFreqs(saMidi), droneLevel);
    } catch { stop(); return; }
    const { aksharas: A, cycles: cyc } = prev;
    const loop = () => {
      const pos = player.position();
      if (pos >= 1) { stop(); return; }
      const idx = Math.min(A - 1, Math.floor(pos * A * cyc) % A);
      if (idx !== idxRef.current) {
        contEl.children[idxRef.current]?.classList.remove('on');
        contEl.children[idx]?.classList.add('on');
        idxRef.current = idx;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  const stopEvt = (e) => e.stopPropagation();
  const close = () => { stop(); onClose(); };

  return html`<div class="dialog-backdrop" onClick=${close}>
    <div class="dialog-box tala-box" onClick=${stopEvt} role="dialog" aria-modal="true" aria-label="Talas">
      <div class="dialog-head">
        <strong>Talas</strong>
        <button title="Close" onClick=${close}>✕</button>
      </div>
      <div class="dialog-body">
        <div class="tala-hint">▶ plays the cycle — <b>I</b> laghu, <b>O</b> drutam, <b>U</b> anudrutam; the cycle start (first laghu) is lower Sa, other limbs are accented.</div>
        <ul class="tala-list">
          ${Object.keys(talas).map((name) => {
            const marks = talaMarks(talas[name]);
            const isPlaying = playing === name;
            return html`<li key=${name}>
              <div class="tala-head">
                <button class=${'tala-play' + (isPlaying ? ' on' : '')}
                        onClick=${(e) => { const cont = e.currentTarget.closest('li').querySelector('.akrow');
                                           isPlaying ? stop() : play(name, cont); }}>
                  ${isPlaying ? '⏹' : '▶'}
                </button>
                <span class="tala-name">${titleCase(name)}</span>
                <span class="tala-count">${talas[name][0]} aksharas · accents ${talas[name][1].join(', ')}</span>
              </div>
              <div class="akrow">
                ${marks.map((mk, i) => html`<span key=${i}
                    class=${'akbox ' + (mk.role === 'start' ? 'start' : mk.role === 'anga' ? 'acc' : 'plain')}>${mk.ch}</span>`)}
              </div>
            </li>`;
          })}
        </ul>
      </div>
    </div>
  </div>`;
}
