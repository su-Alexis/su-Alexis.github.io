// Layer 2 shared scenario state (October 11, 2026). What one machine has seen from the
// others, and what has changed on it, shared by every mission that touches it: red
// missions leave evidence and change fixtures, blue missions find the evidence in the
// machine's logs and put the fixtures back. Pure: no DOM, no storage, so Node tests cover
// it. Scenarios are data (data/scenarios/); fixtures come from the missions that own them
// (data/missions/, a mission's content.fixtures).
//
// The state is one ordered list of fixed IDs (ui/lab-progress.js keeps it beside the
// mission flags, doctrine section 8: known IDs only):
//   evidence  e-<machine>-<kind>[-<account>]-<seat>, in the order it happened (the logs'
//             times come from that order)
//   fixtures  s-<machine>-<fixture>-<state>, only for a fixture not in its first state
//
// Who uses it:
//   features/guest-engine.js   evidenceFrom() on each command's result; evidenceLines()
//                              and fixtureText() when a scenario machine's file is read;
//                              FORWARDED for its logs on another VM (web01's on ubuntu-blue)
//   features/fake-network.js   fixtureRoute() for a page a fixture serves (/status.txt)
//   features/mission-engine.js EVIDENCE_IDS, stateOf(): results' evidence and state
//   ui/lab-progress.js         SCENARIO_IDS: what the record may hold
//   layers/layer2.js           records evidence and effects, hands each guest the state

import { SCENARIOS } from '../data/scenarios/index.js';
import { MISSIONS } from '../data/missions/index.js';
import { VMS } from '../data/commands.js';

// Every account name the lab knows: root and each VM's own user (as ssh accepts them).
export const ACCOUNTS = Object.freeze([...new Set(['root', ...VMS.map((vm) => vm.user)])]);

const idPart = (text) => text.toLowerCase();
const two = (n) => String(n).padStart(2, '0');
const own = (object, key) => (object && Object.hasOwn(object, key) ? object[key] : undefined);

// Every piece of evidence: { id, vm, kind, seat, account, scenario }. Built once.
export const EVIDENCE = Object.freeze(SCENARIOS.flatMap((scenario) => {
  const seats = VMS.filter((vm) => vm.id !== scenario.vm);
  const entries = [];
  for (const kind of scenario.kinds) {
    const accounts = kind.accounts === 'existing' ? scenario.accounts
      : kind.accounts === 'invalid' ? ACCOUNTS.filter((name) => !scenario.accounts.includes(name))
        : [null];
    for (const seat of seats) {
      for (const account of accounts) {
        entries.push(Object.freeze({
          id: `e-${scenario.vm}-${kind.id}${account ? `-${idPart(account)}` : ''}-${seat.id}`,
          vm: scenario.vm, kind, seat, account, scenario,
        }));
      }
    }
  }
  return entries;
}));
export const EVIDENCE_IDS = Object.freeze(EVIDENCE.map((entry) => entry.id));

// A scenario machine's firewall (a scenario's firewall: true): one deny-<vm> fixture per
// other lab machine, off until ufw denies it. State only (no path, no file).
const FIREWALL_FIXTURES = SCENARIOS.filter((scenario) => scenario.firewall === true).flatMap((scenario) => VMS
  .filter((vm) => vm.id !== scenario.vm)
  .map((vm) => ({ id: `deny-${vm.id}`, vm: scenario.vm, seat: vm.id, firewall: true, states: { off: '', on: '' } })));

// Every fixture the missions declare, then the scenarios' firewall rules: { id, vm, path?,
// route?, states: { name: text } }, its first state the one a fresh lab starts in.
export const FIXTURES = Object.freeze([...MISSIONS.flatMap((mission) => {
  const list = own(own(mission, 'content'), 'fixtures');
  return Array.isArray(list) ? list : [];
}), ...FIREWALL_FIXTURES].filter((fixture) => fixture && typeof fixture.id === 'string' && fixture.states && Object.keys(fixture.states).length)
  .map((fixture) => Object.freeze({ ...fixture, initial: Object.keys(fixture.states)[0] })));
