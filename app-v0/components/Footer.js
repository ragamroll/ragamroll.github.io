import { html } from '../vendor/htm-preact.js';
import { BUILD_DATE } from '../version.js';

// Copyright line. The RagaM-Roll + version badge lives in the toolbar/header
// (Toolbar.js). BUILD_DATE is '' in the working tree; tools/build-app-v0.sh
// stamps it with the built commit date.
export function Footer() {
  return html`<footer class="footer">
    <span class="copyright">© 2010 ragamroll${BUILD_DATE ? ` · built ${BUILD_DATE}` : ''}</span>
  </footer>`;
}
