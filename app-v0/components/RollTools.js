import { html } from '../vendor/htm-preact.js';

// The roll's own controls, above its canvas. Small on purpose: it is the seam where
// draw's editing chrome arrives one control at a time, and everything it gains acts on
// whatever the roll has SELECTED, so it stays next to the thing it edits rather than in
// the app-wide toolbar.
//
// Delete is offered for a note and for a rest alike. A note is selected by clicking it —
// clicking does not open anything, because an editor is a heavier action than pointing
// at something, and a note that could only be selected by opening one had no selected
// state at all.
export function RollTools({ sel, onDelete, canUndo, onUndo, zoom, onZoom, paint, onPaint,
  mode, onBack, hasCurve, canPaste, onClear, onCopy, onPaste, snap, onSnap, hz, span, onSpan,
  gamaka, onGamaka, gmove, onGmove }) {
  const what = sel ? (sel.type === 'rest' ? 'rest' : 'note') : '';

  // Shaping one note is a different job from arranging a piece, so the strip swaps
  // rather than growing: nothing here acts on a selection or a length, and leaving the
  // roll-mode controls visible would offer edits the editor cannot make.
  if (mode === 'draw') {
    return html`<div class="roll-tools">
      <button onClick=${onBack} title="Back to the roll">‹ Back</button>
      <button disabled=${!hasCurve} onClick=${onClear} title="Remove this note's gamaka">Clear</button>
      <button disabled=${!hasCurve} onClick=${onCopy} title="Copy this gamaka">Copy</button>
      <button disabled=${!canPaste} onClick=${onPaste}
        title="Paste the copied gamaka onto this note — re-anchored to its own pitch">Paste</button>
      <label class="rt-snap" title="On: points land on the 53-EDO grid. Off: exactly where you put them.">
        <input type="checkbox" checked=${snap} onChange=${onSnap} /> snap
      </label>
      <span class="rt-zoom" title="How much of the pitch axis to show — narrow it to place a shruti precisely">
        <button disabled=${span <= 10} onClick=${() => onSpan(-8)}>−</button>
        <b>±${span}</b>
        <button disabled=${span >= 60} onClick=${() => onSpan(8)}>+</button>
      </span>
      <span class="rt-hz">${hz}</span>
      <span class="rt-what">drag across the note to trace its pitch</span>
    </div>`;
  }

  return html`<div class="roll-tools">
    <button class=${'rt-paint' + (paint ? ' on' : '')} onClick=${onPaint}
      title="Draw a new note by dragging on the grid — or a rest, in the tala margin at the left">
      ${paint ? '✓ + note' : '+ note'}
    </button>
    ${gamaka ? html`<label class="rt-snap" title="On: points land on the 53-EDO grid. Off: exactly where you put them.">
      <input type="checkbox" checked=${snap} onChange=${onSnap} /> snap
    </label>` : ''}
    <button class=${'rt-gamaka' + (gamaka ? ' on' : '')} onClick=${onGamaka}
      title="Shape a gamaka in place: drag across a note to trace it, drag a point to move it, tap one to remove it, shift-drag to re-trace over an existing curve">
      ${gamaka ? '✓ ✎ gamaka' : '✎ gamaka'}
    </button>
    <button class="rt-del" disabled=${!sel} onClick=${onDelete}
      title=${sel ? `Delete the selected ${what} (Del)` : 'Select a note or a rest first'}>
      🗑 Delete
    </button>
    <button class="rt-undo" disabled=${!canUndo} onClick=${onUndo}
      title=${canUndo ? 'Undo the last roll edit (Ctrl-Z)' : 'Nothing to undo — or the notation has been edited since'}>
      ↶ Undo
    </button>
    <!-- What a note-move does to that note's gamaka. An ornament is written against the
         note it decorates, so moving the note can mean either thing honestly: keep the
         ornament's own pitches where they were, or shift it by the same interval. Named
         for the GESTURE rather than for the gamaka, because that is what the reader is
         about to do and what the setting is a modifier of. Shown only when it can matter
         — a piece with no gamakas has no answer. -->
    ${onGmove && html`<label class="tog rt-gmove" title="Dragging a note to another pitch: keep the gamaka's own pitches, or shift it by the same interval">
      note-move
      <select value=${gmove} onChange=${(e) => onGmove(e.target.value)}>
        <option value="preserve-pitch">keep pitch</option>
        <option value="move-with-note">shift gamaka</option>
      </select>
    </label>`}
    <span class="rt-zoom" title="Stretch the time axis — a long note is easier to shape when it is tall">
      <button disabled=${zoom <= 1} onClick=${() => onZoom(-0.5)}>−</button>
      <b>${zoom}×</b>
      <button disabled=${zoom >= 8} onClick=${() => onZoom(0.5)}>+</button>
    </span>
    <span class="rt-what">${paint
      ? 'drag grid = note · drag margin = rest'
      : gamaka ? 'drag a point · tap = remove · shift-drag = re-trace'
      : (sel ? `${what} selected` : 'click = select · dbl-click = gamaka')}</span>
  </div>`;
}
