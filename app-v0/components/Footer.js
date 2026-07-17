import { html } from '../vendor/htm-preact.js';
import { VERSION, BUILD_DATE } from '../version.js';

// Footer: copyright on the left, build timestamp + version on the right —
// shown in every viewport (the toolbar badge no longer carries the version).
// BUILD_DATE is '' in the working tree; tools/build-app-v0.sh stamps it and
// VERSION with the built commit's date + short hash.
export function Footer() {
  return html`<footer class="footer">
    <span class="copyright">© 2010 ragamroll</span>
    <span class="build">${BUILD_DATE ? `built ${BUILD_DATE} · ` : ''}<span class="ver">${VERSION}</span></span>
  </footer>`;
}
