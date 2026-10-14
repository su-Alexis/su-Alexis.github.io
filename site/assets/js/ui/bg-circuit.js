// The default background (owner decision, October 13, 2026; it was "circuit" before): a
// printed circuit board, with pulses of light running along its traces. "background
// default" brings it back; ui/backgrounds.js starts and stops it, ui/canvas-bg.js runs
// the loop.
//
// Laid out like a real routed board (owner requests, October 14, 2026, with a real board
// layout as the reference: traces must connect things, nothing scattered at random, no
// bare pads, no big empty patches). planBoard() works on a grid, in this order:
//   1. Parts: quad (QFP) and small outline (SOIC) chips and pin headers, spread out.
//   2. Nets: each part is wired to its nearest neighbours. The facing sides of two parts
//      are joined pin to pin by a bundle of traces, routed by a small A* maze router that
//      only turns 45 degrees at a time and prefers to run alongside traces already laid,
//      so bundles hug each other the way autorouted boards do. Pins are paired in order
//      across the bundle and the shortest are routed first, so they nest without crossing.
//   3. Leftover pins: a row of series resistors in front of the chip, a bus escaping off
//      the edge of the board (planBus: parallel lines that jog and fan around corners),
//      or a short escape stub to a via. Every pin's first cell is reserved until then, so
//      routing never walls a pin in.
//   4. Gaps: smaller chips dropped into free space and wired up the same way, then
//      mounting holes, then copper pours with stitching vias over whatever is left.
// Traces never cross or touch: every grid point and every diagonal crossing is claimed
// once. A pin that still ends up with no wire loses its pad, so none is left bare.
// tests/bg-circuit.test.mjs checks these rules on random boards.
//
// The board is planned for the whole screen and drawn once onto an offscreen canvas, so
// each frame only copies it and draws the pulses, and resizing the window shows more or
// less of the same board. Data flows between parts over their nets as chains of cause and
// effect (makeTraffic, below); each part also works through its stubs, resistors and
// escaping buses on a slow cycle (makeAmbient), so every wire lights up now and then.
//
// Decorative only, on a transparent canvas; the part labels are fixed strings drawn with
// fillText.

import { el } from '../utils/dom.js';
import { startCanvas } from './canvas-bg.js';
import { sessionStore, readJson, writeJson } from '../core/storage.js';
import { SESSION_KEYS } from '../core/constants.js';

const CELL = 10; // grid pitch, px: trace spacing and pin pitch
const AREA_PER_PART = 75000; // px^2 of board per main part
const MIN_PARTS = 3;
const MAX_PARTS = 40;
const PART_CLEARANCE = 5; // cells between main parts, room for their traces
const NEIGHBOURS = 4; // neighbours each part is wired to, at most
const NET_REACH = 90; // cells: parts further apart are not wired together
const ROUTE_STEPS = 6000; // A* expansions per trace
const ROUTE_BUDGET = 1200000; // A* expansions per board, so a huge screen stays quick
const MAX_PULSES = 240; // data on the nets
const MAX_AMBIENT = 64; // pulses on stubs, resistors and escaping buses at once
const AMBIENT_CYCLE = [8, 12]; // seconds for a part to light each of those once
const TURNS_PER_TICK = 4; // most of those a part starts in one frame
const MAX_HOPS = 10; // a chain of transfers ends after this many
const REPLY_CHANCE = 0.25; // a part answers back on the bus it was reached on
const CARRY_ON = 0.85; // chance a part passes data on once it arrives
const TAIL = 10; // dots in a pulse's tail
const AMBIENT_TAIL = 6; // shorter, on the quiet lines: a quick blip, not a streak
const TAIL_GAP = 4; // px between tail dots
// The board's palette (owner request, October 14, 2026), on the page's own black:
//   deep blue-teal #16383F  subtle background circuitry (the copper pour, chip bodies)
//   muted teal-blue #327783 circuit paths and node outlines
//   icy cyan #67DCE8        active nodes and highlights (pulses on teal paths)
//   deep violet #40345F     subtle purple circuit paths (about a third of the buses)
//   muted purple #8870B5    purple node rings and accents (vias, mounting holes)
//   soft lavender #B99AFF   small purple glow effects (pulses on violet paths)
//   warm amber #E8B45B      occasional status lights: signals on power and control lines
// Two more (owner request, October 14, 2026: the pour and its stitching vias wanted a
// colour of their own that complements the rest, and the board read as three colours):
//   midnight indigo #1F2450 the copper pour, between the teal and the violet
//   amber, faint            its stitching vias, like gold-plated vias on a real board
const INK = Object.freeze({
  board: '22, 56, 63',
  path: '50, 119, 131',
  violet: '64, 52, 95',
  ring: '136, 112, 181',
  pour: '31, 36, 80',
  gold: '232, 180, 91',
});
// Pulse colours, stored by index: 0 rides teal paths, 1 violet ones, 2 power and control
// lines (toneColour).
const COLORS = ['103, 220, 232', '185, 154, 255', '232, 180, 91'];
const VIOLET_SHARE = 0.32;
const toneColour = (trace) => COLORS[!trace ? 0 : trace.signal === 'power' || trace.signal === 'control' ? 2 : trace.tone === 'violet' ? 1 : 0];
const LABELS = ['SoC', 'NIC', 'TPM', 'FPGA', 'ROM', 'WAFF-1', 'HSM', 'DSP', 'GPU', 'MCU', 'PHY', 'PMIC'];

// What sits on a grid point.
const FREE = 0;
const PART = 1; // a part's body or pad
const WIRE = 2; // a trace or via
const KEEP = 3; // a pin's first cell, kept for that pin's own trace
const POUR = 4; // copper pour or mounting hole

// 8 directions, clockwise from east.
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const dirIndex = ([dx, dy]) => DIRS.findIndex(([x, y]) => x === dx && y === dy);

// The board's randomness. planBoard() swaps in a seeded generator while it plans, so a
// session's seed always gives the same board (page to page); otherwise Math.random.
let random = Math.random;
const rand = (min, max) => min + random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const sign = () => (random() < 0.5 ? -1 : 1);

// mulberry32: a small, fast seeded generator (decorative layout only, not security).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// This session's board seed: read back as untrusted (a whole number in range) or made and
// kept now (SESSION_KEYS.bgSeed).
const SEED_MAX = 0xffffffff;
function sessionSeed() {
  const store = sessionStore();
  const kept = readJson(store, SESSION_KEYS.bgSeed);
  if (Number.isInteger(kept) && kept >= 0 && kept <= SEED_MAX) return kept;
  const fresh = Math.floor(Math.random() * SEED_MAX);
  writeJson(store, SESSION_KEYS.bgSeed, fresh);
  return fresh;
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const scale = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
// An orthogonal direction turned 90 degrees one way (s = 1) or the other (s = -1).
const turn90 = (d, s) => (s > 0 ? [-d[1], d[0]] : [d[1], -d[0]]);

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------- The grid ----------

// Grid points from (-margin, -margin) to (cols + margin, rows + margin); the margin lets
// a bus run a little way off the visible board. Anything outside reads as taken.
function makeGrid(cols, rows) {
  const margin = 4;
  const width = cols + 1 + margin * 2;
  const height = rows + 1 + margin * 2;
  const point = new Uint8Array(width * height);
  const crossing = new Uint8Array(width * height); // diagonal through the cell at (x, y)
  const inGrid = (x, y) => x >= -margin && y >= -margin && x <= cols + margin && y <= rows + margin;
  const at = (x, y) => (y + margin) * width + x + margin;
  return {
    cols,
    rows,
    width,
    margin,
    point,
    at,
    onBoard: (x, y) => x >= 0 && y >= 0 && x <= cols && y <= rows,
    get: (x, y) => (inGrid(x, y) ? point[at(x, y)] : PART),
    set: (x, y, value) => { if (inGrid(x, y)) point[at(x, y)] = value; },
    crossed(x, y, nx, ny) {
      const cx = Math.min(x, nx);
      const cy = Math.min(y, ny);
      return inGrid(cx, cy) ? crossing[at(cx, cy)] === 1 : true;
    },
    cross(x, y, nx, ny) {
      const cx = Math.min(x, nx);
      const cy = Math.min(y, ny);
      if (inGrid(cx, cy)) crossing[at(cx, cy)] = 1;
    },
    blockCell(x, y) { if (inGrid(x, y)) crossing[at(x, y)] = 1; },
  };
}

// ---------- Parts ----------

// A chip's body in grid points (corners inclusive) and its pins: each pin sits one cell
// outside the body, with the direction a trace leaves it. Quad packages have pins on all
// four sides, the small outline ones on their two long sides.
function makeChip(x0, y0, w, h, quad) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  const sides = [];
  if (quad || w >= h) {
    const xs = [];
    for (let x = x0 + 1; x < x1; x += 1) xs.push(x);
    sides.push({ out: [0, -1], pins: xs.map((x) => [x, y0 - 1]) });
    sides.push({ out: [0, 1], pins: xs.map((x) => [x, y1 + 1]) });
  }
  if (quad || h > w) {
    const ys = [];
    for (let y = y0 + 1; y < y1; y += 1) ys.push(y);
    sides.push({ out: [-1, 0], pins: ys.map((y) => [x0 - 1, y]) });
    sides.push({ out: [1, 0], pins: ys.map((y) => [x1 + 1, y]) });
  }
  return { kind: quad ? 'qfp' : 'soic', x0, y0, x1, y1, sides, label: '' };
}

