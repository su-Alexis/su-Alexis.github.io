// Page backgrounds (owner request): the "background" command switches between the
// backgrounds in data/commands.js (BACKGROUNDS). Used by ui/terminal-ui.js on every page.
//
// One background is selected at a time. "default" is the circuit board (bg-circuit.js;
// owner decision, October 13, 2026) and hides the page grid, as hex_float does; "grid" draws nothing (the
// grid in layout.css); the others each run a scene on ui/canvas-bg.js (hex-float.js,
// bg-spheres.js for bubbles, bg-synthwave.js, bg-starfield.js) over the grid. The hidden 31337 matrix rain sits on top of all of
// them: while it is on, the selected background is paused (the rain covers the page and
// drawing both would waste frames), and it comes back when the rain is turned off.
// Picking a background while the rain is on turns the rain off.
// Persistence: the selection is kept in SESSION_KEYS.background (only when it is not
// the default) so it follows the visitor across Layer 1 pages; refresh and reboot clear
// it with the rest of the machine session (ui/terminal-ui.js). The stored value is read
// back as untrusted and must be a known id.

import { sessionStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { SESSION_KEYS } from '../core/constants.js';
import { BACKGROUND_IDS } from '../data/commands.js';
import { pickKnown } from '../utils/validate.js';
import { startHexFloat } from './hex-float.js';
import { startSynthwave } from './bg-synthwave.js';
import { startStarfield } from './bg-starfield.js';
import { startCircuit } from './bg-circuit.js';
import { startSpheres } from './bg-spheres.js';
import { toggleMatrix, matrixActive } from './matrix-rain.js';

const RENDERERS = Object.freeze({
  default: startCircuit,
  hex_float: startHexFloat,
  bubbles: startSpheres,
  synthwave: startSynthwave,
  starfield: startStarfield,
});

let selected = 'default';
let renderer = null;

function render({ reducedMotion = false, resume = false } = {}) {
  if (renderer) renderer.stop();
  renderer = null;
  // Every page, the lab included (owner request, October 13, 2026: the lab keeps the
  // background Layer 1 has).
  const start = Object.hasOwn(RENDERERS, selected) ? RENDERERS[selected] : null;
  if (start && !matrixActive()) renderer = start({ still: reducedMotion, resume });
  // Lifts .site above the canvas (layout.css), as .matrix-on does for the rain.
  document.documentElement.classList.toggle('bg-on', renderer !== null);
  // The default scene and hex_float (owner request, October 19, 2026) replace the grid;
  // the others draw over it.
  document.documentElement.classList.toggle('bg-no-grid', renderer !== null && (selected === 'default' || selected === 'hex_float'));
}

export function currentBackground() {
  return selected;
}

// Called once per page load, after resumeMatrix(): brings back the selected background.
export function resumeBackground({ reducedMotion = false } = {}) {
  selected = pickKnown(readJson(sessionStore(), SESSION_KEYS.background), BACKGROUND_IDS, 'default');
  render({ reducedMotion, resume: true });
}

// Switches to a known background id and returns the extra lines the shell prints.
export function setBackground(id, { reducedMotion = false } = {}) {
  selected = pickKnown(id, BACKGROUND_IDS, 'default');
  const store = sessionStore();
  if (selected === 'default') removeKey(store, SESSION_KEYS.background);
  else writeJson(store, SESSION_KEYS.background, selected);
  const lines = [];
  if (matrixActive()) {
    toggleMatrix({ reducedMotion });
    lines.push({ kind: 'out', text: 'matrix: unplugged.' });
  }
  render({ reducedMotion });
  if (reducedMotion && selected !== 'default') lines.push({ kind: 'out', text: 'reduced motion is on, so it holds still.' });
  return lines;
}

// The 31337 easter egg, routed through here so the selected background pauses under the
// rain and resumes after it. Returns the line the shell prints.
export function toggleMatrixBackground({ reducedMotion = false } = {}) {
  const line = toggleMatrix({ reducedMotion });
  render({ reducedMotion });
  return line;
}
