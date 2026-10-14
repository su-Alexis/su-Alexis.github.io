// Blue 1, "Who was here?" (data/missions/blue-1.js), played end to end through the real
// guest engine and mission engine, the way layers/layer2.js feeds them: the red missions
// first (from their own data, never printed), then B1 to B8 on ubuntu-blue, web01's
// console and parrot01. Tickets answers are checked with checkAsk and sent as 'answer'
// results, as the Tickets app does. Assertions name IDs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MISSIONS, observe, askView, checkAsk, missionView } = await import('../site/assets/js/features/mission-engine.js');
const { stateOf, withState, ACCOUNTS } = await import('../site/assets/js/features/scenario.js');
const { bootGuest, runGuest, nodeAt, children, saveFile } = await import('../site/assets/js/features/guest-engine.js');
const { VMS } = await import('../site/assets/js/data/commands.js');

const BLUE = MISSIONS.find((mission) => mission.id === 'blue-1');
const RED = MISSIONS.filter((mission) => /^red-\d$/.test(mission.id));
const step = (id) => BLUE.objectives.find((objective) => objective.id === id);
const ip = (id) => VMS.find((vm) => vm.id === id).ip;
const SED_OFF = "sudo sed -i 's/public_restore=enabled/public_restore=disabled/' /etc/lab-maintenance.conf";
const SED_ON = "sudo sed -i 's/public_restore=disabled/public_restore=enabled/' /etc/lab-maintenance.conf";
const RESTORE = 'sudo cp /var/backups/status.txt /var/www/html/status.txt';

// A small lab: running guests sharing one scenario list and one set of flags.
function lab() {
  const state = { flags: ['m-ws01-baseline-done'], scenario: [], guests: new Map(), asked: [], unlocks: [] };
  const guest = (id) => {
    if (!state.guests.has(id)) {
      const g = bootGuest(VMS.find((vm) => vm.id === id));
      g.running = () => true;
      g.scenario = () => state.scenario;
      state.guests.set(id, g);
    }
    return state.guests.get(id);
  };
  const hasFile = (vm, path) => {
    const node = nodeAt(guest(vm), path.split('/'));
    return Boolean(node && !node.dir);
  };
  const files = (vm, path) => {
    const dir = nodeAt(guest(vm), path.split('/'));
    return dir && dir.dir ? children(guest(vm), dir).filter((node) => !node.dir).map((node) => ({ content: node.content })) : [];
  };
  const feed = (event) => {
    for (const id of event.evidence || []) if (!state.scenario.includes(id)) state.scenario = [...state.scenario, id];
    if (event.effect) state.scenario = withState(state.scenario, event.effect.vm, event.effect.fixture, event.effect.value);
    const out = observe(state.flags, { ...event, state: stateOf(event.target || event.seat, state.scenario) }, { scenario: state.scenario, hasFile, files });
    state.flags = [...state.flags, ...out.flags];
    state.asked.push(...out.asked.map((entry) => entry.objective.id));
    state.unlocks.push(...out.unlocks);
    return out;
  };
  const run = (vm, line) => (runGuest(guest(vm), line).results || []).map(feed);
  return {
    state, run, feed,
    has: (flag) => state.flags.includes(flag),
    // The Tickets app: the questions as shown, answered right, checked, then sent.
    answer: (id, seat = BLUE.seat) => {
      const objective = step(id);
      const view = askView(BLUE, objective, state.scenario);
      const answers = Object.fromEntries(view.map((question) => [question.id, question.answer]));
      assert.ok(checkAsk(BLUE, objective, answers, state.scenario).ok, `${id} answers`);
      return feed({ seat, type: 'answer', value: id });
    },
    view: (id) => askView(BLUE, step(id), state.scenario),
    // The red missions, from their own data (commands, files, reports), never printed.
    playRed: () => {
      for (const mission of RED) {
        for (const objective of mission.objectives) {
          const when = objective.when;
          if (when.commands) run(mission.seat, when.commands[0]);
          if (when.saved) {
            const segments = when.saved[0].split('/');
            saveFile(guest(mission.seat), segments.slice(0, -1), segments.at(-1), 'notes');
            feed({ seat: mission.seat, type: 'saved', value: when.saved[0] });
          }
          if (when.report) feed({ seat: mission.report.seat || mission.seat, type: 'report', value: when.report });
        }
        assert.ok(state.flags.includes(`m-${mission.id}-done`), `${mission.id} not done`);
      }
    },
  };
}

