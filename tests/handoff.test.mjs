// The red/blue fit check (handoff protocol, "Blue 1 spec: Who was here?" doc): the red
// missions (owner-written data/missions/red-1.js, red-2.js) wired into the engine, and the
// traces Blue 1 expects. Plays each red mission through the real guest engine and mission
// engine, the way layers/layer2.js does, and checks it finishes and leaves its trail.
//
// Every assertion names IDs only; no mission text is printed, even on failure, so the
// result is safe to report back across threads.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MISSIONS, MISSION_FLAG_IDS, observe, checkReport, missionView, missionsFor } = await import('../site/assets/js/features/mission-engine.js');
const { EVIDENCE_IDS, stateOf, withState } = await import('../site/assets/js/features/scenario.js');
const { bootGuest, runGuest, nodeAt, saveFile } = await import('../site/assets/js/features/guest-engine.js');
const { VMS } = await import('../site/assets/js/data/commands.js');

const RED = MISSIONS.filter((mission) => /^red-\d$/.test(mission.id));
// The contract slots Blue 1 reads (data/missions/blue-1.js expects; R1-c is optional).
const BLUE = MISSIONS.find((mission) => mission.id === 'blue-1');
const BLUE_EXPECTS = BLUE.expects;
const ok = (condition, id) => assert.ok(condition, id);
// web01's two content fixtures; its firewall rules (deny-<vm>) are Blue 1's.
const content = (state) => ({ status: state.status, publicRestore: state.publicRestore });

// A small lab: running guests that share one scenario list and one set of flags, fed the
// way layers/layer2.js feeds them.
function lab() {
  const state = { flags: [], scenario: [], guests: new Map() };
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
  const feed = (event) => {
    for (const id of event.evidence || []) if (!state.scenario.includes(id)) state.scenario = [...state.scenario, id];
    if (event.effect) state.scenario = withState(state.scenario, event.effect.vm, event.effect.fixture, event.effect.value);
    const target = event.target || event.seat;
    const out = observe(state.flags, { ...event, state: stateOf(target, state.scenario) }, { scenario: state.scenario, hasFile });
    state.flags = [...state.flags, ...out.flags];
    return out;
  };
  return {
    state,
    run: (vm, line) => (runGuest(guest(vm), line).results || []).map(feed),
    save: (vm, path) => {
      const segments = path.split('/');
      assert.ok(saveFile(guest(vm), segments.slice(0, -1), segments[segments.length - 1], 'notes').ok, path);
      return feed({ seat: vm, type: 'saved', value: path });
    },
    report: (mission) => feed({ seat: mission.report.seat || mission.seat, type: 'report', value: mission.id }),
  };
}

// The authored answers, as the Tickets form would send them.
const rightAnswers = (mission) => Object.fromEntries(mission.report.questions.map((question) => [question.id, [...question.answer]]));

// Plays one mission's objectives in order, from the commands and files its data names.
function playMission(world, mission) {
  for (const objective of mission.objectives) {
    const when = objective.when;
    if (when.commands) world.run(mission.seat, when.commands[0]);
    if (when.saved) world.save(mission.seat, when.saved[0]);
    if (when.report) {
      const report = MISSIONS.find((entry) => entry.id === when.report);
      ok(checkReport(report, rightAnswers(report)).ok, `${report.id} report answers`);
      world.report(report);
    }
    ok(world.state.flags.includes(`m-${mission.id}-${objective.id}`), `${mission.id} ${objective.id} unreachable`);
  }
}

test('red missions are wired: known seat and targets, flags, and handoff slots that exist', () => {
  assert.deepEqual(RED.map((mission) => mission.id), ['red-1', 'red-2']);
  for (const mission of RED) {
    ok(VMS.some((vm) => vm.id === mission.seat), `${mission.id} seat`);
    for (const target of mission.targets) ok(VMS.some((vm) => vm.id === target), `${mission.id} target ${target}`);
    for (const objective of mission.objectives) {
      ok(MISSION_FLAG_IDS.includes(`m-${mission.id}-${objective.id}`), `${mission.id} ${objective.id} flag`);
      for (const id of objective.when.evidence || []) ok(EVIDENCE_IDS.includes(id), `${mission.id} ${objective.id} evidence ${id}`);
      for (const id of objective.dependsOn || []) ok(mission.objectives.some((other) => other.id === id), `${mission.id} ${objective.id} dependsOn ${id}`);
    }
    for (const id of mission.completeWhen.evidence) ok(EVIDENCE_IDS.includes(id), `${mission.id} completeWhen ${id}`);
    assert.deepEqual([...mission.provides].sort(), mission.handoff.map((slot) => slot.slot).sort(), `${mission.id} provides`);
    for (const slot of mission.handoff) for (const id of slot.evidence || []) ok(EVIDENCE_IDS.includes(id), `${slot.slot} ${id}`);
  }
  assert.deepEqual(missionsFor('parrot01').map((mission) => mission.id), ['red-1', 'red-2']);
});