// Parts with a solid body that traces must go round (the rest are rows of pads).
const BODIED = new Set(['qfp', 'soic', 'bga', 'inductor']);
const hasBody = (part) => BODIED.has(part.kind);

// The main processor: a large ball-grid package. Its balls sit under the body; the traces
// leave from fan-out points along its edges, as on a routed board.
function makeBga(x0, y0, n) {
  return { ...makeChip(x0, y0, n, n, true), kind: 'bga' };
}

// A power inductor: a big square body with one large pad either side.
function makeInductor(x0, y0, size) {
  const mid = y0 + Math.floor(size / 2);
  return {
    kind: 'inductor',
    x0,
    y0,
    x1: x0 + size,
    y1: y0 + size,
    sides: [{ out: [-1, 0], pins: [[x0 - 1, mid]] }, { out: [1, 0], pins: [[x0 + size + 1, mid]] }],
    label: '',
  };
}

// A row of through-hole header pins, two cells apart. Its traces can leave from either
// side of the row; each pin is still wired once.
function makeHeader(x0, y0, count, vertical) {
  const pins = [];
  for (let i = 0; i < count; i += 1) pins.push(vertical ? [x0, y0 + i * 2] : [x0 + i * 2, y0]);
  const [x1, y1] = pins[pins.length - 1];
  const sides = vertical
    ? [{ out: [-1, 0], pins }, { out: [1, 0], pins }]
    : [{ out: [0, -1], pins }, { out: [0, 1], pins }];
  return { kind: 'header', x0, y0, x1, y1, sides, label: '' };
}

// A two-pad resistor between `near` and `far` (two cells apart along `out`).
function makePassive(near, out) {
  const far = add(near, scale(out, 2));
  return {
    kind: 'passive',
    x0: Math.min(near[0], far[0]),
    y0: Math.min(near[1], far[1]),
    x1: Math.max(near[0], far[0]),
    y1: Math.max(near[1], far[1]),
    sides: [{ out: scale(out, -1), pins: [near] }, { out, pins: [far] }],
    label: '',
  };
}

const allPins = (part) => [...new Set(part.sides.flatMap((side) => side.pins))];
const centre = (part) => [(part.x0 + part.x1) / 2, (part.y0 + part.y1) / 2];

// Marks a part on the grid: its body (and body cells, so no diagonal cuts a corner), its
// pads, and each pin's first cell kept for that pin.
function claimPart(grid, part) {
  if (hasBody(part)) {
    for (let x = part.x0; x <= part.x1; x += 1) {
      for (let y = part.y0; y <= part.y1; y += 1) {
        grid.set(x, y, PART);
        grid.blockCell(x, y);
      }
    }
  } else {
    // Headers and resistors: the row itself, pads and the gaps between them.
    for (let x = part.x0; x <= part.x1; x += 1) {
      for (let y = part.y0; y <= part.y1; y += 1) grid.set(x, y, PART);
    }
  }
  for (const side of part.sides) {
    for (const pin of side.pins) {
      grid.set(pin[0], pin[1], PART);
      const [kx, ky] = add(pin, side.out);
      if (grid.get(kx, ky) === FREE) grid.set(kx, ky, KEEP);
    }
  }
}

// True when the box (x0, y0)-(x1, y1) and `pad` cells around it are free and on the board.
function spotIsFree(grid, x0, y0, x1, y1, pad) {
  for (let x = x0 - pad; x <= x1 + pad; x += 1) {
    for (let y = y0 - pad; y <= y1 + pad; y += 1) {
      if (!grid.onBoard(x, y) || grid.get(x, y) !== FREE) return false;
    }
  }
  return true;
}

// A random main or gap-filling part, placed at a random spot (not yet checked).
function randomPart(grid, small) {
  const roll = random();
  if (!small && roll < 0.18) {
    const count = randInt(4, 10);
    const vertical = random() < 0.5;
    const span = (count - 1) * 2;
    const x0 = randInt(3, grid.cols - (vertical ? 0 : span) - 3);
    const y0 = randInt(3, grid.rows - (vertical ? span : 0) - 3);
    return makeHeader(x0, y0, count, vertical);
  }
  // Small fillers are mostly tiny packages (SOT-style, 3 x 2), with a few small QFNs.
  if (small && roll < 0.4) {
    const [w, h] = random() < 0.5 ? [3, 2] : [2, 3];
    return makeChip(randInt(3, grid.cols - w - 3), randInt(3, grid.rows - h - 3), w, h, false);
  }
  const quad = roll < (small ? 0.75 : 0.6);
  let w = quad ? randInt(small ? 4 : 7, small ? 7 : 11) : randInt(small ? 4 : 6, small ? 7 : 12);
  let h = quad ? w : randInt(3, 4);
  if (!quad && random() < 0.4) [w, h] = [h, w];
  const x0 = randInt(3, grid.cols - w - 3);
  const y0 = randInt(3, grid.rows - h - 3);
  return makeChip(x0, y0, w, h, quad);
}

// ---------- Routing ----------

// The A* maze router: from one pin's first cell to another's, turning at most 45 degrees
// per step, with a cost for turning and a discount for running beside an existing trace.
// Its search arrays are allocated once per board and reused through a run stamp.
function makeRouter(grid) {
  const size = grid.point.length * 8;
  const cost = new Float32Array(size);
  const seen = new Uint32Array(size);
  const done = new Uint32Array(size);
  const prev = new Int32Array(size);
  const heapKey = [];
  const heapState = [];
  let run = 0;

  function push(key, state) {
    let i = heapKey.length;
    heapKey.push(key);
    heapState.push(state);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heapKey[parent] <= key) break;
      heapKey[i] = heapKey[parent];
      heapState[i] = heapState[parent];
      i = parent;
    }
    heapKey[i] = key;
    heapState[i] = state;
  }

  function pop() {
    const top = heapState[0];
    const key = heapKey.pop();
    const state = heapState.pop();
    const n = heapKey.length;
    if (n) {
      let i = 0;
      for (;;) {
        let child = i * 2 + 1;
        if (child >= n) break;
        if (child + 1 < n && heapKey[child + 1] < heapKey[child]) child += 1;
        if (heapKey[child] >= key) break;
        heapKey[i] = heapKey[child];
        heapState[i] = heapState[child];
        i = child;
      }
      heapKey[i] = key;
      heapState[i] = state;
    }
    return top;
  }

  const hugs = (x, y) => grid.get(x + 1, y) === WIRE || grid.get(x - 1, y) === WIRE
    || grid.get(x, y + 1) === WIRE || grid.get(x, y - 1) === WIRE;

  // Returns the grid points from pin `from` to pin `to`, or null. `budget` is a shared
  // counter object, spent as nodes are expanded.
  return function route(from, fromOut, to, toOut, budget) {
    const [sx, sy] = add(from, fromOut);
    const [gx, gy] = add(to, toOut);
    const usable = (v) => v === FREE || v === KEEP;
    if (!usable(grid.get(sx, sy)) || !usable(grid.get(gx, gy)) || (sx === gx && sy === gy)) return null;
    run += 1;
    heapKey.length = 0;
    heapState.length = 0;
    const startDir = dirIndex(fromOut);
    const lastDir = dirIndex(scale(toOut, -1));
    const reach = 24; // how far a trace may detour outside the box between its ends
    const minX = Math.max(0, Math.min(sx, gx) - reach);
    const maxX = Math.min(grid.cols, Math.max(sx, gx) + reach);
    const minY = Math.max(0, Math.min(sy, gy) - reach);
    const maxY = Math.min(grid.rows, Math.max(sy, gy) + reach);
    const guess = (x, y) => {
      const dx = Math.abs(x - gx);
      const dy = Math.abs(y - gy);
      return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 1.15;
    };
    const first = grid.at(sx, sy) * 8 + startDir;
    cost[first] = 0;
    seen[first] = run;
    prev[first] = -1;
    push(guess(sx, sy), first);
    let steps = 0;
    while (heapKey.length) {
      const state = pop();
      if (done[state] === run) continue;
      done[state] = run;
      const p = state >> 3;
      const d = state & 7;
      const x = (p % grid.width) - grid.margin;
      const y = Math.floor(p / grid.width) - grid.margin;
      const turnIn = (lastDir - d + 8) % 8;
      if (x === gx && y === gy && (turnIn === 0 || turnIn === 1 || turnIn === 7)) {
        const points = [to];
        for (let s = state; s !== -1; s = prev[s]) {
          const q = s >> 3;
          points.push([(q % grid.width) - grid.margin, Math.floor(q / grid.width) - grid.margin]);
        }
        points.push(from);
        // The search tracks direction as well as place, so a path can loop back over
        // itself in a tight spot: such a path is no use (a trace never touches itself).
        if (new Set(points.map((point) => `${point}`)).size !== points.length) return null;
        const cuts = [];
        for (let i = 1; i < points.length; i += 1) {
          const [ax, ay] = points[i - 1];
          const [bx, by] = points[i];
          if (ax !== bx && ay !== by) cuts.push(`${Math.min(ax, bx)},${Math.min(ay, by)}`);
        }
        if (new Set(cuts).size !== cuts.length) return null;
        return points.reverse();
      }
      steps += 1;
      budget.left -= 1;
      if (steps > ROUTE_STEPS || budget.left <= 0) return null;
      for (const t of [0, 1, 7]) {
        const nd = (d + t) & 7;
        const [dx, dy] = DIRS[nd];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const v = grid.get(nx, ny);
        if (!(v === FREE || (v === KEEP && nx === gx && ny === gy))) continue;
        if (dx && dy && grid.crossed(x, y, nx, ny)) continue;
        let step = dx && dy ? 1.414 : 1;
        if (t) step += 0.6;
        if (hugs(nx, ny)) step *= 0.72;
        const next = grid.at(nx, ny) * 8 + nd;
        const total = cost[state] + step;
        if (seen[next] === run && cost[next] <= total) continue;
        seen[next] = run;
        cost[next] = total;
        prev[next] = state;
        push(total + guess(nx, ny), next);
      }
    }
    return null;
  };
}

