// "hex_float" background (owner request; the default for part of October 13, 2026, until
// the circuit board took over): neon wireframe hexagons drifting up behind the page, cyberpunk style. Chosen with the "background" command; ui/backgrounds.js owns
// which background is on and starts/stops this renderer.
//
// Decorative only. Drawn on a transparent canvas (ui/canvas-bg.js runs the loop), so the
// page grid still shows through and modules stay readable on top. Shapes (geometry
// below) are hex prisms, crystals, nuts, honeycombs and stars, rotated in 3D with a
// gentle perspective projection; a
// wider faint stroke under each thin line fakes the neon glow (no shadowBlur, which is
// what made earlier effects lag).

import { startCanvas, rand } from './canvas-bg.js';

const AREA_PER_SHAPE = 32000; // px^2 of viewport per shape
const MIN_SHAPES = 12;
const MAX_SHAPES = 46; // bounded work on very large screens
// Neon palette: the site's cyan accent, a hot magenta, and the amber brand color.
const COLORS = [
  { rgb: '79, 209, 224', weight: 0.55 },
  { rgb: '255, 63, 164', weight: 0.3 },
  { rgb: '245, 164, 0', weight: 0.15 },
];

function pickColor() {
  let roll = Math.random();
  for (const color of COLORS) {
    roll -= color.weight;
    if (roll <= 0) return color.rgb;
  }
  return COLORS[0].rgb;
}

// The shapes (owner requests, October 19, 2026: more kinds of hex, stars, more sizes, no
// shapes that look broken, and every one solid 3D, nothing flat). Each is local-space
// vertices and edges, about one unit across, as wireframe neon:
//   prism      a hexagonal prism: two hex rings joined by uprights
//   washer     a thick hex washer: a hex with a smaller hex hole, both extruded
//   frustum    a hex prism that narrows to a smaller top, like a hex bolt head
//   crystal    a hex ring with a point above and below it: a quartz-like gem
//   honeycomb  seven hex cells with depth, one in the middle and six around it
//   nut        a hex nut: an extruded hex with a round bore through it
//   pyramid    a hex pyramid: a hex base rising to a point
//   cube       a cube, which shows a hexagon when it turns corner on
//   tower      a twisted hex tower: stacked hexes, each turned a little further
//   hexagram   a six-pointed star, stellated: every point rises to a peak front and back
//   star       a five-pointed star, stellated the same way
//   octagram   an eight-pointed star, stellated
//   sparkle    a four-pointed glint with depth, mostly tiny
// The stars twinkle as they drift.
export const SHAPE_KINDS = Object.freeze(['prism', 'washer', 'frustum', 'crystal', 'honeycomb', 'nut', 'pyramid', 'cube', 'tower', 'hexagram', 'star', 'octagram', 'sparkle']);
const KIND_WEIGHTS = {
  prism: 0.09, washer: 0.06, frustum: 0.07, crystal: 0.08, honeycomb: 0.07, nut: 0.07, pyramid: 0.07,
  cube: 0.07, tower: 0.07, hexagram: 0.1, star: 0.1, octagram: 0.07, sparkle: 0.08,
};
const STARS = new Set(['hexagram', 'star', 'octagram', 'sparkle']);

