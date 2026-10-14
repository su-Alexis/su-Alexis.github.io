// Layer 2: the mission engine (Skeleton: features/mission-engine.js; doctrine section 7:
// missions are authored data with a briefing, ordered objectives and the flags they set,
// tiered hints, and a reward; the engine checks flags and selects authored output, it
// never runs anything). Owner request, October 11, 2026. Pure: no DOM, no storage, so Node
// tests cover it. ui/lab-progress.js keeps the flags; layers/layer2.js feeds it events;
// ui/guest-desktop.js shows missions in the Tickets app of each mission's seat.
//
// Flags are fixed ids built from the mission data: m-<mission>-<objective> for each
// objective, m-<mission>-report once its report's answers are right, and m-<mission>-done
// for a finished mission. Events carry only canonical, already-checked values (a shell
// command's canonical echo, a known file path, an app id); nothing a visitor typed freely
// ever reaches here, and report answers are only compared, never kept.
//
// The result contract (October 11, 2026): every event is a result that says where it was
// played from and what it did, so a mission can tell a command that worked from one that
// was refused, and which account ran it:
//   seat     the VM the visitor is at (where the command was typed, the app opened)
//   type     'command' | 'opened' | 'saved' | 'app' | 'report', with value: its canonical
//            form (a report's value is its mission id)
//   target   the VM it acted on (the seat itself, or the lab host the network named)
//   account  who ran it: the seat's user, or root under sudo
//   outcome  'ok' | 'denied' (refused: not root, no permission, login denied) | 'failed'
//   reason   a fixed word when it did not work (REASONS), else ''
//   evidence the evidence IDs it left on the target (features/scenario.js)
//   state    the target's scenario fixtures just after it ({ fixture: state })
// toResult() rebuilds one field by field from known values; layers/layer2.js builds them
// from the guest engine's results (features/guest-engine.js) and the desktops' events.
//
// Mission data (data/missions/): id, ticket, seat, title, from, briefing, objectives,
// reward, closing, and optionally (the red missions' format, owner-written):
//   requires     flags that must be set before the mission moves (an earlier mission)
//   scenario     the machine whose state it reads (completeWhen.state)
//   completeWhen { allObjectives, state, evidence (all seen), report (its report done) }
//   report       { id, seat, questions: [{ id, options: [{ value }], answer, multiple }] }
//   reward       { unlock, requires? (flags that must all be set to grant it) }
//   content      { files: [{ vm, path, content }], pages, homeLink, fixtures, commands }
// An objective's `when` (see meets()) and dependsOn (objectives that must be met first).

import { MISSIONS } from '../data/missions/index.js';
import { VMS } from '../data/commands.js';
import { ACCOUNTS, EVIDENCE, EVIDENCE_IDS, FIXTURES, stateOf, stateForText, kindLines, blocked } from './scenario.js';

export { MISSIONS };

// answer: a step's questions answered right in the Tickets app (its value: the objective id).
export const RESULT_TYPES = Object.freeze(['command', 'opened', 'saved', 'app', 'report', 'answer']);
export const OUTCOMES = Object.freeze(['ok', 'denied', 'failed']);
// Why something did not work: not-root (needs sudo), permission (a folder it may not
// write, or a setting that forbids it), auth (a login refused), refused (no service on
// that port), unreachable (the VM is off), protocol (the wrong kind of service there),
// not-found (no such page), invalid (arguments the command does not take), seat (not
// from this machine), filtered (the target's firewall dropped it: a timeout).
export const REASONS = Object.freeze(['not-root', 'permission', 'auth', 'refused', 'unreachable', 'protocol', 'not-found', 'invalid', 'seat', 'filtered']);

const knownVm = (id) => (typeof id === 'string' ? VMS.find((vm) => vm.id === id) || null : null);
const pick = (value, allowed, fallback) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);
const own = (object, key) => (object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined);
const list = (value) => (Array.isArray(value) ? value : []);

// A target's fixture states from untrusted parts: known fixtures and states only.
function stateFor(vmId, raw) {
  const state = {};
  for (const fixture of FIXTURES.filter((entry) => entry.vm === vmId)) {
    const value = own(raw, fixture.id);
    if (typeof value === 'string' && Object.hasOwn(fixture.states, value)) state[fixture.id] = value;
  }
  return Object.freeze(state);
}

