// Exercise the real Tickets handlers and engine with a minimal, non-rendering DOM.
// Browser layout/keyboard checks are separate; this harness owns no network or timers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticketsApp } from '../site/assets/js/ui/guest-desktop.js';
import { missionsFor, observe, missionView } from '../site/assets/js/features/mission-engine.js';
import { bootGuest, runGuest, nodeAt, makeDir } from '../site/assets/js/features/guest-engine.js';
import { VMS } from '../site/assets/js/data/commands.js';
import { missionFlags, addMissionFlags, setFixture, addEvidence, scenarioFlags } from '../site/assets/js/ui/lab-progress.js';
import { stateOf } from '../site/assets/js/features/scenario.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = new Map(); this.listeners = new Map(); this.scrollTop = 0; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  focus() { if (!this.disabled) document.activeElement = this; }
  click() { if (!this.disabled) { this.focus(); this.listeners.get('click')?.(); } }
  findAll(predicate) { return this.children.flatMap((node) => [ ...(predicate(node) ? [node] : []), ...node.findAll(predicate) ]); }
  querySelector(selector) { return this.findAll((node) => (node.className || '').split(' ').includes(selector.slice(1)))[0] || null; }
}

function setup(t, seat = 'parrot01') {
  const stored = new Map();
  globalThis.window = { localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) } };
  globalThis.document = { activeElement: null, createElement: (tag) => new Element(tag) };
  const vm = VMS.find((entry) => entry.id === seat);
  const guest = bootGuest(vm);
  guest.running = () => true;
  guest.scenario = scenarioFlags;
  let body;
  let open = false;
  let opens = 0;
  let paints = 0;
  const events = [];
  let destroy = () => {};
  const feed = (event) => {
    addEvidence(event.evidence || []);
    if (event.effect) setFixture(event.effect.vm, event.effect.fixture, event.effect.value);
    const result = observe(missionFlags(), { ...event, state: stateOf(event.target || event.seat, scenarioFlags()) }, {
      scenario: scenarioFlags(), hasFile: (id, path) => id === seat && Boolean(nodeAt(guest, path.split('/')) && !nodeAt(guest, path.split('/')).dir),
    });
    addMissionFlags(result.flags);
    return result;
  };
  const openTickets = ticketsApp({
    vm, guest,
    windows: {
      isOpen: () => open,
      open: (id, title, node) => { opens++; open = true; if (node) body = node; return {}; },
      retitle: (app, title, node) => { paints++; body = node; },
    },
    life: { onDestroy: (fn) => { destroy = fn; t.after(fn); } },
    changed: () => { events.push(['saved']); },
    onEvent: (type, value) => { events.push([type, value]); feed({ seat, type, value }); },
  });
  openTickets();
  const all = (cls) => body.findAll((node) => (node.className || '').split(' ').includes(cls));
  return {
    guest, events, all, feed, openTickets, destroy: () => destroy(),
    get body() { return body; }, get opens() { return opens; }, get paints() { return paints; },
    close: () => { open = false; },
    run: (line) => { for (const event of runGuest(guest, line).results || []) feed(event); },
    submit: () => all('tk-report-submit')[0].click(),
    answer: (mission) => {
      const groups = all('tk-question');
      mission.report.questions.forEach((question, index) => {
        const buttons = groups[index].children.filter((node) => node.tag === 'button');
        question.options.forEach((option, optionIndex) => { if (question.answer.includes(option.value)) buttons[optionIndex].click(); });
      });
    },
  };
}

const red = missionsFor('parrot01');
const readyFlags = (mission) => [...mission.requires, ...mission.objectives.filter((objective) => !objective.when.report).map((objective) => `m-${mission.id}-${objective.id}`)];

test('Tickets locks reports, preserves drafts and hints, and releases its subscription', (t) => {
  const app = setup(t);
  assert.equal(app.all('tk-status')[0].textContent, 'Locked');
  assert.equal(app.all('tk-report-submit')[0].disabled, true);
  app.submit();
  assert.equal(app.events.length, 0);
  addMissionFlags(red[0].requires);
  assert.equal(app.all('tk-status')[0].textContent, 'Open');
  const choice = app.all('tk-choice')[0];
  choice.click();
  assert.equal(document.activeElement, choice);
  app.body.scrollTop = 100;
  app.all('tk-detail')[0].scrollTop = 200;
  app.all('tk-hint')[0].click();
  assert.equal(document.activeElement, app.all('tk-hint')[0]);
  assert.equal(app.body.scrollTop, 100);
  assert.equal(app.all('tk-detail')[0].scrollTop, 200);
  app.all('tk-row')[1].click();
  assert.equal(app.body.scrollTop, 0);
  app.all('tk-row')[0].click();
  assert.equal(app.all('tk-choice')[0].getAttribute('aria-pressed'), 'true');
  assert.equal(app.all('tk-hint-text').length, 1);
  assert.equal(app.opens, 1, 'progress redraws never raise the window');
  app.close();
  const paints = app.paints;
  addMissionFlags(readyFlags(red[0]));
  assert.equal(app.paints, paints, 'closed window is not redrawn');
  app.openTickets();
  assert.equal(app.all('tk-choice')[0].getAttribute('aria-pressed'), 'true');
  const finalPaints = app.paints;
  app.destroy();
  addMissionFlags(['m-red-1-done']);
  assert.equal(app.paints, finalPaints, 'destroy releases the progress listener');
});

