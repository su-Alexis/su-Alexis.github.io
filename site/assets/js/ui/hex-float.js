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

// The shapes (owner request, October 19, 2026: more kinds of hex, a star, more sizes, and
// no more shapes that looked broken). Each is local-space vertices and edges, about one
// unit across, as wireframe neon:
//   prism      a hexagonal prism: two hex rings joined by uprights
//   rings      a flat hex with a smaller one inside it, turned half a step
//   frustum    a hex prism that narrows to a smaller top, like a hex bolt head
//   crystal    a hex ring with a point above and below it: a quartz-like gem
//   honeycomb  seven flat hex cells, one in the middle and six around it
//   nut        a hex nut: an extruded hex with a round bore through it
//   hexagram   a six-pointed star: two triangles, the hex the theme is built on
//   star       a five-pointed star with a little thickness
// More, the same day ("more variations and sizes"):
//   pyramid    a hex pyramid: a hex base rising to a point
//   cube       a cube, which shows a hexagon when it turns corner on
//   vortex     three nested hexes, each turned a little further: a hex spiral
//   octagram   an eight-pointed star: two squares
//   sparkle    a four-pointed glint, mostly tiny
// The stars (hexagram, star, octagram, sparkle) twinkle as they drift.
export const SHAPE_KINDS = Object.freeze(['prism', 'rings', 'frustum', 'crystal', 'honeycomb', 'nut', 'hexagram', 'star', 'pyramid', 'cube', 'vortex', 'octagram', 'sparkle']);
const KIND_WEIGHTS = {
  prism: 0.09, rings: 0.06, frustum: 0.07, crystal: 0.08, honeycomb: 0.07, nut: 0.07, hexagram: 0.1,
  star: 0.1, pyramid: 0.07, cube: 0.07, vortex: 0.07, octagram: 0.07, sparkle: 0.08,
};
const STARS = new Set(['hexagram', 'star', 'octagram', 'sparkle']);
const FLAT = new Set([...STARS, 'honeycomb', 'rings', 'vortex']);

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
  if (kind === 'prism') {
    join(ring(6, 1, 0.45), ring(6, 1, -0.45), 6);
  } else if (kind === 'rings') {
    ring(6, 1, 0);
    ring(6, 0.55, 0, Math.PI / 6);
  } else if (kind === 'frustum') {
    join(ring(6, 1, -0.3), ring(6, 0.62, 0.3), 6);
  } else if (kind === 'crystal') {
    const belt = ring(6, 0.62, 0.1);
    const top = points.push([0, 0, 1.05]) - 1;
    const bottom = points.push([0, 0, -0.75]) - 1;
    for (let k = 0; k < 6; k += 1) edges.push([belt + k, top], [belt + k, bottom]);
  } else if (kind === 'honeycomb') {
    // Cells with a side of 0.34 (flat-topped), packed edge to edge.
    const r = 0.34;
    const step = r * Math.sqrt(3);
    ring(6, r, 0, 0);
    for (let k = 0; k < 6; k += 1) {
      const angle = (Math.PI / 3) * k + Math.PI / 6;
      ring(6, r, 0, 0, Math.cos(angle) * step, Math.sin(angle) * step);
    }
  } else if (kind === 'nut') {
    join(ring(6, 1, 0.28), ring(6, 1, -0.28), 6);
    join(ring(12, 0.45, 0.28), ring(12, 0.45, -0.28), 12);
  } else if (kind === 'hexagram') {
    ring(3, 1, 0, -Math.PI / 2);
    ring(3, 1, 0, Math.PI / 2);
    ring(6, 0.22, 0, 0); // a small hex at its heart
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
  } else if (kind === 'vortex') {
    ring(6, 1, 0, 0);
    ring(6, 0.7, 0, Math.PI / 9);
    ring(6, 0.44, 0, (Math.PI * 2) / 9);
    ring(6, 0.22, 0, Math.PI / 3);
  } else if (kind === 'octagram') {
    ring(4, 1, 0, 0);
    ring(4, 1, 0, Math.PI / 4);
  } else if (kind === 'sparkle') {
    const start = points.length;
    for (let k = 0; k < 8; k += 1) {
      const angle = (Math.PI / 4) * k - Math.PI / 2;
      const radius = k % 2 ? 0.2 : 1;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, 0]);
      edges.push([start + k, start + ((k + 1) % 8)]);
    }
  } else {
    // Five points: outer and inner corners in turn, front and back, joined at the tips.
    const outline = (z) => {
      const start = points.length;
      for (let k = 0; k < 10; k += 1) {
        const angle = (Math.PI / 5) * k - Math.PI / 2;
        const radius = k % 2 ? 0.42 : 1;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, z]);
        edges.push([start + k, start + ((k + 1) % 10)]);
      }
      return start;
    };
    const front = outline(0.14);
    const back = outline(-0.14);
    for (let k = 0; k < 10; k += 2) edges.push([front + k, back + k]);
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
  const flat = FLAT.has(kind);
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
    spin: flat ? [0, 0, rand(-0.45, 0.45)] : [rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.2, 0.2)], // radians per second
    // Flat shapes (stars, honeycombs, rings) never tumble edge on, where they read as a
    // sliver: they turn face on and rock back and forth up to this far (radians), at
    // tilt[2] radians per second.
    tilt: flat ? [rand(0.25, 0.7), rand(0.25, 0.7), rand(0.3, 0.7)] : null,
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
            if (shape.tilt) {
              const t = (time / 1000) * shape.tilt[2] + shape.phase;
              shape.angles[0] = shape.tilt[0] * Math.sin(t);
              shape.angles[1] = shape.tilt[1] * Math.sin(t * 0.8 + 1.3);
            }
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
