// "hex_float" background (owner request): neon wireframe hexagons drifting up behind the
// page, cyberpunk style. Chosen with the "background" command; ui/backgrounds.js owns
// which background is on and starts/stops this renderer.
//
// Decorative only. Drawn on one transparent <canvas> fixed behind .site (layout.css,
// .bg-canvas), so the page grid still shows through and modules stay readable on top.
// Canvas pixel size is set through the width/height properties, never style attributes
// (doctrine section 9). Shapes are hexagonal prisms and flat double hexes, rotated in 3D
// with a simple perspective projection; a wider faint stroke under each thin line fakes
// the neon glow (no shadowBlur, which is what made earlier effects lag).
// One requestAnimationFrame loop, throttled to FRAME_MS, with motion scaled by elapsed
// time so a slow frame never speeds anything up. It pauses while the tab is hidden and
// is torn down on pagehide. still: draws one frame and never animates (reduced motion).

import { el } from '../utils/dom.js';

const FRAME_MS = 33; // ~30 fps
const AREA_PER_SHAPE = 45000; // px^2 of viewport per shape
const MIN_SHAPES = 10;
const MAX_SHAPES = 34; // bounded work on very large screens
const FADE_IN_MS = 1200;
// Neon palette: the site's cyan accent, a hot magenta, and the amber brand color.
const COLORS = [
  { rgb: '79, 209, 224', weight: 0.55 },
  { rgb: '255, 63, 164', weight: 0.3 },
  { rgb: '245, 164, 0', weight: 0.15 },
];

const rand = (min, max) => min + Math.random() * (max - min);

function pickColor() {
  let roll = Math.random();
  for (const color of COLORS) {
    roll -= color.weight;
    if (roll <= 0) return color.rgb;
  }
  return COLORS[0].rgb;
}

// Local-space vertices and edges. prism: two hex rings joined by uprights.
// rings: a flat hex with a smaller one inside it, rotated half a step.
function geometry(kind) {
  const points = [];
  const edges = [];
  const ring = (radius, z, twist) => {
    const start = points.length;
    for (let k = 0; k < 6; k += 1) {
      const angle = (Math.PI / 3) * k + twist;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, z]);
      edges.push([start + k, start + ((k + 1) % 6)]);
    }
    return start;
  };
  if (kind === 'prism') {
    const top = ring(1, 0.45, 0);
    const bottom = ring(1, -0.45, 0);
    for (let k = 0; k < 6; k += 1) edges.push([top + k, bottom + k]);
  } else {
    ring(1, 0, 0);
    ring(0.55, 0, Math.PI / 6);
  }
  return { points, edges };
}

function makeShape(width, height, anywhere) {
  const depth = rand(0.35, 1); // 1 = near: bigger, brighter, faster
  // Sizes vary a lot (owner request): mostly small and medium, now and then a big one.
  // Depth still shrinks far shapes, but only partly, so size is not just distance.
  const roll = Math.random();
  const size = roll < 0.35 ? rand(10, 30) : roll < 0.85 ? rand(30, 80) : rand(80, 150);
  const radius = size * (0.6 + 0.4 * depth);
  return {
    ...geometry(Math.random() < 0.6 ? 'prism' : 'rings'),
    depth,
    radius,
    x: rand(0, width),
    // New shapes rise from just below the screen; the first batch is scattered everywhere.
    y: anywhere ? rand(0, height) : height + radius * 2,
    rise: rand(8, 22) * depth, // px per second
    sway: rand(0.2, 0.6),
    phase: rand(0, Math.PI * 2),
    angles: [rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2)],
    spin: [rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.2, 0.2)], // radians per second
    color: pickColor(),
    flicker: 0, // ms of neon flicker left
  };
}

function project(shape) {
  const [a, b, c] = shape.angles;
  const sa = Math.sin(a), ca = Math.cos(a);
  const sb = Math.sin(b), cb = Math.cos(b);
  const sc = Math.sin(c), cc = Math.cos(c);
  return shape.points.map(([px, py, pz]) => {
    // Rotate around x, then y, then z.
    let y = py * ca - pz * sa;
    let z = py * sa + pz * ca;
    let x = px * cb + z * sb;
    z = -px * sb + z * cb;
    const rx = x * cc - y * sc;
    y = x * sc + y * cc;
    x = rx;
    const perspective = 3 / (3 + z);
    return [shape.x + x * shape.radius * perspective, shape.y + y * shape.radius * perspective];
  });
}

export function startHexFloat({ still = false, resume = false } = {}) {
  const canvas = el('canvas', { className: 'bg-canvas hex-float', attrs: { 'aria-hidden': 'true' } });
  const context = canvas.getContext('2d');
  if (!context) return null;
  document.body.prepend(canvas);

  let shapes = [];
  let width = 0;
  let height = 0;
  let frame = 0;
  let last = 0;
  // Resuming on a new page (or reduced motion): already at full strength, no fade-in.
  let fade = still || resume ? 1 : 0;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineJoin = 'round';
    const count = Math.max(MIN_SHAPES, Math.min(MAX_SHAPES, Math.round((width * height) / AREA_PER_SHAPE)));
    // Keep the shapes already on screen; add or drop only the difference.
    shapes = shapes.slice(0, count);
    while (shapes.length < count) shapes.push(makeShape(width, height, true));
    // Far shapes first so near ones draw over them.
    shapes.sort((p, q) => p.depth - q.depth);
    if (still) draw();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    for (const shape of shapes) {
      const points = project(shape);
      let alpha = (0.14 + 0.36 * shape.depth) * fade;
      if (shape.flicker > 0) alpha *= 0.35;
      context.beginPath();
      for (const [from, to] of shape.edges) {
        context.moveTo(points[from][0], points[from][1]);
        context.lineTo(points[to][0], points[to][1]);
      }
      // Glow underlay, then the crisp wire.
      context.strokeStyle = `rgba(${shape.color}, ${(alpha * 0.22).toFixed(3)})`;
      context.lineWidth = 4;
      context.stroke();
      context.strokeStyle = `rgba(${shape.color}, ${alpha.toFixed(3)})`;
      context.lineWidth = 1.1;
      context.stroke();
      // Vertex nodes.
      context.fillStyle = `rgba(${shape.color}, ${Math.min(1, alpha * 1.6).toFixed(3)})`;
      for (const [x, y] of points) context.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  function step(dt, time) {
    if (fade < 1) fade = Math.min(1, fade + (dt * 1000) / FADE_IN_MS);
    for (let i = 0; i < shapes.length; i += 1) {
      const shape = shapes[i];
      shape.y -= shape.rise * dt;
      shape.x += Math.sin(time / 1000 * shape.sway + shape.phase) * 6 * shape.depth * dt;
      for (let k = 0; k < 3; k += 1) shape.angles[k] += shape.spin[k] * dt;
      if (shape.flicker > 0) shape.flicker -= dt * 1000;
      else if (Math.random() < 0.0012) shape.flicker = rand(60, 180); // rare neon stutter
      // Gone off the top: a new shape rises from the bottom, keeping the depth order.
      if (shape.y < -shape.radius * 2) {
        shapes[i] = makeShape(width, height, false);
        shapes.sort((p, q) => p.depth - q.depth);
      }
    }
  }

  function loop(time) {
    frame = window.requestAnimationFrame(loop);
    if (time - last < FRAME_MS) return;
    // Cap the step so a long pause (hidden tab, slow device) never jumps the shapes.
    const dt = last ? Math.min(0.1, (time - last) / 1000) : 0;
    last = time;
    step(dt, time);
    draw();
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
