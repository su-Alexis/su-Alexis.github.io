// The circuit board background's layout (ui/bg-circuit.js, planBoard), checked on random
// boards: every trace runs from a pin to a pin or a via, no two traces cross or touch,
// nothing runs through a part, pour or mounting hole, and no pad is left bare (owner
// requests, October 14, 2026: the board has to read as a real routed circuit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBoard, makeTraffic, makeAmbient, makeLights, chipDots } from '../site/assets/js/ui/bg-circuit.js';

// Every grid point a trace passes through after its first, and every diagonal crossing.
function walk(points) {
  const cells = [];
  const crossings = [];
  for (let i = 1; i < points.length; i += 1) {
    let [x, y] = points[i - 1];
    const [tx, ty] = points[i];
    const dx = Math.sign(tx - x);
    const dy = Math.sign(ty - y);
    assert.ok(tx - x === 0 || ty - y === 0 || Math.abs(tx - x) === Math.abs(ty - y), 'runs are straight or 45 degrees');
    while (x !== tx || y !== ty) {
      if (dx && dy) crossings.push(`${Math.min(x, x + dx)},${Math.min(y, y + dy)}`);
      x += dx;
      y += dy;
      cells.push(`${x},${y}`);
    }
  }
  return { cells, crossings };
}

const pinsOf = (part) => part.sides.flatMap((side) => side.pins.map((pin) => `${pin}`));
const SIZES = [[160, 90], [38, 82], [96, 60], [256, 144]];
const boards = SIZES.flatMap(([cols, rows]) => Array.from({ length: 6 }, () => ({ cols, rows, ...planBoard(cols, rows, 20) })));

test('traces run from a pin of their part to a pin of the part they reach, or a via', () => {
  for (const { chips, traces } of boards) {
    assert.ok(chips.length > 0 && traces.length > 0);
    for (const trace of traces) {
      assert.ok(chips.includes(trace.chip), 'its part is on the board');
      assert.ok(pinsOf(trace.chip).includes(`${trace.points[0]}`), 'starts on a pin');
      if (trace.end) {
        assert.ok(chips.includes(trace.end));
        assert.ok(pinsOf(trace.end).includes(`${trace.points[trace.points.length - 1]}`), 'ends on a pin');
        assert.equal(trace.via, false);
      }
    }
  }
});

test('traces never share a point or a crossing, and never run through a part, pour or hole', () => {
  for (const { chips, traces, pours, holes } of boards) {
    const pins = new Set(chips.flatMap(pinsOf));
    const copper = new Set(pours.map((point) => `${point}`));
    const seen = new Set();
    const crossed = new Set();
    for (const trace of traces) {
      const { cells, crossings } = walk(trace.points);
      const last = `${trace.points[trace.points.length - 1]}`;
      for (const cell of cells) {
        assert.ok(!seen.has(cell), `point ${cell} used twice`);
        seen.add(cell);
        if (!(trace.end && cell === last)) assert.ok(!pins.has(cell), `trace runs over a pin at ${cell}`);
        const [x, y] = cell.split(',').map(Number);
        for (const c of chips) {
          if (!['qfp', 'soic', 'bga', 'inductor'].includes(c.kind)) continue;
          assert.ok(!(x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1), `point ${cell} inside a chip`);
        }
        assert.ok(!copper.has(cell), `point ${cell} inside the pour`);
        for (const [hx, hy] of holes) assert.ok(Math.abs(x - hx) > 2 || Math.abs(y - hy) > 2, `point ${cell} on a hole`);
      }
      for (const crossing of crossings) {
        assert.ok(!crossed.has(crossing), `diagonals cross at ${crossing}`);
        crossed.add(crossing);
      }
    }
  }
});

