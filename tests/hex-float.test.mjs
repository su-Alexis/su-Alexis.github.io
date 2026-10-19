// The hex_float background's shapes (ui/hex-float.js): every kind is a sound wireframe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geometry, SHAPE_KINDS, entry } from '../site/assets/js/ui/hex-float.js';

test('every hex_float shape is a whole 3D wireframe about a unit across', () => {
  assert.ok(SHAPE_KINDS.includes('hexagram') && SHAPE_KINDS.includes('star'), 'stars among them');
  assert.ok(SHAPE_KINDS.length >= 8);
  for (const kind of SHAPE_KINDS) {
    const { points, edges } = geometry(kind);
    assert.ok(points.length >= 4 && edges.length >= 6, kind);
    for (const [x, y, z] of points) assert.ok(Math.hypot(x, y, z) <= 1.1, `${kind} fits its size`);
    const used = new Set();
    for (const [a, b] of edges) {
      assert.ok(Number.isInteger(a) && Number.isInteger(b) && a !== b && points[a] && points[b], `${kind} edge ends exist`);
      const [p, q] = [points[a], points[b]];
      assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.05, `${kind} has no zero-length edge`);
      used.add(a).add(b);
    }
    assert.equal(used.size, points.length, `${kind}: no loose points`);
    // Every shape is solid 3D (owner request, October 19, 2026): nothing flat.
    const zs = points.map((point) => point[2]);
    assert.ok(Math.max(...zs) - Math.min(...zs) >= 0.3, `${kind} has depth`);
  }
});

test('new hex_float shapes come in from off screen, heading across it in any direction', () => {
  const [w, h] = [1600, 900];
  const headings = new Set();
  for (let i = 0; i < 400; i += 1) {
    const { x, y, vx, vy } = entry(w, h, 20, false, 15);
    assert.ok(x < 0 || x > w || y < 0 || y > h, 'starts off screen');
    assert.ok((w / 2 - x) * vx + (h / 2 - y) * vy > 0, 'heads into the screen');
    assert.ok(Math.abs(Math.hypot(vx, vy) - 15) < 1e-9, 'at its speed');
    headings.add(Math.round((Math.atan2(vy, vx) + Math.PI) / (Math.PI / 4)) % 8);
  }
  assert.equal(headings.size, 8, 'every way across the screen, not only up');
});
