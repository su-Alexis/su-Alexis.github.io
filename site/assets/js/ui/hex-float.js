// "hex_float" background (owner request; the default for part of October 13, 2026, until
// the circuit board took over): neon wireframe hexes, stars and solids drifting across behind the page, cyberpunk style. Chosen with the "background" command; ui/backgrounds.js owns
// which background is on and starts/stops this renderer.
//
// Decorative only. Drawn on a transparent canvas (ui/canvas-bg.js runs the loop), so the
// page grid still shows through and modules stay readable on top. Shapes (geometry
// below) are hex prisms, crystals, nuts, honeycombs and stars, rotated in 3D with a
// gentle perspective projection; a
// wider faint stroke under each thin line fakes the neon glow (no shadowBlur, which is
// what made earlier effects lag); a shape that swells with light gets a wider halo too.

import { startCanvas, rand } from './canvas-bg.js';

// Turnover and glow (owner request, October 19, 2026: 42% for both). TURNOVER is the
// share of the shapes on screen that leave and are replaced each minute, on any screen:
// speeds scale with the screen's size (drift) so a shape takes as long to cross a phone
// as a desktop. GLOW_SHARE is the share of the time an ordinary shape is glowing: a glow
// lasts GLOW_LENGTH seconds on average, so one starts at GLOW_RATE per second, timed by
// the clock, not the frame rate, so it is the same on a 60 or a 144 Hz screen.
const TURNOVER = 0.42;
const CROSSING = 60 / TURNOVER; // seconds a shape spends on screen, on average
const GLOW_SHARE = 0.42;
const GLOW_LENGTH = 1.35; // the mean of rand(0.9, 1.8)
const GLOW_RATE = GLOW_SHARE / ((1 - GLOW_SHARE) * GLOW_LENGTH);
// Speed scale for this screen: a shape at the base speeds (8 to 22 px a second, by depth)
// crosses a 1920x1080 screen in about BASE_CROSSING seconds (measured, tests/hex-float).
const BASE_CROSSING = 205;
// A line across a screen is pi * area / perimeter long on average (Cauchy), so speeds
// scale with that to keep the crossing time the same on every screen.
const chord = (width, height) => (Math.PI * width * height) / (2 * (width + height)) + 60;
export const drift = (width, height) => (BASE_CROSSING / CROSSING) * (chord(width, height) / chord(1920, 1080));
const AREA_PER_SHAPE = 17000; // px^2 of viewport per shape (busier, owner request, October 19, 2026)
const MIN_SHAPES = 20;
const MAX_SHAPES = 84; // bounded work on very large screens
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
// And more (owner request, October 19, 2026: "more objects"):
//   tetra      a tetrahedron
//   octa       an octahedron
//   icosa      an icosahedron, a twenty-faced geodesic ball
//   gear       an eight-toothed gear with a hex hub
//   diamond    a cut gem: a flat table, a wide girdle and a point below
//   torus      a hex donut: hex sections swept round a ring
// The stars glow softly brighter and back as they drift; any shape may swell with light.
export const SHAPE_KINDS = Object.freeze(['prism', 'washer', 'frustum', 'crystal', 'honeycomb', 'nut', 'pyramid', 'cube', 'tower', 'hexagram', 'star', 'octagram', 'sparkle', 'tetra', 'octa', 'icosa', 'gear', 'diamond', 'torus']);
// How often each turns up, relative to the others (stars a little more).
const KIND_WEIGHTS = {
  prism: 6, washer: 4, frustum: 4, crystal: 5, honeycomb: 4, nut: 4, pyramid: 4, cube: 5, tower: 4,
  hexagram: 7, star: 7, octagram: 5, sparkle: 6, tetra: 4, octa: 5, icosa: 4, gear: 4, diamond: 5, torus: 4,
};
const WEIGHT_TOTAL = Object.values(KIND_WEIGHTS).reduce((sum, w) => sum + w, 0);
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
  } else if (kind === 'sparkle') {
    stellated(4, 0.3, 0.32);
  } else if (kind === 'tetra') {
    for (const [x, y, z] of [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) points.push([x * 0.58, y * 0.58, z * 0.58]);
    for (let a = 0; a < 4; a += 1) for (let b = a + 1; b < 4; b += 1) edges.push([a, b]);
  } else if (kind === 'octa') {
    for (const axis of [0, 1, 2]) {
      for (const sign of [1, -1]) {
        const point = [0, 0, 0];
        point[axis] = sign * 0.95;
        points.push(point);
      }
    }
    for (let a = 0; a < 6; a += 1) for (let b = a + 1; b < 6; b += 1) if (Math.floor(a / 2) !== Math.floor(b / 2)) edges.push([a, b]);
  } else if (kind === 'icosa') {
    // The twelve corners (0, 1, phi) with every sign and turn, scaled to a unit;
    // neighbours are the pairs two units apart before scaling.
    const phi = (1 + Math.sqrt(5)) / 2;
    const raw = [];
    for (const a of [1, -1]) {
      for (const b of [phi, -phi]) raw.push([0, a, b], [a, b, 0], [b, 0, a]);
    }
    const scale = 1 / Math.hypot(1, phi);
    for (const [x, y, z] of raw) points.push([x * scale, y * scale, z * scale]);
    for (let a = 0; a < 12; a += 1) {
      for (let b = a + 1; b < 12; b += 1) {
        if (Math.abs(Math.hypot(raw[a][0] - raw[b][0], raw[a][1] - raw[b][1], raw[a][2] - raw[b][2]) - 2) < 0.01) edges.push([a, b]);
      }
    }
  } else if (kind === 'gear') {
    // Eight teeth: each a rise to the tip and back down, front and back, joined through.
    const outline = (z) => {
      const start = points.length;
      for (let k = 0; k < 32; k += 1) {
        const angle = (Math.PI / 16) * k;
        const radius = k % 4 === 1 || k % 4 === 2 ? 1 : 0.76;
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius, z]);
        edges.push([start + k, start + ((k + 1) % 32)]);
      }
      return start;
    };
    const front = outline(0.2);
    const back = outline(-0.2);
    join(front, back, 32);
    slab(6, 0.3, 0.2);
  } else if (kind === 'diamond') {
    const table = ring(8, 0.5, 0.42, Math.PI / 8);
    const girdle = ring(8, 1, 0.12);
    const culet = points.push([0, 0, -0.9]) - 1;
    for (let k = 0; k < 8; k += 1) edges.push([table + k, girdle + k], [table + k, girdle + ((k + 1) % 8)], [girdle + k, culet]);
  } else {
    // torus: eight hex sections round a ring, each joined to the next.
    let first = -1;
    let last = -1;
    for (let k = 0; k < 8; k += 1) {
      const around = (Math.PI / 4) * k;
      const start = points.length;
      for (let j = 0; j < 6; j += 1) {
        const tube = (Math.PI / 3) * j;
        const reach = 0.7 + Math.cos(tube) * 0.28;
        points.push([Math.cos(around) * reach, Math.sin(around) * reach, Math.sin(tube) * 0.28]);
        edges.push([start + j, start + ((j + 1) % 6)]);
      }
      if (last >= 0) join(last, start, 6);
      else first = start;
      last = start;
    }
    join(last, first, 6);
  }
  return { points, edges };
}

