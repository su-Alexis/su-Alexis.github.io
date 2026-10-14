// Tests for the attribute and URL rules in utils/dom.js (doctrine sections 5 and 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedTag, safeHref, safeImageSrc, safeAttribute } from '../site/assets/js/utils/dom.js';

test('only allowlisted element names', () => {
  assert.equal(isAllowedTag('p'), true);
  for (const tag of ['script', 'iframe', 'object', 'embed', 'style', 'svg', 'math', 'form', 'base', 'P', 'img onerror']) {
    assert.equal(isAllowedTag(tag), false, tag);
  }
});

test('links: relative paths, fragments and reviewed https hosts only', () => {
  assert.equal(safeHref('projects/'), 'projects/');
  assert.equal(safeHref('../index.html#about'), '../index.html#about');
  assert.equal(safeHref('#projects'), '#projects');
  assert.equal(safeHref('https://www.credly.com/users/alexis-sm-pontious/badges'), 'https://www.credly.com/users/alexis-sm-pontious/badges');
  const rejected = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,x', 'vbscript:x',
    '//evil.example/', '/\\evil.example', 'http://www.credly.com/', 'https://evil.example/',
    'https://www.credly.com.evil.example/', 'https://user:pass@github.com/', 'https://github.com:8443/',
    '/absolute/path', '', null, 42,
  ];
  for (const href of rejected) assert.equal(safeHref(href), null, String(href));
});

test('images: same-origin relative image files only', () => {
  assert.equal(safeImageSrc('assets/media/images/projects/windows-debloat-and-optimize/start.jpg'), 'assets/media/images/projects/windows-debloat-and-optimize/start.jpg');
  for (const src of ['https://x.example/a.jpg', '//x.example/a.jpg', 'data:image/png;base64,AAAA', 'a.svg', 'a.jpg#x', 'javascript:a.jpg']) {
    assert.equal(safeImageSrc(src), null, src);
  }
});

test('attributes: executable, style and unknown attributes are dropped', () => {
  for (const name of ['onclick', 'onerror', 'style', 'srcdoc', 'formaction', 'target', 'rel', 'class', 'data-x', 'xlink:href']) {
    assert.equal(safeAttribute('a', name, 'x'), null, name);
  }
  assert.deepEqual(safeAttribute('a', 'aria-label', 'Projects'), ['aria-label', 'Projects']);
  assert.deepEqual(safeAttribute('div', 'id', 'boot-log'), ['id', 'boot-log']);
  for (const id of ['location', 'document', 'top', 'self', 'name', 'opener', 'Location', 'boot log', '1st']) {
    assert.equal(safeAttribute('div', 'id', id), null, id); // DOM clobbering and invalid ids
  }
  assert.equal(safeAttribute('div', 'tabindex', '5'), null);
  assert.equal(safeAttribute('div', 'href', 'projects/'), null);
  assert.equal(safeAttribute('a', 'href', 'javascript:alert(1)'), null);
  assert.equal(safeAttribute('button', 'type', 'submit'), null);
});

test('inputs: text type and fixed attribute values only', () => {
  assert.deepEqual(safeAttribute('input', 'type', 'text'), ['type', 'text']);
  assert.deepEqual(safeAttribute('input', 'maxlength', '512'), ['maxlength', '512']);
  for (const [name, value] of [['type', 'password'], ['type', 'file'], ['type', 'submit'], ['type', 'image'], ['formaction', 'x'], ['form', 'f'], ['value', 'x'], ['autocomplete', 'on'], ['maxlength', '-1'], ['maxlength', '99999'], ['onfocus', 'x']]) {
    assert.equal(safeAttribute('input', name, value), null, `${name}=${value}`);
  }
});