// A result from untrusted parts: only known values survive, the rest take safe defaults.
// Returns null when the seat or type is unknown (such an event meets nothing).
export function toResult(event) {
  if (!event || typeof event !== 'object') return null;
  const seat = knownVm(event.seat);
  const type = pick(event.type, RESULT_TYPES, null);
  if (!seat || !type) return null;
  // No outcome (a desktop event) means it worked; an unknown one fails closed.
  const outcome = event.outcome === undefined ? 'ok' : pick(event.outcome, OUTCOMES, 'failed');
  const evidence = Array.isArray(event.evidence) ? EVIDENCE_IDS.filter((id) => event.evidence.includes(id)) : [];
  const target = (knownVm(event.target) || seat).id;
  return Object.freeze({
    seat: seat.id,
    type,
    value: typeof event.value === 'string' && event.value.length <= 512 ? event.value : null,
    target,
    account: pick(event.account, ACCOUNTS, seat.user),
    outcome,
    reason: outcome === 'ok' ? '' : pick(event.reason, REASONS, ''),
    evidence: Object.freeze(evidence),
    state: stateFor(target, event.state),
    // The file a read-only command read (a tree key) and the VM a lookup named (Blue 1).
    read: typeof event.read === 'string' && event.read.length <= 256 && /^[A-Za-z0-9._/-]+$/.test(event.read) ? event.read : null,
    lookup: knownVm(event.lookup) ? event.lookup : null,
  });
}

const objectiveFlag = (mission, objective) => `m-${mission.id}-${objective.id}`;
// A step with questions (objective.ask, Blue 1): its action sets -seen, and the right
// answers then set the objective's own flag.
const seenFlag = (mission, objective) => `m-${mission.id}-${objective.id}-seen`;
const asks = (objective) => Boolean(objective.ask && Array.isArray(objective.ask.questions));
const reportFlag = (mission) => `m-${mission.id}-report`;
const doneFlag = (mission) => `m-${mission.id}-done`;
const hasReport = (mission) => Boolean(mission.report && Array.isArray(mission.report.questions));

// Every flag a mission can set, for ui/lab-progress.js's allowlist.
export const MISSION_FLAG_IDS = Object.freeze(MISSIONS.flatMap((mission) => [
  ...mission.objectives.flatMap((objective) => (asks(objective) ? [seenFlag(mission, objective)] : [])),
  ...mission.objectives.map((objective) => objectiveFlag(mission, objective)),
  ...(hasReport(mission) ? [reportFlag(mission)] : []),
  doneFlag(mission),
]));

// {user} in an objective is the mission seat's own user, as its shell shows it.
function fillUser(mission, text) {
  const vm = knownVm(mission.seat);
  return vm ? text.replace(/\{user\}/g, vm.user) : text;
}
const isWinbows = (mission) => {
  const vm = knownVm(mission.seat);
  return Boolean(vm && (vm.image === 'winbows' || vm.image === 'winserver'));
};
// Winbows seats ignore case in commands and paths, as PowerShell does (its file tree keys
// paths in lowercase); Linux seats compare exactly, as bash does.
const sameValue = (mission, a, b) => (isWinbows(mission) ? a.toLowerCase() === b.toLowerCase() : a === b);
const stateMatches = (wanted, state) => Object.entries(wanted || {}).every(([key, value]) => own(state, key) === value);

