// Countdown math for the scheduled-exam badge (ui/cert-verify.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, countdownLabel } from '../site/assets/js/ui/cert-verify.js';

const now = new Date(2026, 9, 3, 15, 30); // Oct 3, 2026, afternoon local time

test('days are counted in whole local calendar days', () => {
  assert.equal(daysUntil('2026-10-21', now), 18);
  assert.equal(daysUntil('2026-10-04', now), 1);
  assert.equal(daysUntil('2026-10-03', now), 0);
  assert.equal(daysUntil('2026-10-01', now), -2);
});

test('only real YYYY-MM-DD dates are accepted', () => {
  for (const bad of ['2026-10', '2026-02-30', 'Oct 21', '', '2026-10-21T00:00', null]) assert.equal(daysUntil(bad, now), null, String(bad));
});

test('labels count down, say today on the day, and stop afterwards', () => {
  assert.equal(countdownLabel(18), 'T-18d');
  assert.equal(countdownLabel(0), 'today');
  assert.equal(countdownLabel(-1), null);
  assert.equal(countdownLabel(null), null);
  assert.equal(countdownLabel(5000), null);
});

test('a badge loads, verifies, then resolves', async () => {
  const { badgeFrame } = await import('../site/assets/js/ui/cert-verify.js');
  assert.equal(badgeFrame(0), '[......]');
  assert.equal(badgeFrame(3), '[###...]');
  assert.equal(badgeFrame(6), '[######]');
  assert.match(badgeFrame(7), /^verify [|/-]|^verify ./);
  assert.equal(badgeFrame(13), null);
});

test('certification lines are paced to finish with the console bar', async () => {
  const { lineSchedule } = await import('../site/assets/js/ui/cert-verify.js');
  const { tickMs, gapMs } = lineSchedule(5, 2850);
  const total = 4 * gapMs + 13 * tickMs; // last line starts after 4 gaps and takes 13 ticks
  assert.ok(Math.abs(total - 2850) < 1, `total ${total}`);
  assert.equal(lineSchedule(5, 10).tickMs, 30); // never unreadably fast
  assert.equal(lineSchedule(1, 100000).tickMs, 120); // never sluggish
});
