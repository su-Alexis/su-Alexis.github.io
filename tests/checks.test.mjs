// Proves the repository checks catch what the doctrine forbids and accept what it allows.
// Run: node --test "tests/**/*.test.mjs"
// Secret-like fixtures are assembled at runtime so this file never matches the secret scan itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSiteFile, checkHtmlPolicies, checkAddresses, checkSimulatedHosts, checkSecrets, REQUIRED_CSP } from '../scripts/check-security.mjs';
import { checkPublish, parseInventory, imageMetadata, checkInternalLinks } from '../scripts/check-publish.mjs';

test('internal links must resolve to published files', () => {
  const present = new Set(['index.html', 'projects/index.html', 'assets/css/base.css', 'assets/a.jpg']);
  const ok = checkInternalLinks([
    { rel: 'index.html', html: '<a href="projects/">p</a><link href="assets/css/base.css"><img src="assets/a.jpg"><a href="#top">t</a><a href="https://github.com/x">g</a>' },
    { rel: 'projects/index.html', html: '<a href="../">home</a><a href="../index.html#about">a</a><img src="../assets/a.jpg">' },
    { rel: '404.html', html: '<a href="/">home</a><link href="/assets/css/base.css">' },
  ], present);
  assert.deepEqual(ok, []);
  const broken = checkInternalLinks([{ rel: 'index.html', html: '<a href="writeups/">w</a><img src="assets/missing.jpg">' }], present);
  assert.equal(broken.length, 2);
});

const CSP = Object.entries(REQUIRED_CSP).map(([d, v]) => (v ? `${d} ${v}` : d)).join('; ');

function page(body = '', head = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<title>Test</title>
${head}
<link rel="stylesheet" href="assets/css/base.css">
<script type="module" src="assets/js/core/app.js"></script>
</head>
<body>${body}</body>
</html>`;
}

const rules = (findings) => findings.map((f) => f.rule);

test('a compliant page passes', () => {
  const body = '<a href="https://www.credly.com/" target="_blank" rel="noopener noreferrer">Credly</a>';
  assert.deepEqual(checkSiteFile('index.html', page(body)), []);
});

test('missing or misplaced page policies are caught', () => {
  const noCsp = page().replace(/<meta http-equiv[^>]*>/, '');
  assert.ok(rules(checkHtmlPolicies('x.html', noCsp)).includes('missing Content-Security-Policy meta'));

  const noReferrer = page().replace(/<meta name="referrer"[^>]*>/, '');
  assert.ok(rules(checkHtmlPolicies('x.html', noReferrer)).some((r) => r.startsWith('missing <meta name="referrer"')));

  const late = page().replace(/(<meta http-equiv[^>]*>)/, '').replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${CSP}"></head>`);
  assert.ok(rules(checkHtmlPolicies('x.html', late)).includes('CSP meta must come before the first resource it governs'));

  const weak = page().replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
  assert.ok(rules(checkHtmlPolicies('x.html', weak)).includes('CSP directive differs from doctrine'));

  const extra = page().replace('upgrade-insecure-requests', 'upgrade-insecure-requests; sandbox');
  assert.ok(rules(checkHtmlPolicies('x.html', extra)).includes('unreviewed CSP directive'));
});

test('inline code, styles, external resources and unsafe links are caught in HTML', () => {
  const cases = [
    ['<button onclick="go()">x</button>', 'inline event-handler attribute'],
    ['<script>alert(1)</script>', 'inline <script> (JavaScript must load from a same-origin file)'],
    ['<p style="color:red">x</p>', 'inline style attribute'],
    ['<iframe src="a.html"></iframe>', 'frame, object, embed or base element'],
    ['<form></form>', 'forms are not permitted (doctrine section 1)'],
    ['<a href="javascript:void(0)">x</a>', 'javascript: URL'],
    ['<a href="https://x.example/" target="_blank">x</a>', 'target="_blank" link needs rel="noopener noreferrer"'],
  ];
  for (const [body, rule] of cases) assert.ok(rules(checkSiteFile('index.html', page(body))).includes(rule), rule);
  const ext = page('', '<script src="https://cdn.example/x.js"></script>');
  assert.ok(rules(checkSiteFile('index.html', ext)).includes('external script'));
});

test('forbidden JavaScript sinks are caught', () => {
  const cases = [
    'el.innerHTML = x;',
    'el.outerHTML = x;',
    'el.insertAdjacentHTML("beforeend", x);',
    'document.write(x);',
    'eval(x);',
    'new Function("return 1");',
    'setTimeout("go()", 10);',
    'frame.srcdoc = x;',
    'el.style.cssText = x;',
    'el.setAttribute("onclick", x);',
    'import(`./layers/${id}.js`);',
    'import(path);',
    'import x from "https://cdn.example/x.js";',
  ];
  for (const code of cases) assert.ok(checkSiteFile('assets/js/core/app.js', code).length > 0, code);
});