test('every pin has exactly one wire, and every part has pins', () => {
  for (const { chips, traces } of boards) {
    const ends = traces.flatMap((trace) => [`${trace.points[0]}`, ...(trace.end ? [`${trace.points[trace.points.length - 1]}`] : [])]);
    assert.equal(new Set(ends).size, ends.length, 'one wire per pin');
    for (const c of chips) {
      const pins = pinsOf(c);
      assert.ok(pins.length > 0, 'part with no pins');
      for (const pin of pins) assert.ok(ends.includes(pin), `bare pad at ${pin}`);
    }
  }
});

test('parts keep clear of each other and stay on the board', () => {
  for (const { cols, rows, chips } of boards) {
    for (const c of chips) {
      assert.ok(c.x0 >= 0 && c.y0 >= 0 && c.x1 <= cols && c.y1 <= rows, 'on the board');
      for (const d of chips) {
        if (c === d) continue;
        const apart = c.x1 < d.x0 || d.x1 < c.x0 || c.y1 < d.y0 || d.y1 < c.y0;
        assert.ok(apart, `${c.kind} and ${d.kind} overlap`);
      }
    }
  }
});

test('parts are wired to each other, not only to vias', () => {
  for (const { traces } of boards.filter((b) => b.cols >= 96)) {
    assert.ok(traces.some((trace) => trace.end && trace.end.kind !== 'passive'), 'some part-to-part traces');
  }
});

// Data flow (makeTraffic): the board's activity has to follow the wiring.
function linksOf(board) {
  const links = new Map();
  for (const trace of board.traces) {
    if (!trace.end || trace.end.kind === 'passive') continue;
    if (!links.has(trace.bus)) links.set(trace.bus, { a: trace.chip, b: trace.end, lines: [] });
    // Lengths in grid steps stand in for pixels here.
    links.get(trace.bus).lines.push({ ...trace, length: trace.points.length * 10 });
  }
  return [...links.values()];
}

test('data only moves along nets, and each hop starts where the last one arrived', () => {
  for (const board of boards.filter((b) => b.cols >= 96)) {
    const links = linksOf(board);
    const traffic = makeTraffic(links, { target: 10 });
    const lines = new Map(links.map((link) => [link, new Set(link.lines)]));
    let chained = 0;
    for (let t = 0; t < 600; t += 1) {
      traffic.tick(0.05);
      for (const pulse of traffic.pulses) assert.ok(lines.get(pulse.transfer.link).has(pulse.trace), 'pulse on its own bus');
    }
    for (const transfer of traffic.log) {
      const { link } = transfer;
      assert.ok((transfer.from === link.a && transfer.to === link.b) || (transfer.from === link.b && transfer.to === link.a), 'between the two ends of a net');
      if (transfer.cause) {
        chained += 1;
        assert.equal(transfer.from, transfer.cause.to, 'a part only passes on data it received');
        assert.ok(transfer.hops <= 10);
      }
    }
    assert.ok(chained > 0, 'data is passed on from part to part');
    assert.ok(traffic.pulses.length <= 240);
  }
});

test('a seed always lays out the same board, so pages share one board', () => {
  const shape = (board) => JSON.stringify({
    chips: board.chips.map((c) => [c.kind, c.x0, c.y0, c.x1, c.y1, c.label]),
    traces: board.traces.map((t) => t.points),
    pours: board.pours.length,
  });
  assert.equal(shape(planBoard(160, 90, 20, 12345)), shape(planBoard(160, 90, 20, 12345)));
  assert.notEqual(shape(planBoard(160, 90, 20, 12345)), shape(planBoard(160, 90, 20, 54321)));
});

test('a traffic snapshot puts every pulse back where it was, and bad values are skipped', () => {
  const board = boards.find((b) => b.cols >= 96);
  const links = linksOf(board);
  const before = makeTraffic(links, { target: 10 });
  for (let t = 0; t < 80; t += 1) before.tick(0.05);
  const data = JSON.parse(JSON.stringify(before.snapshot()));
  const after = makeTraffic(links, { target: 0 });
  after.restore(data);
  const where = (traffic) => traffic.pulses.map((p) => `${links.indexOf(p.transfer.link)}:${p.transfer.link.lines.indexOf(p.trace)}:${Math.round(p.d)}`).sort();
  assert.ok(before.pulses.length > 0);
  assert.deepEqual(where(after), where(before));
  const hostile = makeTraffic(links, { target: 0 });
  hostile.restore({ t: [[999, 1, 0, 0, 200, [[0, 5]]], ['x'], [0, 1, 0, 0, 200, [[999, 5]]], [0, 2, 0, 0, 200, [[0, 5]]]], q: [[0, 1, 99999, 0, 0], null] });
  hostile.restore(null);
  hostile.restore({ t: 'nope', q: [] });
  assert.equal(hostile.pulses.length, 0);
});

