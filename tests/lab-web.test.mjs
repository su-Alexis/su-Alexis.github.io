// Layer 2 lab web (features/lab-web.js, data/lab-web.js): what the simulated browsers on
// the Winbows VMs can open. Doctrine section 4: allowlisted pages only, nothing typed is
// fetched or shown back.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { resolveAddress, searchLab, MAX_ADDRESS } = await import('../site/assets/js/features/lab-web.js');
const { PAGES, HOME_PAGE } = await import('../site/assets/js/data/lab-web.js');
const { VMS } = await import('../site/assets/js/data/commands.js');

const all = { running: () => true };

test('the home page is search.example and every page link leads to a page', () => {
  assert.equal(HOME_PAGE, 'search.example');
  for (const [key, page] of Object.entries(PAGES)) {
    for (const block of page.blocks) {
      for (const item of block.t === 'links' ? block.items : []) assert.ok(Object.hasOwn(PAGES, item.to), `${key} links to ${item.to}`);
      if (block.t === 'login' && block.success) assert.ok(Object.hasOwn(PAGES, block.success));
    }
    // Hosts are the lab plan's own (doctrine section 3) or the doctrine's search.example.
    if (!key.startsWith('about:')) assert.match(key.split('/')[0], /^([a-z0-9-]+\.)?(lab|corp|search)\.example$/);
    if (page.host) assert.ok(VMS.some((vm) => vm.id === page.host));
  }
});

test('addresses resolve however they are typed', () => {
  for (const typed of ['web01.lab.example', 'https://web01.lab.example/', 'WEB01.LAB.EXAMPLE', '198.51.100.50', 'web01.lab.example/index.html', 'web01.lab.example:443']) {
    assert.deepEqual(resolveAddress(typed, all), { kind: 'page', key: 'web01.lab.example' }, typed);
  }
  assert.deepEqual(resolveAddress('about:robots', all), { kind: 'page', key: 'about:robots' });
  assert.deepEqual(resolveAddress('search.example/anything', all), { kind: 'page', key: 'search.example' });
});

test('lab machines answer like machines: off, no web server, missing page', () => {
  assert.deepEqual(resolveAddress('web01.lab.example', { running: () => false }), { kind: 'error', error: 'timeout', host: 'web01.lab.example' });
  assert.deepEqual(resolveAddress('dc01.corp.example', all), { kind: 'error', error: 'refused', host: 'dc01.corp.example' });
  assert.deepEqual(resolveAddress('198.51.100.20', all), { kind: 'error', error: 'refused', host: 'ws01.lab.example' });
  assert.deepEqual(resolveAddress('web01.lab.example/admin', all), { kind: 'error', error: 'missing', host: 'web01.lab.example' });
});

test('the camera live view needs its sign-in first', () => {
  assert.deepEqual(resolveAddress('cam01.lab.example/live', all), { kind: 'page', key: 'cam01.lab.example' });
  assert.deepEqual(resolveAddress('cam01.lab.example/live', { ...all, signedIn: (id) => id === 'cam01' }), { kind: 'page', key: 'cam01.lab.example/live' });
  assert.ok(!searchLab('camera live view').includes('cam01.lab.example/live'));
});

test("web01's robots.txt easter egg: found by reading it, never by searching", () => {
  assert.deepEqual(resolveAddress('web01.lab.example/robots.txt', all), { kind: 'page', key: 'web01.lab.example/robots.txt' });
  const robots = PAGES['web01.lab.example/robots.txt'].blocks[0].text;
  assert.match(robots, /Disallow: \/backup-old\//);
  assert.deepEqual(resolveAddress('https://web01.lab.example/backup-old/', all), { kind: 'page', key: 'web01.lab.example/backup-old' });
  assert.deepEqual(resolveAddress('198.51.100.50/backup-old/notes.txt', all), { kind: 'page', key: 'web01.lab.example/backup-old/notes.txt' });
  assert.match(PAGES['web01.lab.example/backup-old/notes.txt'].blocks[0].text, /cam01/);
  for (const words of ['backup old notes', 'robots txt', 'index bak']) {
    assert.ok(searchLab(words).every((key) => !PAGES[key].hidden), words);
  }
  // The camera's sticky note has its text.
  assert.ok(PAGES['cam01.lab.example/live'].blocks.some((block) => block.t === 'camera' && block.note));
});

test('anything else is not found or a search, and nothing typed comes back', () => {
  for (const typed of ['google.com', 'https://example.com', 'about:config', 'javascript:alert(1)', 'file:///c:/winbows']) {
    const result = resolveAddress(typed, all);
    assert.equal(result.kind, 'error', typed);
    assert.equal(result.host, undefined);
  }
  assert.deepEqual(resolveAddress('apache web server', all), { kind: 'search' });
  assert.deepEqual(resolveAddress('router', all), { kind: 'search' });
  assert.equal(resolveAddress('   ', all), null);
  assert.equal(resolveAddress('a'.repeat(MAX_ADDRESS + 1), all), null);
  assert.equal(resolveAddress(42, all), null);
  // Search returns page keys only, never the words.
  assert.deepEqual(searchLab('router admin')[0], 'router01.lab.example');
  assert.ok(searchLab('camera').includes('cam01.lab.example'));
  assert.deepEqual(searchLab('hunter2x'), []);
  assert.ok(searchLab('robots').every((key) => !key.startsWith('about:')));
});
