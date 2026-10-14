// Layer 2: each VM's own files (features/guest-engine.js: saveFile, makeDir, mkdir,
// exportFiles, importFiles; ui/vm-session.js keeps them). Doctrine section 8: a bounded
// overlay on the image's tree, text only, checked names, writes only in the user's home.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { VM_FILES } = await import('../site/assets/js/core/constants.js');
const { bootGuest, runGuest, saveFile, makeDir, exportFiles, importFiles, nodeAt, nameProblem } = await import('../site/assets/js/features/guest-engine.js');

const boot = (id) => bootGuest(VMS.find((vm) => vm.id === id));
const texts = (result) => result.lines.map((line) => line.text).join('\n');

test('saving and making folders in the home folder, and nowhere else', () => {
  const u = boot('ubuntu-blue');
  assert.equal(saveFile(u, u.home, 'plan.txt', 'step 1\r\nstep 2').ok, true);
  assert.equal(nodeAt(u, [...u.home, 'plan.txt']).content, 'step 1\nstep 2');
  assert.match(texts(runGuest(u, 'cat ~/plan.txt')), /step 2/);
  assert.equal(makeDir(u, u.home, 'work').ok, true);
  assert.equal(makeDir(u, u.home, 'work').error, 'exists');
  assert.equal(saveFile(u, ['etc'], 'x.conf', 'nope').error, 'denied');
  assert.equal(makeDir(u, ['tmp'], 'scratch').ok, true);
  assert.equal(saveFile(u, u.home, 'work', 'a folder has this name').error, 'folder');
  // Winbows: the user's folder only, and its reserved names.
  const w = boot('ws01');
  assert.equal(saveFile(w, [...w.home, 'Documents'], 'todo.txt', 'x').ok, true);
  assert.equal(saveFile(w, ['Winbows'], 'evil.txt', 'x').error, 'denied');
  for (const name of ['con', 'NUL.txt', 'trailing.', 'a/b', '..', '', 'x'.repeat(VM_FILES.name + 1), '<script>', 'semi;colon']) {
    assert.equal(nameProblem(w, name), 'name', name);
  }
});

test('files are bounded: count, size, and no control characters', () => {
  const u = boot('ubuntu-red');
  assert.equal(saveFile(u, u.home, 'big.txt', 'x'.repeat(VM_FILES.content + 1)).error, 'big');
  assert.equal(saveFile(u, u.home, 'bell.txt', 'a\u0007b\u001bc\td').node.content, 'abc\td');
  // bell.txt is one; fill up to the limit.
  for (let i = 1; i < VM_FILES.files; i += 1) assert.equal(saveFile(u, u.home, `f${i}.txt`, 'x').ok, true);
  assert.equal(saveFile(u, u.home, 'one-more.txt', 'x').error, 'full');
  // Saving over a file already made is not a new file.
  assert.equal(saveFile(u, u.home, 'f1.txt', 'changed').ok, true);
});

test('mkdir in the shells', () => {
  const u = boot('parrot01');
  const made = runGuest(u, 'mkdir loot');
  assert.equal(made.echo, 'mkdir ~/loot');
  assert.equal(made.changed, true);
  assert.match(texts(runGuest(u, 'mkdir loot')), /File exists/);
  assert.match(texts(runGuest(u, 'mkdir /etc/x')), /Permission denied/);
  const bad = runGuest(u, 'mkdir bad*name');
  assert.equal(bad.echo, null);
  assert.ok(!texts(bad).includes('bad'));
  const w = boot('ws01');
  assert.match(texts(runGuest(w, 'md Projects')), /Directory: C:\\Users\\analyst[\s\S]*Projects/);
  assert.match(texts(runGuest(w, 'mkdir C:/Winbows/x')), /Access to the path is denied/);
});

test('the session record round-trips, and a tampered one is checked again', () => {
  const u = boot('ubuntu-blue');
  makeDir(u, u.home, 'work');
  saveFile(u, [...u.home, 'work'], 'a.txt', 'hello');
  const stored = JSON.parse(JSON.stringify(exportFiles(u)));
  const again = boot('ubuntu-blue');
  importFiles(again, stored);
  assert.equal(nodeAt(again, [...again.home, 'work', 'a.txt']).content, 'hello');
  // Tampered: outside home, bad names, wrong types, too many: all dropped.
  const evil = boot('ubuntu-blue');
  importFiles(evil, {
    dirs: ['etc/evil', 'home/admin/<b>', 42, 'home/admin/ok'],
    files: [['etc/passwd', 'root::0:0'], ['home/admin/x.txt', { not: 'text' }], ['home/admin/fine.txt', 'fine'], 'junk'],
  });
  assert.equal(nodeAt(evil, ['etc', 'evil']), null);
  assert.ok(!nodeAt(evil, ['etc', 'passwd']) || !nodeAt(evil, ['etc', 'passwd']).made);
  assert.equal(nodeAt(evil, [...evil.home, 'ok']).dir, true);
  assert.equal(nodeAt(evil, [...evil.home, 'fine.txt']).content, 'fine');
  importFiles(evil, null);
  importFiles(evil, { dirs: 'nope', files: 'nope' });
});
