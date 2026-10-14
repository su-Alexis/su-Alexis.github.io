// Layer 2 easter eggs in the guest engine (owner request, October 11, 2026): apt moo,
// sl after installing it, the vim trap, Task Manager's process table, and the hidden
// ~waffles page. Typed text is never repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest, promptFor, taskList, endTask } = await import('../site/assets/js/features/guest-engine.js');
const { resolveAddress, searchLab } = await import('../site/assets/js/features/lab-web.js');

const boot = (id) => bootGuest(VMS.find((vm) => vm.id === id));
const texts = (result) => result.lines.map((line) => line.text || '').join('\n');

test('apt moo and sl, installed the way a real Ubuntu or Parrot does it', () => {
  const u = boot('ubuntu-red');
  assert.match(texts(runGuest(u, 'apt moo')), /Have you mooed today/);
  assert.match(texts(runGuest(u, 'sl')), /sudo apt install sl/);
  assert.match(texts(runGuest(u, 'apt install sl')), /are you root/);
  assert.match(texts(runGuest(u, 'sudo apt install sl')), /Setting up sl/);
  const train = runGuest(u, 'sl');
  assert.ok(train.lines.length > 10 && train.lines.every((frame) => Array.isArray(frame.block)));
  assert.deepEqual(train.lines[train.lines.length - 1].block, []);
  const odd = runGuest(u, 'sudo apt install hunter2x');
  assert.ok(odd.echo === null && !texts(odd).includes('hunter2x'));
  // Machines without apt have neither.
  assert.match(texts(runGuest(boot('router01'), 'sl')), /not found/);
});

test('the vim trap: only the real ways out work', () => {
  const p = boot('parrot01');
  const opened = runGuest(p, 'vim');
  assert.equal(opened.clear, true);
  assert.match(texts(opened), /VIM - Vi IMproved/);
  assert.equal(promptFor(p), ':');
  for (const attempt of ['exit', 'quit', 'q', 'hunter2x']) {
    const result = runGuest(p, attempt);
    assert.match(texts(result), /:qa!/);
    assert.ok(!texts(result).includes('hunter2x'));
  }
  assert.match(texts(runGuest(p, ':hunter2x')), /E492/);
  assert.equal(runGuest(p, ':q!').clear, true);
  assert.match(promptFor(p), /\$$/);
});

test('Task Manager uses the same process rules', () => {
  const list = taskList();
  assert.ok(list.some((task) => task.name === 'csrss.exe' && task.critical));
  assert.deepEqual(endTask(612), { ok: true, event: 'crash' });
  assert.equal(endTask(4).ok, false);
  assert.equal(endTask(2964).ok, false);
  assert.deepEqual(endTask(4120), { ok: true, event: null });
  assert.equal(endTask(99999).ok, false);
});

test('the ~waffles page is found by address, never by search', () => {
  assert.deepEqual(resolveAddress('web01.lab.example/~waffles', { running: () => true }), { kind: 'page', key: 'web01.lab.example/~waffles' });
  assert.ok(!searchLab('waffles homepage corner').includes('web01.lab.example/~waffles'));
});
