// IS THERE A NEWER BUILD, AND HOW DOES A READER GET IT?
//
// The service worker already retires a stale copy: its cache is named for the commit it was
// built from, so a release changes those bytes, the browser installs the new worker, and a
// reload lands on it. What was missing is any way to KNOW. A tab is reloaded often enough
// that it hardly matters; an installed app on a phone is not, and "am I on the new build?"
// has to be answered by reading a version string and remembering what was published.
//
// So: ask on demand, notice on our own, and say when the answer is yes.
//
// The worker calls skipWaiting(), so a new one activates as soon as it installs rather than
// waiting for every tab to close. That means the page can be served new assets while it is
// still running old code — harmless for modules already imported, which is nearly all of
// them here, and the reason this offers a reload rather than pretending the swap is
// complete.
import { VERSION } from '../version.js';

const NONE = { ready: false, checking: false, latest: null, offline: false };

// WHAT THE SERVER ACTUALLY HAS, read past every cache between here and it.
//
// The worker's own answer is not enough. GitHub Pages serves with a ten-minute max-age and
// the worker's update check goes through that shared cache, so for those minutes it fetches
// sw.js, is handed the OLD bytes, sees no change and reports — correctly, and uselessly —
// that there is nothing new. "Up to date" then means three different things: current, not
// served here yet, and could not ask. A reader watching a published fix fail to arrive, over
// and over, has no way to tell which.
async function serverVersion() {
  // `fresh` so the worker steps aside (see sw.js), a timestamp so no cache between here and
  // the origin can answer, and no-store so this one is not kept either.
  const res = await fetch(`./version.js?fresh=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('http ' + res.status);
  const m = (await res.text()).match(/VERSION\s*=\s*'([^']*)'/);
  if (!m) throw new Error('no version in it');
  return m[1];
}

export function watchForUpdates(onState, running = VERSION) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    onState({ ...NONE, supported: false });
    return { check: () => {}, apply: () => {}, status: () => ({ kind: 'current', text: '' }) };
  }
  let state = { ...NONE, supported: true };
  const set = (patch) => { state = { ...state, ...patch }; onState(state); };
  set({});

  let reg = null;
  const watchInstalling = (worker) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      // A worker reaching 'installed' while one is already in control means a NEWER build has
      // arrived beside the one being run. The very first install has no controller, and is
      // not an update — it is the app arriving for the first time.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) set({ ready: true, checking: false });
      else if (worker.state === 'activated') set({ checking: false });
    });
  };

  navigator.serviceWorker.register('./sw.js').then((r) => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) set({ ready: true });
    watchInstalling(r.installing);
    r.addEventListener('updatefound', () => { set({ checking: true }); watchInstalling(r.installing); });
  }).catch(() => set({ supported: false }));

  // Coming back to the app is exactly when a reader wants to know, and on a phone it may be
  // days since the browser last looked of its own accord.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }

  let checking = false;
  function check() {
    if (!reg || checking) return;
    checking = true;
    set({ checking: true, offline: false, latest: null });
    // Both, and neither waits on the other. The worker is what can actually deliver a new
    // build; the version read is what can tell a reader WHY it has not.
    Promise.all([
      Promise.resolve(reg.update()).catch(() => { /* offline, or nothing new */ }),
      serverVersion().then((v) => set({ latest: v, offline: false }))
        .catch(() => set({ offline: true })),
    ]).finally(() => { checking = false; set({ checking: false }); });
  }
  // What the caller should SAY, decided here rather than in the markup: the three cases are
  // about what was learned, and the footer's job is only to show it.
  function status() {
    if (state.checking) return { kind: 'checking', text: 'checking…' };
    if (state.ready) return { kind: 'ready', text: 'Update ready — reload' };
    if (state.offline) return { kind: 'offline', text: 'could not check — no connection' };
    if (state.latest && state.latest !== running)
      return { kind: 'waiting', text: `${state.latest} is out — this device is still being served ${running}` };
    return { kind: 'current', text: 'up to date' };
  }

  // The new worker is already active (skipWaiting), so entering it is a reload. `waiting` is
  // told to skip as well, for the case where a future worker drops skipWaiting and this is
  // the only thing that would move it along.
  function apply() {
    try { if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) { /* older worker */ }
    location.reload();
  }

  return { check, apply, status };
}
