// Validated state shapes and transitions. Doctrine section 8: stored values are
// attacker-controlled, so restored state is rebuilt field by field from known fields,
// with versions checked, sizes bounded, and anything unexpected replaced by defaults.

import { LIMITS, TERMINAL_STATE_VERSION, TERMINAL_WINDOW, SHELL_IDS } from './constants.js';
import { isPlainObject, ownField, hasControlChars } from '../utils/validate.js';

export const LINE_KINDS = Object.freeze(['cmd', 'out', 'ok', 'err', 'art']);
const KIND_SET = new Set(LINE_KINDS);
const SHELL_SET = new Set(SHELL_IDS);

// Simulated working directories shown in the prompt, such as "~" or "~/projects/debloat".
const CWD = /^~(?:\/[a-z0-9-]{1,32}){0,3}$/;

function defaultWindow(floating = false, offset = 0) {
  return {
    floating,
    minimized: false,
    x: 80 + offset * 36,
    y: 110 + offset * 36,
    w: TERMINAL_WINDOW.defaultWidth,
    h: TERMINAL_WINDOW.defaultHeight,
  };
}

// tty1 starts docked; spawned shells start as floating windows, cascaded.
export function defaultShell(id) {
  const index = SHELL_IDS.indexOf(id);
  return { id, transcript: [], window: defaultWindow(index > 0, Math.max(0, index - 1)) };
}

export function defaultTerminalState() {
  return { v: TERMINAL_STATE_VERSION, shells: [defaultShell('tty1')] };
}

function isLine(entry) {
  const kind = ownField(entry, 'kind');
  const text = ownField(entry, 'text');
  const cwd = ownField(entry, 'cwd');
  if (cwd !== undefined && (kind !== 'cmd' || typeof cwd !== 'string' || !CWD.test(cwd))) return false;
  return KIND_SET.has(kind) && typeof text === 'string' && text.length <= LIMITS.terminalLineLength && !hasControlChars(text);
}

function copyLine(entry) {
  const cwd = ownField(entry, 'cwd');
  return cwd === undefined ? { kind: entry.kind, text: entry.text } : { kind: entry.kind, text: entry.text, cwd };
}

function finiteIn(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : fallback;
}

function restoreTranscript(transcript) {
  const out = [];
  if (Array.isArray(transcript) && transcript.length <= LIMITS.terminalLines) {
    for (const entry of transcript) {
      if (isLine(entry)) out.push(copyLine(entry));
    }
  }
  return out;
}

function restoreWindow(win, fallback) {
  if (!isPlainObject(win)) return fallback;
  const max = TERMINAL_WINDOW.maxCoordinate;
  return {
    floating: ownField(win, 'floating') === true,
    minimized: ownField(win, 'minimized') === true,
    x: finiteIn(ownField(win, 'x'), 0, max, fallback.x),
    y: finiteIn(ownField(win, 'y'), 0, max, fallback.y),
    w: finiteIn(ownField(win, 'w'), TERMINAL_WINDOW.minWidth, max, TERMINAL_WINDOW.defaultWidth),
    h: finiteIn(ownField(win, 'h'), TERMINAL_WINDOW.minHeight, max, TERMINAL_WINDOW.defaultHeight),
  };
}

function restoreShell(raw, id) {
  const shell = defaultShell(id);
  shell.transcript = restoreTranscript(ownField(raw, 'transcript'));
  shell.window = restoreWindow(ownField(raw, 'window'), shell.window);
  if (id !== 'tty1') shell.window.floating = true; // spawned shells never dock
  return shell;
}

// Version 2 holds up to three shells; tty1 always comes first. Version 1 (a single
// transcript and window) is migrated into tty1. Anything else resets to defaults.
export function restoreTerminalState(parsed) {
  if (!isPlainObject(parsed)) return defaultTerminalState();
  const version = ownField(parsed, 'v');

  if (version === 1) {
    return { v: TERMINAL_STATE_VERSION, shells: [restoreShell(parsed, 'tty1')] };
  }
  if (version !== TERMINAL_STATE_VERSION) return defaultTerminalState();

  const shells = ownField(parsed, 'shells');
  if (!Array.isArray(shells) || shells.length === 0 || shells.length > SHELL_IDS.length) return defaultTerminalState();
  const seen = new Set();
  const restored = [];
  for (const raw of shells) {
    const id = ownField(raw, 'id');
    if (typeof id !== 'string' || !SHELL_SET.has(id) || seen.has(id)) return defaultTerminalState();
    seen.add(id);
    restored.push(restoreShell(raw, id));
  }
  if (restored[0].id !== 'tty1') return defaultTerminalState();
  const state = { v: TERMINAL_STATE_VERSION, shells: restored };
  // pwd / oldpwd: the last page's directory and the one before it, for "cd -".
  for (const key of ['pwd', 'oldpwd']) {
    const value = ownField(parsed, key);
    if (typeof value === 'string' && CWD.test(value)) state[key] = value;
  }
  return state;
}

// The next free shell id, or null when every shell is open.
export function nextShellId(state) {
  const open = new Set(state.shells.map((shell) => shell.id));
  return SHELL_IDS.find((id) => !open.has(id)) || null;
}

// Appends lines and keeps only the newest LIMITS.terminalLines entries.
export function appendLines(transcript, lines) {
  const next = transcript.concat(lines.filter(isLine).map(copyLine));
  return next.length > LIMITS.terminalLines ? next.slice(next.length - LIMITS.terminalLines) : next;
}

// Drops the oldest lines, from the longest transcript first, until the whole state fits
// the storage budget. Keeps persistence working instead of failing to save.
export function fitToBudget(state, maxBytes = LIMITS.storageBytes - 1024) {
  const size = () => new TextEncoder().encode(JSON.stringify(state)).length;
  let guard = LIMITS.terminalLines * SHELL_IDS.length;
  while (size() > maxBytes && guard > 0) {
    const longest = state.shells.reduce((a, b) => (b.transcript.length > a.transcript.length ? b : a));
    if (longest.transcript.length === 0) break;
    longest.transcript.splice(0, Math.min(10, longest.transcript.length));
    guard -= 1;
  }
  return state;
}

// Keeps a window inside the viewport with its title bar reachable.
export function clampWindow(win, viewportWidth, viewportHeight) {
  const w = Math.max(TERMINAL_WINDOW.minWidth, Math.min(win.w, viewportWidth));
  const h = Math.max(TERMINAL_WINDOW.minHeight, Math.min(win.h, viewportHeight));
  const x = Math.max(0, Math.min(win.x, viewportWidth - w));
  const y = Math.max(0, Math.min(win.y, viewportHeight - TERMINAL_WINDOW.barHeight));
  return { ...win, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
