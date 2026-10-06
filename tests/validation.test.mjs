// Abuse tests for utils/validate.js (doctrine sections 5, 8 and 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, normalizePuzzleAnswer, knownId, pickKnown, hashChoice, parseBoundedJson, isPlainObject, ownField } from '../site/assets/js/utils/validate.js';
import { LIMITS, LAYER_IDS, DEFAULT_LAYER, SECTION_IDS } from '../site/assets/js/core/constants.js';

test('commands: trims, lowercases the name, keeps argument case', () => {
  const r = parseCommand('  OPEN Projects  ');
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'open');
  assert.deepEqual([...r.value.args], ['Projects']);
});

test('commands: rejects oversized input before any processing', () => {
  assert.equal(parseCommand('a'.repeat(LIMITS.commandRaw + 1)).reason, 'too-long');
  assert.equal(parseCommand('ls'.padEnd(LIMITS.commandRaw, ' ')).ok, true); // exactly at the limit
  assert.equal(parseCommand('a'.repeat(33)).reason, 'invalid-command'); // command names are short
});

test('commands: rejects control characters, tabs and pasted newlines', () => {
  for (const raw of ['ls\tx', 'ls\nrm', 'ls\u0000', 'ls\u007f', 'ls\u0085']) {
    assert.equal(parseCommand(raw).reason, 'control-chars', JSON.stringify(raw));
  }
});

test('commands: names are ASCII; Unicode lookalikes are never folded into commands', () => {
  assert.equal(parseCommand('сlear').reason, 'non-ascii-command'); // Cyrillic es
  assert.equal(parseCommand('ＬＳ').reason, 'non-ascii-command'); // fullwidth
  assert.equal(parseCommand('<script>').reason, 'invalid-command');
  assert.equal(parseCommand('constructor').ok, true); // parses; dispatch must still use own-property lookup
});

test('commands: argument count and length limits', () => {
  assert.equal(parseCommand('ls ' + 'a '.repeat(LIMITS.commandArgs + 1)).reason, 'too-many-args');
  assert.equal(parseCommand('cat ' + 'x'.repeat(LIMITS.commandArgLength + 1)).reason, 'arg-too-long');
  assert.equal(parseCommand('   ').reason, 'empty');
  assert.equal(parseCommand(null).reason, 'invalid');
});

test('commands: HTML-like arguments are returned as plain data', () => {
  const r = parseCommand('cat <img src=x onerror=alert(1)>');
  assert.equal(r.ok, true);
  assert.deepEqual([...r.value.args], ['<img', 'src=x', 'onerror=alert(1)>']);
});

test('puzzle answers: NFC, case and whitespace rules, limits', () => {
  assert.equal(normalizePuzzleAnswer('  Café   Bebop ').value, 'café bebop');
  assert.equal(normalizePuzzleAnswer('Spike', { caseSensitive: true }).value, 'Spike');
  assert.equal(normalizePuzzleAnswer('x'.repeat(LIMITS.puzzleAnswerRaw + 1)).reason, 'too-long');
  assert.equal(normalizePuzzleAnswer('a\nb').reason, 'control-chars');
  assert.equal(normalizePuzzleAnswer('   ').reason, 'empty');
});

test('identifiers: exact known matches only; inherited names never match', () => {
  assert.equal(knownId('workstation', LAYER_IDS).value, 'workstation');
  assert.equal(knownId('Workstation', LAYER_IDS).ok, false);
  assert.equal(knownId('constructor', LAYER_IDS).ok, false);
  assert.equal(knownId('__proto__', LAYER_IDS).ok, false);
  assert.equal(knownId('../layers/layer2', LAYER_IDS).ok, false);
  assert.equal(knownId('x'.repeat(LIMITS.identifierLength + 1), LAYER_IDS).ok, false);
});

test('unknown layer or hash values fail closed to the safe default', () => {
  assert.equal(pickKnown('evil', LAYER_IDS, DEFAULT_LAYER), DEFAULT_LAYER);
  assert.equal(pickKnown(undefined, LAYER_IDS, DEFAULT_LAYER), DEFAULT_LAYER);
  assert.equal(hashChoice('#projects', SECTION_IDS, null), 'projects');
  assert.equal(hashChoice('#javascript:alert(1)', SECTION_IDS, null), null);
  assert.equal(hashChoice('projects', SECTION_IDS, null), null);
});

test('stored state: bounded before parsing, malformed fails safely', () => {
  assert.equal(parseBoundedJson('{"v":1}').ok, true);
  assert.equal(parseBoundedJson('{').reason, 'malformed');
  assert.equal(parseBoundedJson('x'.repeat(LIMITS.storageCodeUnits + 1)).reason, 'too-large');
  // Under the code-unit limit but over the byte limit once encoded as UTF-8.
  assert.equal(parseBoundedJson('"' + 'é'.repeat(20000) + '"').reason, 'too-large');
  assert.equal(parseBoundedJson(42).reason, 'invalid');
});

test('stored state: prototype tricks are not trusted', () => {
  const parsed = parseBoundedJson('{"__proto__":{"admin":true},"layer":"hidden"}').value;
  assert.equal(isPlainObject(parsed), true);
  assert.equal(ownField(parsed, 'layer'), 'hidden');
  assert.equal(ownField(parsed, 'admin'), undefined);
  assert.equal(ownField(parsed, 'toString'), undefined);
  assert.equal(({}).admin, undefined);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
});
