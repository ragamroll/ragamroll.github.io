// WHICH PALETTE THE PAGE IS IN — the reader's choice, or the system's when they have not
// made one. Pure but for the two lines that touch the document, which is the whole job.
//
// Three states, not two. "System" is not a third colour, it is the ABSENCE of a choice, and
// it has to stay reachable: a reader who tries light and prefers their phone's own setting
// after all needs a way back that is not "guess which one the phone is on".
//
// The mechanism is one attribute on <html>. Set, it wins — the stylesheet's media rule is
// written :root:not([data-theme]) so it stands down. Unset, the media rule answers. There is
// no JavaScript in the deciding, which is what lets index.html apply a stored choice before
// the first paint from a four-line inline script.

export const THEME_KEY = 'ragamroll.theme';
export const THEMES = ['system', 'light', 'dark'];

export function readTheme(store = localStorage) {
  try {
    const v = store.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'system';
  } catch { return 'system'; }         // private mode refuses the read, and that is not an error
}

// The one the page is ACTUALLY in, which is the question the canvas cares about: it cannot
// inherit a CSS variable, so something has to tell it when the answer changed.
export function resolveTheme(pref, matcher = (q) => window.matchMedia(q)) {
  if (pref === 'light' || pref === 'dark') return pref;
  try { return matcher('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
  catch { return 'dark'; }             // no matchMedia: the stylesheet's own default
}

export function applyTheme(pref, doc = document) {
  const root = doc.documentElement;
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else delete root.dataset.theme;      // back to the media query, which is what 'system' means
  // The browser's own chrome — the address bar on a phone — takes its colour from here, and a
  // dark bar over a light page is the one part of the switch a reader cannot fix themselves.
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
  return pref;
}

// A value this build does not know behaves as 'system' everywhere else — readTheme returns
// it, the button wears its face — so the press moves on from system too. Landing back on
// 'system' would have made the first press of a stale stored value do nothing visible.
export function nextTheme(pref) {
  const i = THEMES.indexOf(pref);
  return THEMES[((i < 0 ? 0 : i) + 1) % THEMES.length];
}

// What the button says it is. The glyph is the STATE, not the action — a moon that means
// "press for dark" and a moon that means "you are in dark" cannot both be right, and the one
// that describes the page is the one a reader can check against the page.
export const THEME_FACE = { system: '◐', light: '☀', dark: '☾' };
export const THEME_TITLE = {
  system: 'Theme: following the system — click for light',
  light: 'Theme: light — click for dark',
  dark: 'Theme: dark — click to follow the system',
};
