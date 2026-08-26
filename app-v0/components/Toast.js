import { html } from '../vendor/htm-preact.js';
import { useEffect } from '../vendor/hooks.module.js';

/**
 * WHAT JUST HAPPENED, and the one thing you might want done about it.
 *
 * Ported from the gamaka page, which is being retired. It exists for a single case and was
 * built around it: dragging a note that carries an ornament has to decide whether the
 * ornament keeps its own pitches or travels with the note, and the app decides that from a
 * setting made BEFORE the drag. A setting made in advance is the wrong shape for a question
 * whose answer you can only judge after seeing it — so the result says which rule it took,
 * and offers the other one.
 *
 * Not a notification system. One line, one action, and it goes away: on its own after a few
 * seconds, when the action is taken, or when the next edit replaces it. Nothing queues, so a
 * second edit cannot leave a stale offer to flip an edit that is no longer the last one.
 *
 * role="status" rather than "alert": this reports, it does not interrupt, and a screen reader
 * should hear it when it is idle rather than being cut off mid-sentence.
 */
const LINGER_MS = 7000;

export function Toast({ toast, onAction, onClose }) {
  const key = toast && toast.id;
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, LINGER_MS);
    return () => clearTimeout(t);
    // Keyed on the toast's id so a REPLACEMENT restarts the clock. Keyed on the object it
    // would restart on every render of the app, which is often enough that a toast could
    // outlive the edit it describes.
  }, [key, onClose, toast]);
  if (!toast) return null;

  return html`<div class="toast" role="status">
    <span class="toast-msg">${toast.text}</span>
    ${toast.action && html`<button class="toast-act" onClick=${onAction}>${toast.action}</button>`}
    <button class="toast-x" aria-label="Dismiss" title="Dismiss" onClick=${onClose}>✕</button>
  </div>`;
}