// Claims a laid trace's points (all but its two pins) and its diagonal crossings.
function claimTrace(grid, points) {
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = points[i - 1];
    const [nx, ny] = points[i];
    if (nx !== x && ny !== y) grid.cross(x, y, nx, ny);
    if (grid.get(nx, ny) !== PART) grid.set(nx, ny, WIRE);
  }
}

// Lays a trace along planned steps from a pin, stopping one step short of anything in
// the way (its own pin's kept cell is fine), or after its first step off the board.
function layTrace(grid, start, steps) {
  const points = [start];
  let [x, y] = start;
  let offBoard = false;
  for (let i = 0; i < steps.length; i += 1) {
    const [dx, dy] = steps[i];
    const nx = x + dx;
    const ny = y + dy;
    const v = grid.get(nx, ny);
    if (!(v === FREE || (v === KEEP && i === 0))) break;
    if (dx && dy && grid.crossed(x, y, nx, ny)) break;
    if (dx && dy) grid.cross(x, y, nx, ny);
    grid.set(nx, ny, WIRE);
    points.push([nx, ny]);
    x = nx;
    y = ny;
    if (!grid.onBoard(nx, ny)) {
      offBoard = true;
      break;
    }
  }
  return { points, offBoard };
}

// The steps every line of an escaping bus takes, all decided together so the lines stay
// parallel. starts: the pins, in order along the side; out: the direction they leave in.
function planBus(starts, out) {
  const lines = starts.map((pin) => ({ pos: pin, steps: [] }));
  let dir = out;
  let net = 0; // quarter turns away from "out"; kept within one either way
  const move = (line, d, n) => {
    for (let k = 0; k < n; k += 1) {
      line.steps.push(d);
      line.pos = add(line.pos, d);
    }
  };
  const straight = (n) => lines.forEach((line) => move(line, dir, n));
  // A 45 degree jog sideways and back: every line moves the same, so they stay parallel.
  const jog = (s, n) => {
    const diagonal = add(dir, turn90(dir, s));
    lines.forEach((line) => move(line, diagonal, n));
  };
  // A 90 degree turn as a staggered fan: the line furthest toward the turn bends first,
  // each line further out runs one more step before and after its bend, and the fronts
  // end level again.
  const turn = (s) => {
    const next = turn90(dir, s);
    const reach = lines.map((line) => dot(line.pos, next));
    const most = Math.max(...reach);
    const diagonal = add(dir, next);
    lines.forEach((line, i) => {
      const rank = most - reach[i];
      move(line, dir, rank);
      move(line, diagonal, 1);
      move(line, next, rank);
    });
    dir = next;
    net += s;
  };

  straight(randInt(2, 4));
  if (random() < 0.45) turn(sign());
  const runs = randInt(2, 4);
  for (let i = 0; i < runs; i += 1) {
    straight(randInt(4, 22));
    const roll = random();
    if (roll < 0.4) jog(sign(), randInt(1, 3));
    else if (roll < 0.6) turn(net === 0 ? sign() : -net);
  }
  straight(randInt(2, 8));
  // Stagger the vias every other line so they have room.
  lines.forEach((line, i) => move(line, dir, (i % 2) * 2));
  return lines.map((line) => line.steps);
}

// Drops the points where a trace runs straight on, leaving only its corners.
function corners(points) {
  return points.filter((point, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i + 1];
    return (point[0] - ax) !== (bx - point[0]) || (point[1] - ay) !== (by - point[1]);
  });
}

// ---------- The board ----------

// The whole board in grid units for a cols x rows grid: parts (chips, headers,
// resistors), traces (each from a pin of `chip`; `end` is the part it reaches, if any;
// `via` says whether it ends in a via), copper pours and mounting holes. A `seed` (a whole
// number) makes it repeatable: the page uses the session's seed, so every page draws the
// same board (a new boot, a new seed, a new board). `view` is the window's share of the
// board in cells, where the processor goes. Exported for tests/bg-circuit.test.mjs.
export function planBoard(cols, rows, partCount, seed = null, view = null) {
  random = seed === null ? Math.random : seeded(seed);
  try {
    return layOut(cols, rows, partCount, view);
  } finally {
    random = Math.random;
  }
}

