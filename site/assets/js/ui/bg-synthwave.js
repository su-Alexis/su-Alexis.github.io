// "synthwave" background (owner request): an 80s retro grid racing toward a striped
// neon sun on the horizon, with a few twinkling stars. Chosen with "background
// synthwave"; ui/backgrounds.js starts and stops it, ui/canvas-bg.js runs the loop.
//
// Decorative only. Unlike the transparent backgrounds it paints a dim sky and floor, so
// the page reads as sitting in front of a scene; everything is kept at low strength
// (INTENSITY) so modules and text stay readable on top.

import { startCanvas, rand } from './canvas-bg.js';

const INTENSITY = 0.75;
const HORIZON = 0.62; // fraction of the screen height
const GRID_SPEED = 0.55; // grid rows per second rushing toward the viewer
const ROWS = 26;
const COLUMNS = 14; // each side of the center line

export function startSynthwave({ still = false, resume = false } = {}) {
  return startCanvas({
    className: 'bg-synthwave',
    still,
    resume,
    scene: (context) => {
      let width = 0;
      let height = 0;
      let horizon = 0;
      let offset = 0;
      let clock = 0;
      let stars = [];
      return {
        resize(w, h) {
          width = w;
          height = h;
          horizon = Math.round(h * HORIZON);
          const count = Math.min(140, Math.round((w * horizon) / 9000));
          stars = Array.from({ length: count }, () => ({ x: rand(0, w), y: rand(0, horizon * 0.8), r: rand(0.4, 1.3), phase: rand(0, Math.PI * 2) }));
        },
        step(dt) {
          offset = (offset + dt * GRID_SPEED) % 1;
          clock += dt;
        },
        draw(fade) {
          const ctx = context;
          ctx.clearRect(0, 0, width, height);
          ctx.globalAlpha = fade * INTENSITY;

          // Sky: dark at the top, warming to magenta at the horizon.
          const sky = ctx.createLinearGradient(0, 0, 0, horizon);
          sky.addColorStop(0, 'rgba(12, 4, 28, 0.55)');
          sky.addColorStop(0.65, 'rgba(48, 10, 78, 0.6)');
          sky.addColorStop(1, 'rgba(160, 30, 120, 0.6)');
          ctx.fillStyle = sky;
          ctx.fillRect(0, 0, width, horizon);

          for (const star of stars) {
            const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(clock * 1.3 + star.phase));
            ctx.fillStyle = `rgba(255, 240, 255, ${(0.7 * twinkle).toFixed(3)})`;
            ctx.fillRect(star.x, star.y, star.r * 2, star.r * 2);
          }

          // Sun: a warm gradient disc, cut by bands that thicken toward its base.
          const radius = Math.min(width, height) * 0.17;
          const cx = width / 2;
          const cy = horizon - radius * 0.35;
          const halo = ctx.createRadialGradient(cx, cy, radius * 0.6, cx, cy, radius * 2.2);
          halo.addColorStop(0, 'rgba(255, 70, 160, 0.35)');
          halo.addColorStop(1, 'rgba(255, 70, 160, 0)');
          ctx.fillStyle = halo;
          ctx.fillRect(cx - radius * 2.2, cy - radius * 2.2, radius * 4.4, radius * 2.2 + (horizon - cy));
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.clip();
          const sun = ctx.createLinearGradient(0, cy - radius, 0, cy + radius);
          sun.addColorStop(0, '#ffe08a');
          sun.addColorStop(0.5, '#ff8a5c');
          sun.addColorStop(1, '#ff2f9a');
          ctx.fillStyle = sun;
          let y = cy - radius;
          while (y < Math.min(cy + radius, horizon)) {
            const t = (y - (cy - radius)) / (radius * 2);
            const gap = t < 0.42 ? 0 : 1.5 + (t - 0.42) * 16;
            const band = t < 0.42 ? radius * 0.84 : Math.max(2, 9 - (t - 0.42) * 10);
            ctx.fillRect(cx - radius, y, radius * 2, band);
            y += band + gap;
          }
          ctx.restore();

          // Floor.
          const floor = ctx.createLinearGradient(0, horizon, 0, height);
          floor.addColorStop(0, 'rgba(30, 4, 50, 0.85)');
          floor.addColorStop(1, 'rgba(6, 2, 16, 0.9)');
          ctx.fillStyle = floor;
          ctx.fillRect(0, horizon, width, height - horizon);

          // Grid: lines converging on the vanishing point, glow first then the wire.
          const depth = height - horizon;
          ctx.beginPath();
          const spread = width / 6;
          for (let i = -COLUMNS; i <= COLUMNS; i += 1) {
            ctx.moveTo(cx, horizon);
            ctx.lineTo(cx + i * spread, height + depth * 0.2);
          }
          for (let j = 0; j < ROWS; j += 1) {
            const d = j + 1 - offset;
            const ry = horizon + (depth * 1.1) / d;
            if (ry > height) continue;
            ctx.moveTo(0, ry);
            ctx.lineTo(width, ry);
          }
          ctx.strokeStyle = 'rgba(255, 63, 164, 0.18)';
          ctx.lineWidth = 4;
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255, 90, 190, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          // Haze at the horizon hides where the rows bunch up.
          const haze = ctx.createLinearGradient(0, horizon, 0, horizon + depth * 0.22);
          haze.addColorStop(0, 'rgba(40, 6, 60, 0.95)');
          haze.addColorStop(1, 'rgba(40, 6, 60, 0)');
          ctx.fillStyle = haze;
          ctx.fillRect(0, horizon, width, depth * 0.22);
          ctx.fillStyle = 'rgba(255, 120, 200, 0.9)';
          ctx.fillRect(0, horizon - 1, width, 2);

          ctx.globalAlpha = 1;
        },
      };
    },
  });
}
