import { html } from '../vendor/htm-preact.js';
import { useEffect, useState, useRef } from '../vendor/hooks.module.js';
import { VERSION, BUILD_DATE } from '../version.js';
import { watchForUpdates } from '../core/app-update.js';

// Footer: copyright on the left, build timestamp + version on the right —
// shown in every viewport (the toolbar badge no longer carries the version).
// BUILD_DATE is '' in the working tree; tools/build-app-v0.sh stamps it and
// VERSION with the built commit's date + short hash.
//
// THE VERSION IS ALSO THE UPDATE BUTTON. An installed app on a phone can go days without a
// reload, so a published fix sits there unseen and the only way to know which build you are
// on is to read this string and remember what was released. Tapping it asks; when a newer
// build has arrived it says so and offers the reload that enters it.
// AND A LONG PRESS OPENS THE TIMING REPORT. There is no console on a phone, and the fault
// it exists for cannot be reproduced anywhere else, so the numbers have to be reachable from
// the device itself. On the version because it is already the one button down here, and a
// long press cannot be arrived at by accident — which is right for something nobody needs
// until they are asked for it.
export function Footer({ onPerf }) {
  const [upd, setUpd] = useState({ supported: false, ready: false, checking: false });
  const [ctl, setCtl] = useState(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => { setCtl(watchForUpdates(setUpd)); }, []);

  // The press must not ALSO check for updates when it is let go: one gesture, one meaning.
  const hold = useRef({ t: 0, fired: false });
  const HOLD_MS = 600;
  const down = () => {
    if (!onPerf) return;
    hold.current.fired = false;
    clearTimeout(hold.current.t);
    hold.current.t = setTimeout(() => { hold.current.fired = true; onPerf(); }, HOLD_MS);
  };
  const up = () => clearTimeout(hold.current.t);
  const tap = () => {
    // That press was the hold. Belt and braces, and measured to be: the report opens while
    // the finger is still down, so at pointer-up the button is under the dialog and the
    // browser delivers no click to it — removing this line changes nothing observable here.
    // It stays because that depends on the panel covering the button, which is a fact about
    // the layout rather than about the gesture, and one press must never mean two things.
    if (hold.current.fired) { hold.current.fired = false; return; }
    setAsked(true); ctl && ctl.check();
  };
  const holdProps = { onPointerDown: down, onPointerUp: up, onPointerLeave: up, onPointerCancel: up,
                      onContextMenu: (e) => { if (onPerf) e.preventDefault(); } };

  // What to SAY about the last check comes from the update module, which is the only place
  // that knows the difference between "current", "not served here yet" and "could not ask".
  const said = ctl && asked && !upd.checking && !upd.ready ? ctl.status() : null;
  const label = upd.checking ? 'checking…' : VERSION;
  return html`<footer class="footer">
    <span class="copyright">© 2010 ragamroll</span>
    <span class="build">
      ${BUILD_DATE ? `built ${BUILD_DATE} · ` : ''}
      ${upd.supported
        ? html`<button class="ver ver-btn" title="Check for a newer version — hold to see timing on this device"
                       ...${holdProps} onClick=${tap}>${label}</button>`
        : html`<span class="ver" ...${holdProps}>${VERSION}</span>`}
      ${upd.ready
        ? html`<button class="upd" onClick=${() => ctl && ctl.apply()}>Update ready — reload</button>`
        : (said ? html`<span class=${'upd-none upd-' + said.kind}>${said.text}</span>` : '')}
    </span>
  </footer>`;
}
