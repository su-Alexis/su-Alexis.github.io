// Blue 1's shell tools (Blue 1 spec, "Engine work"): web01's logs forwarded to
// ubuntu-blue, grep and tail on Linux shells, nslookup from the lab map, cp, and curl -o.
// Doctrine section 7: fixed flags, read-only reads of authored files, free text never
// echoed or kept unless it is the file's own text, writes only where saveFile allows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest, nodeAt } = await import('../site/assets/js/features/guest-engine.js');
const { FORWARDED, forwardedFile } = await import('../site/assets/js/features/scenario.js');

// A guest on a small lab: every VM up, the given scenario list.
function boot(id, scenario = []) {
  const guest = bootGuest(VMS.find((vm) => vm.id === id));
  guest.running = () => true;
  guest.scenario = () => scenario;
  return guest;
}
const texts = (result) => result.lines.map((line) => line.text).join('\n');
const TRAIL = ['e-web01-http-parrot01', 'e-web01-ssh-existing-denied-admin-parrot01', 'e-web01-ssh-invalid-denied-operator-parrot01'];

test("web01's logs are forwarded to ubuntu-blue and match web01's own copies", () => {
  assert.deepEqual(FORWARDED.map((entry) => [entry.to, entry.path, entry.vm, entry.source]), [
    ['ubuntu-blue', 'var/log/remote/web01/auth.log', 'web01', 'var/log/auth.log'],
    ['ubuntu-blue', 'var/log/remote/web01/apache2/access.log', 'web01', 'var/log/apache2/access.log'],
  ]);
  const blue = boot('ubuntu-blue', TRAIL);
  const web = boot('web01', TRAIL);
  assert.equal(texts(runGuest(blue, 'cat /var/log/remote/web01/auth.log')), texts(runGuest(web, 'cat /var/log/auth.log')));
  assert.equal(texts(runGuest(blue, 'cat /var/log/remote/web01/apache2/access.log')), texts(runGuest(web, 'cat /var/log/apache2/access.log')));
  // The source's own lines are filled in for web01, not for the receiver.
  assert.match(texts(runGuest(blue, 'cat /var/log/remote/web01/auth.log')), /web01 sshd\[1184\]/);
  assert.doesNotMatch(texts(runGuest(blue, 'cat /var/log/remote/web01/auth.log')), /ubuntu-blue/);
  // Only the defender's desk receives them.
  assert.equal(nodeAt(boot('ubuntu-red'), ['var', 'log', 'remote']), null);
  assert.equal(forwardedFile('ubuntu-red', 'var/log/remote/web01/auth.log'), null);
});

test('cat, grep and tail report the file they read', () => {
  const blue = boot('ubuntu-blue', TRAIL);
  for (const line of ['cat /var/log/remote/web01/auth.log', 'grep Invalid /var/log/remote/web01/auth.log', 'tail /var/log/remote/web01/auth.log']) {
    const [result] = runGuest(blue, line).results;
    assert.equal(result.outcome, 'ok', line);
    assert.equal(result.read, 'var/log/remote/web01/auth.log', line);
  }
  // A grep that finds nothing exits 1 and reads nothing.
  const miss = runGuest(blue, 'grep zzz /var/log/remote/web01/auth.log');
  assert.equal(miss.failed, true);
  assert.equal(miss.results[0].read, undefined);
});

