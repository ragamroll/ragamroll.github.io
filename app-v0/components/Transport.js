import { html } from '../vendor/htm-preact.js';
import { midiToName } from '../core/tuning.js';

// Action bar above the workspace. Wraps on narrow (portrait) screens so no
// control is clipped. Sa + tempo sit on the main UI for easy reach; the mix
// group runs Drone → Melody → Tala → Master (Drone first so mute/unmute is
// closest to hand on mobile).
const pct = (v) => Math.round(v * 100);

// Sa reference-pitch choices span the full vocal range of shadja tonics, from
// the lowest male (bass, ~E2) to the highest female (soprano, ~C5). MIDI is
// standard here (60 = middle C, 261.63 Hz); the note labels carry the app's
// +1-octave display quirk.
const SA_CHOICES = [];
for (let m = 40; m <= 72; m++) SA_CHOICES.push(m);

// What a playback tempo may be. 600 rather than 400 because a length-unit is not a beat:
// curated files carry T480, and a box that stopped at 400 could not even reach the tempo
// of the piece it was overriding. The slider is a SPEED, and quarter-speed to quadruple
// covers the kalai the notation itself doubles and halves in.
export const BPM_MIN = 20, BPM_MAX = 600;
const MULT_MIN = 0.25, MULT_MAX = 4, MULT_STEP = 0.25;
const clampBpm = (v) => Math.max(BPM_MIN, Math.min(BPM_MAX, v));

export function Transport({ state, canPlay, onPlay, onPause, onStop,
  talaVol, onTalaVol, talaMuted, onToggleTala, melodyMuted, onToggleMelody,
  droneVol, onDroneVol, droneMuted, onToggleDrone, masterVol, onMasterVol,
  onSave, onExportMidi, onShare, shared, onLanes, compositionTempo, tempoOverride, onTempo, onResetTempo,
  saPitch, autoSaMidi, onSetSa, onRewind}) {
  const overridden = tempoOverride != null;
  const eff = overridden ? tempoOverride : compositionTempo;
  // Speed multiplier of the composition tempo. The RATIO is honest and the SLIDER's own
  // position is what gets clamped — pinning the ratio to the slider's range read "2.0×"
  // for 240 BPM and for 400 alike, so a tempo typed past the slider's end looked like a
  // control that had stopped responding to anything.
  const ratio = eff / compositionTempo;
  const sliderAt = Math.max(MULT_MIN, Math.min(MULT_MAX, Math.round(ratio / MULT_STEP) * MULT_STEP));

  return html`<span class="transport">
    <button class="doc-btn" title="Save the .srgm source" onClick=${onSave}>Save</button>
    <button class="doc-btn" title="Export the melody as a .mid file" onClick=${onExportMidi}>Export MIDI</button>
    <button class=${'doc-btn' + (shared ? ' ok' : '')} title="Copy a shareable link (composition packed into the URL)"
            onClick=${onShare}>${shared ? 'Copied ✓' : 'Share'}</button>
    <!-- The other end of the same piece: the lane editor places the written swaras and the
         sahitya on these notes. It goes by link rather than by file, so nothing has to be
         saved and found again to cross between the two. -->
    <button class="doc-btn" title="Open this piece in the lane editor — where the written swaras and the sahitya are placed on its notes"
            onClick=${onLanes}>Lanes ↗</button>

    <label class="sapick" title="Sa reference pitch — transposes playback (Auto = the raga's Sa)">
      Sa
      <select value=${saPitch == null ? '' : String(saPitch)}
              onChange=${(e) => onSetSa(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">Auto (${midiToName(autoSaMidi)})</option>
        ${SA_CHOICES.map((m) => html`<option key=${m} value=${String(m)}>${midiToName(m)}</option>`)}
      </select>
    </label>

    <label class=${'tempo' + (overridden ? ' on' : '')}
           title=${`Playback tempo. Slider = speed × the composition's ${compositionTempo} BPM (${MULT_STEP} steps, ${MULT_MIN}–${MULT_MAX}×); the box sets an exact BPM (${BPM_MIN}–${BPM_MAX}), including past the slider's ends. ↺ = back to composition.`}>
      ♩
      <input class="tempo-mult" type="range" min=${String(MULT_MIN)} max=${String(MULT_MAX)} step=${String(MULT_STEP)} value=${sliderAt}
             onInput=${(e) => onTempo(clampBpm(Math.round(compositionTempo * Number(e.target.value))))} />
      <input class="tempo-num" type="number" min=${String(BPM_MIN)} max=${String(BPM_MAX)} step="1" placeholder=${String(compositionTempo)}
             value=${overridden ? String(tempoOverride) : ''}
             onInput=${(e) => { const val = e.target.value; if (val === '') onResetTempo(); else onTempo(Number(val)); }}
             onBlur=${(e) => { e.target.value = overridden ? String(tempoOverride) : ''; }} />
      <span class="tempo-state">${overridden ? `${eff} bpm · ${ratio.toFixed(2)}×` : `comp ${compositionTempo}`}</span>
      ${overridden ? html`<button class="tempo-reset" title="Use composition tempo" onClick=${onResetTempo}>↺</button>` : ''}
    </label>

    <span class="transport-play">
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

      <span class=${'vol' + (droneMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!droneMuted} onClick=${onToggleDrone}
                title=${droneMuted ? 'Drone off — click to turn on (keeps the set level)'
                                   : `Drone on (${pct(droneVol)}%) — click to silence`}>
          ${droneMuted ? '🎵' : '🎶'} Drone
        </button>
        <input type="range" min="0" max="1" step="0.05" value=${droneVol}
               title=${`Drone volume ${pct(droneVol)}%`}
               onInput=${(e) => onDroneVol(Number(e.target.value))} />
      </span>
      <span class=${'vol' + (melodyMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!melodyMuted} onClick=${onToggleMelody}
                title=${melodyMuted ? 'Melody muted — click to unmute'
                                    : 'Melody on — click to mute (solo tala + drone)'}>
          ${melodyMuted ? '🔇' : '🎼'} Melody
        </button>
      </span>
      <span class=${'vol' + (talaMuted ? ' muted' : '')}>
        <button class="vol-toggle" aria-pressed=${!talaMuted} onClick=${onToggleTala}
                title=${talaMuted ? 'Tala off — click to unmute (keeps the set level)'
                                  : `Tala on (${pct(talaVol)}%) — click to mute`}>
          ${talaMuted ? '🔇' : '🔊'} Tala
        </button>
        <input type="range" min="0" max="1" step="0.05" value=${talaVol}
               title=${`Tala volume ${pct(talaVol)}%`}
               onInput=${(e) => onTalaVol(Number(e.target.value))} />
      </span>
      <label class="vol" title=${`Master volume ${pct(masterVol)}%`}>
        ${masterVol <= 0 ? '🔇' : '🔈'} Master
        <input type="range" min="0" max="1" step="0.05" value=${masterVol}
               onInput=${(e) => onMasterVol(Number(e.target.value))} />
      </label>
    </span>
  </span>`;
}