test("every slot Blue 1 expects is provided by a red mission", () => {
  const provided = RED.flatMap((mission) => mission.provides);
  for (const slot of BLUE_EXPECTS) ok(provided.includes(slot), `${slot} missing`);
});

test('red-1 then red-2 play end to end, leave the trail, and unlock ubuntu-blue', () => {
  const world = lab();
  world.state.flags = ['m-ws01-baseline-done'];
  const [red1, red2] = RED;
  // red-2 waits for red-1.
  ok(!missionView(world.state.flags, red2).open, 'red-2 open too early');
  playMission(world, red1);
  ok(world.state.flags.includes('m-red-1-done'), 'red-1 not done');
  ok(missionView(world.state.flags, red2).open, 'red-2 not open');
  playMission(world, red2);
  ok(world.state.flags.includes('m-red-2-done'), 'red-2 not done');
  // The trail Blue 1 reads: every slot's evidence, and web01 altered with public restore on.
  for (const mission of RED) for (const slot of mission.handoff) for (const id of slot.evidence || []) ok(world.state.scenario.includes(id), `${slot.slot} ${id} not left`);
  assert.deepEqual(content(stateOf('web01', world.state.scenario)), { status: 'altered', publicRestore: 'enabled' });
});

test('red-2 rewards ubuntu-blue once both are done', () => {
  const world = lab();
  world.state.flags = ['m-ws01-baseline-done'];
  let unlocks = [];
  const [red1, red2] = RED;
  playMission(world, red1);
  // Play red-2, keeping what the last step returns.
  for (const objective of red2.objectives) {
    const when = objective.when;
    if (when.commands) unlocks = [...unlocks, ...world.run(red2.seat, when.commands[0]).flatMap((out) => out.unlocks)];
    if (when.saved) unlocks = [...unlocks, ...world.save(red2.seat, when.saved[0]).unlocks];
    if (when.report) unlocks = [...unlocks, ...world.report(red2).unlocks];
  }
  assert.deepEqual(unlocks, ['ubuntu-blue']);
});

test('reports: wrong or missing answers are named by question id only', () => {
  for (const mission of RED) {
    const answers = rightAnswers(mission);
    const first = mission.report.questions[0];
    assert.deepEqual(checkReport(mission, { ...answers, [first.id]: ['not-an-option'] }), { ok: false, wrong: [first.id] });
    assert.equal(checkReport(mission, {}).ok, false);
    assert.equal(checkReport(mission, null).ok, false);
  }
});

test('out-of-order steps do not count, and a refused apply leaves web01 alone', () => {
  const world = lab();
  world.state.flags = ['m-ws01-baseline-done', 'm-red-1-done'];
  const [, red2] = RED;
  // Skipping ahead: apply before the earlier steps does not tick r2-apply.
  world.run('parrot01', 'lab-restore apply web01');
  ok(!world.state.flags.includes('m-red-2-r2-apply'), 'r2-apply out of order');
  // With public restore turned off, apply is refused and changes nothing.
  const fresh = lab();
  fresh.state.scenario = ['s-web01-publicRestore-disabled'];
  fresh.run('parrot01', 'lab-restore apply web01');
  assert.deepEqual(content(stateOf('web01', fresh.state.scenario)), { status: 'baseline', publicRestore: 'disabled' });
  ok(!fresh.state.scenario.some((id) => id.startsWith('e-web01-maintenance-restore-applied')), 'applied evidence when refused');
  ok(red2.objectives.length > 0, 'red-2 objectives');
});