// B1 to B5: the investigation, up to the questions of the timeline step.
function investigate(world) {
  world.run('ubuntu-blue', 'sudo apt install nmap');
  world.run('ubuntu-blue', 'nmap -sV web01');
  assert.ok(world.has('m-blue-1-surface'), 'surface');
  world.run('ubuntu-blue', 'cat /var/log/remote/web01/apache2/access.log');
  world.answer('site-log');
  world.run('ubuntu-blue', `nslookup ${ip('parrot01')}`);
  world.answer('which-vm');
  world.run('ubuntu-blue', 'grep sshd /var/log/remote/web01/auth.log');
  world.answer('auth-log');
  world.run('ubuntu-blue', 'grep lab-maintenance /var/log/remote/web01/auth.log');
  world.answer('timeline');
}
function preserve(world) {
  world.run('ubuntu-blue', 'mkdir ~/evidence');
  world.run('ubuntu-blue', 'cp /var/log/remote/web01/auth.log ~/evidence/');
  world.run('ubuntu-blue', 'curl -o ~/evidence/status.txt https://web01.lab.example/status.txt');
}

test('blue-1 is wired: seat, scenario, flags, its expected slots, and fixed-choice questions', () => {
  assert.equal(BLUE.seat, 'ubuntu-blue');
  assert.equal(BLUE.scenario, 'web01');
  assert.equal(BLUE.reward.unlock, 'ubuntu-red');
  assert.deepEqual(BLUE.objectives.map((objective) => objective.id), ['surface', 'site-log', 'which-vm', 'auth-log', 'timeline', 'preserve', 'recover', 'verify']);
  for (const objective of BLUE.objectives) {
    assert.equal(objective.hints.length, 3, objective.id);
    for (const id of objective.dependsOn || []) assert.ok(BLUE.objectives.some((other) => other.id === id), `${objective.id} dependsOn ${id}`);
  }
  // Every question has fixed choices, and every fixed answer is one of them.
  for (const objective of BLUE.objectives.filter((entry) => entry.ask)) {
    for (const question of askView(BLUE, objective, [])) {
      assert.ok(question.options.length >= 2, `${objective.id} ${question.id} options`);
      for (const value of question.answer) assert.ok(question.options.some((option) => option.value === value), `${objective.id} ${question.id} answer`);
    }
  }
  // The defender's desk and web01 itself are never offered as suspects.
  const vms = askView(BLUE, step('which-vm'), [])[0].options.map((option) => option.value);
  assert.ok(!vms.includes('web01') && vms.includes('ubuntu-blue'));
});

test('blue-1 waits for red-2', () => {
  const world = lab();
  assert.equal(missionView(world.state.flags, BLUE).open, false);
  world.run('ubuntu-blue', 'sudo apt install nmap');
  world.run('ubuntu-blue', 'nmap -sV web01');
  assert.ok(!world.has('m-blue-1-surface'));
});

test('red-1, red-2, then blue-1 end to end: answers follow the trail, and ubuntu-red unlocks', () => {
  const world = lab();
  world.playRed();
  assert.ok(missionView(world.state.flags, BLUE).open, 'blue-1 open');
  investigate(world);
  for (const id of ['site-log', 'which-vm', 'auth-log', 'timeline']) assert.ok(world.has(`m-blue-1-${id}`), id);
  // The answers came from the recorded trail: parrot01 was the seat.
  assert.deepEqual(world.state.asked.slice(0, 4), ['site-log', 'which-vm', 'auth-log', 'timeline']);
  const accounts = world.view('auth-log')[0].answer;
  assert.ok(accounts.length > 0 && accounts.every((name) => ACCOUNTS.includes(name)), 'accounts');
  assert.deepEqual(world.view('site-log')[0].answer, [ip('parrot01')]);
  assert.deepEqual(world.view('which-vm')[0].answer, ['parrot01']);
  assert.deepEqual(world.view('timeline')[1].answer, ['recon']);
  preserve(world);
  assert.ok(world.has('m-blue-1-preserve'), 'preserve');
  world.run('web01', SED_OFF);
  assert.ok(!world.has('m-blue-1-recover'), 'recover needs both');
  world.run('web01', RESTORE);
  assert.ok(world.has('m-blue-1-recover'), 'recover');
  world.run('parrot01', 'lab-restore apply web01');
  assert.ok(world.has('m-blue-1-verify-seen'), 'verify seen');
  assert.deepEqual(stateOf('web01', world.state.scenario).status, 'baseline');
  assert.deepEqual(world.view('verify')[0].answer, ['parrot01']);
  assert.deepEqual(world.view('verify')[3].answer, ['preserved', 'disabled', 'restored', 'verified']);
  world.answer('verify');
  assert.ok(world.has('m-blue-1-done'), 'done');
  assert.deepEqual(world.state.unlocks, ['ubuntu-blue', 'ubuntu-red']);
});

