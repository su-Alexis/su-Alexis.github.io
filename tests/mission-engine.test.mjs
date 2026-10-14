// Layer 2 mission engine (features/mission-engine.js) and the first mission, Baseline ws01
// (data/missions/ws01-baseline.js). Doctrine section 7: authored data, fixed flags,
// objectives met by the simulation's own events, never by free text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MISSIONS, MISSION_FLAG_IDS, observe, missionView, missionsFor } = await import('../site/assets/js/features/mission-engine.js');
const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');

const mission = MISSIONS.find((entry) => entry.id === 'ws01-baseline');

test('missions are well formed: a known VM, objectives with hints, a known reward', () => {
  for (const entry of MISSIONS) {
    assert.ok(VMS.some((vm) => vm.id === entry.seat), entry.id);
    assert.ok(entry.objectives.length > 0 && entry.briefing.length > 0);
    for (const objective of entry.objectives) {
      assert.ok(objective.hints.length >= 2, objective.id);
      assert.match(objective.id, /^[a-z0-9-]+$/);
    }
    if (entry.reward && entry.reward.unlock) assert.ok(VMS.some((vm) => vm.id === entry.reward.unlock && vm.unlock));
  }
  // One flag per objective, plus a -seen flag for each step with questions (Blue 1).
  const seen = (entry) => entry.objectives.filter((objective) => objective.ask).length;
  assert.equal(MISSION_FLAG_IDS.length, MISSIONS.reduce((n, entry) => n + entry.objectives.length + seen(entry) + (entry.report ? 2 : 1), 0));
  assert.deepEqual(missionsFor('ws01').map((entry) => entry.id), ['ws01-baseline']);
});

test("the shell's own canonical commands complete objectives", () => {
  // The echo the console keeps is what the engine sees: run the real commands.
  const ws = bootGuest(VMS.find((vm) => vm.id === 'ws01'));
  const echoes = ['SFC /SCANNOW', 'DISM /Online /Cleanup-Image /RestoreHealth', 'Get-Process', 'type Documents\\baseline.txt'].map((line) => runGuest(ws, line).echo);
  let flags = [];
  for (const echo of echoes) flags = [...flags, ...observe(flags, { seat: 'ws01', type: 'command', value: echo }).flags];
  const view = missionView(flags, mission);
  assert.deepEqual(view.objectives.map((objective) => objective.done), [true, true, true, true, false]);
  assert.equal(view.next.id, 'findings');
  assert.equal(view.done, false);
  // Saving findings.txt finishes it.
  const last = observe(flags, { seat: 'ws01', type: 'saved', value: 'Users/analyst/Documents/findings.txt' });
  assert.ok(last.flags.includes('m-ws01-baseline-done'));
  assert.equal(last.finished[0].reward.unlock, 'parrot01');
  assert.equal(missionView([...flags, ...last.flags], mission).done, true);
});

test('other ways in count too: Notepad opening the baseline, Task Manager', () => {
  assert.deepEqual(observe([], { seat: 'ws01', type: 'opened', value: 'Users/analyst/Documents/baseline.txt' }).flags, ['m-ws01-baseline-baseline']);
  assert.deepEqual(observe([], { seat: 'ws01', type: 'app', value: 'taskmgr' }).flags, ['m-ws01-baseline-processes']);
});

test('the wrong VM, unknown events and finished missions change nothing', () => {
  assert.deepEqual(observe([], { seat: 'parrot01', type: 'command', value: 'sfc /scannow' }).flags, []);
  assert.deepEqual(observe([], { seat: 'ws01', type: 'command', value: 'sfc /hunter2x' }).flags, []);
  assert.deepEqual(observe([], { seat: 'ws01', type: 'nonsense', value: 'x' }).flags, []);
  assert.deepEqual(observe([], { seat: 'ws01', type: 'command', value: 42 }).flags, []);
  assert.deepEqual(observe([], null).flags, []);
  assert.deepEqual(observe(['m-ws01-baseline-done'], { seat: 'ws01', type: 'command', value: 'sfc /scannow' }).flags, []);
});

test('vm reset-missions asks the terminal to clear mission progress', async () => {
  const { execute } = await import('../site/assets/js/features/command-engine.js');
  const result = execute('vm reset-missions', { page: 'lab' });
  assert.equal(result.action.type, 'missions-reset');
  assert.equal(result.echo, 'vm reset-missions');
});