test('Tickets rejects incomplete and incorrect reports without saving or emitting a report', (t) => {
  const app = setup(t);
  addMissionFlags(readyFlags(red[0]));
  app.submit();
  assert.equal(app.all('tk-report-error').length, red[0].report.questions.length);
  assert.equal(document.activeElement, app.all('tk-report-status')[0]);
  app.answer(red[0]);
  const question = red[0].report.questions[0];
  const wrongIndex = question.options.findIndex((option) => !question.answer.includes(option.value));
  app.all('tk-question')[0].children.filter((node) => node.tag === 'button')[wrongIndex].click();
  app.submit();
  assert.equal(app.all('tk-report-error').length, 1);
  assert.equal(app.events.length, 0);
  assert.equal(Boolean(nodeAt(app.guest, red[0].report.path.split('/'))), false);
});

test('Tickets cannot grant credit when saving fails', (t) => {
  const app = setup(t);
  addMissionFlags(readyFlags(red[0]));
  const segments = red[0].report.path.split('/');
  assert.equal(makeDir(app.guest, segments.slice(0, -1), segments.at(-1)).ok, true);
  app.answer(red[0]);
  app.submit();
  assert.match(app.all('tk-report-status')[0].textContent, /Could not save/);
  assert.equal(app.events.length, 0);
  assert.equal(missionView(missionFlags(), red[0]).reported, false);
});

test('both red missions complete through real report controls after their command steps', (t) => {
  const app = setup(t);
  addMissionFlags(red[0].requires);
  for (const [index, mission] of red.entries()) {
    app.all('tk-row')[index].click();
    for (const objective of mission.objectives) {
      if (objective.when.commands) app.run(objective.when.commands[0]);
    }
    assert.equal(app.all('tk-report-submit')[0].disabled, false, mission.id);
    app.answer(mission);
    app.submit();
    assert.equal(missionView(missionFlags(), mission).done, true, mission.id);
    const file = nodeAt(app.guest, mission.report.path.split('/'));
    assert.ok(file && file.content.includes('\n'), `${mission.id} report file`);
    assert.deepEqual(app.events.slice(-2), [['saved'], ['report', mission.id]]);
    assert.equal(app.all('tk-report-submit').length, 0, 'resolved reports cannot be submitted twice');
  }
});

test('the shared renderer still shows the Winbows baseline ticket without a report', (t) => {
  const app = setup(t, 'ws01');
  assert.ok(app.all('tk-item').length > 0);
  assert.equal(app.all('tk-report-submit').length, 0);
  app.all('tk-hint')[0].click();
  assert.equal(app.all('tk-hint-text').length, 1);
});

test('Blue 1 on ubuntu-blue: step questions open after its action, wrong answers are marked, right ones send an answer', (t) => {
  const app = setup(t, 'ubuntu-blue');
  const blue = missionsFor('ubuntu-blue')[0];
  assert.equal(blue.id, 'blue-1');
  assert.equal(app.all('tk-status')[0].textContent, 'Locked');
  // The trail Red left (parrot01), and Blue past B1.
  addEvidence(['e-web01-http-parrot01']);
  addMissionFlags(['m-red-2-done', 'm-blue-1-surface']);
  assert.equal(app.all('tk-ask').length, 0, 'no questions before the log is read');
  app.run('cat /var/log/remote/web01/apache2/access.log');
  assert.ok(missionFlags().includes('m-blue-1-site-log-seen'));
  assert.equal(app.all('tk-ask').length, 1);
  const choice = (text) => app.all('tk-ask')[0].findAll((node) => node.className === 'tk-choice' && node.textContent === text)[0];
  const parrot = VMS.find((vm) => vm.id === 'parrot01').ip;
  const desk = VMS.find((vm) => vm.id === 'ubuntu-blue').ip;
  choice(desk).click();
  app.all('tk-report-submit')[0].click();
  assert.equal(app.all('tk-report-error').length, 1);
  assert.equal(app.events.length, 0);
  assert.equal(missionFlags().includes('m-blue-1-site-log'), false);
  // The marked draft survives the redraw; fix it and check again.
  choice(desk).click();
  choice(parrot).click();
  assert.equal(choice(parrot).getAttribute('aria-pressed'), 'true');
  app.all('tk-report-submit')[0].click();
  assert.deepEqual(app.events, [['answer', 'site-log']]);
  assert.ok(missionFlags().includes('m-blue-1-site-log'));
  assert.equal(app.all('tk-correct')[0]?.textContent, 'Correct. Step complete.', 'a right answer says so in the ticket');
  assert.equal(app.all('tk-ask').length, 0, 'answered questions close');
  // The next step's questions are not open until its own action.
  assert.equal(missionView(missionFlags(), blue).next.id, 'which-vm');
});

test('the browser entry module imports with its mission and desktop dependencies', async () => {
  globalThis.window = {};
  const layer = await import('../site/assets/js/layers/layer2.js');
  assert.equal(typeof layer.mountLab, 'function');
});
