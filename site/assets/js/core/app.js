// Small bootstrap. Doctrine section 12: the portfolio is complete without JavaScript, so
// everything here is optional enhancement and every failure leaves the page as authored.

import { ROOT_CLASSES } from './constants.js';
import { byId } from '../utils/dom.js';
import { mountTerminal } from '../ui/terminal-ui.js';
import { mountStatusScramble } from '../ui/status-scramble.js';
import { mountCertVerify } from '../ui/cert-verify.js';
import { mountShotViewer } from '../ui/shot-viewer.js';

function start() {
  const root = document.documentElement;
  root.classList.add(ROOT_CLASSES.scriptEnabled);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add(ROOT_CLASSES.reducedMotion);
  }
}

try {
  start();
} catch {
  // Enhancement failed; remove the marker so CSS shows the complete static page.
  document.documentElement.classList.remove(ROOT_CLASSES.scriptEnabled);
}

// The console is an independent enhancement: if it fails, the page is unaffected.
try {
  const terminal = byId('terminal');
  if (terminal) mountTerminal(terminal);
} catch {
  // Leave the static console log in place.
}

// Decrypting [ ACTIVE ] tags: decorative and independent of the console.
try {
  mountStatusScramble();
} catch {
  // Tags keep their authored text.
}

// Certification badges verify on load (home page only; no-op elsewhere).
try {
  mountCertVerify();
} catch {
  // Badges keep their authored text.
}

// Screenshot viewer keyboard support (project pages with galleries; no-op elsewhere).
try {
  mountShotViewer();
} catch {
  // The viewer still works with plain links.
}
