// WHERE THE CONTROLS SIT, as data rather than as markup.
//
// The chrome under the roll used to be three components' worth of JSX, and every time a reader
// wanted a different arrangement it was a code change and a release. It is now a list of rows,
// each a list of control ids — so the same change is a setting, is remembered, can be written
// to a file and handed back, and can be folded into the built-in default with
// tools/apply-layout.mjs. The same road the instrument panel already takes.
//
// ROW ORDER IS PRIORITY ORDER. The panel is clipped from the BOTTOM when the notation grip is
// pushed past shut, so the last row is the first to go. Row 1 is pinned above the panel
// entirely and is never clipped: it holds what you must be able to reach while a piece plays.

// Every control the chrome can place. The id is what a saved layout stores, so these are a
// compatibility surface: rename one and every layout in the wild loses it. Add freely.
export const CONTROLS = [
  'open', 'rewind', 'play', 'stop', 'loop', 'timbre', 'sa',
  'drone', 'melody', 'tala',
  'master', 'tempo', 'sync',
  'lanes', 'save', 'share', 'midi',
  'ragas', 'talas', 'scale',
];

// The built-in arrangement. Row 1 is the pinned one.
export const DEFAULT_ROWS = [
  ['rewind', 'play', 'stop', 'loop', 'open', 'timbre'],
  ['drone', 'melody', 'tala', 'sa'],
  ['master', 'tempo', 'sync'],
  ['lanes', 'save', 'share', 'midi'],
  ['ragas', 'talas', 'scale'],
];

export const LAYOUT_KEY = 'ragamroll.layout';

// READING A LAYOUT BACK IN, and it must never lose a control.
//
// The instrument panel refuses a settings file whole when it names something this build does
// not have: half an instrument is neither. A layout cannot work that way, because its failure
// mode is a button you can no longer reach. So this drops what it does not recognise, keeps
// what it does, and puts anything the file never mentioned back on the floor — with a note
// saying what it did, in the panel, where the reader is.
export function readLayout(text) {
  let raw;
  try { raw = typeof text === 'string' ? JSON.parse(text) : text; }
  catch { return { ok: false, error: 'That file is not JSON. The panel writes the kind it reads with ⭳ Save.' }; }
  const rows = Array.isArray(raw) ? raw : (raw && raw.rows);
  if (!Array.isArray(rows) || !rows.length || !rows.every(Array.isArray))
    return { ok: false, error: 'That JSON is not a set of control rows.' };

  const known = new Set(CONTROLS);
  const seen = new Set();
  const notes = [];
  const dropped = [];
  const out = rows.map((row) => row.filter((id) => {
    if (typeof id !== 'string') return false;
    if (!known.has(id)) { if (!dropped.includes(id)) dropped.push(id); return false; }
    if (seen.has(id)) return false;                 // a control cannot be in two places
    seen.add(id);
    return true;
  })).filter((row, i) => row.length > 0 || i === 0);   // row 1 survives even if it came empty

  if (dropped.length) notes.push(`${dropped.join(', ')} ${dropped.length > 1 ? 'are not controls' : 'is not a control'} this build has`);
  const missing = CONTROLS.filter((id) => !seen.has(id));
  if (missing.length) {
    // On the LAST row, which is the first to be pushed off screen — out of the way, but
    // findable. Losing them would mean a control with no way back.
    out[out.length - 1] = out[out.length - 1].concat(missing);
    notes.push(`${missing.join(', ')} ${missing.length > 1 ? 'were' : 'was'} not in the file and ${missing.length > 1 ? 'are' : 'is'} on the last row`);
  }
  return { ok: true, rows: out, notes };
}

export function loadLayout() {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY);
    if (!stored) return DEFAULT_ROWS.map((r) => r.slice());
    const out = readLayout(stored);
    return out.ok ? out.rows : DEFAULT_ROWS.map((r) => r.slice());
  } catch (_) { return DEFAULT_ROWS.map((r) => r.slice()); }
}

export function saveLayout(rows) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(rows)); } catch (_) { /* private mode */ }
}

export const isDefaultLayout = (rows) => JSON.stringify(rows) === JSON.stringify(DEFAULT_ROWS);
