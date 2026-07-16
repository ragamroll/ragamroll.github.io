// Pure: map a 0..1 playback fraction to a scrollTop over a pane's scrollable range.
export function scrollPos(fraction, scrollHeight, clientHeight) {
  const f = Math.max(0, Math.min(1, fraction));
  return Math.round(f * Math.max(0, scrollHeight - clientHeight));
}