function layOut(cols, rows, partCount, view) {
  const grid = makeGrid(cols, rows);
  const route = makeRouter(grid);
  const budget = { left: ROUTE_BUDGET };
  const parts = [];
  const traces = [];
  const pours = [];
  const holes = [];
  const wired = new Set(); // pins with a trace
  const labels = shuffle([...LABELS]);
  let chipNumber = 0;
  let headerNumber = 0;
  const keyOf = (pin) => `${pin}`;

  function addPart(part) {
    if (part.kind === 'bga') part.label = 'SoC';
    else if (part.kind === 'qfp') part.label = labels[parts.length % labels.length];
    else if (part.kind === 'soic') part.label = part.x1 - part.x0 <= 3 && part.y1 - part.y0 <= 3 ? `Q${(chipNumber += 1)}` : `U${(chipNumber += 1)}`;
    else if (part.kind === 'inductor') part.label = `L${(chipNumber += 1)}`;
    else if (part.kind === 'header') part.label = `J${(headerNumber += 1)}`;
    parts.push(part);
    claimPart(grid, part);
  }

  function addTrace(points, chip, end, via, bus) {
    const trace = { chip, end, points: corners(points), via };
    trace.bus = bus || [trace];
    if (!bus) traces.push(trace);
    wired.add(keyOf(points[0]));
    if (end) wired.add(keyOf(points[points.length - 1]));
    return trace;
  }

  // Runs of neighbouring pins on a side that have no wire yet.
  function freeRuns(side) {
    const runs = [];
    let current = [];
    for (const pin of side.pins) {
      if (wired.has(keyOf(pin))) {
        if (current.length) runs.push(current);
        current = [];
      } else current.push(pin);
    }
    if (current.length) runs.push(current);
    return runs;
  }

  // Wires part a to part b: their facing sides, pin to pin, as one bundle.
  function connect(a, b) {
    const toward = [centre(b)[0] - centre(a)[0], centre(b)[1] - centre(a)[1]];
    const back = scale(toward, -1);
    // The side facing the other part, or failing that one at right angles to it (its
    // traces then turn the corner); never one facing away.
    const best = (part, v) => {
      const unit = scale(v, 1 / (Math.hypot(v[0], v[1]) || 1));
      return part.sides
        .filter((side) => dot(side.out, unit) > -0.2 && freeRuns(side).length)
        .sort((s, t) => dot(t.out, unit) - dot(s.out, unit))[0];
    };
    const sideA = best(a, toward);
    const sideB = best(b, back);
    if (!sideA || !sideB) return;
    const runA = freeRuns(sideA).sort((r, s) => s.length - r.length)[0];
    const runB = freeRuns(sideB).sort((r, s) => s.length - r.length)[0];
    const count = Math.min(runA.length, runB.length, randInt(3, 12));
    const pick = (run) => {
      const from = randInt(0, run.length - count);
      return run.slice(from, from + count);
    };
    // Paired in order across the bundle, so the traces nest instead of crossing.
    const across = [-toward[1], toward[0]];
    const order = (pins) => pins.sort((p, q) => dot(p, across) - dot(q, across));
    const pinsA = order(pick(runA));
    const pinsB = order(pick(runB));
    const pairs = pinsA.map((pin, i) => [pin, pinsB[i]]);
    const length = ([p, q]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);
    pairs.sort((p, q) => length(p) - length(q));
    const bus = [];
    for (const [pa, pb] of pairs) {
      if (budget.left <= 0) break;
      const points = route(pa, sideA.out, pb, sideB.out, budget);
      if (!points) continue;
      claimTrace(grid, points);
      bus.push(addTrace(points, a, b, false, bus));
    }
    traces.push(...bus);
  }

  // Wires each of these parts to its nearest neighbours, nearest pairs first.
  function connectAll(group) {
    const pairs = [];
    const done = new Set();
    for (const a of group) {
      const near = parts
        .filter((b) => b !== a && b.kind !== 'passive')
        .map((b) => ({ b, d: Math.hypot(centre(b)[0] - centre(a)[0], centre(b)[1] - centre(a)[1]) }))
        .filter(({ d }) => d < NET_REACH)
        .sort((p, q) => p.d - q.d)
        .slice(0, NEIGHBOURS);
      for (const { b, d } of near) {
        const key = [parts.indexOf(a), parts.indexOf(b)].sort((p, q) => p - q).join();
        if (done.has(key)) continue;
        done.add(key);
        pairs.push({ a, b, d });
      }
    }
    pairs.sort((p, q) => p.d - q.d);
    for (const { a, b } of pairs) connect(a, b);
  }

  // A short escape stub from a pin to a via.
  function stub(part, pin, out) {
    const laid = layTrace(grid, pin, [out, out]);
    if (laid.points.length > 1) addTrace(laid.points, part, null, !laid.offBoard);
  }

  // Series resistors in front of every other pin of a run: pin to resistor, resistor to via.
  function resistors(part, run, out) {
    run.forEach((pin, i) => {
      if (i % 2) return;
      const gap = randInt(3, 4);
      const near = add(pin, scale(out, gap));
      const far = add(near, scale(out, 2));
      for (let k = 2; k <= gap + 3; k += 1) {
        const [x, y] = add(pin, scale(out, k));
        if (!grid.onBoard(x, y) || grid.get(x, y) !== FREE) return;
      }
      const passive = makePassive(near, out);
      parts.push(passive);
      claimPart(grid, passive);
      const lead = [pin];
      for (let k = 1; k <= gap; k += 1) lead.push(add(pin, scale(out, k)));
      claimTrace(grid, lead);
      addTrace(lead, part, passive, false);
      stub(passive, far, out);
    });
  }

  // A bus of the run's pins escaping off across the board.
  function escape(part, run, out) {
    const plans = planBus(run, out);
    const bus = [];
    run.forEach((pin, i) => {
      const laid = layTrace(grid, pin, plans[i]);
      if (laid.points.length > 1) bus.push(addTrace(laid.points, part, null, !laid.offBoard, bus));
    });
    traces.push(...bus);
  }

  // Whatever pins of these parts are still unwired.
  function finish(group) {
    for (const part of group) {
      for (const side of part.sides) {
        for (const run of freeRuns(side)) {
          const roll = random();
          if (part.kind !== 'header' && run.length >= 2 && roll < 0.3) resistors(part, run, side.out);
          else if (run.length >= 2 && roll < 0.65) escape(part, run, side.out);
          for (const pin of run) if (!wired.has(keyOf(pin))) stub(part, pin, side.out);
        }
      }
    }
  }

  // 1. The board's architecture first (owner request, October 14, 2026: realistic sizes
  // and layouts, a new one every boot): one large processor, its memory in a row beside
  // it, a block of identical chips repeated in a grid, connectors along the edges and a
  // power stage of inductors in a corner. Then ordinary chips, and later small fillers.
  const area = cols * rows;
  const place = (part, pad) => {
    if (part.x0 < 2 || part.y0 < 2 || part.x1 > cols - 2 || part.y1 > rows - 2) return null;
    if (!spotIsFree(grid, part.x0, part.y0, part.x1, part.y1, pad)) return null;
    addPart(part);
    return part;
  };
  const between = (lo, hi) => randInt(lo, Math.max(lo, hi));
  // The processor goes where it will be seen: inside the window's part of the board
  // (view, in grid cells) when that is known, not off in a corner of a larger screen.
  const seenCols = view ? Math.min(cols, Math.max(40, view.cols)) : cols;
  const seenRows = view ? Math.min(rows, Math.max(40, view.rows)) : rows;
  let cpu = null;
  for (let tries = 0; tries < 40 && !cpu; tries += 1) {
    const n = randInt(16, 22);
    if (n + 16 > cols || n + 16 > rows) break;
    cpu = place(makeBga(between(Math.round(seenCols * 0.15), Math.round(seenCols * 0.85) - n), between(Math.round(seenRows * 0.12), Math.round(seenRows * 0.88) - n), n), 6);
  }
  if (cpu) {
    // Memory: two to four identical chips side by side, a bus's width from the processor.
    const count = randInt(2, 4);
    const long = randInt(9, 13);
    const gap = randInt(7, 10);
    const pitch = randInt(9, 11); // room for both rows of pins and their escapes between chips
    for (const side of shuffle([0, 1, 2, 3])) {
      const chips = [];
      for (let i = 0; i < count; i += 1) {
        const horizontal = side < 2; // above or below: chips stand upright in a row
        const x0 = horizontal ? cpu.x0 + i * pitch : side === 2 ? cpu.x0 - gap - long : cpu.x1 + gap;
        const y0 = horizontal ? (side === 0 ? cpu.y0 - gap - long : cpu.y1 + gap) : cpu.y0 + i * pitch;
        chips.push(horizontal ? makeChip(x0, y0, 4, long, false) : makeChip(x0, y0, long, 4, false));
      }
      if (chips.every((chip) => chip.x0 >= 3 && chip.y0 >= 3 && chip.x1 <= cols - 3 && chip.y1 <= rows - 3
        && spotIsFree(grid, chip.x0, chip.y0, chip.x1, chip.y1, 2))) {
        for (const chip of chips) addPart(chip);
        break;
      }
    }
  }
  // A repeated block: identical small chips in a grid (the rows of identical modules on
  // a real board), somewhere still free.
  for (let tries = 0; tries < 30; tries += 1) {
    const n = randInt(5, 7);
    const pitch = n + randInt(7, 9);
    const across = randInt(3, 5);
    const down = randInt(2, 3);
    const w = (across - 1) * pitch + n;
    const h = (down - 1) * pitch + n;
    if (w + 8 > cols || h + 8 > rows) continue;
    const x0 = randInt(4, cols - w - 4);
    const y0 = randInt(4, rows - h - 4);
    if (!spotIsFree(grid, x0, y0, x0 + w, y0 + h, 3)) continue;
    for (let i = 0; i < across; i += 1) for (let j = 0; j < down; j += 1) addPart(makeChip(x0 + i * pitch, y0 + j * pitch, n, n, true));
    break;
  }
  // Connectors on the edges: long pin headers lying along them.
  const connectors = randInt(1, 3);
  for (let k = 0, made = 0; k < 40 && made < connectors; k += 1) {
    const count = randInt(8, 16);
    const span = (count - 1) * 2;
    const edge = randInt(0, 3);
    const vertical = edge >= 2;
    const x0 = vertical ? (edge === 2 ? 3 : cols - 3) : randInt(4, cols - span - 4);
    const y0 = vertical ? randInt(4, rows - span - 4) : (edge === 0 ? 3 : rows - 3);
    if (place(makeHeader(x0, y0, count, vertical), 2)) made += 1;
  }
  // The power stage: a few inductors in a row near a corner.
  for (let tries = 0; tries < 20; tries += 1) {
    const size = randInt(4, 6);
    const count = randInt(2, 4);
    const step = size + randInt(4, 6);
    const left = random() < 0.5;
    const top = random() < 0.5;
    const x0 = left ? randInt(4, Math.round(cols * 0.25)) : randInt(Math.round(cols * 0.6), Math.max(Math.round(cols * 0.6), cols - count * step - 4));
    const y0 = top ? randInt(4, Math.round(rows * 0.25)) : randInt(Math.round(rows * 0.7), Math.max(Math.round(rows * 0.7), rows - size - 4));
    const coils = Array.from({ length: count }, (_, i) => makeInductor(x0 + i * step, y0, size));
    if (!coils.every((coil) => coil.x1 <= cols - 4 && coil.y1 <= rows - 4 && spotIsFree(grid, coil.x0 - 2, coil.y0, coil.x1 + 2, coil.y1, 2))) continue;
    for (const coil of coils) addPart(coil);
    break;
  }

  // 2. Ordinary chips up to the board's count, then everything wired, then leftover pins.
  for (let attempt = 0; attempt < partCount * 40 && parts.length < partCount; attempt += 1) {
    const part = randomPart(grid, false);
    if (spotIsFree(grid, part.x0, part.y0, part.x1, part.y1, PART_CLEARANCE)) addPart(part);
  }
  connectAll(parts.slice());
  finish(parts.slice());

  // 3: smaller chips in the gaps, each wired as it lands.
  for (let attempt = 0; attempt < area / 8; attempt += 1) {
    const part = randomPart(grid, true);
    if (!spotIsFree(grid, part.x0, part.y0, part.x1, part.y1, 3)) continue;
    addPart(part);
    connectAll([part]);
    finish([part]);
  }

  // Release the kept cells nobody used, then mounting holes and copper pours.
  for (let i = 0; i < grid.point.length; i += 1) if (grid.point[i] === KEEP) grid.point[i] = FREE;
  for (let attempt = 0; attempt < 200 && holes.length < Math.max(2, Math.round(area / 5000)); attempt += 1) {
    const x = randInt(4, cols - 4);
    const y = randInt(4, rows - 4);
    if (!spotIsFree(grid, x - 2, y - 2, x + 2, y + 2, 1)) continue;
    holes.push([x, y]);
    for (let hx = x - 2; hx <= x + 2; hx += 1) for (let hy = y - 2; hy <= y + 2; hy += 1) grid.set(hx, hy, POUR);
  }
  // Copper pour: every free point at least a cell clear of everything else, as one
  // sheet around the parts and traces; specks too small to read as copper stay bare.
  // Stitching vias sit on a regular grid inside it.
  const inPour = new Uint8Array(grid.point.length);
  const clear = (x, y) => {
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) if (grid.get(x + dx, y + dy) !== FREE) return false;
    return true;
  };
  for (let x = 0; x <= cols; x += 1) for (let y = 0; y <= rows; y += 1) if (clear(x, y)) inPour[grid.at(x, y)] = 1;
  const stitches = [];
  for (let x = 0; x <= cols; x += 1) {
    for (let y = 0; y <= rows; y += 1) {
      if (inPour[grid.at(x, y)] !== 1) continue;
      // Flood the island, then keep it only if it is big enough.
      const island = [[x, y]];
      inPour[grid.at(x, y)] = 2;
      for (let i = 0; i < island.length; i += 1) {
        const [ix, iy] = island[i];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (grid.onBoard(nx, ny) && inPour[grid.at(nx, ny)] === 1) {
            inPour[grid.at(nx, ny)] = 2;
            island.push([nx, ny]);
          }
        }
      }
      if (island.length < 16) continue;
      for (const [ix, iy] of island) inPour[grid.at(ix, iy)] = 3;
      pours.push(...island);
    }
  }
  for (const [x, y] of pours) grid.set(x, y, POUR);
  // Where the pour's edge steps along a 45 degree trace, fill half of each notch so the
  // edge runs straight along the trace instead of in stairs. Every triangle winds the
  // same way as the pour's squares, so they all fill as one shape.
  const poured = (x, y) => grid.onBoard(x, y) && inPour[grid.at(x, y)] === 3;
  const chamfers = [];
  for (let x = 0; x <= cols; x += 1) {
    for (let y = 0; y <= rows; y += 1) {
      if (poured(x, y)) continue;
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
          if (!poured(x + a, y) || !poured(x, y + b)) continue;
          const tri = [[x + a / 2, y + b / 2], [x + a / 2, y - b / 2], [x - a / 2, y + b / 2]];
          const [[x1, y1], [x2, y2], [x3, y3]] = tri;
          if ((x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1) < 0) tri.reverse();
          chamfers.push(tri);
        }
      }
    }
  }
  for (const [x, y] of pours) {
    if (x % 4 || y % 4) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => grid.get(x + dx, y + dy) === POUR)) stitches.push([x, y]);
  }

  // No bare pads: a pin with no wire loses its pad; a part left with no pins is dropped.
  for (const part of parts) {
    for (const side of part.sides) side.pins = side.pins.filter((pin) => wired.has(keyOf(pin)));
  }
  const kept = parts.filter((part) => part.sides.some((side) => side.pins.length));
  // About a third of the buses (and lone stubs) run in violet, the rest in teal.
  const tones = new Map();
  for (const trace of traces) {
    if (!tones.has(trace.bus)) tones.set(trace.bus, random() < VIOLET_SHARE ? 'violet' : 'teal');
    trace.tone = tones.get(trace.bus);
    // What the line carries, for its pulses' colour: power to and from the inductors,
    // control through the resistors (pull-ups, enables, status), data everywhere else.
    const touches = (kind) => trace.chip.kind === kind || (trace.end && trace.end.kind === kind);
    trace.signal = touches('inductor') ? 'power' : touches('passive') ? 'control' : 'data';
  }
  return { chips: kept, traces, pours, chamfers, stitches, holes };
}