// Whether a result meets an objective. The seat must be the mission's; then the
// objective's `when` decides:
//   outcome  which outcome counts: 'ok' unless it says 'denied', 'failed' or 'any'
//   as       the accounts that count (default: any)
//   target   the VMs it must have acted on (default: any)
//   commands, opened, saved, apps  a matching value of that type
//   evidence evidence IDs, any one of which the result left
//   reason   the reason it did not work (with outcome 'denied' or 'failed')
//   state    the target's fixtures just after it
//   report   a mission id whose report must be done (with saved: the file and the report,
//            in either order)
// match: 'all' (the red missions) needs every condition it names; without it (ws01's
// Baseline), the conditions after `target` are alternatives: any one is enough.
// Blue 1's conditions (owner-approved spec, October 11, 2026):
//   seats    the VMs this step is played from, instead of the mission's seat (a step on
//            web01's console or parrot01)
//   programs commands by name (the echo's first word after sudo: nmap, any form)
//   reads    file paths read by cat, grep, tail or cp (the result's read field)
//   lookup   true: any name lookup that answered (nslookup)
//   labState the mission's scenario machine's fixtures right now, whatever the event or
//            seat (a fix counts once it holds)
//   preserved { dir, holds }: files in that folder on the seat hold every item in holds,
//            { fixture, state } (a copy of that version) or { kind } (a copy of a log line
//            of that evidence kind); context.files(vm, path) lists the folder
function meets(mission, objective, result, have, context) {
  if (!result) return false;
  const when = objective.when || {};
  if (when.labState) return when.match === 'all' && stateMatches(when.labState, stateOf(mission.scenario, list(context.scenario)));
  if (!(when.seats || [mission.seat]).includes(result.seat)) return false;
  if (result.type === 'report') return when.match === 'all' && meetsByReport(mission, when, result, context);
  if (result.type === 'answer') return false;
  if (when.preserved) return when.match === 'all' && preservedHolds(mission, when.preserved, result.seat, context);
  const outcome = when.outcome || 'ok';
  if (outcome !== 'any' && result.outcome !== outcome) return false;
  if (when.as && !when.as.includes(result.account)) return false;
  if (when.target && !when.target.includes(result.target)) return false;
  const values = { command: when.commands, opened: when.opened, saved: when.saved, app: when.apps };
  const valueMatches = () => {
    if (typeof result.value !== 'string') return false;
    const wanted = list(values[result.type]);
    if (result.type === 'app') return wanted.includes(result.value);
    const value = result.type === 'command' ? result.value.trim() : result.value;
    return wanted.some((entry) => sameValue(mission, fillUser(mission, entry), value));
  };
  const evidenceMatches = () => list(when.evidence).some((id) => result.evidence.includes(id));
  const program = () => (result.type === 'command' && typeof result.value === 'string' ? result.value.trim().replace(/^sudo /, '').split(' ')[0] : null);
  const programMatches = () => list(when.programs).includes(program());
  const readMatches = () => list(when.reads).includes(result.read);
  const lookupMatches = () => Boolean(result.lookup);
  if (when.match !== 'all') {
    return (when.evidence && evidenceMatches()) || (when.reads && readMatches()) || (when.lookup && lookupMatches())
      || (when.programs && programMatches()) || valueMatches();
  }
  if (when.programs && !programMatches()) return false;
  if (when.reads && !readMatches()) return false;
  if (when.lookup && !lookupMatches()) return false;
  if (Object.values(values).some((entry) => entry) && !valueMatches()) return false;
  if (when.evidence && !evidenceMatches()) return false;
  if (when.reason && result.reason !== when.reason) return false;
  if (when.state && !stateMatches(when.state, result.state)) return false;
  if (when.report) {
    const other = MISSIONS.find((entry) => entry.id === when.report);
    if (!other || !have.has(reportFlag(other))) return false;
  }
  return true;
}

// A report just finished meets the objectives waiting on it whose files are already saved
// on the seat (context.hasFile).
function meetsByReport(mission, when, result, context) {
  if (when.report !== result.value) return false;
  const hasFile = typeof context.hasFile === 'function' ? context.hasFile : () => false;
  return list(when.saved).every((path) => hasFile(mission.seat, fillUser(mission, path)));
}

// Whether the seat's folder holds copies of everything preserved names (Blue 1 step 6).
// context.files(vm, path) returns [{ content }] for the files in that folder.
function preservedHolds(mission, preserved, seat, context) {
  if (typeof context.files !== 'function') return false;
  const files = list(context.files(seat, fillUser(mission, preserved.dir))).filter((file) => file && typeof file.content === 'string');
  const scenario = list(context.scenario);
  return list(preserved.holds).every((item) => files.some((file) => {
    if (item.fixture) return stateForText(FIXTURES.find((entry) => entry.vm === mission.scenario && entry.id === item.fixture), file.content) === item.state;
    if (item.kind) return kindLines(mission.scenario, item.kind, scenario).some((line) => file.content.includes(line));
    return false;
  }));
}

// Whether a mission's completion conditions hold (all objectives, then completeWhen's
// scenario state, evidence seen and report).
function complete(mission, have, context) {
  if (!mission.objectives.every((objective) => have.has(objectiveFlag(mission, objective)))) return false;
  const when = mission.completeWhen;
  if (!when) return true;
  const scenario = list(context.scenario);
  if (when.state && !stateMatches(when.state, stateOf(mission.scenario, scenario))) return false;
  if (list(when.evidence).some((id) => !scenario.includes(id))) return false;
  if (when.report && !have.has(reportFlag(mission))) return false;
  return true;
}

// Whether a mission is open to play: its requires are met (an earlier mission done).
const available = (mission, have) => list(mission.requires).every((flag) => have.has(flag));