const stateId = (fixture, state) => `s-${fixture.vm}-${fixture.id}-${state}`;
export const STATE_IDS = Object.freeze(FIXTURES.flatMap((fixture) => Object.keys(fixture.states).slice(1).map((state) => stateId(fixture, state))));
export const SCENARIO_IDS = Object.freeze([...EVIDENCE_IDS, ...STATE_IDS]);

// A machine's fixture states, from the scenario list: { fixtureId: state }.
export function stateOf(vmId, flags) {
  const have = new Set(Array.isArray(flags) ? flags : []);
  const state = {};
  for (const fixture of FIXTURES.filter((entry) => entry.vm === vmId)) {
    state[fixture.id] = Object.keys(fixture.states).find((name) => have.has(stateId(fixture, name))) || fixture.initial;
  }
  return state;
}

// The scenario list with one fixture set to a state (unknown fixture or state: unchanged).
export function withState(flags, vmId, fixtureId, value) {
  const list = Array.isArray(flags) ? flags : [];
  const fixture = FIXTURES.find((entry) => entry.vm === vmId && entry.id === fixtureId);
  if (!fixture || !Object.hasOwn(fixture.states, value)) return list;
  const mine = new Set(Object.keys(fixture.states).map((name) => stateId(fixture, name)));
  const kept = list.filter((id) => !mine.has(id));
  return value === fixture.initial ? kept : [...kept, stateId(fixture, value)];
}

// Whether a kind's state condition holds.
const stateMatches = (kind, state) => !kind.state || Object.entries(kind.state).every(([key, value]) => own(state, key) === value);

// What a command's result leaves behind. result: { seat, target, contact }, from the guest
// engine (contact: { service, method?, path?, user?, action? }, set by the lab network or
// a lab-restore effect); state: the target's fixture states when it happened. Returns the
// evidence IDs, or [].
export function evidenceFrom(result, state = {}) {
  const contact = result && result.contact;
  if (!contact || typeof contact.service !== 'string') return [];
  return EVIDENCE.filter((entry) => {
    const kind = entry.kind;
    return entry.vm === result.target && entry.seat.id === result.seat && kind.service === contact.service
      && (!kind.method || kind.method === contact.method)
      && (!kind.path || kind.path === contact.path)
      && (!kind.action || kind.action === contact.action)
      && (entry.account === null || entry.account === contact.user)
      && stateMatches(kind, state);
  }).map((entry) => entry.id);
}