// ---------- Drawing and pulses ----------

// A trace in pixels, with the cumulative length at each corner for placing pulses.
function toPixels(trace) {
  const points = trace.points.map(([x, y]) => [x * CELL, y * CELL]);
  const at = [0];
  for (let i = 1; i < points.length; i += 1) {
    at.push(at[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  // Its top-left corner, to tell whether any of it is in view (the window is never
  // offset into the board, so only the near edges matter).
  const minX = Math.min(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1]));
  return { ...trace, points, at, length: at[at.length - 1], minX, minY };
}

function pointAt(trace, distance) {
  const d = Math.max(0, Math.min(trace.length, distance));
  let i = 1;
  while (i < trace.at.length - 1 && trace.at[i] < d) i += 1;
  const [x0, y0] = trace.points[i - 1];
  const [x1, y1] = trace.points[i];
  const span = trace.at[i] - trace.at[i - 1] || 1;
  const t = (d - trace.at[i - 1]) / span;
  return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
}

// The outline a part glows along when a pulse reaches it, in pixels.
function outline(part) {
  const grow = hasBody(part) ? 0 : CELL * 0.6;
  return [part.x0 * CELL - grow, part.y0 * CELL - grow, (part.x1 - part.x0) * CELL + grow * 2, (part.y1 - part.y0) * CELL + grow * 2];
}

function drawPart(b, part) {
  if (part.kind === 'header') {
    const [x, y, w, h] = outline(part);
    b.strokeStyle = `rgba(${INK.path}, 0.45)`;
    b.lineWidth = 1;
    b.strokeRect(x - 2, y - 2, w + 4, h + 4);
    b.fillStyle = `rgba(${INK.path}, 0.75)`;
    b.fillText(part.label, x + w / 2, y - 9);
    b.lineWidth = 1.6;
    b.strokeStyle = `rgba(${INK.ring}, 0.6)`;
    allPins(part).forEach(([px, py], i) => {
      b.beginPath();
      if (i === 0) b.rect(px * CELL - 3.5, py * CELL - 3.5, 7, 7);
      else b.arc(px * CELL, py * CELL, 3.6, 0, Math.PI * 2);
      b.stroke();
    });
    return;
  }
  if (part.kind === 'passive') {
    // Two pads with the part's body between them.
    b.fillStyle = `rgba(${INK.path}, 0.75)`;
    for (const [px, py] of allPins(part)) b.fillRect(px * CELL - 3, py * CELL - 3, 6, 6);
    const mx = ((part.x0 + part.x1) / 2) * CELL;
    const my = ((part.y0 + part.y1) / 2) * CELL;
    const [bw, bh] = part.y0 === part.y1 ? [10, 7] : [7, 10];
    b.strokeStyle = `rgba(${INK.path}, 0.6)`;
    b.lineWidth = 1;
    b.strokeRect(mx - bw / 2, my - bh / 2, bw, bh);
    return;
  }
  const x = part.x0 * CELL;
  const y = part.y0 * CELL;
  const w = (part.x1 - part.x0) * CELL;
  const h = (part.y1 - part.y0) * CELL;
  if (part.kind === 'inductor') {
    // A shielded power inductor: a square body, a ring for the winding, two big pads.
    b.fillStyle = `rgba(${INK.board}, 0.7)`;
    b.fillRect(x, y, w, h);
    b.strokeStyle = `rgba(${INK.path}, 0.7)`;
    b.lineWidth = 1.2;
    b.strokeRect(x, y, w, h);
    b.beginPath();
    b.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.32, 0, Math.PI * 2);
    b.stroke();
    b.fillStyle = `rgba(${INK.path}, 0.8)`;
    for (const [px, py] of allPins(part)) b.fillRect(px * CELL - 4, py * CELL - 7, 8, 14);
    b.fillStyle = `rgba(${INK.path}, 0.75)`;
    b.fillText(part.label, x + w / 2, y - 9);
    return;
  }
  if (part.kind === 'bga') {
    // The processor: its ball grid under the body, fan-out vias where traces leave it.
    b.fillStyle = `rgba(${INK.board}, 0.7)`;
    b.fillRect(x, y, w, h);
    b.strokeStyle = `rgba(${INK.path}, 0.75)`;
    b.lineWidth = 1.4;
    b.strokeRect(x, y, w, h);
    b.fillStyle = `rgba(${INK.path}, 0.4)`;
    for (let bx = x + CELL; bx < x + w - 2; bx += CELL) {
      for (let by = y + CELL; by < y + h - 2; by += CELL) {
        b.beginPath();
        b.arc(bx, by, 1.6, 0, Math.PI * 2);
        b.fill();
      }
    }
    b.fillStyle = `rgba(${INK.board}, 0.95)`;
    b.fillRect(x + w * 0.3, y + h * 0.42, w * 0.4, h * 0.16);
    b.fillStyle = `rgba(${INK.path}, 0.85)`;
    b.fillText(part.label, x + w / 2, y + h / 2);
    b.strokeStyle = `rgba(${INK.path}, 0.75)`;
    b.lineWidth = 1;
    for (const side of part.sides) {
      for (const [px, py] of side.pins) {
        b.beginPath();
        b.arc(px * CELL - side.out[0] * CELL * 0.5, py * CELL - side.out[1] * CELL * 0.5, 1.8, 0, Math.PI * 2);
        b.stroke();
      }
    }
    // Pin one's corner mark.
    b.beginPath();
    b.moveTo(x, y + 12);
    b.lineTo(x, y);
    b.lineTo(x + 12, y);
    b.lineWidth = 2;
    b.stroke();
    return;
  }
  b.fillStyle = `rgba(${INK.board}, 0.55)`;
  b.fillRect(x, y, w, h);
  b.strokeStyle = `rgba(${INK.path}, 0.7)`;
  b.lineWidth = 1.2;
  b.strokeRect(x, y, w, h);
  b.fillStyle = `rgba(${INK.path}, 0.75)`;
  for (const side of part.sides) {
    for (const [px, py] of side.pins) {
      // A pad from the body edge out to the pin point, where its trace starts.
      const cx = px * CELL - side.out[0] * CELL * 0.5;
      const cy = py * CELL - side.out[1] * CELL * 0.5;
      const [pw, ph] = side.out[0] ? [CELL, 4] : [4, CELL];
      b.fillRect(cx - pw / 2, cy - ph / 2, pw, ph);
    }
  }
  b.beginPath();
  b.arc(x + 6, y + 6, 1.8, 0, Math.PI * 2);
  b.fill();
  if (part.kind === 'qfp') {
    // The exposed thermal pad under a quad package, with its via array.
    const inset = Math.round(w * 0.28);
    b.fillStyle = `rgba(${INK.board}, 0.8)`;
    b.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
    b.fillStyle = `rgba(${INK.path}, 0.55)`;
    for (let i = 1; i <= 3; i += 1) {
      for (let j = 1; j <= 3; j += 1) {
        b.beginPath();
        b.arc(x + inset + ((w - inset * 2) * i) / 4, y + inset + ((h - inset * 2) * j) / 4, 1.3, 0, Math.PI * 2);
        b.fill();
      }
    }
  }
  b.fillStyle = `rgba(${INK.path}, 0.75)`;
  b.fillText(part.label, x + w / 2, part.kind === 'qfp' ? y + h * 0.14 + 4 : y + h / 2);
}

