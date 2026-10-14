// Layer 2 lab network (features/fake-network.js, wired in features/guest-engine.js):
// consistent with the rest of the lab and never echoing what was typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');
const { PAGES } = await import('../site/assets/js/data/lab-web.js');

const boot = (id, up = () => true) => {
  const guest = bootGuest(VMS.find((vm) => vm.id === id));
  guest.running = up;
  return guest;
};
const texts = (result) => result.lines.map((line) => line.text).join('\n');

test('powered-off machines do not answer', () => {
  const p = boot('parrot01', (id) => id === 'parrot01');
  assert.match(texts(runGuest(p, 'ping -c 1 web01')), /Destination Host Unreachable/);
  assert.match(texts(runGuest(p, 'curl http://web01.lab.example/')), /No route to host/);
  assert.match(texts(runGuest(p, 'ssh web01')), /No route to host/);
  assert.doesNotMatch(texts(runGuest(p, 'nmap web01')), /scan report for web01/);
});

test('curl serves the same pages the browsers show', () => {
  const p = boot('parrot01');
  assert.equal(texts(runGuest(p, 'curl http://web01.lab.example/robots.txt')).trim(), PAGES['web01.lab.example/robots.txt'].blocks[0].text.trim());
  assert.match(texts(runGuest(p, 'curl http://web01.lab.example/backup-old/notes.txt')), /cam01/);
  assert.match(texts(runGuest(p, 'curl http://web01.lab.example/')), /It works/);
  // Winbows PowerShell 5.1: curl is Invoke-WebRequest.
  assert.match(texts(runGuest(boot('ws01'), 'curl http://web01.lab.example/')), /StatusCode\s+: 200/);
});

test('nmap only where it is installed', () => {
  assert.match(texts(runGuest(boot('parrot01'), 'nmap web01')), /Nmap scan report for web01/);
  const u = boot('ubuntu-red');
  assert.match(texts(runGuest(u, 'nmap web01')), /sudo apt install nmap/);
  runGuest(u, 'sudo apt install nmap');
  assert.match(texts(runGuest(u, 'nmap web01')), /Nmap scan report/);
  assert.match(texts(runGuest(boot('router01'), 'nmap web01')), /not found/);
});

test('unknown hosts are never repeated, and output streams', () => {
  const p = boot('parrot01');
  for (const line of ['ping hunter2x.example', 'curl http://hunter2x.example/', 'ssh hunter2x', 'nmap hunter2x']) {
    const result = runGuest(p, line);
    assert.ok(!texts(result).includes('hunter2x'), line);
    assert.equal(result.echo, null, line);
  }
  assert.ok(runGuest(p, 'ping web01').lines.every((line) => line.ms > 0));
});