// The time the n-th piece of evidence happened: a lab morning, about a minute and a half
// apart, so the logs read in order.
const timeAt = (n) => {
  const seconds = 9 * 3600 + n * 97;
  return `${two(Math.floor(seconds / 3600) % 24)}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
};

// The lines evidence adds to a log on a scenario machine, after the file's own authored
// lines, in the order it happened. vmId and path are the guest's own (path: its tree
// key); flags is the scenario list.
export function evidenceLines(vmId, path, flags) {
  const seen = (Array.isArray(flags) ? flags : []).filter((id) => EVIDENCE_IDS.includes(id));
  const lines = [];
  seen.forEach((id, n) => {
    const entry = EVIDENCE.find((item) => item.id === id);
    if (entry.vm !== vmId || entry.kind.file !== path) return;
    const fields = { time: timeAt(n), ip: entry.seat.ip, user: entry.account || '' };
    lines.push(entry.kind.line.replace(/\{(time|ip|user)\}/g, (match, field) => fields[field]));
  });
  return lines;
}

// The lines one evidence kind has written on a machine so far, exactly as its log shows
// them (Blue 1 step 6 checks a preserved copy holds one). Same times as evidenceLines.
export function kindLines(vmId, kindId, flags) {
  const seen = (Array.isArray(flags) ? flags : []).filter((id) => EVIDENCE_IDS.includes(id));
  const lines = [];
  seen.forEach((id, n) => {
    const entry = EVIDENCE.find((item) => item.id === id);
    if (entry.vm !== vmId || entry.kind.id !== kindId) return;
    const fields = { time: timeAt(n), ip: entry.seat.ip, user: entry.account || '' };
    lines.push(entry.kind.line.replace(/\{(time|ip|user)\}/g, (match, field) => fields[field]));
  });
  return lines;
}

// A fixture file's text in its current state, or null when the path is no fixture's.
export function fixtureText(vmId, path, flags) {
  const fixture = FIXTURES.find((entry) => entry.vm === vmId && entry.path === path);
  return fixture ? fixture.states[stateOf(vmId, flags)[fixture.id]] : null;
}

// The page a fixture serves on its machine's web server (its route), or null.
export function fixtureRoute(vmId, route, flags) {
  const fixture = FIXTURES.find((entry) => entry.vm === vmId && entry.route === route);
  return fixture ? fixture.states[stateOf(vmId, flags)[fixture.id]] : null;
}

// The fixture files a machine has, for its file tree (paths below its root). A fixture
// with no path (state only, such as a firewall rule) has no file.
export const fixturePaths = (vmId) => FIXTURES.filter((entry) => entry.vm === vmId && typeof entry.path === 'string').map((entry) => entry.path);

// Forwarded logs (a scenario's forward, data/scenarios/): { to, path, vm, source } with
// path the file on the receiving VM and source the same log on the scenario machine.
// features/guest-engine.js gives the receiver these files (the source image's lines) and
// adds the source's evidence lines when one is read, so both copies always agree.
export const FORWARDED = Object.freeze(SCENARIOS.flatMap((scenario) => (scenario.forward
  ? scenario.forward.files.map((file) => Object.freeze({
    to: scenario.forward.to,
    path: `${scenario.forward.dir}/${file.replace(/^var\/log\//, '')}`,
    vm: scenario.vm,
    source: file,
  }))
  : [])));
// The fixture whose file is at this path on a machine, or null.
export const fixtureAt = (vmId, path) => FIXTURES.find((entry) => entry.vm === vmId && entry.path === path) || null;

// Which of a fixture's states this text is (trailing newlines ignored), or null. Writing a
// fixture file (cp from a backup, sed -i on a setting) can only land on a known state;
// anything else is refused by the caller, so the shared state stays a fixed set of IDs.
export function stateForText(fixture, text) {
  const trim = (value) => String(value).replace(/\n+$/, '');
  return fixture ? Object.keys(fixture.states).find((name) => trim(fixture.states[name]) === trim(text)) || null : null;
}

// Known-good backups on a machine (a scenario's backups): [{ path, content }], each its
// fixture's first state.
export const backupFiles = (vmId) => SCENARIOS.filter((scenario) => scenario.vm === vmId).flatMap((scenario) => (scenario.backups || [])
  .map((backup) => ({ path: backup.path, fixture: FIXTURES.find((entry) => entry.vm === vmId && entry.id === backup.fixture) }))
  .filter((backup) => backup.fixture)
  // Without its final newline, as cat shows the fixture itself (fixtureText's reader).
  .map((backup) => ({ path: backup.path, content: backup.fixture.states[backup.fixture.initial].replace(/\n$/, '') })));

// Whether a machine's firewall drops traffic from a seat (its deny-<seat> rule is on).
export function blocked(targetId, seatId, flags) {
  const fixture = FIXTURES.find((entry) => entry.vm === targetId && entry.firewall && entry.seat === seatId);
  return Boolean(fixture) && stateOf(targetId, flags)[fixture.id] === 'on';
}

// The firewall rules a machine has, in lab order: [{ fixture, seat (the VM) }].
export const firewallRules = (vmId) => FIXTURES.filter((entry) => entry.vm === vmId && entry.firewall)
  .map((fixture) => ({ fixture, seat: VMS.find((vm) => vm.id === fixture.seat) }));

export const forwardedFiles = (vmId) => FORWARDED.filter((entry) => entry.to === vmId);
export const forwardedFile = (vmId, path) => FORWARDED.find((entry) => entry.to === vmId && entry.path === path) || null;
