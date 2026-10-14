// Layer 2 session (doctrine section 8, "Layer 2 storage"): the running VMs, which one is
// in front, and where each window sits on the lab's desk. It lives in sessionStorage
// (SESSION_KEYS.vms) and is cleared on refresh and reboot by ui/terminal-ui.js, like the
// shells, so VMs survive moving between pages but not a restart of the machine.
//
// Written by layers/layer2.js on the lab page; read by ui/terminal-ui.js on every page so
// "vm list", "vm start" and "vm stop" know about suspended guests even away from the lab.
// The record is versioned and rebuilt field by field: only known guest ids, each once, and
// window numbers clamped to finite bounds (they only ever set left/top/width/height).

import { sessionStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { SESSION_KEYS, VM_SESSION_VERSION, VM_WINDOW, VM_LOG, VM_FILES } from '../core/constants.js';
import { VM_IDS } from '../data/commands.js';
import { isPlainObject, ownField, hasControlChars } from '../utils/validate.js';

const IDS = VM_IDS;

const bounded = (value, min, max, fallback) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export function emptyVms() {
  return { v: VM_SESSION_VERSION, front: null, vms: [] };
}

// Each console line kept: a known kind and short text without control characters; longer
// text is cut. Rendered as text only (layers/layer2.js).
const LOG_KINDS = Object.freeze(['cmd', 'out', 'err', 'ok']);
function cleanLog(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-VM_LOG.lines).flatMap((line) => {
    if (!isPlainObject(line)) return [];
    const kind = ownField(line, 'kind');
    const text = ownField(line, 'text');
    if (!LOG_KINDS.includes(kind) || typeof text !== 'string' || hasControlChars(text)) return [];
    return [{ kind, text: text.slice(0, VM_LOG.length) }];
  });
}

// { v, front: VM name or null, vms: [{ id, minimized, floating, x, y, w, h, cwd, log }] }. Anything malformed
// reads as "nothing running"; a bad entry is dropped on its own.
export function cleanVms(raw) {
  if (!isPlainObject(raw) || ownField(raw, 'v') !== VM_SESSION_VERSION) return emptyVms();
  const list = ownField(raw, 'vms');
  if (!Array.isArray(list) || list.length > IDS.length) return emptyVms();
  const max = VM_WINDOW.maxCoordinate;
  const vms = [];
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const id = ownField(entry, 'id');
    if (typeof id !== 'string' || !IDS.includes(id) || vms.some((vm) => vm.id === id)) continue;
    vms.push({
      id,
      minimized: ownField(entry, 'minimized') === true,
      floating: ownField(entry, 'floating') === true,
      x: bounded(ownField(entry, 'x'), 0, max, 0),
      y: bounded(ownField(entry, 'y'), 0, max, 0),
      w: bounded(ownField(entry, 'w'), VM_WINDOW.minWidth, max, VM_WINDOW.defaultWidth),
      h: bounded(ownField(entry, 'h'), VM_WINDOW.minHeight, max, VM_WINDOW.defaultHeight),
      // Checked against the VM's own file tree when restored (features/guest-engine.js).
      cwd: typeof ownField(entry, 'cwd') === 'string' && ownField(entry, 'cwd').length <= VM_LOG.cwd ? ownField(entry, 'cwd') : '',
      log: cleanLog(ownField(entry, 'log')),
    });
  }
  const front = ownField(raw, 'front');
  return { v: VM_SESSION_VERSION, front: typeof front === 'string' && vms.some((vm) => vm.id === front) ? front : null, vms };
}

export function readVms() {
  return cleanVms(readJson(sessionStore(), SESSION_KEYS.vms));
}

// Nothing running removes the record rather than storing an empty one.
export function writeVms(record) {
  const clean = cleanVms(record);
  if (clean.vms.length === 0) removeKey(sessionStore(), SESSION_KEYS.vms);
  else writeJson(sessionStore(), SESSION_KEYS.vms, clean);
}

// ---------- Each VM's own files (SESSION_KEYS.vmFiles) ----------
// The folders and files a visitor made or saved on each VM (features/guest-engine.js,
// exportFiles): { v, vms: { <vm>: { dirs: [keys], files: [[key, text]] } } }. Rebuilt field
// by field and bounded here; the engine checks every name, place and size again when it
// puts them back (importFiles). Cleared with the rest of the session on refresh/reboot.
function cleanFiles(raw) {
  if (!isPlainObject(raw)) return { dirs: [], files: [] };
  const dirs = ownField(raw, 'dirs');
  const files = ownField(raw, 'files');
  const okKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= VM_FILES.key && !hasControlChars(key);
  return {
    dirs: Array.isArray(dirs) ? dirs.slice(0, VM_FILES.dirs).filter(okKey) : [],
    files: Array.isArray(files)
      ? files.slice(0, VM_FILES.files).filter((entry) => Array.isArray(entry) && entry.length === 2 && okKey(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= VM_FILES.content).map(([key, text]) => [key, text])
      : [],
  };
}

function readAllFiles() {
  const raw = readJson(sessionStore(), SESSION_KEYS.vmFiles);
  if (!isPlainObject(raw) || ownField(raw, 'v') !== VM_FILES.version || !isPlainObject(ownField(raw, 'vms'))) return {};
  const all = {};
  for (const id of IDS) {
    const entry = ownField(ownField(raw, 'vms'), id);
    if (entry !== undefined) all[id] = cleanFiles(entry);
  }
  return all;
}

export function readVmFiles(id) {
  return IDS.includes(id) ? readAllFiles()[id] || { dirs: [], files: [] } : { dirs: [], files: [] };
}

export function writeVmFiles(id, files) {
  if (!IDS.includes(id)) return;
  const all = readAllFiles();
  const clean = cleanFiles(files);
  if (clean.dirs.length || clean.files.length) all[id] = clean;
  else delete all[id];
  if (Object.keys(all).length) writeJson(sessionStore(), SESSION_KEYS.vmFiles, { v: VM_FILES.version, vms: all });
  else removeKey(sessionStore(), SESSION_KEYS.vmFiles);
}

// Powers a guest off away from the lab ("vm stop <guest>" on another page).
export function dropVm(id) {
  const record = readVms();
  writeVms({ ...record, front: record.front === id ? null : record.front, vms: record.vms.filter((vm) => vm.id !== id) });
}