// ---------- Traffic ----------

// Data moving between parts over the nets they share (owner request, October 14, 2026:
// a busier board whose flow follows realistic logic). A link is one bundle of traces
// between two parts. The rules, which tests/bg-circuit.test.mjs holds us to:
//   - Data only travels along a net, from one part to the part at its other end.
//   - A transfer is a word on the bus: some of the bundle's lines at once, at one speed.
//     It has arrived when its last line lands (longer lines arrive later, as skew does).
//   - The part it reaches lights up, and a moment later usually acts on it: it answers
//     back on the same bus now and then, otherwise passes data on over one of its other
//     nets. So activity spreads as chains of cause and effect, never jumping between
//     parts that are not wired together. A chain ends at random or after MAX_HOPS.
//   - New chains start on links in view, enough to keep `target` chains going.
//   - Every bus gets its turn (owner request, October 14, 2026: some wires hardly ever
//     lit): a new chain starts on the link in view that has gone longest without data,
//     and a part passing data on picks the bus it has used least lately, the way a
//     controller round-robins its ports. A little jitter keeps it from looking like a
//     sweep.
//   - kick(part) starts a chain at a part, for input arriving on one of its other lines
//     (makeAmbient). It only stands in for a new chain, so the board gets no busier.
// Exported for tests; it uses no DOM.
export function makeTraffic(links, { target = 8, visible = () => true, maxPulses = MAX_PULSES } = {}) {
  const byPart = new Map();
  for (const link of links) {
    for (const [part, forward] of [[link.a, true], [link.b, false]]) {
      if (!byPart.has(part)) byPart.set(part, []);
      byPart.get(part).push({ link, forward });
    }
  }
  const pulses = [];
  const queue = [];
  const log = [];
  let clock = 0;
  let active = 0; // transfers on the wire, plus parts about to act
  // When each link last carried data; never-used links start slightly apart, at random.
  const lastSent = new Map(links.map((link) => [link, -1 - random()]));
  const staleness = (link) => (lastSent.get(link) ?? 0) + random() * 0.6;
  // The longest-unused of these links (in view, if any are); null for none.
  function stalest(list) {
    let best = null;
    let bestSeen = false;
    let bestAge = Infinity;
    for (const link of list) {
      const seen = visible(link);
      if (bestSeen && !seen) continue;
      const age = staleness(link);
      if ((seen && !bestSeen) || age < bestAge) {
        best = link;
        bestSeen = seen;
        bestAge = age;
      }
    }
    return best;
  }

  function send(link, forward, hops, color, cause) {
    // Data takes the colour of the bus it rides: cyan on teal, lavender on violet.
    if (link.lines[0] && link.lines[0].tone) color = toneColour(link.lines[0]);
    let lines = link.lines.filter(() => random() < 0.7);
    if (!lines.length) lines = [link.lines[Math.floor(random() * link.lines.length)]];
    const transfer = { from: forward ? link.a : link.b, to: forward ? link.b : link.a, link, hops, color, cause, left: lines.length };
    const speed = rand(170, 250);
    for (const trace of lines) pulses.push({ trace, d: 0, speed, color, inward: !forward, transfer });
    log.push(transfer);
    if (log.length > 400) log.shift();
    lastSent.set(link, clock);
    active += 1;
  }

  function act({ part, came, hops, color, cause }) {
    const options = byPart.get(part) || [];
    if (!options.length) return;
    const others = options.filter((o) => o.link !== came);
    const back = options.find((o) => o.link === came);
    const onward = stalest(others.map((o) => o.link));
    const pick = !others.length || (back && random() < REPLY_CHANCE)
      ? back
      : others.find((o) => o.link === onward);
    if (pick) send(pick.link, pick.forward, hops, color, cause);
  }

  return {
    pulses,
    log,
    // Moves everything on by dt seconds; returns the parts data reached, with its colour.
    tick(dt) {
      clock += dt;
      const reached = [];
      for (const pulse of pulses) pulse.d += pulse.speed * dt;
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i];
        if (pulse.d < pulse.trace.length + TAIL * TAIL_GAP) continue;
        pulses.splice(i, 1);
        const { transfer } = pulse;
        transfer.left -= 1;
        if (transfer.left) continue;
        active -= 1;
        reached.push({ part: transfer.to, color: transfer.color });
        if (transfer.hops < MAX_HOPS && random() < CARRY_ON) {
          queue.push({ at: clock + rand(0.06, 0.3), part: transfer.to, came: transfer.link, hops: transfer.hops + 1, color: transfer.color, cause: transfer });
          active += 1;
        }
      }
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i].at > clock) continue;
        const [due] = queue.splice(i, 1);
        active -= 1;
        if (pulses.length < maxPulses) act(due);
      }
      if (active < target && pulses.length < maxPulses && links.length) {
        const fresh = stalest(links);
        send(fresh, random() < 0.5, 0, toneColour(fresh.lines[0]), null);
      }
      return reached;
    },
    kick(part) {
      if (active < target && pulses.length < maxPulses) act({ part, came: null, hops: 0, color: COLORS[0], cause: null });
    },
    // What is on the wire, as plain numbers (owner request, October 14, 2026: the pulses
    // keep their places from page to page). Links are named by index, so this only makes
    // sense on the same board (the session seed and size; startCircuit checks).
    //   t: [link, forward 0/1, hops, colour, speed, [[line, distance], ...]] per transfer
    //   q: [link it came by, at that link's b end 0/1, due in ms, hops, colour] per part
    //      about to act
    snapshot() {
      const index = new Map(links.map((link, i) => [link, i]));
      const groups = new Map();
      for (const pulse of pulses) {
        if (!groups.has(pulse.transfer)) groups.set(pulse.transfer, { speed: pulse.speed, lines: [] });
        groups.get(pulse.transfer).lines.push([pulse.transfer.link.lines.indexOf(pulse.trace), Math.round(pulse.d)]);
      }
      return {
        t: [...groups].map(([transfer, group]) => [index.get(transfer.link), transfer.from === transfer.link.a ? 1 : 0,
          transfer.hops, COLORS.indexOf(transfer.color), Math.round(group.speed), group.lines]),
        q: queue.map((due) => [index.get(due.came), due.part === due.came.b ? 1 : 0,
          Math.max(0, Math.round((due.at - clock) * 1000)), due.hops, COLORS.indexOf(due.color)]),
      };
    },
    // Puts a snapshot back, checking every value first (it comes back from storage as
    // untrusted): anything out of range is skipped. The chains carry on from where they
    // were; what caused them is not kept.
    restore(data) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!data || !Array.isArray(data.t) || !Array.isArray(data.q)) return;
      for (const entry of data.t.slice(0, maxPulses)) {
        if (!Array.isArray(entry) || entry.length !== 6) continue;
        const [li, forward, hops, colour, speed, lines] = entry;
        if (!int(li, 0, links.length - 1) || !int(forward, 0, 1) || !int(hops, 0, MAX_HOPS) || !int(colour, 0, COLORS.length - 1)
          || !int(speed, 100, 300) || !Array.isArray(lines) || !lines.length) continue;
        const link = links[li];
        const placed = lines.filter((line) => Array.isArray(line) && line.length === 2 && int(line[0], 0, link.lines.length - 1)
          && int(line[1], 0, Math.ceil(link.lines[line[0]].length) + TAIL * TAIL_GAP));
        if (!placed.length || pulses.length + placed.length > maxPulses) continue;
        const transfer = { from: forward ? link.a : link.b, to: forward ? link.b : link.a, link, hops, color: COLORS[colour], cause: null, left: placed.length };
        for (const [line, d] of placed) pulses.push({ trace: link.lines[line], d, speed, color: transfer.color, inward: !forward, transfer });
        active += 1;
      }
      for (const entry of data.q.slice(0, 200)) {
        if (!Array.isArray(entry) || entry.length !== 5) continue;
        const [li, atB, ms, hops, colour] = entry;
        if (!int(li, 0, links.length - 1) || !int(atB, 0, 1) || !int(ms, 0, 1000) || !int(hops, 0, MAX_HOPS) || !int(colour, 0, COLORS.length - 1)) continue;
        const came = links[li];
        queue.push({ at: clock + ms / 1000, part: atB ? came.b : came.a, came, hops, color: COLORS[colour], cause: null });
        active += 1;
      }
    },
  };
}