export function geometry(kind) {
  const points = [];
  const edges = [];
  // A closed ring of n points at radius r, height z, turned by twist; returns its first index.
  const ring = (n, radius, z, twist = 0, cx = 0, cy = 0) => {
    const start = points.length;
    for (let k = 0; k < n; k += 1) {
      const angle = ((Math.PI * 2) / n) * k + twist;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, z]);
      edges.push([start + k, start + ((k + 1) % n)]);
    }
    return start;
  };
  const join = (a, b, n) => {
    for (let k = 0; k < n; k += 1) edges.push([a + k, b + k]);
  };
  // A ring extruded front and back, joined by uprights.
  const slab = (n, radius, depth, twist = 0, cx = 0, cy = 0) => join(ring(n, radius, depth, twist, cx, cy), ring(n, radius, -depth, twist, cx, cy), n);
  // A star of `tips` points, outer and inner corners in turn, with a peak in front and
  // behind that every corner rises to: a solid, faceted star.
  const stellated = (tips, inner, depth) => {
    const start = points.length;
    const n = tips * 2;
    for (let k = 0; k < n; k += 1) {
      const angle = (Math.PI / tips) * k - Math.PI / 2;
      const radius = k % 2 ? inner : 1;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, 0]);
      edges.push([start + k, start + ((k + 1) % n)]);
    }
    const front = points.push([0, 0, depth]) - 1;
    const back = points.push([0, 0, -depth]) - 1;
    for (let k = 0; k < n; k += 1) edges.push([start + k, front], [start + k, back]);
  };
  if (kind === 'prism') {
    slab(6, 1, 0.45);
  } else if (kind === 'washer') {
    slab(6, 1, 0.22);
    slab(6, 0.55, 0.22, Math.PI / 6);
  } else if (kind === 'frustum') {
    join(ring(6, 1, -0.3), ring(6, 0.62, 0.3), 6);
  } else if (kind === 'crystal') {
    const belt = ring(6, 0.62, 0.1);
    const top = points.push([0, 0, 1.05]) - 1;
    const bottom = points.push([0, 0, -0.75]) - 1;
    for (let k = 0; k < 6; k += 1) edges.push([belt + k, top], [belt + k, bottom]);
  } else if (kind === 'honeycomb') {
    // Cells with a side of 0.34, packed edge to edge, each with a little depth.
    const r = 0.34;
    const step = r * Math.sqrt(3);
    slab(6, r, 0.16);
    for (let k = 0; k < 6; k += 1) {
      const angle = (Math.PI / 3) * k + Math.PI / 6;
      slab(6, r, 0.16, 0, Math.cos(angle) * step, Math.sin(angle) * step);
    }
  } else if (kind === 'nut') {
    slab(6, 1, 0.28);
    slab(12, 0.45, 0.28);
  } else if (kind === 'pyramid') {
    const base = ring(6, 0.95, -0.4);
    const apex = points.push([0, 0, 0.85]) - 1;
    for (let k = 0; k < 6; k += 1) edges.push([base + k, apex]);
  } else if (kind === 'cube') {
    const c = 0.58; // corners at a unit's distance from the middle
    for (const x of [-c, c]) for (const y of [-c, c]) for (const z of [-c, c]) points.push([x, y, z]);
    for (let a = 0; a < 8; a += 1) {
      for (const bit of [1, 2, 4]) if (!(a & bit)) edges.push([a, a | bit]);
    }
  } else if (kind === 'tower') {
    let below = -1;
    for (let level = 0; level < 4; level += 1) {
      const at = ring(6, 0.72, -0.6 + level * 0.4, level * (Math.PI / 12));
      if (below >= 0) join(below, at, 6);
      below = at;
    }
  } else if (kind === 'hexagram') {
    stellated(6, 0.58, 0.38);
  } else if (kind === 'star') {
    stellated(5, 0.42, 0.34);
  } else if (kind === 'octagram') {
    stellated(8, 0.62, 0.36);
  } else {
    stellated(4, 0.3, 0.32); // sparkle
  }
  return { points, edges };
}

function pickKind() {
  let roll = Math.random();
  for (const kind of SHAPE_KINDS) {
    roll -= KIND_WEIGHTS[kind];
    if (roll <= 0) return kind;
  }
  return 'prism';
}

function makeShape(width, height, anywhere) {
  const depth = rand(0.35, 1); // 1 = near: bigger, brighter, faster
  // Sizes vary a lot (owner requests): specks, small and medium most of the time, now and
  // then a big one. Depth still shrinks far shapes, but only partly, so size is not just
  // distance. A honeycomb spreads wider, so it starts a little bigger.
  const kind = pickKind();
  const roll = Math.random();
  // Six tiers, from glints of dust to a rare giant; sparkles stay small.
  const tiers = [[3, 7], [7, 14], [14, 30], [30, 60], [60, 110], [110, 240]];
  const odds = kind === 'sparkle' ? [0.45, 0.35, 0.15, 0.05, 0, 0] : [0.1, 0.18, 0.27, 0.25, 0.15, 0.05];
  let pick = Math.random();
  let tier = 0;
  while (tier < odds.length - 1 && pick > odds[tier]) {
    pick -= odds[tier];
    tier += 1;
  }
  const size = rand(tiers[tier][0], tiers[tier][1]);
  const radius = size * (0.6 + 0.4 * depth) * (kind === 'honeycomb' ? 1.25 : 1);
  const star = STARS.has(kind);
  return {
    ...geometry(kind),
    kind,
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
    twinkle: star ? rand(1.2, 2.6) : 0, // seconds per twinkle, stars only
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
    // A gentle perspective: a strong one warped big shapes until they looked broken.
    const perspective = 6 / (6 + z);
    return [shape.x + x * shape.radius * perspective, shape.y + y * shape.radius * perspective];
  });
}

export function startHexFloat({ still = false, resume = false } = {}) {
  return startCanvas({
    className: 'hex-float',
    still,
    resume,
    scene: (context) => {
      let shapes = [];
      let width = 0;
      let height = 0;
      return {
        resize(w, h) {
          width = w;
          height = h;
          context.lineJoin = 'round';
          const count = Math.max(MIN_SHAPES, Math.min(MAX_SHAPES, Math.round((width * height) / AREA_PER_SHAPE)));
          // Keep the shapes already on screen; add or drop only the difference.
          shapes = shapes.slice(0, count);
          while (shapes.length < count) shapes.push(makeShape(width, height, true));
          // Far shapes first so near ones draw over them.
          shapes.sort((p, q) => p.depth - q.depth);
        },
        step(dt, time) {
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
        },
        draw(fade) {
          const now = performance.now();
          context.clearRect(0, 0, width, height);
          for (const shape of shapes) {
            const points = project(shape);
            let alpha = (0.14 + 0.36 * shape.depth) * fade;
            if (shape.flicker > 0) alpha *= 0.35;
            // Stars twinkle: a slow swell between two thirds and full brightness.
            if (shape.twinkle) alpha *= 0.82 + 0.18 * Math.sin((now / 1000) * ((Math.PI * 2) / shape.twinkle) + shape.phase);
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
        },
      };
    },
  });
}
