// Layer 2: web01's shared scenario state (features/scenario.js, data/scenarios/web01.js,
// the red missions' fixtures) and the mission result contract (features/mission-engine.js
// toResult, built by features/guest-engine.js). Doctrine sections 7 and 8: evidence and
// fixture states are a fixed allowlist of IDs, results carry only known values, and
// nothing typed is kept. Assertions name IDs and log shapes only, never mission text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { EVIDENCE_IDS, STATE_IDS, SCENARIO_IDS, ACCOUNTS, evidenceFrom, evidenceLines, stateOf, withState, fixtureText } = await import('../site/assets/js/features/scenario.js');
const { toResult, observe, OUTCOMES, REASONS } = await import('../site/assets/js/features/mission-engine.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');
const { VMS } = await import('../site/assets/js/data/commands.js');
const { LIMITS } = await import('../site/assets/js/core/constants.js');

const vmById = (id) => VMS.find((vm) => vm.id === id);
// A guest on the lab network: powered-on VMs answer, and it sees the scenario list given.
function seat(id, { up = VMS.map((vm) => vm.id), scenario = [] } = {}) {
  const guest = bootGuest(vmById(id));
  guest.running = (other) => up.includes(other);
  guest.scenario = () => scenario;
  return guest;
}
const only = (result) => {
  assert.equal(result.results.length, 1);
  return result.results[0];
};
const textOf = (result) => result.lines.map((line) => line.text);

test('scenario IDs are a fixed, unique, storable allowlist', () => {
  assert.equal(new Set(SCENARIO_IDS).size, SCENARIO_IDS.length);
  for (const id of SCENARIO_IDS) {
    assert.match(id, /^[es]-web01-[A-Za-z0-9-]+$/);
    assert.ok(id.length <= LIMITS.identifierLength);
  }
  // web01 never leaves evidence on itself.
  assert.ok(!EVIDENCE_IDS.some((id) => id.endsWith('-web01')));
  for (const id of ['e-web01-http-parrot01', 'e-web01-maintenance-page-parrot01', 'e-web01-ssh-existing-denied-admin-parrot01',
    'e-web01-ssh-invalid-denied-operator-parrot01', 'e-web01-status-before-parrot01', 'e-web01-status-after-parrot01',
    'e-web01-http-head-parrot01', 'e-web01-maintenance-restore-applied-parrot01']) assert.ok(EVIDENCE_IDS.includes(id), id);
  // Existing accounts only as "existing", the others only as "invalid".
  assert.ok(!EVIDENCE_IDS.includes('e-web01-ssh-existing-denied-operator-parrot01'));
  assert.ok(!EVIDENCE_IDS.includes('e-web01-ssh-invalid-denied-admin-parrot01'));
  // Red 2's two fixtures, then web01's firewall: one deny rule per other lab machine.
  assert.deepEqual(STATE_IDS, ['s-web01-status-altered', 's-web01-publicRestore-disabled',
    ...['ws01', 'parrot01', 'ubuntu-blue', 'ubuntu-red', 'dc01', 'router01', 'cam01'].map((vm) => `s-web01-deny-${vm}-on`)]);
  assert.equal(ACCOUNTS.filter((name) => name === 'root').length, 1);
});

// web01's two content fixtures (the firewall rules are checked in blue-tools.test.mjs).
const content = (state) => ({ status: state.status, publicRestore: state.publicRestore });

test('fixtures start in their first state and change only to known states', () => {
  assert.deepEqual(content(stateOf('web01', [])), { status: 'baseline', publicRestore: 'enabled' });
  const altered = withState([], 'web01', 'status', 'altered');
  assert.deepEqual(altered, ['s-web01-status-altered']);
  assert.deepEqual(content(stateOf('web01', altered)), { status: 'altered', publicRestore: 'enabled' });
  assert.deepEqual(withState(altered, 'web01', 'status', 'baseline'), []);
  assert.deepEqual(withState(altered, 'web01', 'status', 'pwned'), altered);
  assert.deepEqual(withState(altered, 'web01', '__proto__', 'x'), altered);
  assert.notEqual(fixtureText('web01', 'var/www/html/status.txt', []), fixtureText('web01', 'var/www/html/status.txt', altered));
  assert.equal(fixtureText('web01', 'etc/hostname', []), null);
});

