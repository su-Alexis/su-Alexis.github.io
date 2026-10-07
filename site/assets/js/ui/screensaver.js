// Idle screensaver (owner request, and an easter egg for "hunt"): after IDLE_MS with no
// keyboard, mouse, touch or scroll input, the screen switches off like a CRT (black
// shutters close to a bright line, the line shrinks to a dot) and the waffle logo
// bounces around a black screen, changing color at every wall, DVD-player style. Any
// input wakes it: the line flashes back and the picture opens up again. Started once per
// page by ui/terminal-ui.js, which prints the egg line through onWake().
//
// Decorative only: one overlay of fixed elements (terminal.css, .screensaver) and one
// canvas, sized through its width/height properties (doctrine section 9). The logo is
// drawn from the top bar's own <img>, so no URL is built. The input that wakes it is
// swallowed, so a key pressed to wake the screen does not also type into a shell.
// It never starts during the boot, the fork bomb, the rm -rf joke, or in a hidden tab.
// Reduced motion: no shutters and no bouncing; the logo sits still in the middle.

import { el } from '../utils/dom.js';
import { sessionStore, readJson, writeJson } from '../core/storage.js';
import { SESSION_KEYS } from '../core/constants.js';

const IDLE_MS = 120000;
const CLOSE_MS = 750; // shutters close, line collapses (terminal.css, ss-close)
const OPEN_MS = 700; // line returns, shutters open (terminal.css, ss-open)
const SPEED = 120; // px per second, each axis
const LOGO = 96;
const COLORS = ['#f5a400', '#4fd1e0', '#ff3fa4', '#5fcf80', '#b18cff', '#ff7a45'];
const ACTIVITY = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'scroll'];
const BUSY = ['boot-run', 'fork-bomb', 'power-off'];

let started = false;
let killed = false;

// For btop/ps/kill (ui/terminal-ui.js): the screensaver shows as a process until killed.
// A kill keeps it off on every page until a refresh or reboot (SESSION_KEYS.noScreensaver).
export function screensaverRunning() {
  return started && !killed;
}

export function killScreensaver() {
  killed = true;
  writeJson(sessionStore(), SESSION_KEYS.noScreensaver, true);
}

export function startScreensaver({ reducedMotion = false, onWake = () => {} } = {}) {
  if (started) return;
  started = true;
  if (readJson(sessionStore(), SESSION_KEYS.noScreensaver) === true) killed = true;
  const root = document.documentElement;
  let last = performance.now();
  let timer = 0;
  let overlay = null;
  let frame = 0;
  let phase = 'idle'; // idle | closing | asleep | waking

  function schedule() {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, Math.max(1000, last + IDLE_MS - performance.now()));
  }

  function busy() {
    return document.hidden || BUSY.some((name) => root.classList.contains(name))
      || Boolean(document.querySelector('.bsod, .rm-gone, .rm-back'));
  }

  function check() {
    if (phase !== 'idle' || killed) return;
    if (performance.now() - last < IDLE_MS) return schedule();
    if (busy()) {
      last = performance.now();
      return schedule();
    }
    sleep();
  }

  function sleep() {
    const canvas = el('canvas', { className: 'ss-canvas' });
    overlay = el('div', { className: 'screensaver', attrs: { 'aria-hidden': 'true' } }, [
      canvas,
      el('div', { className: 'ss-shutter ss-top' }),
      el('div', { className: 'ss-shutter ss-bottom' }),
      el('div', { className: 'ss-line' }),
    ]);
    document.body.appendChild(overlay);
    if (reducedMotion) {
      phase = 'asleep';
      overlay.classList.add('is-asleep');
      bounce(canvas);
      return;
    }
    phase = 'closing';
    overlay.classList.add('is-closing');
    window.setTimeout(() => {
      if (phase !== 'closing') return;
      phase = 'asleep';
      overlay.classList.replace('is-closing', 'is-asleep');
      bounce(canvas);
    }, CLOSE_MS);
  }

  // The DVD logo. Still (reduced motion): drawn once, centered.
  function bounce(canvas) {
    const context = canvas.getContext('2d');
    if (!context) return;
    const logo = document.querySelector('.topbar .brand img');
    const tinted = el('canvas');
    const tint = tinted.getContext('2d');
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const boxW = LOGO + 40;
    const boxH = LOGO + 34;
    let x = reducedMotion ? (width - boxW) / 2 : Math.random() * Math.max(1, width - boxW);
    let y = reducedMotion ? (height - boxH) / 2 : Math.random() * Math.max(1, height - boxH);
    let vx = SPEED;
    let vy = SPEED * 0.8;
    let color = 0;
    let before = 0;

    function paintLogo() {
      tinted.width = LOGO;
      tinted.height = LOGO;
      tint.clearRect(0, 0, LOGO, LOGO);
      if (logo && logo.complete && logo.naturalWidth) {
        tint.globalCompositeOperation = 'source-over';
        tint.drawImage(logo, 0, 0, LOGO, LOGO);
        tint.globalCompositeOperation = 'source-atop';
        tint.globalAlpha = 0.7;
        tint.fillStyle = COLORS[color];
        tint.fillRect(0, 0, LOGO, LOGO);
        tint.globalAlpha = 1;
      }
    }

    function draw() {
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.drawImage(tinted, x + (boxW - LOGO) / 2, y);
      context.fillStyle = COLORS[color];
      context.font = 'bold 18px ui-monospace, Consolas, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.fillText('wafflesOS', x + boxW / 2, y + LOGO + 10);
    }

    function step(time) {
      frame = window.requestAnimationFrame(step);
      const dt = before ? Math.min(0.05, (time - before) / 1000) : 0;
      before = time;
      x += vx * dt;
      y += vy * dt;
      let hit = false;
      if (x <= 0 || x >= width - boxW) { vx = -vx; x = Math.max(0, Math.min(x, width - boxW)); hit = true; }
      if (y <= 0 || y >= height - boxH) { vy = -vy; y = Math.max(0, Math.min(y, height - boxH)); hit = true; }
      if (hit) {
        color = (color + 1) % COLORS.length;
        paintLogo();
      }
      draw();
    }

    paintLogo();
    draw();
    if (!reducedMotion) frame = window.requestAnimationFrame(step);
  }

  function wake() {
    window.cancelAnimationFrame(frame);
    const node = overlay;
    phase = 'waking';
    const done = () => {
      if (node) node.remove();
      overlay = null;
      phase = 'idle';
      last = performance.now();
      schedule();
      onWake();
    };
    if (reducedMotion || !node) return done();
    node.classList.remove('is-closing', 'is-asleep');
    node.classList.add('is-waking');
    window.setTimeout(done, OPEN_MS);
  }

  const onActivity = (event) => {
    if (phase === 'idle') {
      last = performance.now();
      return;
    }
    // Swallow the input that wakes the screen (or arrives while it wakes).
    if (event.type === 'keydown' || event.type === 'pointerdown') {
      event.preventDefault();
      event.stopPropagation();
    }
    if (phase === 'asleep' || phase === 'closing') wake();
  };
  for (const type of ACTIVITY) {
    // Only keydown and pointerdown can be cancelled; the rest stay passive so scrolling
    // and touch stay smooth.
    window.addEventListener(type, onActivity, { capture: true, passive: type !== 'keydown' && type !== 'pointerdown' });
  }
  document.addEventListener('visibilitychange', () => {
    last = performance.now();
    if (phase === 'idle') schedule();
  });
  window.addEventListener('pagehide', () => window.clearTimeout(timer));
  schedule();
}