// What one event changes, given the flags already set. event: a result (see the top of
// this file); it is rebuilt with toResult() first. context: { scenario: the scenario list
// (ui/lab-progress.js), hasFile(vm, path): whether a file exists on a VM }. Returns
// { flags: the new flags to set, completed: [{ mission, objective }], asked: [{ mission,
// objective }] whose questions just opened, finished: [missions
// just finished], unlocks: [VM ids whose key is granted] }. Objectives move in the order
// dependsOn allows; a mission finishes when its completion conditions hold.
export function observe(flags, event, context = {}) {
  const result = toResult(event);
  const have = new Set(Array.isArray(flags) ? flags : []);
  const added = [];
  const completed = [];
  const asked = [];
  const finished = [];
  const unlocks = [];
  const set = (flag) => {
    if (have.has(flag)) return false;
    have.add(flag);
    added.push(flag);
    return true;
  };
  for (const mission of MISSIONS) {
    if (have.has(doneFlag(mission)) || !available(mission, have)) continue;
    // A report sent from its seat (the Tickets app checks the answers first).
    if (result && result.type === 'report' && hasReport(mission) && result.value === mission.id && result.seat === (mission.report.seat || mission.seat)) set(reportFlag(mission));
    for (const objective of mission.objectives) {
      const flag = objectiveFlag(mission, objective);
      if (have.has(flag) || !result) continue;
      if (list(objective.dependsOn).some((id) => !have.has(`m-${mission.id}-${id}`))) continue;
      // A step with questions: its action opens them (-seen); the right answers, sent from
      // the mission's seat once the Tickets app has checked them (checkAsk), finish it.
      if (asks(objective)) {
        const seen = seenFlag(mission, objective);
        if (!have.has(seen)) {
          if (meets(mission, objective, result, have, context)) {
            set(seen);
            asked.push({ mission, objective });
          }
          continue;
        }
        if (result.type !== 'answer' || result.value !== objective.id || result.seat !== mission.seat) continue;
        set(flag);
        completed.push({ mission, objective });
        continue;
      }
      if (!meets(mission, objective, result, have, context)) continue;
      set(flag);
      completed.push({ mission, objective });
    }
    if (complete(mission, have, context)) {
      set(doneFlag(mission));
      finished.push(mission);
      const reward = mission.reward || {};
      if (typeof reward.unlock === 'string' && list(reward.requires).every((flag) => have.has(flag))) unlocks.push(reward.unlock);
    }
  }
  return { flags: added, completed, asked, finished, unlocks };
}

// Whether a report's answers are right. answers: { questionId: [values] } (untrusted:
// only compared with the authored options, never kept). Returns { ok, wrong: [question
// ids answered wrongly or not at all] }.
export function checkReport(mission, answers) {
  if (!hasReport(mission)) return { ok: false, wrong: [] };
  const wrong = wrongAnswers(mission.report.questions, answers);
  return { ok: wrong.length === 0, wrong };
}
// The ids of questions answered wrongly or not at all (only authored options count).
function wrongAnswers(questions, answers) {
  return questions.filter((question) => {
    const given = list(own(answers, question.id)).filter((value) => list(question.options).some((option) => option.value === value));
    const answer = list(question.answer);
    return given.length !== new Set(given).size || given.length !== answer.length || !answer.every((value) => given.includes(value));
  }).map((question) => question.id);
}

// ---------- Questions worked out from the trail (Blue 1, objective.ask) ----------
// A blue step's questions have fixed choices (doctrine: no free text kept), and their right
// answers come from the evidence actually recorded on the mission's scenario machine, so a
// visitor who ran the red side from another seat gets that seat as the answer. The
// mission's own seat (the defender's desk) is never a suspect: its traffic is known.
//   options  'addresses' | 'vms' (the lab machines but the scenario's own) | 'accounts'
//            (ACCOUNTS) | [{ value, label }]
//   answer   { seatsOf: [kinds], field: 'ip' | 'vm' }   the seats that left those kinds
//            { accountsOf: [kinds] }                     the accounts those kinds name
//            { firstOf: { value: [kinds], ... } }        whichever group happened first
//            { fixed: [values], addIfDenied?: { value, seatOf: [kinds] } }  plus value
//            when the scenario machine's firewall denies one of those kinds' seats
const evidenceOf = (mission, kinds, scenario) => EVIDENCE.filter((entry) => entry.vm === mission.scenario
  && list(kinds).includes(entry.kind.id) && entry.seat.id !== mission.seat && scenario.includes(entry.id));
const seatsOf = (mission, kinds, scenario) => [...new Set(evidenceOf(mission, kinds, scenario).map((entry) => entry.seat.id))];

