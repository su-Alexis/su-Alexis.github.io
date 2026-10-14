// Layer 2 progress (doctrine section 8, "Layer 2 storage"): which encrypted VMs have their
// key (one key per VM, owner decision), and the mission engine's flags
// (features/mission-engine.js MISSION_FLAG_IDS: objectives met, missions finished), and
// the shared scenario state: the evidence other machines left on a scenario machine
// such as web01 (features/scenario.js EVIDENCE_IDS), so a blue mission finds what a red
// one did even after a reboot.
// Used by ui/terminal-ui.js ("vm", and the lab's library through layers/layer2.js).
//
// Stored in localStorage (PROGRESS_STORAGE_KEY) as { v: PROGRESS_VERSION, flags: [ids] }
// so progress survives refresh and reboot. Flags are rebuilt from UNLOCK_IDS only;
// anything else reads as "no progress". Unlocks are presentation only: they decide which
// simulated guests boot, never anything real, so tampering only skips ahead.
//
// Two ways in (owner request, October 8, 2026): the image passphrase (the lab's cheat
// code, checked as a digest by features/puzzles.js), or root's key file for a visitor who
// is root (sudo or su), which doubles as the owner's testing shortcut.

import { localStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { PROGRESS_STORAGE_KEY, PROGRESS_VERSION, UNLOCK_IDS } from '../core/constants.js';
import { VMS } from '../data/commands.js';
import { MISSION_FLAG_IDS } from '../features/mission-engine.js';
import { SCENARIO_IDS, EVIDENCE_IDS, withState } from '../features/scenario.js';
import { isPlainObject, ownField, knownId } from '../utils/validate.js';

// A VM's key flag. ws01 has none: it is never encrypted.
const flagFor = (vm) => `vm-${vm}`;
const LOCKABLE = Object.freeze(VMS.filter((g) => g.unlock && UNLOCK_IDS.includes(flagFor(g.id))).map((g) => g.id));

// Every flag the record may hold: VM keys, mission flags, then the scenario list
// (evidence and fixture states). Anything else is dropped.
const ALL_FLAGS = Object.freeze([...UNLOCK_IDS, ...MISSION_FLAG_IDS, ...SCENARIO_IDS]);
const SCENARIO = new Set(SCENARIO_IDS);

// Keys and mission flags come back in their fixed order; the scenario list keeps the order
// it was stored in (the order things happened on the lab network), duplicates dropped.
function readFlags() {
  const stored = readJson(localStore(), PROGRESS_STORAGE_KEY);
  if (!isPlainObject(stored) || ownField(stored, 'v') !== PROGRESS_VERSION) return [];
  const flags = ownField(stored, 'flags');
  if (!Array.isArray(flags) || flags.length > ALL_FLAGS.length) return [];
  const fixed = ALL_FLAGS.filter((id) => !SCENARIO.has(id) && flags.some((value) => knownId(value, [id]).ok));
  const scenario = [...new Set(flags.filter((value) => knownId(value, SCENARIO).ok))];
  return [...fixed, ...scenario];
}
// Writes the record with ids added at the end (keeping the scenario list's order).
const writeAdded = (flags, added) => writeFlags([...flags, ...added.filter((id) => !flags.includes(id))]);

// Who to tell when progress changes (the Tickets app). Each returns a function that stops.
const listeners = new Set();
export function onProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const notify = () => {
  for (const listener of [...listeners]) listener();
};

// The mission flags set so far.
export function missionFlags() {
  return readFlags().filter((flag) => MISSION_FLAG_IDS.includes(flag));
}

// Sets mission flags (known ids only). Returns the ones that were new.
export function addMissionFlags(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const flags = readFlags();
  const added = MISSION_FLAG_IDS.filter((id) => wanted.includes(id) && !flags.includes(id));
  if (added.length) {
    writeAdded(flags, added);
    notify();
  }
  return added;
}

// The scenario list so far (features/scenario.js): evidence in the order it happened,
// and the fixtures not in their first state.
export function scenarioFlags() {
  return readFlags().filter((flag) => SCENARIO.has(flag));
}

// Records evidence (known ids only), in the order given, after what is already there.
// Returns the ones that were new.
export function addEvidence(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const flags = readFlags();
  const added = [...new Set(wanted.filter((id) => EVIDENCE_IDS.includes(id) && !flags.includes(id)))];
  if (added.length) writeAdded(flags, added);
  return added;
}

// Sets a scenario fixture (a known fixture and state only; features/scenario.js).
export function setFixture(vmId, fixtureId, value) {
  const flags = readFlags();
  const scenario = flags.filter((flag) => SCENARIO.has(flag));
  const next = withState(scenario, vmId, fixtureId, value);
  if (next.length === scenario.length && next.every((id, i) => id === scenario[i])) return false;
  writeFlags([...flags.filter((flag) => !SCENARIO.has(flag)), ...next]);
  notify();
  return true;
}

// Clears every mission flag and the scenario (a mission reset, so the labs replay from a
// clean trail and web01 back as it was); VM keys stay.
export function resetMissions() {
  const flags = readFlags();
  writeFlags(flags.filter((flag) => !MISSION_FLAG_IDS.includes(flag) && !SCENARIO.has(flag)));
  notify();
}

// Keys and mission flags in their fixed order, then the scenario list in its own.
function writeFlags(list) {
  const flags = [...ALL_FLAGS.filter((id) => !SCENARIO.has(id) && list.includes(id)), ...[...new Set(list)].filter((id) => SCENARIO.has(id))];
  if (flags.length === 0) removeKey(localStore(), PROGRESS_STORAGE_KEY);
  else writeJson(localStore(), PROGRESS_STORAGE_KEY, { v: PROGRESS_VERSION, flags });
}

// Names of the encrypted-by-default VMs this browser has the key for, in VMS order.
export function unlockedGuests() {
  const flags = readFlags();
  return LOCKABLE.filter((id) => flags.includes(flagFor(id)));
}

// Unlocks the given guests. Returns the ids that were newly unlocked.
export function unlockGuests(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const flags = readFlags();
  const added = LOCKABLE.filter((id) => wanted.includes(id) && !flags.includes(flagFor(id)));
  if (added.length) {
    writeAdded(flags, added.map(flagFor));
    notify();
  }
  return added;
}

// Locks the given guests again ("vm lock", for replaying the locked path). Returns the
// ids that were locked.
export function lockGuests(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const flags = readFlags();
  const removed = LOCKABLE.filter((id) => wanted.includes(id) && flags.includes(flagFor(id)));
  if (removed.length) writeFlags(flags.filter((flag) => !removed.some((id) => flagFor(id) === flag)));
  return removed;
}