test("a page fetched from web01's Apache leaves evidence by method and path, in order", () => {
  const home = only(runGuest(seat('parrot01'), 'curl https://web01.lab.example/'));
  assert.deepEqual(home, {
    seat: 'parrot01', type: 'command', value: 'curl https://web01.lab.example/', target: 'web01',
    account: 'operator', outcome: 'ok', reason: '', evidence: ['e-web01-http-parrot01'],
  });
  assert.deepEqual(only(runGuest(seat('parrot01'), 'curl -I https://web01.lab.example/')).evidence, ['e-web01-http-head-parrot01']);
  assert.deepEqual(only(runGuest(seat('parrot01'), 'curl https://web01.lab.example/maintenance/')).evidence, ['e-web01-maintenance-page-parrot01']);
  assert.equal(only(runGuest(seat('parrot01'), 'curl https://web01.lab.example/maintenance/')).value, 'curl https://web01.lab.example/maintenance/');
  // /status.txt: before or after, by web01's state when it was asked for.
  assert.deepEqual(only(runGuest(seat('parrot01'), 'curl https://web01.lab.example/status.txt')).evidence, ['e-web01-status-before-parrot01']);
  const altered = ['s-web01-status-altered'];
  assert.deepEqual(only(runGuest(seat('parrot01', { scenario: altered }), 'curl https://web01.lab.example/status.txt')).evidence, ['e-web01-status-after-parrot01']);
  assert.notDeepEqual(textOf(runGuest(seat('parrot01'), 'curl https://web01.lab.example/status.txt')), textOf(runGuest(seat('parrot01', { scenario: altered }), 'curl https://web01.lab.example/status.txt')));
  // web01 reads its access log: its own lines first, then the evidence in the order seen.
  const seen = ['e-web01-http-head-parrot01', 'e-web01-http-parrot01'];
  const log = textOf(runGuest(seat('web01', { scenario: seen }), 'cat /var/log/apache2/access.log'));
  assert.match(log[0], /^198\.51\.100\.20 /);
  assert.match(log[log.length - 2], /^198\.51\.100\.10 - - \[11\/Oct\/2026:09:00:00 \+0000\] "HEAD \/ HTTP\/1\.1" 200$/);
  assert.match(log[log.length - 1], /^198\.51\.100\.10 - - \[11\/Oct\/2026:09:01:37 \+0000\] "GET \/ HTTP\/1\.1" 200$/);
  assert.equal(textOf(runGuest(seat('web01'), 'cat /var/log/apache2/access.log')).length, 2);
});

test('a refused ssh login is denied, names the account, and lands in auth.log', () => {
  const admin = only(runGuest(seat('parrot01'), 'ssh admin@web01.lab.example'));
  assert.deepEqual([admin.target, admin.outcome, admin.reason, admin.account], ['web01', 'denied', 'auth', 'operator']);
  assert.deepEqual(admin.evidence, ['e-web01-ssh-existing-denied-admin-parrot01']);
  const other = only(runGuest(seat('parrot01'), 'ssh web01'));
  assert.deepEqual(other.evidence, ['e-web01-ssh-invalid-denied-operator-parrot01']);
  const auth = textOf(runGuest(seat('web01', { scenario: [...admin.evidence, ...other.evidence] }), 'cat /var/log/auth.log'));
  assert.match(auth[auth.length - 2], /sshd\[2101\]: Connection closed by authenticating user admin 198\.51\.100\.10 port 51001 \[preauth\]$/);
  assert.match(auth[auth.length - 1], /sshd\[2102\]: Invalid user operator from 198\.51\.100\.10 port 51002$/);
  // An unknown name is never kept, and leaves no evidence.
  const unknown = only(runGuest(seat('parrot01'), 'ssh hunter2@web01'));
  assert.equal(unknown.value, null);
  assert.deepEqual(unknown.evidence, []);
  assert.ok(!auth.join('\n').includes('hunter2'));
});

test('nothing reaches a powered-off or closed service, so nothing is logged', () => {
  const off = only(runGuest(seat('parrot01', { up: ['parrot01'] }), 'curl http://web01.lab.example/'));
  assert.deepEqual([off.outcome, off.reason, off.evidence], ['failed', 'unreachable', []]);
  const closed = only(runGuest(seat('parrot01'), 'curl http://ws01.lab.example/'));
  assert.deepEqual([closed.target, closed.outcome, closed.reason, closed.evidence], ['ws01', 'failed', 'refused', []]);
  assert.deepEqual(only(runGuest(seat('web01'), 'curl http://web01.lab.example/')).evidence, []);
  assert.equal(only(runGuest(seat('parrot01'), 'nmap -sV -p 22,80,443 web01.lab.example')).target, 'web01');
});

test('the account comes from the shell: sudo runs as root, without it apt is denied', () => {
  const web = seat('web01');
  const denied = only(runGuest(web, 'apt update'));
  assert.deepEqual([denied.account, denied.outcome, denied.reason, denied.value], ['admin', 'denied', 'not-root', 'apt update']);
  const root = only(runGuest(web, 'sudo apt update'));
  assert.deepEqual([root.account, root.outcome, root.value, root.target], ['root', 'ok', 'sudo apt update', 'web01']);
  assert.deepEqual(runGuest(web, 'pwd && whoami').results.map((result) => result.value), ['pwd', 'whoami']);
  assert.deepEqual(runGuest(web, 'definitely-not-a-command').results || [], []);
});

