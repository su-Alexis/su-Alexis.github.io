// Easter egg hunt (owner request): remembers which eggs this browser has found, for the
// "hunt" command. Used by ui/terminal-ui.js (command eggs) and ui/screensaver.js.
//
// Stored in localStorage (HUNT_STORAGE_KEY) so progress survives refresh and reboot; the
// fork bomb reboots the machine, and finding it should not wipe the hunt. Doctrine
// section 8 allows puzzle progress there. The record is versioned and rebuilt from known
// egg ids only; anything else reads as "nothing found". It grants nothing: found eggs
// only change what "hunt" prints.

import { localStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { HUNT_STORAGE_KEY, HUNT_VERSION } from '../core/constants.js';
import { EGG_IDS } from '../data/commands.js';
import { isPlainObject, ownField, knownId } from '../utils/validate.js';

export function foundEggs() {
  const stored = readJson(localStore(), HUNT_STORAGE_KEY);
  if (!isPlainObject(stored) || ownField(stored, 'v') !== HUNT_VERSION) return [];
  const found = ownField(stored, 'found');
  if (!Array.isArray(found) || found.length > EGG_IDS.length) return [];
  // Keep the dataset's order and drop duplicates and unknown ids.
  return EGG_IDS.filter((id) => found.some((value) => knownId(value, [id]).ok));
}

// Marks an egg found. Returns the line to print when it is new, otherwise null.
export function recordEgg(id) {
  if (!knownId(id, EGG_IDS).ok) return null;
  const found = foundEggs();
  if (found.includes(id)) return null;
  found.push(id);
  writeJson(localStore(), HUNT_STORAGE_KEY, { v: HUNT_VERSION, found });
  const total = EGG_IDS.length;
  return found.length === total
    ? { kind: 'ok', text: `[ hunt ] egg found! ${total}/${total}. that's all of them. type 'hunt' to admire your work.` }
    : { kind: 'ok', text: `[ hunt ] egg found! ${found.length}/${total}. type 'hunt' to see your progress.` };
}

export function resetHunt() {
  removeKey(localStore(), HUNT_STORAGE_KEY);
}