test('safe JavaScript patterns pass', () => {
  const code = [
    "const loaders = Object.freeze({ portfolio: () => import('../layers/layer1.js') });",
    "el.textContent = value;",
    "el.setAttribute('aria-hidden', 'true');",
    "setTimeout(() => el.classList.add('done'), 100);",
    "el.style.left = `${x}px`;",
  ].join('\n');
  assert.deepEqual(checkSiteFile('assets/js/core/app.js', code), []);
});

test('external CSS and insecure http are caught', () => {
  assert.ok(checkSiteFile('assets/css/base.css', '@import url("https://fonts.example/x.css");').length > 0);
  assert.ok(checkSiteFile('assets/css/base.css', 'a { background: url(//x.example/a.png); }').length > 0);
  assert.ok(rules(checkSiteFile('assets/js/core/app.js', 'const u = "http://x.example/";')).includes('insecure http:// reference'));
  assert.deepEqual(checkSiteFile('assets/js/core/app.js', 'const ns = "http://www.w3.org/2000/svg";'), []);
});

test('simulated addresses must use documentation ranges', () => {
  assert.deepEqual(checkAddresses('f', 'hosts: 192.0.2.10, 198.51.100.42, 203.0.113.7, 2001:db8::42'), []);
  assert.equal(checkAddresses('f', 'target 10.0.0.5').length, 1);
  assert.equal(checkAddresses('f', 'target 8.8.8.8').length, 1);
  assert.equal(checkAddresses('f', 'target fe80::1').length, 1);
  assert.deepEqual(checkAddresses('f', 'uptime 10:30:00'), []);
});

test('simulated hostnames must be reserved names', () => {
  assert.deepEqual(checkSimulatedHosts('f', "['gateway.lab.example', 'dc01.corp.example', 'fileserver.test', 'notes.txt', 'node.status']"), []);
  assert.equal(checkSimulatedHosts('f', "'intranet.acme.com'").length, 1);
  assert.equal(checkSimulatedHosts('f', "'dc01.corp.local'").length, 1);
});

test('secrets are caught', () => {
  const samples = [
    'AKIA' + 'ABCDEFGHIJKLMNOP',
    'ghp_' + 'a'.repeat(36),
    '-----BEGIN ' + 'RSA PRIVATE KEY-----',
    'api_key = "' + 'x'.repeat(20) + '"',
  ];
  for (const s of samples) assert.equal(checkSecrets('f', s).length, 1, s.slice(0, 6));
  assert.deepEqual(checkSecrets('f', 'Never commit API keys or tokens.'), []);
});

test('publish inventory is an exact allowlist', () => {
  const inventory = parseInventory('# comment\nindex.html\n404.html\nassets/css/base.css\n');
  const ok = checkPublish({ files: [{ rel: 'index.html', size: 10 }, { rel: '404.html', size: 10 }, { rel: 'assets/css/base.css', size: 10 }], inventory });
  assert.deepEqual(ok.findings, []);

  const extra = checkPublish({ files: [{ rel: 'index.html', size: 10 }, { rel: '404.html', size: 10 }, { rel: 'assets/css/base.css', size: 10 }, { rel: 'old.html', size: 10 }], inventory });
  assert.ok(rules(extra.findings).includes('not in scripts/publish-inventory.txt (unreviewed file)'));

  const missing = checkPublish({ files: [{ rel: 'index.html', size: 10 }, { rel: '404.html', size: 10 }], inventory });
  assert.ok(rules(missing.findings).includes('listed file does not exist'));
});

test('forbidden publish files are caught', () => {
  const inventory = ['index.html', '404.html', 'app.js.map', 'notes.md', 'page.bak', 'app.test.js', 'big.jpg'];
  const files = inventory.map((rel) => ({ rel, size: rel === 'big.jpg' ? 700 * 1024 : 10 }));
  files.push({ rel: '.env', size: 10 });
  const r = rules(checkPublish({ files, inventory }).findings);
  for (const rule of ['source map', 'file type .md is not publishable', 'backup or temporary file', 'test, debug or draft file', 'file larger than the reviewed limit', 'hidden file or directory']) {
    assert.ok(r.includes(rule), rule);
  }
});

test('placeholders fail strict mode and only warn in dev mode', () => {
  const files = [{ rel: 'index.html', size: 1 }, { rel: '404.html', size: 1 }, { rel: 'assets/js/_PLACEHOLDER.md', size: 1 }];
  const inventory = ['index.html', '404.html'];
  assert.ok(rules(checkPublish({ files, inventory }).findings).includes('placeholder must be removed before publishing'));
  const dev = checkPublish({ files, inventory, dev: true });
  assert.deepEqual(dev.findings, []);
  assert.equal(dev.warnings.length, 1);
});

test('image metadata is detected', () => {
  const jpegWithExif = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda]);
  const jpegClean = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xda]);
  assert.equal(imageMetadata(jpegWithExif, 'jpg'), 'EXIF/XMP (APP1)');
  assert.equal(imageMetadata(jpegClean, 'jpg'), null);
  const r = rules(checkPublish({ files: [{ rel: 'a.jpg', size: 1, metadata: 'EXIF/XMP (APP1)' }], inventory: ['a.jpg'], dev: true }).findings);
  assert.ok(r.includes('image metadata must be stripped'));
});
