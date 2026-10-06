// "31337" easter egg (owner request): the page background turns into falling green digits,
// movie-style. Typing 31337 again in any shell turns it off. Used by ui/terminal-ui.js.
//
// Decorative only. The rain is drawn on one <canvas> fixed behind .site (layout.css,
// .matrix-rain), so modules and shells stay readable on top. Canvas pixel size is set
// through the width/height properties, never style attributes (doctrine section 9).
// Every column starts at the top, after a short random delay, so the rain visibly begins
// at the top of the screen and falls. One requestAnimationFrame loop, throttled to
// FRAME_MS; it pauses while the tab is hidden and is torn down on pagehide.
// Persistence: a session flag (SESSION_KEYS.matrix, value true) keeps it on across
// Layer 1 pages; each page resumes it mid-fall so it reads as one continuous rain.
// Toggling off removes the flag; refresh and reboot clear it in ui/terminal-ui.js.
// Reduced motion never starts it.

import { el } from '../utils/dom.js';
import { sessionStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { SESSION_KEYS } from '../core/constants.js';

const CELL = 18; // px per character, rows and columns
const FRAME_MS = 50; // ~20 fps keeps it calm and cheap
const START_SPREAD = 40; // frames: random start delay per column
const MAX_COLUMNS = 400; // bounded work on very wide screens
const DIGITS = '0123456789';

let active = null;

function start({ resume = false } = {}) {
  const canvas = el('canvas', { className: 'matrix-rain', attrs: { 'aria-hidden': 'true' } });
  const context = canvas.getContext('2d');
  if (!context) return null;
  document.body.prepend(canvas);
  document.documentElement.classList.add('matrix-on');

  let columns = [];
  let frame = 0;
  let last = 0;
  let width = 0;
  let height = 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.font = `${CELL - 2}px ui-monospace, Consolas, monospace`;
    context.textBaseline = 'top';
    const count = Math.min(MAX_COLUMNS, Math.ceil(width / CELL));
    // Keep existing drops on resize; new columns start from the top.
    // Resuming on a new page: drops are already scattered down the screen, mid-fall.
    const rows = Math.ceil(height / CELL);
    columns = Array.from({ length: count }, (_, i) => columns[i] || (resume
      ? { row: Math.floor(Math.random() * rows), wait: 0 }
      : { row: 0, wait: Math.floor(Math.random() * START_SPREAD) }));
  }

  function draw() {
    // Translucent wash leaves the classic fading trail behind each drop.
    context.fillStyle = 'rgba(10, 12, 14, 0.12)';
    context.fillRect(0, 0, width, height);
    for (let i = 0; i < columns.length; i += 1) {
      const drop = columns[i];
      if (drop.wait > 0) { drop.wait -= 1; continue; }
      const y = drop.row * CELL;
      context.fillStyle = '#d8ffe2'; // bright head
      context.fillText(DIGITS[Math.floor(Math.random() * DIGITS.length)], i * CELL, y);
      if (drop.row > 0) {
        context.fillStyle = '#5fcf80'; // trail, the site's --color-ok
        context.fillText(DIGITS[Math.floor(Math.random() * DIGITS.length)], i * CELL, y - CELL);
      }
      drop.row += 1;
      // Past the bottom: restart from the top after a random pause, so columns desync.
      if (y > height && Math.random() > 0.975) { drop.row = 0; drop.wait = Math.floor(Math.random() * 20); }
    }
  }

  function loop(time) {
    frame = window.requestAnimationFrame(loop);
    if (time - last < FRAME_MS) return;
    last = time;
    draw();
  }

  const onVisibility = () => {
    window.cancelAnimationFrame(frame);
    if (!document.hidden) frame = window.requestAnimationFrame(loop);
  };

  function stop() {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', stop);
    canvas.remove();
    document.documentElement.classList.remove('matrix-on');
    active = null;
  }

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);
  frame = window.requestAnimationFrame(loop);
  return { stop };
}

// Whether the rain is on right now (ui/backgrounds.js pauses other backgrounds under it).
export function matrixActive() {
  return active !== null;
}

// Turns the rain on or off and returns the line the shell prints.
export function toggleMatrix({ reducedMotion = false } = {}) {
  const store = sessionStore();
  if (active) {
    active.stop();
    removeKey(store, SESSION_KEYS.matrix);
    return { kind: 'ok', text: 'matrix: signal lost. back to reality.' };
  }
  if (reducedMotion) return { kind: 'out', text: 'matrix: reduced motion is on, so the rain stays off.' };
  active = start();
  if (active) writeJson(store, SESSION_KEYS.matrix, true);
  return active
    ? { kind: 'ok', text: "wake up, visitor... the matrix has you. (type '31337' again to unplug)" }
    : { kind: 'err', text: 'matrix: this browser cannot draw the rain.' };
}

// Called once per page load: restarts the rain if the session flag says it was on.
export function resumeMatrix({ reducedMotion = false } = {}) {
  if (active || reducedMotion) return;
  if (readJson(sessionStore(), SESSION_KEYS.matrix) !== true) return;
  active = start({ resume: true });
}