// The other lines: stubs down to vias, resistor lines and buses escaping to the board's
// edge, which are most of the wires on the board (owner request, October 14, 2026: every
// wire should light up now and then, with some logic to it, without crowding the board).
// The rules, which tests/bg-circuit.test.mjs holds us to:
//   - Each part works through its own such lines in a fixed order on a slow cycle of its
//     own (AMBIENT_CYCLE seconds), the way a chip polls its I/O. So every line lights
//     once a cycle, and the parts stay out of step with each other.
//   - A bundle goes as one word, all its lines together.
//   - Lines out of view are passed over at once, so a part's cycle covers only what is
//     in view, and a smaller window sees each line more often.
//   - The pulses are quick, short blips, so lighting every line often stays calm.
//   - Most signals go out from the part; some come in, and the part lights up as they
//     land. Data reaching a part over a net (poke) makes it drive its next line soon, so
//     the quiet lines answer the traffic.
//   - At most `cap` pulses at once. A line whose turn comes with no room waits for room
//     instead of being skipped, so none is left dark.
// Exported for tests; it uses no DOM. `visible` takes one trace.
export function makeAmbient(quiet, { visible = () => true, cap = MAX_AMBIENT } = {}) {
  const pulses = [];
  const index = new Map(quiet.map((trace, i) => [trace, i]));
  // Bundles: a trace's bus, keeping only its quiet lines, named by the first of them.
  const bundles = new Map();
  for (const trace of quiet) {
    const lines = (trace.bus && trace.bus.length ? trace.bus : [trace]).filter((t) => index.has(t));
    const key = lines[0] || trace;
    if (!bundles.has(key)) bundles.set(key, { part: trace.chip, lines: lines.length ? lines : [trace] });
  }
  // Each part's round: its bundles in a fixed, shuffled order, one every `step` seconds.
  const rounds = new Map();
  for (const bundle of bundles.values()) {
    if (!rounds.has(bundle.part)) rounds.set(bundle.part, []);
    rounds.get(bundle.part).push(bundle);
  }
  let clock = 0;
  const parts = [...rounds].map(([part, list]) => {
    const step = rand(AMBIENT_CYCLE[0], AMBIENT_CYCLE[1]) / list.length;
    return { part, list: shuffle(list), next: Math.floor(random() * list.length), step, at: random() * step, last: -Infinity };
  });
  const byPart = new Map(parts.map((p) => [p.part, p]));
  let holding = null; // the part waiting for room, if any

  // One turn of a part's round; false when it has to wait.
  function turn(p) {
    // Its next line in view, passing over the rest; none in view: look again shortly.
    let bundle = null;
    for (let k = 0; k < p.list.length && !bundle; k += 1) {
      if (p.list[p.next].lines.some(visible)) bundle = p.list[p.next];
      else p.next = (p.next + 1) % p.list.length;
    }
    if (!bundle) {
      p.at = clock + 1;
      return false;
    }
    // Wait for room (a bundle bigger than the cap still goes once the board is clear).
    // The first part kept waiting goes before any other, so a wide bus is never starved
    // by a stream of single lines slipping into the gaps.
    if (holding && holding !== p) return false;
    if (pulses.length && pulses.length + bundle.lines.length > cap) {
      holding = p;
      return false;
    }
    holding = null;
    fire(bundle);
    p.last = clock;
    p.next = (p.next + 1) % p.list.length;
    // A part that fell behind (a hidden tab, a long wait for room) catches up by one turn
    // at most, so it never bursts.
    p.at = Math.max(p.at, clock - p.step) + p.step * rand(0.8, 1.2);
    return true;
  }

  function fire(bundle) {
    const speed = rand(160, 240);
    const color = toneColour(bundle.lines[0]);
    const inward = random() < 0.3;
    for (const trace of bundle.lines) pulses.push({ trace, d: 0, speed, color, inward, tail: AMBIENT_TAIL });
  }

  return {
    pulses,
    // Moves everything on by dt seconds; returns where signals landed: { part, color,
    // inward } for a part, or { x, y, color } for a via.
    tick(dt) {
      clock += dt;
      const landed = [];
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i];
        pulse.d += pulse.speed * dt;
        if (pulse.d < pulse.trace.length + AMBIENT_TAIL * TAIL_GAP) continue;
        pulses.splice(i, 1);
        const { trace, color } = pulse;
        if (pulse.inward) landed.push({ part: trace.chip, color, inward: true });
        else if (trace.end) landed.push({ part: trace.end, color, inward: false });
        else if (trace.via) {
          const [x, y] = trace.points[trace.points.length - 1];
          landed.push({ x, y, color });
        }
      }
      // A part with many lines (the processor's fan-out) can be due more than once in a
      // frame; it takes up to TURNS_PER_TICK turns, so its cycle keeps time.
      for (const p of parts) {
        for (let turns = 0; turns < TURNS_PER_TICK && p.at <= clock; turns += 1) {
          if (!turn(p)) break;
        }
      }
      return landed;
    },
    // Data reached this part: it drives its next line shortly, unless it just did.
    poke(part) {
      const p = byPart.get(part);
      if (p && clock - p.last > 1) p.at = Math.min(p.at, clock + rand(0.05, 0.25));
    },
    // As in makeTraffic, plain numbers: [line, distance, speed, colour, inward 0/1] per
    // pulse, lines named by their index in `quiet`.
    snapshot() {
      return pulses.map((p) => [index.get(p.trace), Math.round(p.d), Math.round(p.speed), COLORS.indexOf(p.color), p.inward ? 1 : 0]);
    },
    // Checks every value first (it comes back from storage as untrusted).
    restore(data) {
      const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
      if (!Array.isArray(data)) return;
      for (const entry of data.slice(0, cap)) {
        if (!Array.isArray(entry) || entry.length !== 5 || pulses.length >= cap) continue;
        const [ti, d, speed, colour, inward] = entry;
        if (!int(ti, 0, quiet.length - 1) || !int(speed, 100, 300) || !int(colour, 0, COLORS.length - 1) || !int(inward, 0, 1)) continue;
        if (!int(d, 0, Math.ceil(quiet[ti].length) + AMBIENT_TAIL * TAIL_GAP)) continue;
        pulses.push({ trace: quiet[ti], d, speed, color: COLORS[colour], inward: inward === 1, tail: AMBIENT_TAIL });
      }
    },
  };
}

