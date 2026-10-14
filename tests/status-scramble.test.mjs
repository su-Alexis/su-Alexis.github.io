// Frame logic for the decrypting [ ACTIVE ] tags (ui/status-scramble.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt, cycleTicks, parseTag } from '../site/assets/js/ui/status-scramble.js';

test('tag text parses to the bare word; anything else is left alone', () => {
  assert.equal(parseTag('[ ACTIVE ]'), 'ACTIVE');
  assert.equal(parseTag('  [ACTIVE]  '), 'ACTIVE');
  assert.equal(parseTag('[ IN PREPARATION ]'), 'IN PREPARATION');
  for (const bad of ['ACTIVE', '[ active ]', '[ ]', '[ <b>X</b> ]', `[ ${'A'.repeat(30)} ]`]) assert.equal(parseTag(bad), null, bad);
});

const WORD = 'ACTIVE';
const fixed = () => 0; // always the first glyph, 'A'
const join = (f) => f.done + f.head + f.rest;

test('every frame keeps the word length so the tag never changes width', () => {
  for (let t = 0; t < cycleTicks(WORD.length) * 2; t += 1) {
    assert.equal(join(frameAt(WORD, t)).length, WORD.length, `tick ${t}`);
  }
});

test('the cycle opens on the readable word with no scanner head', () => {
  assert.deepEqual(frameAt(WORD, 0, fixed), { done: WORD, head: '', rest: '' });
  assert.deepEqual(frameAt(WORD, cycleTicks(WORD.length), fixed), { done: WORD, head: '', rest: '' });
});

test('the scramble head moves right to left, the decrypt head left to right', () => {
  const heads = [];
  for (let t = 0; t < cycleTicks(WORD.length); t += 1) {
    const f = frameAt(WORD, t, fixed);
    if (f.head) heads.push(f.done.length);
  }
  const half = heads.length / 2;
  const scramble = heads.slice(0, half);
  const decrypt = heads.slice(half);
  assert.deepEqual(scramble, [...scramble].sort((a, b) => b - a));
  assert.deepEqual(decrypt, [...decrypt].sort((a, b) => a - b));
  assert.equal(scramble[0], WORD.length - 1);
  assert.equal(decrypt.at(-1), WORD.length - 1);
});

test('the decrypted prefix is always the real word, and only that', () => {
  for (let t = 0; t < cycleTicks(WORD.length); t += 1) {
    const f = frameAt(WORD, t, fixed);
    assert.ok(WORD.startsWith(f.done), `tick ${t}`);
  }
});
