// Layer 2 session record (ui/vm-session.js) and VM window clamping (ui/windows-ui.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.window = {
  sessionStorage: {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  },
};

const { cleanVms, readVms, writeVms, dropVm } = await import('../site/assets/js/ui/vm-session.js');
const { clampVm, resizeVm, VM_EDGES } = await import('../site/assets/js/ui/windows-ui.js');
const { SESSION_KEYS, VM_WINDOW, VM_LOG } = await import('../site/assets/js/core/constants.js');

test('the VM session keeps known guests once, a valid front, and bounded numbers', () => {
  const clean = cleanVms({
    v: 2,
    front: 'parrot01',
    vms: [
      { id: 'ws01', floating: true, x: -50, y: 1e9, w: 10, h: 300.6 },
      { id: 'ws01', floating: false },
      { id: '__proto__' },
      { id: 'parrot01', floating: 'yes', x: NaN },
      {}, {}, {}, {}, {},
    ],
  });
  assert.deepEqual(clean.vms.map((vm) => vm.id), []);
  const ok = cleanVms({ v: 2, front: 'parrot01', vms: [{ id: 'ws01', floating: true, x: -50, y: 1e9, w: 10, h: 300.6 }, { id: 'ws01' }, { id: 'parrot01', floating: 'yes', x: NaN }] });
  assert.deepEqual(ok.vms.map((vm) => vm.id), ['ws01', 'parrot01']);
  assert.deepEqual(ok.vms[0], { id: 'ws01', minimized: false, floating: true, x: 0, y: VM_WINDOW.maxCoordinate, w: VM_WINDOW.minWidth, h: 301, cwd: '', log: [] });
  // Console lines: known kinds only, no control characters, cut to length, last ones kept.
  const logged = cleanVms({ v: 2, vms: [{ id: 'ws01', cwd: 'users/analyst', log: [
    { kind: 'cmd', text: 'PS C:\> dir' }, { kind: 'script', text: 'x' }, { kind: 'out', text: 'ab' }, { kind: 'out', text: 'y'.repeat(500) }, 'nope',
  ] }] }).vms[0];
  assert.equal(logged.cwd, 'users/analyst');
  assert.deepEqual(logged.log.map((line) => line.kind), ['cmd', 'out']);
  assert.equal(logged.log[1].text.length, VM_LOG.length);
  const many = Array.from({ length: 100 }, (_, i) => ({ kind: 'out', text: String(i) }));
  assert.equal(cleanVms({ v: 2, vms: [{ id: 'ws01', log: many }] }).vms[0].log.length, VM_LOG.lines);
  assert.equal(cleanVms({ v: 2, vms: [{ id: 'ws01', cwd: 'x'.repeat(300) }] }).vms[0].cwd, '');
  assert.equal(ok.vms[1].floating, false);
  assert.equal(cleanVms({ v: 2, vms: [{ id: 'ubuntu-red', minimized: true }] }).vms[0].minimized, true);
  assert.equal(cleanVms({ v: 2, vms: [{ id: 'ubuntu-red', minimized: 'yes' }] }).vms[0].minimized, false);
  assert.equal(ok.vms[1].x, 0);
  assert.equal(ok.front, 'parrot01');
  assert.equal(cleanVms({ v: 2, front: 'ubuntu-red', vms: [{ id: 'ws01' }] }).front, null, 'front must be running');
  for (const raw of [null, 'x', { v: 1, vms: [] }, { v: 2, vms: 'ws01' }, { v: 2, vms: Array.from({ length: 9 }, () => ({})) }]) {
    assert.deepEqual(cleanVms(raw).vms, [], JSON.stringify(raw));
  }
});

test('the record is written, dropped per guest and removed when empty', () => {
  data.clear();
  writeVms({ v: 2, front: 'ws01', vms: [{ id: 'ws01' }, { id: 'parrot01' }] });
  assert.deepEqual(readVms().vms.map((vm) => vm.id), ['ws01', 'parrot01']);
  dropVm('ws01');
  assert.equal(readVms().front, null);
  assert.deepEqual(readVms().vms.map((vm) => vm.id), ['parrot01']);
  dropVm('parrot01');
  assert.equal(data.has(SESSION_KEYS.vms), false);
  data.set(SESSION_KEYS.vms, '{"v":2,"vms":[{"id":"ubuntu-red","w":1e400}]}');
  assert.equal(readVms().vms[0].w, VM_WINDOW.defaultWidth, 'non-finite numbers fall back');
});

test('floating VM windows stay inside the desk', () => {
  const desk = [1600, 860];
  assert.deepEqual(clampVm({ x: -40, y: -10, w: 800, h: 450 }, ...desk), { x: 0, y: 0, w: 800, h: 450 });
  assert.deepEqual(clampVm({ x: 1500, y: 800, w: 800, h: 450 }, ...desk), { x: 800, y: 410, w: 800, h: 450 });
  assert.deepEqual(clampVm({ x: 0, y: 0, w: 5000, h: 5000 }, ...desk), { x: 0, y: 0, w: 1600, h: 860 });
  assert.deepEqual(clampVm({ x: 0, y: 0, w: 10, h: 10 }, ...desk), { x: 0, y: 0, w: VM_WINDOW.minWidth, h: VM_WINDOW.minHeight });
});

test('VM windows resize from every edge and corner, keeping the opposite edges and the minimum', () => {
  const desk = [1600, 860];
  const from = { floating: true, x: 400, y: 200, w: 800, h: 450 };
  assert.deepEqual(VM_EDGES, ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
  assert.deepEqual(resizeVm(from, 'e', 100, 50, ...desk), { ...from, w: 900 });
  assert.deepEqual(resizeVm(from, 's', 100, 50, ...desk), { ...from, h: 500 });
  assert.deepEqual(resizeVm(from, 'w', -100, 0, ...desk), { ...from, x: 300, w: 900 });
  assert.deepEqual(resizeVm(from, 'n', 0, -100, ...desk), { ...from, y: 100, h: 550 });
  assert.deepEqual(resizeVm(from, 'nw', 50, 40, ...desk), { ...from, x: 450, y: 240, w: 750, h: 410 });
  assert.deepEqual(resizeVm(from, 'se', 10, 10, ...desk), { ...from, w: 810, h: 460 });
  // Never smaller than the minimum: the dragged edge stops, the opposite one stays.
  const tiny = resizeVm(from, 'w', 2000, 0, ...desk);
  assert.deepEqual([tiny.x + tiny.w, tiny.w], [1200, VM_WINDOW.minWidth]);
  const short = resizeVm(from, 'n', 0, 2000, ...desk);
  assert.deepEqual([short.y + short.h, short.h], [650, VM_WINDOW.minHeight]);
  // Never past the desk.
  assert.deepEqual(resizeVm(from, 'nw', -2000, -2000, ...desk), { ...from, x: 0, y: 0, w: 1200, h: 650 });
  assert.deepEqual(resizeVm(from, 'se', 2000, 2000, ...desk), { ...from, w: 1200, h: 660 });
});
