// Tab completion in the VM shells (features/guest-engine.js completeGuest; owner bug
// report, October 12, 2026). Commands for the first word, the machine's own file names
// after it; read-only, and nothing typed is offered back except as the line itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest, completeGuest } = await import('../site/assets/js/features/guest-engine.js');

function boot(id) {
  const guest = bootGuest(VMS.find((vm) => vm.id === id));
  guest.running = () => true;
  guest.scenario = () => [];
  return guest;
}

test('the first word completes to a command this machine knows', () => {
  const blue = boot('ubuntu-blue');
  assert.deepEqual(completeGuest(blue, 'whoa'), { value: 'whoami ' });
  assert.deepEqual(completeGuest(blue, 'nsl'), { value: 'nslookup ' });
  // Several matches with nothing in common to add: the list, for a second Tab.
  const many = completeGuest(blue, 'c');
  assert.ok(many.options.includes('cat') && many.options.includes('cd'));
  assert.equal(completeGuest(blue, 'zzz'), null);
  // PowerShell ignores case and knows its own names.
  const ws = boot('ws01');
  assert.deepEqual(completeGuest(ws, 'IPCO'), { value: 'ipconfig ' });
});

test('later words complete paths: folders end in the separator, files in a space', () => {
  const blue = boot('ubuntu-blue');
  assert.deepEqual(completeGuest(blue, 'cd Doc'), { value: 'cd Documents/' });
  assert.deepEqual(completeGuest(blue, 'cat Documents/run'), { value: 'cat Documents/runbook.txt ' });
  assert.deepEqual(completeGuest(blue, 'cat /var/log/remote/web01/au'), { value: 'cat /var/log/remote/web01/auth.log ' });
  assert.deepEqual(completeGuest(blue, 'ls ~/Pi'), { value: 'ls ~/Pictures/' });
  // Desktop, Documents, Downloads share "D" and then split: the list.
  assert.deepEqual(completeGuest(blue, 'cd D').options, ['Desktop/', 'Documents/', 'Downloads/']);
  // A path that is not there, or quotes: nothing.
  assert.equal(completeGuest(blue, 'cat /nothere/x'), null);
  assert.equal(completeGuest(blue, 'grep "Inv'), null);
  // Winbows paths use backslashes and ignore case.
  const ws = boot('ws01');
  assert.deepEqual(completeGuest(ws, 'type docu'), { value: 'type Documents\\' });
});

test('completion never runs anything and stays quiet at prompts that are not the shell', () => {
  const blue = boot('ubuntu-blue');
  const before = runGuest(blue, 'pwd').lines.map((line) => line.text).join();
  completeGuest(blue, 'cd Doc');
  assert.equal(runGuest(blue, 'pwd').lines.map((line) => line.text).join(), before);
  assert.equal(completeGuest(blue, 'x'.repeat(300)), null);
  // A device still at its login prompt offers nothing.
  const cam = boot('cam01');
  assert.equal(completeGuest(cam, 'ro'), null);
});