function pickKind() {
  let roll = Math.random() * WEIGHT_TOTAL;
  for (const kind of SHAPE_KINDS) {
    roll -= KIND_WEIGHTS[kind];
    if (roll <= 0) return kind;
  }
  return 'prism';
}

// Where a shape comes in and which way it floats (owner request, October 19, 2026: in
// random directions, not only up). New shapes start just off a random edge of the screen
// and head across it toward a random point inside, at `speed` px per second; the first
// batch is scattered over the screen already, each heading any way at all. Exported for
// tests; it uses no DOM.
export function entry(width, height, radius, anywhere, speed) {
  const margin = radius * 2;
  let x;
  let y;
  if (anywhere) {
    x = rand(0, width);
    y = rand(0, height);
  } else {
    const edge = Math.floor(Math.random() * 4);
    x = edge === 0 ? -margin : edge === 1 ? width + margin : rand(0, width);
    y = edge === 2 ? -margin : edge === 3 ? height + margin : rand(0, height);
  }
  const heading = anywhere
    ? rand(0, Math.PI * 2)
    : Math.atan2(rand(height * 0.2, height * 0.8) - y, rand(width * 0.2, width * 0.8) - x);
  return { x, y, vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed };
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
    ...entry(width, height, radius, anywhere, rand(8, 22) * depth * drift(width, height)),
    sway: rand(0.2, 0.6),
    phase: rand(0, Math.PI * 2),
    angles: [rand(0, Math.PI * 2), rand(0, Math.PI * 2), rand(0, Math.PI * 2)],
    spin: [rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.2, 0.2)], // radians per second
    color: pickColor(),
    twinkle: star ? rand(2.2, 4) : 0, // seconds per slow glow, stars only
    glow: 0, // seconds left of a glow swell, and its length (glowFor)
    glowFor: 1,
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
            // Along its heading, with a gentle sideways drift across it.
            const drift = Math.sin((time / 1000) * shape.sway + shape.phase) * 6 * shape.depth * dt;
            const speed = Math.hypot(shape.vx, shape.vy) || 1;
            shape.x += shape.vx * dt - (shape.vy / speed) * drift;
            shape.y += shape.vy * dt + (shape.vx / speed) * drift;
            for (let k = 0; k < 3; k += 1) shape.angles[k] += shape.spin[k] * dt;
            // Now and then a shape swells with light and settles again (owner request,
            // October 19, 2026: a glow instead of the old neon flicker, which dimmed it).
            if (shape.glow > 0) shape.glow = Math.max(0, shape.glow - dt);
            else if (Math.random() < dt * GLOW_RATE) {
              shape.glowFor = rand(0.9, 1.8);
              shape.glow = shape.glowFor;
            }
            // Gone off any edge, heading away: a new one comes in from off screen, keeping
            // the depth order.
            const margin = shape.radius * 2;
            const gone = (shape.x < -margin && shape.vx <= 0) || (shape.x > width + margin && shape.vx >= 0)
              || (shape.y < -margin && shape.vy <= 0) || (shape.y > height + margin && shape.vy >= 0);
            if (gone) {
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
            const alpha = (0.14 + 0.36 * shape.depth) * fade;
            // How much it glows, 0 to 1: a swell's rise and fall, and for stars a slow
            // twinkle of their own. Glow only ever adds light; nothing dims or blinks.
            let glow = shape.glow > 0 ? Math.sin(Math.PI * (1 - shape.glow / shape.glowFor)) : 0;
            if (shape.twinkle) glow = Math.max(glow, 0.35 + 0.35 * Math.sin((now / 1000) * ((Math.PI * 2) / shape.twinkle) + shape.phase));
            context.beginPath();
            for (const [from, to] of shape.edges) {
              context.moveTo(points[from][0], points[from][1]);
              context.lineTo(points[to][0], points[to][1]);
            }
            // A soft outer halo while it glows, the glow underlay, then the crisp wire, all
            // brighter and wider as the glow rises.
            if (glow > 0.05) {
              context.strokeStyle = `rgba(${shape.color}, ${(alpha * 0.1 * glow).toFixed(3)})`;
              context.lineWidth = 10 + 8 * glow;
              context.stroke();
            }
            context.strokeStyle = `rgba(${shape.color}, ${Math.min(1, alpha * (0.22 + 0.4 * glow)).toFixed(3)})`;
            context.lineWidth = 4 + 3 * glow;
            context.stroke();
            context.strokeStyle = `rgba(${shape.color}, ${Math.min(1, alpha * (1 + 0.5 * glow)).toFixed(3)})`;
            context.lineWidth = 1.1;
            context.stroke();
            // Vertex nodes.
            context.fillStyle = `rgba(${shape.color}, ${Math.min(1, alpha * (1.6 + glow)).toFixed(3)})`;
            for (const [x, y] of points) context.fillRect(x - 1, y - 1, 2, 2);
          }
        },
      };
    },
  });
}