test('lab-restore: preview reads, apply changes web01 once, and only while public restore is on', () => {
  const preview = only(runGuest(seat('parrot01'), 'lab-restore preview web01'));
  assert.deepEqual([preview.value, preview.target, preview.outcome, preview.evidence], ['lab-restore preview web01', 'web01', 'ok', []]);
  assert.equal(preview.effect, undefined);
  assert.equal(only(runGuest(seat('ubuntu-blue'), 'lab-restore preview web01')).outcome, 'ok');
  const apply = only(runGuest(seat('parrot01'), 'lab-restore apply web01'));
  assert.deepEqual([apply.outcome, apply.evidence], ['ok', ['e-web01-maintenance-restore-applied-parrot01']]);
  assert.deepEqual(apply.effect, { vm: 'web01', fixture: 'status', value: 'altered' });
  // Applied already, turned off, the wrong seat, web01 off, unknown words: refused.
  assert.equal(only(runGuest(seat('parrot01', { scenario: ['s-web01-status-altered'] }), 'lab-restore apply web01')).outcome, 'failed');
  const off = only(runGuest(seat('parrot01', { scenario: ['s-web01-publicRestore-disabled'] }), 'lab-restore apply web01'));
  assert.deepEqual([off.outcome, off.reason, off.effect], ['denied', 'permission', undefined]);
  assert.deepEqual([only(runGuest(seat('ubuntu-blue'), 'lab-restore apply web01')).reason], ['seat']);
  assert.equal(only(runGuest(seat('parrot01', { up: ['parrot01'] }), 'lab-restore apply web01')).reason, 'unreachable');
  const odd = only(runGuest(seat('parrot01'), 'lab-restore apply mallory'));
  assert.deepEqual([odd.value, odd.reason], [null, 'invalid']);
  // Machines no form names do not have it.
  assert.deepEqual(runGuest(seat('ws01'), 'lab-restore preview web01').results || [], []);
  // web01's files show the state.
  const before = textOf(runGuest(seat('web01'), 'cat /var/www/html/status.txt'));
  const after = textOf(runGuest(seat('web01', { scenario: ['s-web01-status-altered'] }), 'cat /var/www/html/status.txt'));
  assert.notDeepEqual(before, after);
});

test('toResult keeps only known values and fails closed', () => {
  assert.equal(toResult(null), null);
  assert.equal(toResult({ seat: 'nope', type: 'command', value: 'ls' }), null);
  assert.equal(toResult({ seat: 'ws01', type: 'constructor', value: 'ls' }), null);
  const odd = toResult({ seat: 'web01', type: 'command', value: 'ls', target: '__proto__', account: 'mallory', outcome: 'pwned', reason: 'because', evidence: ['e-web01-http-parrot01', 'bogus', 7], state: { status: 'altered', __proto__: { x: 1 }, publicRestore: 'sideways' }, read: 'var/log/bad name!', lookup: 'constructor' });
  assert.deepEqual({ ...odd, evidence: [...odd.evidence], state: { ...odd.state } }, {
    seat: 'web01', type: 'command', value: 'ls', target: 'web01', account: 'admin',
    outcome: 'failed', reason: '', evidence: ['e-web01-http-parrot01'], state: { status: 'altered' },
    read: null, lookup: null,
  });
  const kept = toResult({ seat: 'ubuntu-blue', type: 'command', value: 'cat x', read: 'var/log/remote/web01/auth.log', lookup: 'parrot01' });
  assert.deepEqual([kept.read, kept.lookup], ['var/log/remote/web01/auth.log', 'parrot01']);
  assert.equal(toResult({ seat: 'ws01', type: 'app', value: 'taskmgr' }).outcome, 'ok');
  assert.equal(toResult({ seat: 'ws01', type: 'command', value: 'x'.repeat(600) }).value, null);
  assert.ok(OUTCOMES.includes('denied') && REASONS.includes('not-root'));
  assert.deepEqual(evidenceFrom(null), []);
  assert.deepEqual(evidenceFrom({ seat: 'parrot01', target: 'web01', contact: { service: 'ssh', user: 'mallory' } }), []);
  assert.deepEqual(evidenceLines('web01', 'var/log/auth.log', ['bogus']), []);
});

test('objectives count a command only when it worked', () => {
  const event = { seat: 'ws01', type: 'command', value: 'sfc /scannow' };
  assert.deepEqual(observe([], { ...event, outcome: 'denied', reason: 'permission' }).flags, []);
  assert.deepEqual(observe([], { ...event, outcome: 'failed' }).flags, []);
  assert.deepEqual(observe([], { ...event, outcome: 'ok' }).flags, ['m-ws01-baseline-sfc']);
  assert.deepEqual(observe([], only(runGuest(seat('ws01'), 'SFC /SCANNOW'))).flags, ['m-ws01-baseline-sfc']);
});
