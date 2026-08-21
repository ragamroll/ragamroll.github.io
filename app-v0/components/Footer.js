import { html } from '../vendor/htm-preact.js';
import { useEffect, useState } from '../vendor/hooks.module.js';
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
export function Footer() {
  const [upd, setUpd] = useState({ supported: false, ready: false, checking: false });
  const [ctl, setCtl] = useState(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => { setCtl(watchForUpdates(setUpd)); }, []);

  const label = upd.checking ? 'checking…' : VERSION;
  return html`<footer class="footer">
    <span class="copyright">© 2010 ragamroll</span>
    <span class="build">
      ${BUILD_DATE ? `built ${BUILD_DATE} · ` : ''}
      ${upd.supported
        ? html`<button class="ver ver-btn" title="Check for a newer version"
                       onClick=${() => { setAsked(true); ctl && ctl.check(); }}>${label}</button>`
        : html`<span class="ver">${VERSION}</span>`}
      ${upd.ready
        ? html`<button class="upd" onClick=${() => ctl && ctl.apply()}>Update ready — reload</button>`
        : (asked && !upd.checking ? html`<span class="upd-none">up to date</span>` : '')}
    </span>
  </footer>`;
}
