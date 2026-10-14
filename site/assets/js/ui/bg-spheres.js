// "bubbles" background (owner requests, October 13, 2026): translucent bubbles floating
// slowly up behind the page, chosen with "background bubbles". ui/backgrounds.js starts
// and stops it; ui/canvas-bg.js runs the loop.
//
// Decorative only, on a transparent canvas. Each sphere is drawn as a bubble (owner request,
// October 13, 2026): nearly clear inside, its tint gathering at a thin film edge, a white
// window highlight at the upper left and a faint glint opposite. Spheres sit at three depths: far ones are smaller, dimmer and
// slower, which gives a gentle parallax. They drift and bob, and wrap around the edges.
// No shadowBlur (it made earlier effects lag); counts are bounded by the screen's area.

import { startCanvas, rand } from './canvas-bg.js';

const AREA_PER_SPHERE = 52000; // px^2 of viewport per sphere
const MIN_SPHERES = 10;
const MAX_SPHERES = 30;
// The site's cyan accent, a violet and a little of the amber brand color.
const TINTS = [
  { rgb: '79, 209, 224', weight: 0.5 },
  { rgb: '150, 110, 255', weight: 0.32 },
  { rgb: '245, 164, 0', weight: 0.18 },
];

function pickTint() {
  let roll = Math.random();
  for (const tint of TINTS) {
    roll -= tint.weight;
    if (roll <= 0) return tint.rgb;
  }
  return TINTS[0].rgb;
}

function makeSphere(width, height) {
  const depth = Math.random() < 0.5 ? 0 : Math.random() < 0.6 ? 1 : 2; // 0 far, 2 near
  const scale = [0.45, 0.75, 1.1][depth];
  return {
    x: rand(0, width),
    y: rand(0, height),
    r: rand(18, 70) * scale,
    vx: rand(-6, 6) * (0.5 + depth * 0.4),
    vy: rand(-12, -3) * (0.5 + depth * 0.4), // a slow rise, like bubbles
    bob: rand(0, Math.PI * 2),
    bobSpeed: rand(0.2, 0.6),
    alpha: [0.28, 0.42, 0.55][depth],
    tint: pickTint(),
  };
}

export function startSpheres({ still = false, resume = false } = {}) {
  return startCanvas({
    className: 'bg-spheres',
    still,
    resume,
    scene: (context) => {
      let width = 0;
      let height = 0;
      let spheres = [];
      return {
        resize(w, h) {
          width = w;
          height = h;
          const count = Math.max(MIN_SPHERES, Math.min(MAX_SPHERES, Math.round((w * h) / AREA_PER_SPHERE)));
          spheres = spheres.slice(0, count);
          while (spheres.length < count) spheres.push(makeSphere(w, h));
          // Far spheres first, so nearer ones draw over them.
          spheres.sort((a, b) => a.r - b.r);
        },
        step(dt) {
          for (const s of spheres) {
            s.bob += s.bobSpeed * dt;
            s.x += (s.vx + Math.sin(s.bob) * 4) * dt;
            s.y += s.vy * dt;
            if (s.y < -s.r * 2) {
              s.y = height + s.r * 2;
              s.x = rand(0, width);
            }
            if (s.x < -s.r * 2) s.x = width + s.r * 2;
            else if (s.x > width + s.r * 2) s.x = -s.r * 2;
          }
        },
        draw(fade) {
          const ctx = context;
          ctx.clearRect(0, 0, width, height);
          for (const s of spheres) {
            const a = s.alpha * fade;
            // A bubble: almost clear in the middle, its colour gathering toward the edge.
            const body = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r);
            body.addColorStop(0, `rgba(${s.tint}, 0)`);
            body.addColorStop(0.7, `rgba(${s.tint}, ${(a * 0.08).toFixed(3)})`);
            body.addColorStop(0.92, `rgba(${s.tint}, ${(a * 0.32).toFixed(3)})`);
            body.addColorStop(1, `rgba(${s.tint}, 0)`);
            ctx.fillStyle = body;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
            // Its thin film edge.
            ctx.strokeStyle = `rgba(${s.tint}, ${(a * 0.55).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * 0.97, 0, Math.PI * 2);
            ctx.stroke();
            // The window highlight, upper left, and a faint glint opposite it.
            const hx = s.x - s.r * 0.4;
            const hy = s.y - s.r * 0.42;
            const shine = ctx.createRadialGradient(hx, hy, 0, hx, hy, s.r * 0.32);
            shine.addColorStop(0, `rgba(255, 255, 255, ${(a * 0.75).toFixed(3)})`);
            shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = shine;
            ctx.beginPath();
            ctx.arc(hx, hy, s.r * 0.32, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 255, 255, ${(a * 0.35).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * 0.8, 0.15 * Math.PI, 0.4 * Math.PI);
            ctx.stroke();
          }
        },
      };
    },
  });
}
