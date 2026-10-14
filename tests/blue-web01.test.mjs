// Blue 1 step 7's tools on web01 (Blue 1 spec, "Engine work"): sed -i on its maintenance
// setting, restoring status.txt from its backup, and ufw deny honoured by the lab network
// (a drop times out; it is never refused). Writes to web01's tracked files are root only
// and can only land on a known version, so the shared scenario state stays fixed IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');
const { withState, stateOf, fixtureText, firewallRules } = await import('../site/assets/js/features/scenario.js');

const texts = (result) => result.lines.map((line) => line.text).join('\n');

// A small lab whose guests share one scenario list, applying each command's evidence and
// then its effect, the way layers/layer2.js does.
function lab(start = []) {
  const state = { scenario: [...start] };
  const guests = new Map();
  const guest = (id) => {
    if (!guests.has(id)) {
      const g = bootGuest(VMS.find((vm) => vm.id === id));
      g.running = () => true;
      g.scenario = () => state.scenario;
      guests.set(id, g);
    }
    return guests.get(id);
  };
  const run = (id, line) => {
    const result = runGuest(guest(id), line);
    for (const item of result.results || []) {
      for (const id2 of item.evidence || []) if (!state.scenario.includes(id2)) state.scenario = [...state.scenario, id2];
      if (item.effect) state.scenario = withState(state.scenario, item.effect.vm, item.effect.fixture, item.effect.value);
    }
    return result;
  };
  return { state, run, web: () => stateOf('web01', state.scenario) };
}
const ALTERED = ['s-web01-status-altered'];
const SED_OFF = "sed -i 's/public_restore=enabled/public_restore=disabled/' /etc/lab-maintenance.conf";
const SED_ON = "sed -i 's/public_restore=disabled/public_restore=enabled/' /etc/lab-maintenance.conf";

test("web01 keeps a known-good backup of status.txt, matching the file's first state", () => {
  const world = lab(ALTERED);
  const backup = texts(world.run('web01', 'cat /var/backups/status.txt'));
  assert.equal(backup, fixtureText('web01', 'var/www/html/status.txt', []).replace(/\n$/, ''));
  assert.notEqual(backup, texts(world.run('web01', 'cat /var/www/html/status.txt')));
});

test('sed -i turns public restore off (root only, known settings only)', () => {
  const world = lab();
  const denied = world.run('web01', SED_OFF);
  assert.equal(denied.results[0].outcome, 'denied');
  assert.equal(denied.results[0].reason, 'not-root');
  assert.equal(world.web().publicRestore, 'enabled');
  const done = world.run('web01', `sudo ${SED_OFF}`);
  assert.equal(done.failed, false);
  assert.equal(done.echo, `sudo ${SED_OFF}`);
  assert.equal(done.results[0].account, 'root');
  assert.equal(world.web().publicRestore, 'disabled');
  assert.match(texts(world.run('web01', 'cat /etc/lab-maintenance.conf')), /^public_restore=disabled$/m);
  // Again: nothing matches, so no change and no output.
  assert.deepEqual(world.run('web01', `sudo ${SED_OFF}`).lines, []);
  // And back on (how to recover a trail restored before it was preserved).
  world.run('web01', `sudo ${SED_ON}`);
  assert.equal(world.web().publicRestore, 'enabled');
  // A setting the lab does not know is refused, and the typed text is not kept or shown.
  const odd = world.run('web01', "sudo sed -i 's/public_restore=enabled/hacked=yes/' /etc/lab-maintenance.conf");
  assert.equal(odd.failed, true);
  assert.equal(odd.echo, null);
  assert.ok(!texts(odd).includes('hacked'));
  assert.equal(world.web().publicRestore, 'enabled');
  // Other system files stay read-only, even for root; without -i sed does nothing.
  assert.equal(world.run('web01', "sudo sed -i 's/web01/x/' /etc/hostname").failed, true);
  assert.equal(world.run('web01', "sed 's/a/b/' /etc/hostname").failed, true);
  for (const line of ['sudo sed -i s/a/b /etc/lab-maintenance.conf', "sudo sed -i 's/a/b/'", "sudo sed -i 's/a/b/ /etc/lab-maintenance.conf"]) {
    assert.equal(world.run('web01', line).failed, true, line);
  }
});

test('sed -i edits the user\'s own files too, without keeping the typed expression', () => {
  const world = lab();
  world.run('ubuntu-blue', 'cp /etc/hostname ~/host.txt');
  const edit = world.run('ubuntu-blue', "sed -i 's/ubuntu/box/' ~/host.txt");
  assert.equal(edit.failed, false);
  assert.equal(edit.echo, null);
  assert.match(texts(world.run('ubuntu-blue', 'cat ~/host.txt')), /box-blue/);
});

