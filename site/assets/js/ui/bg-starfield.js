// "starfield" background (owner request): flying through space, stars streaming out
// from the center of the screen. Chosen with "background starfield"; ui/backgrounds.js
// starts and stops it, ui/canvas-bg.js runs the loop.
//
// Decorative only, on a transparent canvas. Each star has a position in a unit cube and
// is projected with a simple perspective divide; a short streak to where it was a moment
// ago gives the sense of speed. The pace is gentle on purpose: a background, not a ride.

import { startCanvas, rand } from './canvas-bg.js';

const SPEED = 0.11; // depth units per second
const AREA_PER_STAR = 3800;
const MIN_STARS = 120;
const MAX_STARS = 520;
const TINTS = ['220, 235, 255', '220, 235, 255', '220, 235, 255', '79, 209, 224', '255, 120, 200'];

function makeStar(fresh) {
  return {
    x: rand(-1, 1),
    y: rand(-1, 1),
    // New stars start far away; the first batch is spread through the whole depth.
    z: fresh ? rand(0.85, 1) : rand(0.05, 1),
    tint: TINTS[Math.floor(Math.random() * TINTS.length)],
  };
}

export function startStarfield({ still = false, resume = false } = {}) {
  return startCanvas({
    className: 'bg-starfield',
    still,
    resume,
    scene: (context) => {
      let width = 0;
      let height = 0;
      let stars = [];
      const project = (star, z) => [width / 2 + (star.x / z) * (width / 2), height / 2 + (star.y / z) * (height / 2)];
      return {
        resize(w, h) {
          width = w;
          height = h;
          const count = Math.max(MIN_STARS, Math.min(MAX_STARS, Math.round((w * h) / AREA_PER_STAR)));
          stars = stars.slice(0, count);
          while (stars.length < count) stars.push(makeStar(false));
        },
        step(dt) {
          for (let i = 0; i < stars.length; i += 1) {
            const star = stars[i];
            star.z -= SPEED * dt;
            const [x, y] = project(star, Math.max(star.z, 0.01));
            if (star.z <= 0.02 || x < -20 || x > width + 20 || y < -20 || y > height + 20) stars[i] = makeStar(true);
          }
        },
        draw(fade) {
          const ctx = context;
          ctx.clearRect(0, 0, width, height);
          ctx.lineCap = 'round';
          for (const star of stars) {
            const near = 1 - star.z;
            const alpha = Math.min(1, 0.15 + near * 1.1) * fade;
            const [x, y] = project(star, star.z);
            const [tx, ty] = project(star, star.z + 0.025);
            ctx.strokeStyle = `rgba(${star.tint}, ${alpha.toFixed(3)})`;
            ctx.lineWidth = 0.6 + near * 2;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(x + 0.01, y);
            ctx.stroke();
          }
        },
      };
    },
  });
}
