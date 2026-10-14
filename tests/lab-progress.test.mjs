// Layer 2 progress storage (ui/lab-progress.js): versioned, rebuilt from known ids only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  },
};

const { unlockedGuests, unlockGuests, lockGuests } = await import('../site/assets/js/ui/lab-progress.js');
const { PROGRESS_STORAGE_KEY } = await import('../site/assets/js/core/constants.js');

test('unlocks are remembered, versioned and limited to lockable guests', () => {
  data.clear();
  assert.deepEqual(unlockedGuests(), []);
  assert.deepEqual(unlockGuests(['ubuntu-blue', 'ws01', '__proto__']), ['ubuntu-blue'], 'ws01 is never encrypted');
  assert.deepEqual(unlockGuests(['ubuntu-blue']), [], 'already unlocked');
  assert.deepEqual(unlockGuests(['parrot01', 'ubuntu-blue']), ['parrot01']);
  assert.deepEqual(unlockedGuests(), ['parrot01', 'ubuntu-blue']);
  assert.deepEqual(JSON.parse(data.get(PROGRESS_STORAGE_KEY)), { v: 1, flags: ['vm-parrot01', 'vm-ubuntu-blue'] });
  assert.deepEqual(lockGuests(['parrot01']), ['parrot01']);
  assert.deepEqual(unlockedGuests(), ['ubuntu-blue']);
  assert.deepEqual(lockGuests(['ubuntu-blue', 'parrot01']), ['ubuntu-blue']);
  assert.equal(data.has(PROGRESS_STORAGE_KEY), false, 'an empty record is removed');
});

test('tampered or foreign records read as no progress', () => {
  for (const raw of ['nope', '{"v":2,"flags":["vm-parrot01"]}', '{"v":1,"flags":"vm-parrot01"}', '{"v":1,"flags":["vm-ws01","admin"]}', '{"v":1,"flags":["a","b","c","d"]}']) {
    data.set(PROGRESS_STORAGE_KEY, raw);
    assert.deepEqual(unlockedGuests(), [], raw);
  }
  data.set(PROGRESS_STORAGE_KEY, '{"v":1,"flags":["vm-ubuntu-blue","vm-ubuntu-blue"]}');
  assert.deepEqual(unlockedGuests(), ['ubuntu-blue'], 'duplicates collapse');
  unlockGuests(['parrot01']);
  assert.deepEqual(JSON.parse(data.get(PROGRESS_STORAGE_KEY)).flags, ['vm-parrot01', 'vm-ubuntu-blue']);
});
