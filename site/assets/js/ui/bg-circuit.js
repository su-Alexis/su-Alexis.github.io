// "circuit" background (owner request): printed circuit board traces, with pulses of
// light running along them and lighting up the pads they reach. Chosen with
// "background circuit"; ui/backgrounds.js starts and stops it, ui/canvas-bg.js runs the
// loop.
//
// Decorative only, on a transparent canvas. The board (traces, pads, a few chips) is
// random but drawn once per resize onto an offscreen canvas, so each frame only copies
// it and draws the pulses. Traces follow a grid and turn in 45 degree steps, like
// real routing.

import { el } from '../utils/dom.js';
import { startCanvas, rand } from './canvas-bg.js';

const CELL = 24;
const AREA_PER_TRACE = 20000;
const MIN_TRACES = 18;
const MAX_TRACES = 80;
const MAX_PULSES = 22;
const SPAWN_EVERY = 0.22; // seconds between new pulses
const TAIL = 9; // dots in a pulse's tail
// 8 directions, clockwise from east. Traces start orthogonal and turn 45 degrees at a time.
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const COLORS = ['79, 209, 224', '95, 207, 128'];

function makeTrace(cols, rows) {
  let gx = Math.floor(rand(0, cols));
  let gy = Math.floor(rand(0, rows));
  let dir = Math.floor(rand(0, 4)) * 2; // start orthogonal
  const points = [[gx * CELL, gy * CELL]];
  const steps = Math.floor(rand(4, 15));
  for (let i = 0; i < steps; i += 1) {
    if (i > 0 && Math.random() < 0.24) dir = (dir + (Math.random() < 0.5 ? 1 : 7)) % 8;
    gx += DIRS[dir][0];
    gy += DIRS[dir][1];
    if (gx < 0 || gy < 0 || gx > cols || gy > rows) break;
    points.push([gx * CELL, gy * CELL]);
  }
  // Cumulative length at each point, for placing pulses by distance.
  const at = [0];
  for (let i = 1; i < points.length; i += 1) {
    at.push(at[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, at, length: at[at.length - 1] };
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
      let traces = [];
      let pulses = [];
      let flashes = [];
      let spawnIn = 0;

      function drawBoard() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        board.width = Math.floor(width * ratio);
        board.height = Math.floor(height * ratio);
        const b = boardContext;
        b.setTransform(ratio, 0, 0, ratio, 0, 0);
        b.lineJoin = 'round';
        b.lineCap = 'round';
        b.strokeStyle = 'rgba(79, 209, 224, 0.13)';
        b.lineWidth = 1.6;
        for (const trace of traces) {
          b.beginPath();
          trace.points.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
          b.stroke();
        }
        // Pads at the ends: a ring where a trace ends, a via where it starts.
        for (const trace of traces) {
          const [sx, sy] = trace.points[0];
          const [ex, ey] = trace.points[trace.points.length - 1];
          b.fillStyle = 'rgba(79, 209, 224, 0.22)';
          b.fillRect(sx - 2, sy - 2, 4, 4);
          b.beginPath();
          b.arc(ex, ey, 3.2, 0, Math.PI * 2);
          b.strokeStyle = 'rgba(79, 209, 224, 0.24)';
          b.lineWidth = 1.2;
          b.stroke();
        }
        // A few chips, outlined, with pins.
        const chips = Math.max(2, Math.round((width * height) / 260000));
        b.strokeStyle = 'rgba(79, 209, 224, 0.16)';
        b.lineWidth = 1.2;
        for (let i = 0; i < chips; i += 1) {
          const w = CELL * Math.floor(rand(2, 4));
          const h = CELL * Math.floor(rand(1, 3));
          const x = Math.floor(rand(0, (width - w) / CELL)) * CELL;
          const y = Math.floor(rand(0, (height - h) / CELL)) * CELL;
          b.strokeRect(x, y, w, h);
          b.beginPath();
          for (let px = x + 6; px < x + w - 2; px += 8) {
            b.moveTo(px, y);
            b.lineTo(px, y - 5);
            b.moveTo(px, y + h);
            b.lineTo(px, y + h + 5);
          }
          b.stroke();
        }
      }

      return {
        resize(w, h) {
          width = w;
          height = h;
          const count = Math.max(MIN_TRACES, Math.min(MAX_TRACES, Math.round((w * h) / AREA_PER_TRACE)));
          traces = Array.from({ length: count }, () => makeTrace(Math.ceil(w / CELL), Math.ceil(h / CELL))).filter((trace) => trace.length > CELL * 2);
          pulses = [];
          flashes = [];
          if (traces.length) drawBoard();
        },
        step(dt) {
          spawnIn -= dt;
          if (spawnIn <= 0 && pulses.length < MAX_PULSES && traces.length) {
            spawnIn = SPAWN_EVERY;
            const trace = traces[Math.floor(Math.random() * traces.length)];
            pulses.push({ trace, d: 0, speed: rand(110, 230), color: COLORS[Math.floor(Math.random() * COLORS.length)] });
          }
          for (const pulse of pulses) pulse.d += pulse.speed * dt;
          for (const pulse of pulses.filter((p) => p.d >= p.trace.length + TAIL * 6)) {
            const [x, y] = pulse.trace.points[pulse.trace.points.length - 1];
            flashes.push({ x, y, life: 0.45, color: pulse.color });
          }
          pulses = pulses.filter((p) => p.d < p.trace.length + TAIL * 6);
          for (const flash of flashes) flash.life -= dt;
          flashes = flashes.filter((f) => f.life > 0);
        },
        draw(fade) {
          const ctx = context;
          ctx.clearRect(0, 0, width, height);
          ctx.globalAlpha = fade;
          if (board.width) ctx.drawImage(board, 0, 0, width, height);
          for (const pulse of pulses) {
            for (let k = TAIL; k >= 0; k -= 1) {
              const d = pulse.d - k * 6;
              if (d < 0 || d > pulse.trace.length) continue;
              const [x, y] = pointAt(pulse.trace, d);
              const a = (1 - k / (TAIL + 1)) * 0.85;
              const r = k === 0 ? 2.4 : 1.6;
              ctx.fillStyle = `rgba(${pulse.color}, ${a.toFixed(3)})`;
              ctx.fillRect(x - r, y - r, r * 2, r * 2);
            }
          }
          for (const flash of flashes) {
            ctx.beginPath();
            ctx.arc(flash.x, flash.y, 3.2 + (0.45 - flash.life) * 10, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${flash.color}, ${(flash.life / 0.45 * 0.8).toFixed(3)})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        },
      };
    },
  });
}
