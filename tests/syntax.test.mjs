// Every published script parses as an ES module (October 11, 2026: a duplicate
// declaration in layers/layer2.js stopped the lab loading, and no other test imports that
// browser-only module). Each file is copied to a temporary .mjs, so node --check parses it
// as a module (as the browser does) without running it; early errors such as duplicate
// declarations then fail here instead of in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SITE_DIR, listFiles } from '../scripts/lib.mjs';

test('every site script parses as a module', () => {
  const scripts = listFiles(SITE_DIR).filter((rel) => rel.endsWith('.js'));
  assert.ok(scripts.length > 0);
  const dir = mkdtempSync(join(tmpdir(), 'site-syntax-'));
  try {
    const broken = scripts.filter((rel, i) => {
      const copy = join(dir, `${i}.mjs`);
      copyFileSync(join(SITE_DIR, rel), copy);
      return spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' }).status !== 0;
    });
    assert.deepEqual(broken, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