// Every wire lights up now and then (owner request, October 14, 2026: some hardly ever
// did): the nets by fair turns of the traffic, the quiet lines by each part's cycle.
function quietOf(board) {
  const quiet = board.traces.filter((trace) => !trace.end || trace.end.kind === 'passive');
  const copies = new Map(quiet.map((trace) => [trace, { ...trace, length: trace.points.length * 10 }]));
  for (const copy of copies.values()) copy.bus = copy.bus.map((t) => copies.get(t)).filter(Boolean);
  return [...copies.values()];
}

test('every wire on the board lights up within 16 seconds, and never too many at once', () => {
  for (const board of boards.filter((b) => b.cols >= 96)) {
    const links = linksOf(board);
    const quiet = quietOf(board);
    const traffic = makeTraffic(links, { target: 10 });
    const ambient = makeAmbient(quiet, { cap: 64 });
    const lit = new Set();
    for (let t = 0; t < 16 * 20; t += 1) {
      for (const { part } of traffic.tick(0.05)) ambient.poke(part);
      for (const landed of ambient.tick(0.05)) if (landed.inward) traffic.kick(landed.part);
      for (const pulse of [...traffic.pulses, ...ambient.pulses]) lit.add(pulse.trace);
      assert.ok(ambient.pulses.length <= 64, 'the quiet lines stay under their cap');
    }
    for (const link of links) assert.ok(link.lines.some((line) => lit.has(line)), 'every net carries data');
    for (const trace of quiet) assert.ok(lit.has(trace), 'every quiet line lights up');
  }
});

test('the quiet lines wait for room rather than skip a turn, and skip lines out of view', () => {
  const board = boards.find((b) => b.cols >= 96);
  const quiet = quietOf(board);
  const shown = new Set(quiet.filter((_, i) => i % 3 === 0));
  const ambient = makeAmbient(quiet, { cap: 4, visible: (trace) => shown.has(trace) });
  const lit = new Set();
  for (let t = 0; t < 60 * 20; t += 1) {
    ambient.tick(0.05);
    for (const pulse of ambient.pulses) lit.add(pulse.trace);
    assert.ok(ambient.pulses.length <= Math.max(4, Math.max(...quiet.map((q) => q.bus.length))));
  }
  for (const trace of lit) assert.ok(shown.has(trace) || trace.bus.some((t) => shown.has(t)), 'only bundles in view');
  assert.ok(lit.size > 0);
});

test('an ambient snapshot comes back the same, and bad values are skipped', () => {
  const board = boards.find((b) => b.cols >= 96);
  const quiet = quietOf(board);
  const before = makeAmbient(quiet);
  for (let t = 0; t < 80; t += 1) before.tick(0.05);
  const data = JSON.parse(JSON.stringify(before.snapshot()));
  const after = makeAmbient(quiet);
  after.restore(data);
  assert.ok(before.pulses.length > 0);
  assert.deepEqual(after.snapshot(), data);
  const hostile = makeAmbient(quiet);
  hostile.restore([[99999, 5, 150, 0, 0], ['x'], [0, -1, 150, 0, 0], [0, 5, 999, 0, 0], [0, 5, 150, 7, 0], [0, 5, 150, 0, 2], null]);
  hostile.restore('nope');
  hostile.restore(null);
  assert.equal(hostile.pulses.length, 0);
});

