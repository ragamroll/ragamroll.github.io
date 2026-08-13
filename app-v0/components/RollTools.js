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
    <!-- Icons, not words. This strip has to fit a phone in portrait, and the three
         controls that name what they DO — paint a note, shape a gamaka, delete — say it
         in one glyph each with the title carrying the sentence. The ✓ that marked an
         armed mode goes too: the armed state already colours the button, so the tick was width
         spent saying twice what the colour says once. aria-label keeps the name for a
         reader who cannot see the glyph. -->
    <button class=${'rt-paint' + (paint ? ' on' : '')} onClick=${onPaint} aria-label="Add note"
      title="Draw a new note by dragging on the grid — or a rest, in the tala margin at the left">
      +♪
    </button>
    <!-- ✎ brings the editor's own controls with it, on the note last shaped — which is the
         one the roll has selected, because shaping selects. They are the SAME handlers the
         full-screen strip calls: a gamaka copied here pastes there and back, and the point
         of the exercise is that the editor stops being the only place these live. Shown
         only while ✎ is armed, since a strip that fits a phone cannot carry them always. -->
    ${gamaka ? html`<label class="rt-snap" title="On: points land on the 53-EDO grid. Off: exactly where you put them.">
      <input type="checkbox" checked=${snap} onChange=${onSnap} /> snap
    </label>
    <button class="rt-gclear" disabled=${!hasCurve} onClick=${onClear} aria-label="Clear gamaka"
      title=${hasCurve ? 'Remove this note\'s gamaka' : 'Shape or select a note with a gamaka first'}>∿✕</button>
    <button class="rt-gcopy" disabled=${!hasCurve} onClick=${onCopy} aria-label="Copy gamaka"
      title=${hasCurve ? 'Copy this gamaka' : 'Shape or select a note with a gamaka first'}>⧉</button>
    <button class="rt-gpaste" disabled=${!canPaste} onClick=${onPaste} aria-label="Paste gamaka"
      title=${canPaste ? 'Paste the copied gamaka onto this note — re-anchored to its own pitch' : 'Nothing copied yet'}>📋</button>
    <span class="rt-hz">${hz}</span>` : ''}
    <button class=${'rt-gamaka' + (gamaka ? ' on' : '')} onClick=${onGamaka} aria-label="Shape gamaka"
      title="Shape a gamaka in place: drag across a note to trace it, drag a point to move it, tap one to remove it, shift-drag to re-trace over an existing curve">
      ∿
    </button>
    <button class="rt-del" disabled=${!sel} onClick=${onDelete} aria-label="Delete"
      title=${sel ? `Delete the selected ${what} (Del)` : 'Select a note or a rest first'}>
      🗑
    </button>
    <button class="rt-undo" disabled=${!canUndo} onClick=${onUndo} aria-label="Undo"
      title=${canUndo ? 'Undo the last roll edit (Ctrl-Z)' : 'Nothing to undo — or the notation has been edited since'}>
      ↶
    </button>
    <!-- What a note-move does to that note's gamaka. An ornament is written against the
         note it decorates, so moving the note can mean either thing honestly: keep the
         ornament's own pitches where they were, or shift it by the same interval. Named
         for the GESTURE rather than for the gamaka, because that is what the reader is
         about to do and what the setting is a modifier of. Shown only when it can matter
         — a piece with no gamakas has no answer. -->
    ${onGmove && html`<label class="tog rt-gmove" title="Dragging a note to another pitch: keep the gamaka's own pitches, or shift it by the same interval">
      move
      <select value=${gmove} onChange=${(e) => onGmove(e.target.value)}>
        <option value="preserve-pitch">keep</option>
        <option value="move-with-note">shift</option>
      </select>
    </label>`}
    <!-- The − 1× + zoom group is gone: the roll carries a zoom slider down its right
         edge now, which does the same thing continuously and anchors on the centre of
         what is on screen. Two controls for one axis, one of which stepped in halves,
         was width a phone did not have. -->
    <span class="rt-what">${paint
      ? 'drag grid = note · drag margin = rest'
      : gamaka ? 'drag a point · tap = remove · shift-drag = re-trace'
      : (sel ? `${what} selected` : 'click = select · dbl-click = gamaka')}</span>
  </div>`;
}
