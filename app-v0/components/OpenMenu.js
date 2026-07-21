import { html } from '../vendor/htm-preact.js';
import { useState, useRef, useEffect } from '../vendor/hooks.module.js';

// Unified "Open ▾" control: a single entry point for loading a composition,
// whether from a local file or one of the bundled examples. Replaces the old
// separate file-Open label + Examples <select>. Single-level popover (no hover
// flyout) so it works with one tap on touch. Closes on select, outside-click,
// or Esc. `exampleValue` marks the currently-loaded example (was the select's
// controlled value) so the user sees which one is active.
export function OpenMenu({ examples, exampleValue, onOpen, onExample, onOpenLink }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [linkErr, setLinkErr] = useState(false);
  const rootRef = useRef(null);
  const fileRef = useRef(null);

  // Load a pasted share link (any host). Clears + closes on success; flags red on
  // a link that can't be decoded.
  const submitLink = async () => {
    if (!link.trim() || !onOpenLink) return;
    const ok = await onOpenLink(link);
    if (ok) { setLink(''); setLinkErr(false); setOpen(false); } else { setLinkErr(true); }
  };

  useEffect(() => {
    if (!open) return;
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
    ${open && html`<div class="openmenu-pop" role="menu">
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