function optionsFor(mission, source) {
  if (Array.isArray(source)) return source;
  const others = VMS.filter((vm) => vm.id !== mission.scenario);
  if (source === 'addresses') return others.map((vm) => ({ value: vm.ip, label: vm.ip }));
  if (source === 'vms') return others.map((vm) => ({ value: vm.id, label: vm.id }));
  if (source === 'accounts') return ACCOUNTS.map((name) => ({ value: name, label: name }));
  return [];
}

function answerFor(mission, spec, scenario) {
  if (!spec || typeof spec !== 'object') return [];
  if (spec.seatsOf) {
    const seats = seatsOf(mission, spec.seatsOf, scenario);
    return spec.field === 'ip' ? seats.map((id) => knownVm(id).ip) : seats;
  }
  if (spec.accountsOf) return [...new Set(evidenceOf(mission, spec.accountsOf, scenario).map((entry) => entry.account))];
  if (spec.firstOf) {
    const firstAt = (kinds) => {
      const ids = new Set(evidenceOf(mission, kinds, scenario).map((entry) => entry.id));
      const at = scenario.findIndex((id) => ids.has(id));
      return at === -1 ? Infinity : at;
    };
    const ranked = Object.entries(spec.firstOf).map(([value, kinds]) => [value, firstAt(kinds)]).filter(([, at]) => at !== Infinity).sort((a, b) => a[1] - b[1]);
    return ranked.length ? [ranked[0][0]] : [];
  }
  const answer = [...list(spec.fixed)];
  const deny = spec.addIfDenied;
  if (deny && seatsOf(mission, deny.seatOf, scenario).some((id) => blocked(mission.scenario, id, scenario))) answer.push(deny.value);
  return answer;
}

// A step's questions as the Tickets app shows them, with their right answers for the
// trail so far: [{ id, prompt, multiple, options, answer }].
export function askView(mission, objective, scenario) {
  if (!asks(objective)) return [];
  const flags = list(scenario);
  return objective.ask.questions.map((question) => ({
    id: question.id,
    prompt: question.prompt,
    multiple: Boolean(question.multiple),
    options: optionsFor(mission, question.options),
    answer: answerFor(mission, question.answer, flags),
  }));
}

// Whether a step's answers are right for the trail so far. answers: { questionId:
// [values] } (untrusted: only compared, never kept). Returns { ok, wrong: [ids] }.
export function checkAsk(mission, objective, answers, scenario) {
  if (!asks(objective)) return { ok: false, wrong: [] };
  const wrong = wrongAnswers(askView(mission, objective, scenario), answers);
  return { ok: wrong.length === 0, wrong };
}

// A mission as the Tickets app shows it: each objective with done, the next one to do,
// whether it is open (requires met), whether its report is done, and whether it is
// finished.
export function missionView(flags, mission) {
  const have = new Set(Array.isArray(flags) ? flags : []);
  const objectives = mission.objectives.map((objective) => ({
    ...objective,
    done: have.has(objectiveFlag(mission, objective)),
    // A step with questions: whether its action is done and the questions are open.
    seen: asks(objective) && have.has(seenFlag(mission, objective)),
  }));
  return {
    mission,
    objectives,
    next: objectives.find((objective) => !objective.done) || null,
    open: available(mission, have),
    reported: have.has(reportFlag(mission)),
    done: have.has(doneFlag(mission)),
  };
}

// The missions played from a VM (their seat), in order.
export const missionsFor = (vmId) => MISSIONS.filter((mission) => mission.seat === vmId);

// The commands missions add (content.commands: { name, target, forms, output }), for
// features/guest-engine.js. Only well-formed entries: a name, a known target, forms of
// fixed words.
export function missionCommands() {
  return MISSIONS.flatMap((mission) => list(own(mission.content, 'commands')))
    .filter((spec) => spec && typeof spec.name === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(spec.name) && knownVm(spec.target)
      && Array.isArray(spec.forms) && spec.forms.every((form) => Array.isArray(form.args) && form.args.every((word) => typeof word === 'string')));
}

// The files missions put on a VM (content.files): [{ path, content }], paths below its
// root. Text only; features/guest-engine.js adds them to the VM's tree when it boots.
export function seatFiles(vmId) {
  return MISSIONS.flatMap((mission) => list(own(mission.content, 'files')))
    .filter((file) => file && file.vm === vmId && typeof file.path === 'string' && typeof file.content === 'string')
    .map((file) => ({ path: file.path, content: file.content }));
}