test('questions open only after their action, answers count only from ubuntu-blue, and wrong answers are named by id', () => {
  const world = lab();
  world.playRed();
  world.run('ubuntu-blue', 'sudo apt install nmap');
  // Reading the log before the scan does not open its questions (steps go in order).
  world.run('ubuntu-blue', 'cat /var/log/remote/web01/apache2/access.log');
  assert.ok(!world.has('m-blue-1-site-log-seen'));
  world.run('ubuntu-blue', 'nmap -sV web01');
  // An answer before the questions are open is ignored.
  world.feed({ seat: 'ubuntu-blue', type: 'answer', value: 'site-log' });
  assert.ok(!world.has('m-blue-1-site-log'));
  world.run('ubuntu-blue', 'tail /var/log/remote/web01/apache2/access.log');
  assert.ok(world.has('m-blue-1-site-log-seen'));
  // From another seat, or for another step, an answer does nothing.
  world.feed({ seat: 'parrot01', type: 'answer', value: 'site-log' });
  world.feed({ seat: 'ubuntu-blue', type: 'answer', value: 'which-vm' });
  assert.ok(!world.has('m-blue-1-site-log') && !world.has('m-blue-1-which-vm'));
  // Wrong or extra choices are refused; only authored options are compared.
  const objective = step('site-log');
  assert.deepEqual(checkAsk(BLUE, objective, { source: [ip('ubuntu-blue')] }, world.state.scenario), { ok: false, wrong: ['source'] });
  assert.deepEqual(checkAsk(BLUE, objective, { source: [ip('parrot01'), ip('ws01')] }, world.state.scenario), { ok: false, wrong: ['source'] });
  assert.equal(checkAsk(BLUE, objective, { source: ['<b>x</b>'] }, world.state.scenario).ok, false);
  assert.equal(checkAsk(BLUE, objective, null, world.state.scenario).ok, false);
  assert.equal(checkAsk(BLUE, step('surface'), {}, world.state.scenario).ok, false);
});

test('recovering before preserving leaves nothing to preserve; re-applying the change brings the trail back', () => {
  const world = lab();
  world.playRed();
  investigate(world);
  world.run('web01', RESTORE);
  preserve(world);
  assert.ok(!world.has('m-blue-1-preserve'), 'a restored page is not the evidence');
  // How to get the evidence back: re-enable, re-apply from parrot01, then preserve again.
  world.run('web01', SED_ON);
  world.run('parrot01', 'lab-restore apply web01');
  world.run('ubuntu-blue', 'curl -o ~/evidence/status.txt https://web01.lab.example/status.txt');
  assert.ok(world.has('m-blue-1-preserve'), 'preserve after re-apply');
});

test('a firewall block cannot stand in for the fix: a dropped apply does not verify', () => {
  const world = lab();
  world.playRed();
  investigate(world);
  preserve(world);
  world.run('web01', `sudo ufw deny from ${ip('parrot01')}`);
  world.run('web01', RESTORE);
  // Public restore still on: the block hides it, so verify must not count.
  world.run('parrot01', 'lab-restore apply web01');
  assert.ok(!world.has('m-blue-1-recover') && !world.has('m-blue-1-verify-seen'));
  world.run('web01', SED_OFF);
  assert.ok(world.has('m-blue-1-recover'));
  // Still blocked: the apply times out (filtered), which proves nothing.
  world.run('parrot01', 'lab-restore apply web01');
  assert.ok(!world.has('m-blue-1-verify-seen'));
  // Lift the block, test the setting itself, and the closing form also expects the block.
  world.run('web01', `sudo ufw delete deny from ${ip('parrot01')}`);
  world.run('parrot01', 'lab-restore apply web01');
  assert.ok(world.has('m-blue-1-verify-seen'));
  world.run('web01', `sudo ufw deny from ${ip('parrot01')}`);
  assert.ok(world.view('verify')[3].answer.includes('blocked'));
  world.answer('verify');
  assert.ok(world.has('m-blue-1-done'));
});

test('blue-1 does not finish while the fix is undone', () => {
  const world = lab();
  world.playRed();
  investigate(world);
  preserve(world);
  world.run('web01', SED_OFF);
  world.run('web01', RESTORE);
  world.run('parrot01', 'lab-restore apply web01');
  world.run('web01', SED_ON);
  world.answer('verify');
  assert.ok(world.has('m-blue-1-verify') && !world.has('m-blue-1-done'));
  world.run('web01', SED_OFF);
  assert.ok(world.has('m-blue-1-done'));
});
