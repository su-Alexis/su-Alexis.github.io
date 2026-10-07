// Shared plumbing for the canvas backgrounds the "background" command offers
// (ui/backgrounds.js): hex_float, synthwave, starfield and circuit all run on this.
//
// One <canvas> fixed behind .site (layout.css, .bg-canvas), sized through its width and
// height properties, never style attributes (doctrine section 9). One
// requestAnimationFrame loop throttled to frameMs, with the step size taken from elapsed
// time (capped, so a long pause never makes things jump). It pauses while the tab is
// hidden and tears itself down on pagehide.
//
// A scene is (context) => ({ resize(width, height), step(dt, time), draw(fade) }).
// still: draw once per resize, never animate (reduced motion). resume: start at full
// strength instead of fading in (the visitor is arriving on a new page mid-effect).

import { el } from '../utils/dom.js';

const FADE_IN_MS = 1200;

export function startCanvas({ className, frameMs = 33, still = false, resume = false, scene }) {
  const canvas = el('canvas', { className: `bg-canvas ${className}`, attrs: { 'aria-hidden': 'true' } });
  const context = canvas.getContext('2d');
  if (!context) return null;
  document.body.prepend(canvas);
  const view = scene(context);

  let frame = 0;
  let last = 0;
  let fade = still || resume ? 1 : 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    view.resize(width, height);
    if (still) view.draw(1);
  }

  function loop(time) {
    frame = window.requestAnimationFrame(loop);
    if (time - last < frameMs) return;
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    if (fade < 1) fade = Math.min(1, fade + (dt * 1000) / FADE_IN_MS);
    view.step(dt, time);
    view.draw(fade);
  }

  const onVisibility = () => {
    window.cancelAnimationFrame(frame);
    last = 0;
    if (!document.hidden) frame = window.requestAnimationFrame(loop);
  };

  function stop() {
    window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', stop);
    canvas.remove();
  }

  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', stop);
  if (!still) {
    document.addEventListener('visibilitychange', onVisibility);
    frame = window.requestAnimationFrame(loop);
  }
  return { stop };
}

export const rand = (min, max) => min + Math.random() * (max - min);