test('lines are coloured by what they carry: power and control in amber, data by its bus', () => {
  for (const board of boards) {
    for (const trace of board.traces) {
      const touches = (kind) => trace.chip.kind === kind || (trace.end && trace.end.kind === kind);
      const expected = touches('inductor') ? 'power' : touches('passive') ? 'control' : 'data';
      // MKb<3's lines follow their own rule, by side (tested below).
      if (trace.chip.hero || (trace.end && trace.end.hero)) continue;
      assert.equal(trace.signal, expected);
      assert.equal(trace.tone === 'gold', expected !== 'data', 'gold copper exactly where gold data runs');
    }
  }
  const board = boards.find((b) => b.cols >= 96);
  const ambient = makeAmbient(quietOf(board));
  for (let t = 0; t < 200; t += 1) ambient.tick(0.05);
  for (const pulse of ambient.pulses) {
    const amber = pulse.trace.signal !== 'data';
    assert.equal(pulse.color === '232, 180, 91', amber, 'amber exactly on power and control lines');
  }
});

// MKb<3 (owner requests, October 15, 2026): the processor is always named MKb<3, sits in
// the bottom-right of the window, has one side in violet and one in teal, and always has
// gold (power) data among its lines.
test('MKb<3 is named, placed bottom-right of the view, and wired by side: violet, teal, gold, mixed', () => {
  let placed = 0;
  for (let seed = 1; seed <= 12; seed += 1) {
    const board = planBoard(192, 108, 28, seed, { cols: 192, rows: 108 });
    const hero = board.chips.find((c) => c.kind === 'bga');
    assert.ok(hero, 'every desktop board has the processor');
    assert.equal(hero.label, 'MKb<3');
    assert.ok(hero.hero);
    if (hero.x1 >= 192 - 12 && hero.y1 >= 108 - 12) placed += 1;
    const lines = board.traces.filter((t) => t.chip === hero || t.end === hero);
    const pinOf = (t) => (t.chip === hero ? t.points[0] : t.points[t.points.length - 1]);
    const sideOf = ([x, y]) => (x < hero.x0 ? 'left' : x > hero.x1 ? 'right' : y < hero.y0 ? 'top' : 'bottom');
    const bySide = { left: [], top: [], bottom: [], right: [] };
    for (const t of lines) bySide[sideOf(pinOf(t))].push(t);
    assert.ok(bySide.left.every((t) => t.tone === 'violet' && t.signal === 'data'), 'left: violet');
    assert.ok(bySide.top.every((t) => t.tone === 'teal' && t.signal === 'data'), 'top: teal');
    assert.ok(bySide.bottom.length > 0, 'its bottom side always has wires');
    assert.ok(bySide.bottom.every((t) => t.tone === 'gold' && t.signal === 'power'), 'bottom: gold, power only');
    const rightBuses = new Set(bySide.right.map((t) => t.bus));
    if (rightBuses.size >= 3) assert.equal(new Set(bySide.right.map((t) => t.tone)).size, 3, 'right: all three');
  }
  assert.ok(placed >= 11, `bottom-right on ${placed} of 12 boards`);
});

test('chip dots light up and go out at random, and data arriving sets a burst going', () => {
  const board = planBoard(192, 108, 28, 7, { cols: 192, rows: 108 });
  const hero = board.chips.find((c) => c.kind === 'bga');
  assert.ok(chipDots(hero).length > 100, 'the processor has its ball grid');
  const lights = makeLights(board.chips);
  let peak = 0;
  let seenOn = new Set();
  for (let t = 0; t < 400; t += 1) {
    lights.tick(0.05);
    if (t === 200) lights.poke(hero);
    const lit = lights.dots.filter((d) => d.level > 0);
    peak = Math.max(peak, lit.length / lights.dots.length);
    for (const d of lit) seenOn.add(d);
  }
  assert.ok(seenOn.size > lights.dots.length * 0.5, 'most dots light up within 20 seconds');
  assert.ok(peak < 0.5, `never more than half lit at once (${peak.toFixed(2)})`);
});
