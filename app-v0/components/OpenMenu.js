import { html } from '../vendor/htm-preact.js';
import { useState, useRef, useEffect } from '../vendor/hooks.module.js';

// Unified "Open ▾" control: a single entry point for loading a composition,
// whether from a local file or one of the bundled examples. Replaces the old
// separate file-Open label + Examples <select>. Single-level popover (no hover
// flyout) so it works with one tap on touch. Closes on select, outside-click,
// or Esc. `exampleValue` marks the currently-loaded example (was the select's
// controlled value) so the user sees which one is active.
export function OpenMenu({ examples, exampleValue, onNew, onOpen, onExample, onOpenLink }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkErr, setLinkErr] = useState(false);
  const rootRef = useRef(null);
  const fileRef = useRef(null);
  // WHICH WAY IT DROPS, and how tall it may be. This used to open upward always, which was
  // right while Open sat at the very bottom of the screen. It is in the pinned row under the
  // roll now, and opening upward put a list of examples over the roll and off the top —
  // measured at 156px above the window on a short one. So it takes whichever side has more
  // room and never grows past it.
  const [drop, setDrop] = useState({ up: true, max: 0, shift: 0 });

  // Load a pasted share link (any host). Clears + closes on success; flags red on
  // a link that can't be decoded.
  const submitLink = async () => {
    if (!link.trim() || !onOpenLink) return;
    const ok = await onOpenLink(link);
    if (ok) { setLink(''); setLinkErr(false); setOpen(false); } else { setLinkErr(true); }
  };

  useEffect(() => {
    if (!open) return;
    const el = rootRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const above = r.top - 8, below = (window.innerHeight || 600) - r.bottom - 8;
      setDrop({ up: above > below, max: Math.max(120, Math.round(Math.max(above, below))), shift: 0 });
      // AND SIDEWAYS, measured after it has been drawn. The panel is anchored to the button's
      // left edge, and the button is no longer near the left of the screen — it sits after the
      // transport controls in the pinned row, so on a narrow window the list ran off the right.
      // Its width is not knowable until it exists, hence the second pass.
      requestAnimationFrame(() => {
        const pop = el.querySelector('.openmenu-pop');
        if (!pop) return;
        const b = pop.getBoundingClientRect(), W = window.innerWidth || 400;
        const over = Math.round(b.right - (W - 6));
        const under = Math.round(6 - b.left);
        const dx = over > 0 ? -over : (under > 0 ? under : 0);
        if (dx) setDrop((d) => ({ ...d, shift: dx }));
      });
    }
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return html`<span class="openmenu" ref=${rootRef}>
    <button class="openmenu-btn" aria-haspopup="menu" aria-expanded=${open}
            onClick=${() => setOpen(o => !o)}>Open ▾</button>
    <input type="file" accept=".srgm,.txt" ref=${fileRef} style="display:none"
           onChange=${e => { const f = e.target.files[0]; e.target.value = ''; if (f) { setOpen(false); onOpen(f); } }} />
    ${open && html`<div class=${'openmenu-pop' + (drop.up ? '' : ' down')} role="menu"
                        style=${`max-height:${drop.max}px; margin-left:${drop.shift}px`}>
      <button role="menuitem" class="openmenu-item" onClick=${() => { setOpen(false); onNew && onNew(); }}>Blank / New</button>
      <button role="menuitem" class="openmenu-item" onClick=${() => fileRef.current && fileRef.current.click()}>From file…</button>
      <div class="openmenu-sep">Paste a share link</div>
      <div class="openmenu-link">
        <input type="text" class=${'openmenu-linkin' + (linkErr ? ' err' : '')}
               placeholder="…/#pako:… (any host)" value=${link}
               onInput=${e => { setLink(e.target.value); setLinkErr(false); }}
               onKeyDown=${e => { if (e.key === 'Enter') submitLink(); }} />
        <button class="openmenu-linkgo" title="Open the pasted link" onClick=${submitLink}>Open</button>
      </div>
      ${linkErr && html`<div class="openmenu-linkerr">Not a valid share link.</div>`}
      <div class="openmenu-sep">Examples</div>
      ${examples.map(x => html`<button role="menuitem"
          class=${'openmenu-item' + (x === exampleValue ? ' current' : '')}
          onClick=${() => { setOpen(false); onExample(x); }}>${x}</button>`)}
    </div>`}
  </span>`;
}