test('sudo cp restores status.txt from the backup; nothing else may overwrite it', () => {
  const world = lab(ALTERED);
  const copy = 'cp /var/backups/status.txt /var/www/html/status.txt';
  assert.equal(world.run('web01', copy).results[0].reason, 'not-root');
  assert.equal(world.web().status, 'altered');
  // Another file's text is not a known version of status.txt.
  assert.equal(world.run('web01', 'sudo cp /etc/hostname /var/www/html/status.txt').failed, true);
  assert.equal(world.web().status, 'altered');
  const done = world.run('web01', `sudo ${copy}`);
  assert.equal(done.failed, false);
  assert.equal(done.echo, `sudo ${copy}`);
  assert.equal(world.web().status, 'baseline');
  // Root still cannot scatter files around the system.
  assert.equal(world.run('web01', 'sudo cp /etc/hostname /etc/copy').failed, true);
});

test('ufw: root only, lab addresses only, deny and delete, and a status that lists the rules', () => {
  const world = lab();
  assert.equal(firewallRules('web01').length, VMS.length - 1);
  assert.equal(world.run('web01', 'ufw deny from 198.51.100.10').results[0].reason, 'not-root');
  assert.equal(texts(world.run('web01', 'sudo ufw status')), 'Status: active');
  const added = world.run('web01', 'sudo ufw deny from 198.51.100.10');
  assert.equal(texts(added), 'Rule added');
  assert.equal(added.echo, 'sudo ufw deny from 198.51.100.10');
  assert.equal(world.web()['deny-parrot01'], 'on');
  assert.equal(texts(world.run('web01', 'sudo ufw deny from 198.51.100.10')), 'Skipping adding existing rule');
  assert.match(texts(world.run('web01', 'sudo ufw status')), /Anywhere\s+DENY\s+198\.51\.100\.10/);
  assert.match(texts(world.run('web01', 'sudo ufw status numbered')), /\[ 1\] Anywhere\s+DENY IN\s+198\.51\.100\.10/);
  // Names, foreign addresses, its own address and junk are refused without repeating them.
  for (const typed of ['parrot01', '203.0.113.7', '198.51.100.50', 'evil;rm']) {
    const result = world.run('web01', `sudo ufw deny from ${typed}`);
    assert.equal(result.failed, true, typed);
    assert.equal(result.echo, null, typed);
    assert.ok(!texts(result).includes(typed), typed);
  }
  assert.equal(texts(world.run('web01', 'sudo ufw delete deny from 198.51.100.10')), 'Rule deleted');
  assert.equal(world.web()['deny-parrot01'], 'off');
  assert.equal(world.run('web01', 'sudo ufw delete deny from 198.51.100.10').failed, true);
  // Other Ubuntu machines' firewalls are not part of the lab; ParrotOS has no ufw.
  assert.equal(texts(world.run('ubuntu-blue', 'sudo ufw status')), 'Status: inactive');
  assert.equal(world.run('ubuntu-blue', 'sudo ufw deny from 198.51.100.10').failed, true);
  assert.equal(world.run('parrot01', 'ufw status').failed, true);
});

test("a denied seat's traffic to web01 is dropped: it times out, leaves no trail, and lab-restore cannot reach", () => {
  const world = lab(['s-web01-deny-parrot01-on']);
  for (const [line, pattern] of [
    ['curl https://web01.lab.example/', /Connection timed out/],
    ['ssh admin@web01.lab.example', /Connection timed out/],
    ['ping -c 2 web01', /100% packet loss/],
    ['lab-restore apply web01', /Connection timed out/],
  ]) {
    const result = world.run('parrot01', line);
    assert.equal(result.failed, true, line);
    assert.match(texts(result), pattern, line);
    assert.equal(result.results[0].reason, 'filtered', line);
    assert.deepEqual(result.results[0].evidence, [], line);
  }
  // Never "connection refused": that is what reject (or a closed port) would say.
  assert.doesNotMatch(texts(world.run('parrot01', 'curl https://web01.lab.example/')), /refused/);
  assert.equal(world.web().status, 'baseline');
  assert.match(texts(world.run('parrot01', 'nmap -sV web01')), /Host seems down/);
  assert.match(texts(world.run('parrot01', 'nmap -Pn web01')), /filtered tcp ports \(no-response\)/);
  // Everyone else still gets through.
  const blue = world.run('ubuntu-blue', 'curl https://web01.lab.example/');
  assert.equal(blue.failed, false);
  assert.deepEqual(blue.results[0].evidence, ['e-web01-http-ubuntu-blue']);
});