export function startCircuit({ still = false, resume = false } = {}) {
  return startCanvas({
    className: 'bg-circuit',
    still,
    resume,
    scene: (context) => {
      const board = el('canvas');
      const boardContext = board.getContext('2d');
      let width = 0;
      let height = 0;
      let chips = [];
      let traces = [];
      let pours = [];
      let stitches = [];
      let chamfers = [];
      let holes = [];
      let flashes = [];
      let traffic = makeTraffic([]);
      let ambient = makeAmbient([]); // stubs, resistors and escaping buses
      let quiet = []; // traces that are not part-to-part nets
      // The board is planned for the whole screen, not just the window (owner report,
      // October 14, 2026: resizing redrew a new random board on every resize event, so it
      // flickered). Resizing within it only shows more or less of the same board; a window
      // bigger than the board, or a new zoom level, re-plans it once resizing settles.
      let boardW = 0;
      let boardH = 0;
      let boardRatio = 0;
      let rebuild = 0;
      let redraw = () => {};
      let seed = 0;
      let firstPending = false;

      function drawBoard() {
        const ratio = boardRatio;
        board.width = Math.floor(boardW * ratio);
        board.height = Math.floor(boardH * ratio);
        const b = boardContext;
        b.setTransform(ratio, 0, 0, ratio, 0, 0);
        b.lineJoin = 'round';
        b.lineCap = 'round';
        // The page colour under everything, so the canvas is opaque: during a page slide
        // the new page's live board sits over the old page's picture of it and covers it
        // the moment it is drawn, with nothing to blend (layer1.css, "Desktop transitions").
        const page = getComputedStyle(document.body).backgroundColor;
        b.fillStyle = page && !/rgba\(.*,\s*0\)$/.test(page) && page !== 'transparent' ? page : '#0a0c0e';
        b.fillRect(0, 0, boardW, boardH);
        // Copper pour: one faint sheet (each pour point fills its cell, so neighbours join
        // up), filled once so overlaps never double up, with its stitching vias.
        b.beginPath();
        for (const [x, y] of pours) b.rect(x * CELL - CELL / 2, y * CELL - CELL / 2, CELL, CELL);
        for (const tri of chamfers) {
          tri.forEach(([x, y], i) => (i ? b.lineTo(x * CELL, y * CELL) : b.moveTo(x * CELL, y * CELL)));
          b.closePath();
        }
        b.fillStyle = `rgba(${INK.pour}, 0.32)`;
        b.fill();
        b.strokeStyle = `rgba(${INK.gold}, 0.42)`;
        b.lineWidth = 1;
        for (const [x, y] of stitches) {
          b.beginPath();
          b.arc(x * CELL, y * CELL, 1.7, 0, Math.PI * 2);
          b.stroke();
        }
        // Mounting holes.
        for (const [hx, hy] of holes) {
          b.strokeStyle = `rgba(${INK.ring}, 0.5)`;
          b.lineWidth = 1.2;
          b.beginPath();
          b.arc(hx * CELL, hy * CELL, CELL * 1.9, 0, Math.PI * 2);
          b.stroke();
          b.beginPath();
          b.arc(hx * CELL, hy * CELL, CELL * 1.1, 0, Math.PI * 2);
          b.stroke();
          b.fillStyle = `rgba(${INK.ring}, 0.5)`;
          for (let k = 0; k < 8; k += 1) {
            const a = (k / 8) * Math.PI * 2;
            b.beginPath();
            b.arc(hx * CELL + Math.cos(a) * CELL * 1.5, hy * CELL + Math.sin(a) * CELL * 1.5, 1.1, 0, Math.PI * 2);
            b.fill();
          }
        }
        // Traces, teal then violet, and the vias where they end (purple rings on violet).
        b.lineWidth = 1.2;
        for (const [tone, ink] of [['teal', `rgba(${INK.path}, 0.55)`], ['violet', `rgba(${INK.violet}, 0.95)`]]) {
          b.strokeStyle = ink;
          b.beginPath();
          for (const trace of traces) {
            if (trace.tone !== tone) continue;
            trace.points.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
          }
          b.stroke();
        }
        b.lineWidth = 1.1;
        for (const trace of traces) {
          if (!trace.via) continue;
          const [x, y] = trace.points[trace.points.length - 1];
          b.strokeStyle = trace.tone === 'violet' ? `rgba(${INK.ring}, 0.7)` : `rgba(${INK.path}, 0.8)`;
          b.beginPath();
          b.arc(x, y, 2.4, 0, Math.PI * 2);
          b.stroke();
        }
        // Parts.
        b.font = '9px ui-monospace, Consolas, monospace';
        b.textAlign = 'center';
        b.textBaseline = 'middle';
        for (const part of chips) drawPart(b, part);
      }


      function build() {
        rebuild = 0;
        const screen = window.screen || {};
        boardW = Math.max(width, screen.width || 0);
        boardH = Math.max(height, screen.height || 0);
        boardRatio = Math.min(window.devicePixelRatio || 1, 2);
        const count = Math.max(MIN_PARTS, Math.min(MAX_PARTS, Math.round((boardW * boardH) / AREA_PER_PART)));
        seed = sessionSeed();
        const plan = planBoard(Math.ceil(boardW / CELL), Math.ceil(boardH / CELL), count, seed, { cols: Math.ceil(width / CELL), rows: Math.ceil(height / CELL) });
        chips = plan.chips;
        pours = plan.pours;
        stitches = plan.stitches;
        chamfers = plan.chamfers;
        holes = plan.holes;
        traces = plan.traces.map(toPixels);
        // Each trace's bundle, in pixels.
        const byPlan = new Map(plan.traces.map((trace, i) => [trace, traces[i]]));
        traces.forEach((trace) => { trace.bus = trace.bus.map((t) => byPlan.get(t)).filter(Boolean); });
        // The links between parts (resistors excepted) carry the data; the rest is ambient.
        const links = new Map();
        plan.traces.forEach((trace, i) => {
          if (!trace.end || trace.end.kind === 'passive') return;
          if (!links.has(trace.bus)) links.set(trace.bus, { a: trace.chip, b: trace.end, lines: [] });
          links.get(trace.bus).lines.push(traces[i]);
        });
        const all = [...links.values()];
        const seen = (link) => link.lines.some(inView);
        const netsInView = all.filter(seen).length;
        // About two chains of transfers going for every three nets in view: busy, with room
        // left for the quiet lines (makeAmbient) to show.
        traffic = makeTraffic(all, { target: Math.max(5, Math.min(24, Math.round(netsInView * 0.65))), visible: seen });
        quiet = traces.filter((trace) => !trace.end || trace.end.kind === 'passive');
        ambient = makeAmbient(quiet, { visible: inView });
        flashes = [];
        drawBoard();
        restorePulses();
      }

      // The pulses carry over from page to page (owner request, October 14, 2026): saved
      // as the page is left (pageswap, just before the slide's picture is taken, or
      // pagehide) and put back on the next page's identical board, so they pick up where
      // they stopped. Only for the same seed and board size; a refresh or reboot clears
      // them with the seed (ui/terminal-ui.js).
      function savePulses() {
        if (!context.canvas.isConnected || !traces.length) return;
        writeJson(sessionStore(), SESSION_KEYS.bgPulses, {
          v: 1, seed, w: boardW, h: boardH, at: Date.now(),
          ...traffic.snapshot(),
          a: ambient.snapshot(),
        });
      }
      function restorePulses() {
        const data = readJson(sessionStore(), SESSION_KEYS.bgPulses);
        if (!data || data.v !== 1 || data.seed !== seed || data.w !== boardW || data.h !== boardH) return;
        traffic.restore(data);
        ambient.restore(data.a);
        // Move everything on by the time the page change took (at most two seconds), so
        // the pulses arrive where they would be had they never stopped.
        const away = Number.isFinite(data.at) ? Math.min(2, Math.max(0, (Date.now() - data.at) / 1000)) : 0;
        if (away > 0) {
          traffic.tick(away);
          ambient.tick(away);
        }
      }
      // pageswap is the moment the slide's picture is taken; pagehide is the fallback
      // where it never fires (no transition), so it does not overwrite a pageswap save.
      let saved = false;
      window.addEventListener('pageswap', () => { saved = true; savePulses(); });
      window.addEventListener('pagehide', () => { if (!saved) savePulses(); });
      window.addEventListener('pageshow', () => { saved = false; });

      // Any part of the trace in the window, not just its ends (a long line crossing the
      // view with both ends off it used to be counted out, so it hardly ever lit).
      const inView = (trace) => trace.minX <= width && trace.minY <= height;

      const view = {
        resize(w, h) {
          width = w;
          height = h;
          // The first layout waits until the page has painted (owner request, October 14,
          // 2026: page changes were held up by it): the canvas is there, empty, from the
          // start, and the board appears a moment later. During a page slide the old
          // page's picture of the board shows until then.
          if (!boardW) {
            if (!firstPending) {
              firstPending = true;
              window.requestAnimationFrame(() => window.setTimeout(() => {
                build();
                redraw(); // a still (reduced motion) board has no loop to draw it
              }, 0));
            }
            return;
          }
          const ratio = Math.min(window.devicePixelRatio || 1, 2);
          if (w <= boardW && h <= boardH && ratio === boardRatio) return;
          window.clearTimeout(rebuild);
          rebuild = window.setTimeout(() => {
            build();
            redraw(); // a still (reduced motion) board has no loop to draw it
          }, 250);
        },
        step(dt) {
          // Data between parts (makeTraffic): each part it reaches lights up, and soon
          // drives one of its quiet lines.
          for (const { part, color } of traffic.tick(dt)) {
            flashes.push({ part, life: 0.5, color });
            ambient.poke(part);
          }
          // The quiet lines (makeAmbient). A signal coming in to a part sometimes sets
          // it sending data over a net, as input would.
          for (const landed of ambient.tick(dt)) {
            if (landed.part) {
              flashes.push({ part: landed.part, life: 0.4, color: landed.color });
              if (landed.inward && random() < 0.3) traffic.kick(landed.part);
            } else flashes.push({ x: landed.x, y: landed.y, life: 0.45, color: landed.color });
          }
          for (const flash of flashes) flash.life -= dt;
          flashes = flashes.filter((f) => f.life > 0);
        },
        draw(fade) {
          const ctx = context;
          ctx.clearRect(0, 0, width, height);
          ctx.globalAlpha = fade;
          if (board.width) ctx.drawImage(board, 0, 0, boardW, boardH);
          // Data on the nets at full strength; the quiet lines' housekeeping a little
          // fainter, so it fills the board in without competing with it.
          for (const [pulses, strength] of [[traffic.pulses, 0.85], [ambient.pulses, 0.6]]) {
            for (const pulse of pulses) {
              const tail = pulse.tail || TAIL;
              for (let k = tail; k >= 0; k -= 1) {
                const d = pulse.d - k * TAIL_GAP;
                if (d < 0 || d > pulse.trace.length) continue;
                const [x, y] = pointAt(pulse.trace, pulse.inward ? pulse.trace.length - d : d);
                const a = (1 - k / (tail + 1)) * strength;
                const r = k === 0 ? 2.2 : 1.4;
                ctx.fillStyle = `rgba(${pulse.color}, ${a.toFixed(3)})`;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
              }
            }
          }
          ctx.lineWidth = 1.5;
          for (const flash of flashes) {
            if (flash.part) {
              // The part lights up as data lands on it.
              ctx.strokeStyle = `rgba(${flash.color}, ${(flash.life / 0.5 * 0.6).toFixed(3)})`;
              ctx.strokeRect(...outline(flash.part));
              continue;
            }
            ctx.beginPath();
            ctx.arc(flash.x, flash.y, 2.4 + (0.45 - flash.life) * 9, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${flash.color}, ${(flash.life / 0.45 * 0.8).toFixed(3)})`;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        },
      };
      redraw = () => view.draw(1);
      return view;
    },
  });
}
