// Pure: map a 0..1 playback fraction to a scrollTop over a pane's scrollable range.
export function scrollPos(fraction, scrollHeight, clientHeight) {
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(f * Math.max(0, scrollHeight - clientHeight));
}

// Pure: scrollTop that centers the active row in the viewport, clamped so the
// view never scrolls past the content bounds (rides top→center at the start,
// center→bottom at the end).
export function playheadScroll(activeRow, rowHeight, scrollHeight, clientHeight) {
  const target = (activeRow + 0.5) * rowHeight - clientHeight / 2;
  return Math.round(Math.max(0, Math.min(target, Math.max(0, scrollHeight - clientHeight))));
}
