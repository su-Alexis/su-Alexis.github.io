// Tampered-storage tests for terminal state and storage helpers (doctrine sections 8 and 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreTerminalState, defaultTerminalState, defaultShell, appendLines, clampWindow, nextShellId, fitToBudget } from '../site/assets/js/core/state.js';
import { readJson, writeJson, removeKey } from '../site/assets/js/core/storage.js';
import { LIMITS, TERMINAL_STATE_VERSION, TERMINAL_WINDOW, TERMINAL_STORAGE_KEY } from '../site/assets/js/core/constants.js';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  };
}

const tty1 = (state) => state.shells[0];

test('malformed or wrong-version state falls back to defaults', () => {
  for (const parsed of [undefined, null, 42, 'x', [], { v: 99 }, { v: '2' }, { v: 2 }, { v: 2, shells: [] }, { v: 2, shells: 'x' }]) {
    assert.deepEqual(restoreTerminalState(parsed), defaultTerminalState());
  }
});

test('version 1 state migrates into tty1', () => {
  const state = restoreTerminalState({ v: 1, transcript: [{ kind: 'out', text: 'kept' }], window: { floating: true, minimized: false, x: 10, y: 20, w: 500, h: 300 } });
  assert.equal(state.v, TERMINAL_STATE_VERSION);
  assert.equal(state.shells.length, 1);
  assert.equal(tty1(state).id, 'tty1');
  assert.deepEqual(tty1(state).transcript, [{ kind: 'out', text: 'kept' }]);
  assert.equal(tty1(state).window.floating, true);
});

test('shell lists are checked: known ids, no duplicates, tty1 first, at most three', () => {
  const shell = (id) => ({ id, transcript: [], window: {} });
  const bad = [
    [shell('tty2')],
    [shell('tty1'), shell('tty1')],
    [shell('tty1'), shell('tty9')],
    [shell('tty1'), shell('constructor')],
    [shell('tty1'), shell('tty2'), shell('tty3'), shell('tty3')],
    [shell('tty1'), 'tty2'],
  ];
  for (const shells of bad) assert.deepEqual(restoreTerminalState({ v: 2, shells }), defaultTerminalState(), JSON.stringify(shells));
  const ok = restoreTerminalState({ v: 2, shells: [shell('tty1'), shell('tty3')] });
  assert.deepEqual(ok.shells.map((s) => s.id), ['tty1', 'tty3']);
  assert.equal(ok.shells[1].window.floating, true); // spawned shells never dock
  assert.equal(nextShellId(ok), 'tty2');
  assert.equal(nextShellId({ shells: [shell('tty1'), shell('tty2'), shell('tty3')] }), null);
});

test('transcripts are rebuilt from known kinds and bounded text only', () => {
  const state = restoreTerminalState({
    v: 2,
    shells: [{
      id: 'tty1',
      transcript: [
        { kind: 'out', text: 'ok line' },
        { kind: 'html', text: '<b>x</b>' },
        { kind: 'out', text: 'x'.repeat(LIMITS.terminalLineLength + 1) },
        { kind: 'err', text: 'bad' + String.fromCharCode(10) + 'newline' },
        { kind: 'cmd', text: 42 },
        'string entry',
        { kind: 'cmd', text: 'help', extra: 'ignored' },
        { kind: 'cmd', text: 'ls', cwd: '~/projects' },
        { kind: 'cmd', text: 'ls', cwd: '/etc/passwd' },
        { kind: 'out', text: 'x', cwd: '~' },
      ],
    }],
  });
  assert.deepEqual(tty1(state).transcript, [{ kind: 'out', text: 'ok line' }, { kind: 'cmd', text: 'help' }, { kind: 'cmd', text: 'ls', cwd: '~/projects' }]);
});

test('oversized transcripts are discarded entirely', () => {
  const transcript = Array.from({ length: LIMITS.terminalLines + 1 }, () => ({ kind: 'out', text: 'x' }));
  assert.deepEqual(tty1(restoreTerminalState({ v: 2, shells: [{ id: 'tty1', transcript }] })).transcript, []);
});

