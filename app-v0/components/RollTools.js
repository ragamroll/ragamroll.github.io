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
  hasSeg, onMarkA, onMarkB, onClearMarks }) {
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
      <label class="rt-snap" title="Snap each anchor onto a row of the raga when you let go">
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
    <button class="rt-del" disabled=${!sel} onClick=${onDelete}
      title=${sel ? `Delete the selected ${what} (Del)` : 'Select a note or a rest first'}>
      🗑 Delete
    </button>
    <button class="rt-undo" disabled=${!canUndo} onClick=${onUndo}
      title=${canUndo ? 'Undo the last roll edit (Ctrl-Z)' : 'Nothing to undo — or the notation has been edited since'}>
      ↶ Undo
    </button>
    <span class=${'rt-ab' + (hasSeg ? ' on' : '')}
      title="Play only part of the piece: select a note and mark it as the start (A) or the end (B)">
      <button disabled=${!sel || sel.type !== 'note'} onClick=${onMarkA}>A</button>
      <button disabled=${!sel || sel.type !== 'note'} onClick=${onMarkB}>B</button>
      <button disabled=${!hasSeg} onClick=${onClearMarks} title="Play the whole piece again">⟲</button>
    </span>
    <span class="rt-zoom" title="Stretch the time axis — a long note is easier to shape when it is tall">
      <button disabled=${zoom <= 1} onClick=${() => onZoom(-0.5)}>−</button>
      <b>${zoom}×</b>
      <button disabled=${zoom >= 8} onClick=${() => onZoom(0.5)}>+</button>
    </span>
    <span class="rt-what">${paint
      ? 'drag grid = note · drag left margin = rest'
      : (sel ? `${what} selected` : 'click = select · double-click = shape gamaka')}</span>
  </div>`;
}
