// In-place navigation (core/router.js): which links it may handle. Only paths in the page
// map count, the lab is always a normal load, and modified clicks stay with the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteRootFor, pageForPath, isPlainClick, softNavigate } from '../site/assets/js/core/router.js';
import { PAGES } from '../site/assets/js/data/commands.js';

test('the site root comes from this page and its place in the page map', () => {
  assert.equal(siteRootFor('/', 'home'), '/');
  assert.equal(siteRootFor('/index.html', 'home'), '/');
  assert.equal(siteRootFor('/projects/wingg/', 'wingg'), '/');
  assert.equal(siteRootFor('/projects/wingg/index.html', 'wingg'), '/');
  assert.equal(siteRootFor('/sub/site/projects/', 'projects'), '/sub/site/');
});

test('only paths in the page map lead to a page', () => {
  for (const [id, page] of Object.entries(PAGES)) {
    assert.equal(pageForPath(`/${page.path}`, '/'), id);
    assert.equal(pageForPath(`/${page.path}index.html`, '/'), id);
  }
  for (const bad of ['/projects', '/projects/nope/', '/assets/js/core/app.js', '/../', '//evil.example/', '/projects/wingg/../../', '', null, 42]) {
    assert.equal(pageForPath(bad, '/'), null, String(bad));
  }
  assert.equal(pageForPath('/other/projects/', '/sub/'), null);
});

test('modified or already-handled clicks stay with the browser', () => {
  const plain = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.equal(isPlainClick(plain), true);
  for (const change of [{ defaultPrevented: true }, { button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(isPlainClick({ ...plain, ...change }), false, JSON.stringify(change));
  }
});

test('without a running router the shell loads pages normally', () => {
  assert.equal(softNavigate('projects'), false);
  assert.equal(softNavigate('lab'), false);
});