test('prototype pollution attempts are ignored', () => {
  const parsed = JSON.parse('{"v":2,"__proto__":{"polluted":true},"shells":[{"id":"tty1","__proto__":{"transcript":[{"kind":"out","text":"x"}]},"window":{"__proto__":{"floating":true},"x":"5","y":-10,"w":1e9,"h":null}}]}');
  const state = restoreTerminalState(parsed);
  const defaults = defaultTerminalState().shells[0].window;
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(tty1(state).transcript, []);
  assert.equal(tty1(state).window.floating, false);
  assert.equal(tty1(state).window.x, defaults.x);
  assert.equal(tty1(state).window.y, defaults.y);
  assert.equal(tty1(state).window.w, TERMINAL_WINDOW.defaultWidth);
  assert.equal(tty1(state).window.h, TERMINAL_WINDOW.defaultHeight);
});

test('three full shells are trimmed to fit the storage budget, oldest lines first', () => {
  const full = (id) => ({ id, transcript: Array.from({ length: LIMITS.terminalLines }, (_, i) => ({ kind: 'out', text: `${id} line ${i} `.padEnd(120, '.') })), window: defaultShell(id).window });
  const state = { v: 2, shells: [full('tty1'), full('tty2'), full('tty3')] };
  fitToBudget(state);
  const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
  assert.ok(bytes <= LIMITS.storageBytes, `${bytes} bytes`);
  for (const s of state.shells) {
    assert.ok(s.transcript.length > 0);
    assert.match(s.transcript[s.transcript.length - 1].text, new RegExp(`^${s.id} line ${LIMITS.terminalLines - 1} `));
  }
});

test('appendLines keeps only the newest lines and drops invalid ones', () => {
  let transcript = [];
  for (let i = 0; i < LIMITS.terminalLines + 25; i += 1) transcript = appendLines(transcript, [{ kind: 'out', text: String(i) }]);
  assert.equal(transcript.length, LIMITS.terminalLines);
  assert.equal(transcript[transcript.length - 1].text, String(LIMITS.terminalLines + 24));
  assert.equal(appendLines([], [{ kind: 'bad', text: 'x' }]).length, 0);
});

test('windows are clamped into the viewport with the title bar reachable', () => {
  const win = clampWindow({ floating: true, minimized: false, x: 5000, y: 5000, w: 3000, h: 3000 }, 1280, 720);
  assert.equal(win.w, 1280);
  assert.equal(win.h, 720);
  assert.equal(win.x, 0);
  assert.equal(win.y, 720 - TERMINAL_WINDOW.barHeight);
  const small = clampWindow({ x: -50, y: -50, w: 10, h: 10 }, 1280, 720);
  assert.equal(small.x, 0);
  assert.equal(small.y, 0);
  assert.equal(small.w, TERMINAL_WINDOW.minWidth);
});

test('storage helpers are bounded, namespaced and failure-tolerant', () => {
  const store = memoryStore();
  assert.equal(writeJson(store, TERMINAL_STORAGE_KEY, { a: 1 }), true);
  assert.deepEqual(readJson(store, TERMINAL_STORAGE_KEY), { a: 1 });
  assert.equal(writeJson(store, 'other-app-key', { a: 1 }), false); // not our namespace
  assert.equal(writeJson(store, TERMINAL_STORAGE_KEY, { big: 'x'.repeat(LIMITS.storageCodeUnits) }), false);
  store.setItem(TERMINAL_STORAGE_KEY, '{not json');
  assert.equal(readJson(store, TERMINAL_STORAGE_KEY), undefined);
  removeKey(store, TERMINAL_STORAGE_KEY);
  assert.equal(readJson(store, TERMINAL_STORAGE_KEY), undefined);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readJson(broken, TERMINAL_STORAGE_KEY), undefined);
  assert.equal(writeJson(broken, TERMINAL_STORAGE_KEY, {}), false);
  assert.doesNotThrow(() => removeKey(broken, TERMINAL_STORAGE_KEY));
  assert.equal(readJson(null, TERMINAL_STORAGE_KEY), undefined);
});

test('pwd and oldpwd are restored only as simulated directories', () => {
  const shells = [{ id: 'tty1', transcript: [], window: {} }];
  const ok = restoreTerminalState({ v: 2, shells, pwd: '~/projects', oldpwd: '~' });
  assert.equal(ok.pwd, '~/projects');
  assert.equal(ok.oldpwd, '~');
  const bad = restoreTerminalState({ v: 2, shells, pwd: '/etc', oldpwd: '~/../../etc' });
  assert.equal(bad.pwd, undefined);
  assert.equal(bad.oldpwd, undefined);
});
