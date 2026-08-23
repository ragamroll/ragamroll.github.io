import { html } from '../vendor/htm-preact.js';
import { midiToName } from '../core/tuning.js';
import { useRef } from '../vendor/hooks.module.js';

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

export function Transport({ state, canPlay, onPlay, onPause, onStop, looping, onToggleLoop, hasSeg,
  syncMs, onSync,
  talaVol, onTalaVol, talaMuted, onToggleTala, melodyMuted, onToggleMelody,
  droneVol, onDroneVol, droneMuted, onToggleDrone, masterVol, onMasterVol,
  onSave, onExportMidi, onShare, shared, onLanes, compositionTempo, tempoOverride, onTempo, onResetTempo,
  saPitch, autoSaMidi, onSetSa, onRewind}) {
  // PRESS, THEN HOLD. A first nudge on the press, then repeats while the finger stays down —
  // starting slowly enough that a single tap is one step, and quickening so that a couple of
  // hundred milliseconds of trim is a press-and-wait rather than a count.
  //
  // THE TIMER LIVES IN A REF, and that is the whole difficulty. The first version kept it in a
  // closure built by a helper called during render — and every nudge causes a render, so the
  // handler that ran on pointer-up belonged to a LATER closure and cleared a timer that was
  // not the running one. Each tap left a repeater going behind it; three taps drove the trim
  // to its limit in the wrong direction, which is how it was found.
  const hold = useRef({ t: 0, every: 220 });
  const stopHold = () => { clearTimeout(hold.current.t); hold.current.t = 0; hold.current.every = 220; };
  const nudge = (dir) => ({
    onPointerDown: (e) => {
      e.preventDefault();
      stopHold();
      onSync(dir);
      const again = () => {
        onSync(dir);
        hold.current.every = Math.max(60, hold.current.every * 0.75);
        hold.current.t = setTimeout(again, hold.current.every);
      };
      hold.current.t = setTimeout(again, 420);
    },
    onPointerUp: stopHold, onPointerLeave: stopHold, onPointerCancel: stopHold,
  });

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

      <span class="transport-mix">
      <!-- A/V TRIM, and it is nudged rather than typed. This is a value you can only find by
           ear while a piece runs: a number field makes you leave that loop to guess, type,
           listen and guess again, and nobody knows what a millisecond feels like. Two buttons
           converge on it in seconds. Held down they repeat, because a Bluetooth headset is a
           couple of hundred milliseconds out and that should not be ten taps.
           The reading appears only once it is non-zero, so it costs no width until it is
           used and is never invisible state. The label resets it. -->
      <span class=${'sync' + (syncMs ? ' on' : '')}
            title=${'Line and sound disagree? Nudge the playhead until they meet. Bluetooth and '
              + 'external speakers lag by more than they admit to, and no browser reports it. '
              + 'Remembered for this browser — it belongs to the machine, not the piece.'}>
        <button class="sync-nudge" aria-label="Playhead earlier"
                ...${nudge(-1)}>◀</button>
        <button class="sync-name" onClick=${() => onSync(0)}
                title=${syncMs ? 'Back to no trim' : 'No trim'}>${syncMs ? `${syncMs > 0 ? '+' : ''}${syncMs} ms` : 'sync'}</button>
        <button class="sync-nudge" aria-label="Playhead later"
                ...${nudge(1)}>▶</button>
      </span>
      <!-- What it will repeat is in the title, not left to be inferred: the same toggle
           means the segment or the whole piece depending on whether a range is marked, and
           a control whose scope you have to work out is a control you press twice. Live —
           turning it on mid-run makes the pass you are in the first of many, and turning it
           off lets that pass finish rather than cutting the note you are inside. -->
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