test('grep: plain text, fixed flags, quoted patterns, and typed text never kept', () => {
  const blue = boot('ubuntu-blue', TRAIL);
  const file = '/var/log/remote/web01/auth.log';
  const quoted = runGuest(blue, `grep -n "Invalid user" ${file}`);
  assert.equal(quoted.echo, `grep -n "Invalid user" ${file}`);
  assert.match(texts(quoted), /^\d+:.*Invalid user operator from 198\.51\.100\.10/);
  assert.equal(texts(runGuest(blue, `grep -c sshd ${file}`)), '5');
  assert.match(texts(runGuest(blue, `grep -i INVALID ${file}`)), /Invalid user/);
  assert.doesNotMatch(texts(runGuest(blue, `grep -v sshd ${file}`)), /sshd/);
  // Regular-expression characters are plain text: no backtracking, no surprises.
  assert.equal(runGuest(blue, `grep (a+)+$ ${file}`).failed, true);
  // A pattern that is not in the file is neither shown nor kept.
  for (const typed of ['hunter2', '<script>alert(1)</script>', '"my secret"']) {
    const result = runGuest(blue, `grep ${typed} ${file}`);
    assert.equal(result.echo, null, typed);
    assert.ok(!texts(result).includes(typed.replace(/"/g, '')), typed);
  }
  // Bad forms: no file, an unknown flag, an unclosed quote, a missing file.
  for (const line of ['grep sshd', `grep -P sshd ${file}`, `grep "sshd ${file}`, 'grep sshd /var/log/nothere', `grep sshd ${file} ${file}`]) {
    const result = runGuest(blue, line);
    assert.equal(result.failed, true, line);
    assert.equal(result.echo, null, line);
  }
});

test('tail: the last lines, -n N or -N, bounded', () => {
  const blue = boot('ubuntu-blue', TRAIL);
  const file = '/var/log/remote/web01/auth.log';
  const all = texts(runGuest(blue, `cat ${file}`)).split('\n');
  assert.deepEqual(texts(runGuest(blue, `tail -n 2 ${file}`)).split('\n'), all.slice(-2));
  assert.deepEqual(texts(runGuest(blue, `tail -1 ${file}`)).split('\n'), all.slice(-1));
  assert.equal(runGuest(blue, `tail -n 2 ${file}`).echo, `tail -n 2 ${file}`);
  for (const line of [`tail -n 0 ${file}`, `tail -n 201 ${file}`, `tail -n x ${file}`, `tail -f ${file}`, 'tail', 'tail /nothere']) {
    assert.equal(runGuest(blue, line).failed, true, line);
  }
});

test('nslookup answers from the lab map, forward and reverse, and never repeats a miss', () => {
  const blue = boot('ubuntu-blue');
  const reverse = runGuest(blue, 'nslookup 198.51.100.10');
  assert.match(texts(reverse), /10\.100\.51\.198\.in-addr\.arpa\s+name = parrot01\.lab\.example\./);
  assert.equal(reverse.results[0].lookup, 'parrot01');
  assert.equal(reverse.echo, 'nslookup 198.51.100.10');
  const forward = runGuest(blue, 'nslookup web01');
  assert.match(texts(forward), /Name:\s+web01\.lab\.example\nAddress: 198\.51\.100\.50/);
  assert.equal(forward.echo, 'nslookup web01.lab.example');
  for (const typed of ['example.com', '203.0.113.9', 'secret-box']) {
    const miss = runGuest(blue, `nslookup ${typed}`);
    assert.equal(miss.failed, true);
    assert.equal(miss.echo, null);
    assert.ok(!texts(miss).includes(typed), typed);
  }
});

test('cp copies what a file reads now into the home, and nowhere else', () => {
  const blue = boot('ubuntu-blue', TRAIL);
  assert.equal(runGuest(blue, 'mkdir ~/evidence').failed, false);
  const copy = runGuest(blue, 'cp /var/log/remote/web01/auth.log ~/evidence/');
  assert.equal(copy.echo, 'cp /var/log/remote/web01/auth.log ~/evidence/auth.log');
  assert.equal(copy.changed, true);
  // The copy keeps the evidence lines as they read at the time.
  assert.match(nodeAt(blue, [...blue.home, 'evidence', 'auth.log']).content, /Invalid user operator/);
  assert.equal(runGuest(blue, 'cp /etc/hostname ~/evidence/host.txt').failed, false);
  const denied = runGuest(blue, 'cp /etc/hostname /etc/copy');
  assert.equal(denied.results[0].outcome, 'denied');
  for (const line of ['cp /etc/hostname', 'cp -r /etc ~/', 'cp /nothere ~/', 'cp /etc ~/etc', 'cp /etc/hostname ~/missing/dir/x']) {
    assert.equal(runGuest(blue, line).failed, true, line);
  }
});

test('curl -o and -O save the page; the request still reaches web01 and leaves its trail', () => {
  const blue = boot('ubuntu-blue');
  runGuest(blue, 'mkdir ~/evidence');
  const named = runGuest(blue, 'curl -o ~/evidence/status.txt https://web01.lab.example/status.txt');
  assert.equal(named.echo, 'curl -o ~/evidence/status.txt https://web01.lab.example/status.txt');
  assert.equal(named.results[0].target, 'web01');
  assert.deepEqual(named.results[0].evidence, ['e-web01-status-before-ubuntu-blue']);
  assert.ok(nodeAt(blue, [...blue.home, 'evidence', 'status.txt']));
  // The progress meter, not the page.
  assert.match(texts(named), /% Total/);
  runGuest(blue, 'cd ~/evidence');
  const remote = runGuest(blue, 'curl -O https://web01.lab.example/maintenance/');
  assert.equal(remote.failed, true);
  assert.equal(runGuest(blue, 'curl -O https://web01.lab.example/status.txt').failed, false);
  // Somewhere the user cannot write, a missing name, or -I with -o.
  for (const line of ['curl -o /etc/status.txt https://web01.lab.example/status.txt', 'curl -o', 'curl -I -o x.txt https://web01.lab.example/']) {
    assert.equal(runGuest(blue, line).failed, true, line);
  }
});
