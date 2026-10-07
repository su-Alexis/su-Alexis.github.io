// Tests for the console's read-only commands and easter eggs added in the Layer 1 shell
// extras: cat, man, neofetch, uptime, history, git log, hunt, theme, sudo and rm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execute, complete } from '../site/assets/js/features/command-engine.js';
import { COMMANDS, EGGS, PROJECTS, PAGES, THEME_IDS } from '../site/assets/js/data/commands.js';
import { FILES, MANUAL, NEOFETCH_LOGO, CERT_ROWS, PROJECT_READMES } from '../site/assets/js/data/shell-text.js';
import { LIMITS } from '../site/assets/js/core/constants.js';

const texts = (result) => result.lines.map((l) => l.text).join('\n');
// Page text as a visitor reads it: tags dropped, entities decoded, spaces collapsed.
const pageText = (path) => readFileSync(new URL(`../site/${path}index.html`, import.meta.url), 'utf8')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&#[0-9]+;|&[a-z]+;/g, ' ')
  .replace(/\s+/g, ' ');

test('certs.txt matches the certifications on the home page', () => {
  const home = pageText('');
  for (const cert of CERT_ROWS) {
    assert.ok(home.includes(cert.name), cert.name);
    if (cert.when) assert.ok(home.includes(cert.when), `${cert.name} ${cert.when}`);
  }
  assert.equal(CERT_ROWS.filter((cert) => cert.status === 'CERTIFIED').length, 1, 'only Security+ is earned');
});

test('project READMEs quote their project pages word for word', () => {
  for (const project of PROJECTS) {
    const readme = PROJECT_READMES[project.page];
    assert.ok(readme, project.page);
    const page = pageText(PAGES[project.page].path);
    assert.ok(page.includes(readme.summary), `${project.page} summary`);
    assert.ok(page.includes(readme.stack), `${project.page} stack`);
    assert.ok(page.includes(`[ ${readme.status} ]`), `${project.page} status`);
  }
});

test('cat prints only files in the current directory', () => {
  assert.match(texts(execute('cat about.txt', { page: 'home' })), /Alexis Pontious/);
  assert.equal(execute('cat about.txt', { page: 'wingg' }).valid, false);
  assert.equal(execute('cat README.md', { page: 'home' }).valid, false);
  for (const project of PROJECTS) assert.match(texts(execute('cat README.md', { page: project.page })), /status: \[/);
  for (const bad of ['../about.txt', '/etc/passwd', 'ABOUT.TXT', 'constructor', '__proto__', '.']) {
    const result = execute(`cat ${bad}`, { page: 'home' });
    assert.equal(result.valid, false, bad);
    assert.ok(!texts(result).includes(bad) || bad === '.', bad);
  }
  assert.equal(complete('cat ce', { page: 'home' }), 'cat certs.txt');
  assert.equal(complete('cat R', { page: 'debloat' }), 'cat README.md');
  assert.equal(complete('cat R', { page: 'home' }), null);
  for (const page of Object.keys(FILES)) {
    for (const lines of Object.values(FILES[page])) for (const [, text] of lines) assert.ok(text.length <= LIMITS.terminalLineLength);
  }
});

test('ls lists the files that cat can print', () => {
  assert.match(texts(execute('ls', { page: 'home' })), /about\.txt {2}certs\.txt/);
  assert.match(texts(execute('ls', { page: 'wingg' })), /README\.md/);
});

test('every visible command has a man page; hidden ones do not', () => {
  for (const command of COMMANDS) {
    const result = execute(`man ${command.name}`);
    if (command.hidden) {
      assert.equal(result.valid, false, command.name);
    } else {
      assert.ok(Object.hasOwn(MANUAL, command.name), command.name);
      assert.match(texts(result), /NAME[\s\S]*SYNOPSIS[\s\S]*DESCRIPTION/, command.name);
    }
  }
  assert.match(texts(execute('man')), /What manual page/);
});

test('neofetch lines up its logo and reports the context it is given', () => {
  assert.ok(NEOFETCH_LOGO.every((row) => row.length === NEOFETCH_LOGO[0].length));
  const text = texts(execute('neofetch', { theme: 'amber', background: 'hex_float', uptime: 125, shell: 'tty2' }));
  assert.match(text, /Theme: amber/);
  assert.match(text, /Background: hex_float/);
  assert.match(text, /Uptime: 2 min/);
  assert.match(text, /Shell: wsh \(tty2\)/);
  assert.match(text, /Packages: 6 projects/);
  // Hostile context falls back to safe defaults.
  const hostile = texts(execute('neofetch', { theme: '<script>', background: '__proto__', uptime: -5, shell: 'root' }));
  assert.match(hostile, /Theme: cyan/);
  assert.match(hostile, /Background: default/);
  assert.match(hostile, /Uptime: 0 min/);
  assert.match(hostile, /wsh \(tty1\)/);
});

test('uptime formats minutes, hours and days', () => {
  assert.match(texts(execute('uptime', { uptime: 59 })), /up 0 min/);
  assert.match(texts(execute('uptime', { uptime: 3725 })), /up 1:02/);
  assert.match(texts(execute('uptime', { uptime: 2 * 86400 + 3600 })), /up 2 days, 1:00/);
  assert.match(texts(execute('uptime', { uptime: Infinity })), /up 0 min/);
});

test('history lists stored commands only, bounded, ending with itself', () => {
  const result = execute('history', { history: ['help', 'ls', 'x\u0007bad', 42, ''] });
  assert.deepEqual(result.lines.map((l) => l.text.trim()), ['1  help', '2  ls', '3  history']);
  const many = execute('history', { history: Array.from({ length: 300 }, (_, i) => `cmd${i}`) });
  assert.equal(many.lines.length, LIMITS.terminalHistory);
  assert.match(many.lines.at(-1).text, /history$/);
});

test('git log shows the changelog, newest first', () => {
  const result = execute('git log');
  assert.equal(result.lines[0].kind, 'git');
  assert.match(result.lines[0].text, /\(HEAD -> main\)/);
  assert.equal(execute('git push').valid, false);
  assert.equal(execute('git').valid, false);
});

test('theme lists and switches only known themes', () => {
  assert.match(texts(execute('theme', { theme: 'green' })), /\* green/);
  for (const id of THEME_IDS) assert.deepEqual({ ...execute(`theme ${id}`).action }, { type: 'theme', id });
  for (const bad of ['red', 'AMBER', '../cyan', 'constructor']) assert.equal(execute(`theme ${bad}`).action, null, bad);
});

test('hunt shows found eggs, hints for the rest, and ignores tampered progress', () => {
  const none = texts(execute('hunt'));
  assert.match(none, new RegExp(`0/${EGGS.length} found`));
  for (const egg of EGGS) assert.ok(none.includes(egg.hint), egg.id);
  assert.ok(!none.includes('31337'), 'no spoilers before finding');
  const some = texts(execute('hunt', { found: ['matrix', 'matrix', 'bogus', '__proto__'] }));
  assert.match(some, new RegExp(`1/${EGGS.length} found`));
  assert.ok(some.includes('31337'));
  assert.match(texts(execute('hunt', { found: EGGS.map((egg) => egg.id) })), /every egg found/);
  assert.deepEqual({ ...execute('hunt reset').action }, { type: 'hunt-reset' });
  assert.match(texts(execute('help')), /hunt \[reset\]/);
});

test('easter eggs report which egg they are', () => {
  assert.equal(execute('hello world').egg, 'hello');
  assert.equal(execute('hello').egg, null);
  assert.equal(execute('31337').egg, 'matrix');
  assert.equal(execute(':(){ :|:& };:').egg, 'forkbomb');
  // The breakdown only runs as root; sudo itself asks for the password first.
  assert.equal(execute('sudo rm -rf /').egg, null);
  assert.equal(execute('rm -rf /', { root: true }).egg, 'rmrf');
  assert.equal(execute('help').egg, null);
});

test('sudo asks for the password and names the command to run as root', () => {
  assert.deepEqual({ ...execute('sudo rm -rf /').action }, { type: 'sudo', via: 'sudo', inner: 'rm -rf /' });
  assert.deepEqual({ ...execute('sudo whoami').action }, { type: 'sudo', via: 'sudo', inner: 'whoami' });
  // Bare sudo prompts too (owner request), opening a root shell like sudo -i.
  for (const raw of ['sudo', 'sudo su', 'sudo -i', 'sudo bash', 'sudo su -']) {
    assert.deepEqual({ ...execute(raw).action }, { type: 'sudo', via: 'sudo', inner: null }, raw);
  }
  for (const raw of ['sudo nmap', 'sudo sudo ls', 'sudo su root now']) assert.equal(execute(raw).action.inner, 'unknown', raw);
  assert.equal(execute('sudo whoami').action.via, 'sudo');
  assert.doesNotMatch(texts(execute('help')), /sudo|rm </);
  assert.equal(complete('su'), null);
});

test('su does what sudo does, with its own prompt', () => {
  for (const raw of ['su', 'su -', 'su root', 'su - root', 'su -c']) {
    assert.deepEqual({ ...execute(raw).action }, { type: 'sudo', via: 'su', inner: null }, raw);
  }
  const dashC = execute('su -c whoami');
  assert.deepEqual({ ...dashC.action }, { type: 'sudo', via: 'su', inner: 'whoami' });
  assert.equal(dashC.echo, 'su -c whoami');
  assert.deepEqual({ ...execute('su rm -rf /').action }, { type: 'sudo', via: 'su', inner: 'rm -rf /' });
  for (const raw of ['su nmap', 'su su', 'su sudo ls', 'su -c nmap']) assert.equal(execute(raw).action.inner, 'unknown', raw);
  assert.doesNotMatch(texts(execute('help')), /\bsu\b/);
});

test('as root: whoami, the prompt name in neofetch, exit drops root, rm -rf breaks the page', () => {
  assert.equal(texts(execute('whoami', { root: true })), 'root');
  assert.equal(texts(execute('whoami', { root: 'yes' })), 'visitor', 'only the literal true counts');
  assert.match(texts(execute('neofetch', { root: true })), /root@portfolio/);
  assert.deepEqual({ ...execute('exit', { root: true }).action }, { type: 'unroot' });
  for (const raw of ['rm -rf /', 'rm -rf', 'rm -fr /*', 'rm -rf --no-preserve-root /', 'rm -rf ~']) {
    const result = execute(raw, { root: true });
    assert.deepEqual({ ...result.action }, { type: 'rmrf' }, raw);
    assert.match(result.echo, /^rm -rf/, raw);
  }
  assert.equal(execute('rm -rf /').action, null, 'not without root');
});

test('free sudo and rm arguments are never echoed, kept or passed on', () => {
  const secret = 'hunter2' + 'pw';
  for (const raw of [`sudo ${secret}`, `sudo rm -rf /home/${secret}`, `sudo cat ${secret}`, `su ${secret}`, `su -c ${secret}`, `su - ${secret}`, `rm -rf ${secret}`, `rm ${secret}`]) {
    for (const root of [false, true]) {
      const result = execute(raw, { root });
      assert.ok(!texts(result).includes(secret), raw);
      assert.ok(!result.echo.includes(secret), `${raw}: echo never keeps free arguments`);
      assert.ok(!JSON.stringify(result.action).includes(secret), `${raw}: action never carries them`);
    }
  }
});

test('puzzle answers are checked by digest, fail closed, and bound their input', async () => {
  const { matchesPuzzle } = await import('../site/assets/js/features/puzzles.js');
  const { PUZZLES } = await import('../site/assets/js/data/puzzles.js');
  const { createHash } = await import('node:crypto');
  assert.match(PUZZLES.root.sha256, /^[0-9a-f]{64}$/);
  // A stand-in answer, so the real one never appears in this public repository.
  const answer = 'Test-Answer!42';
  const digest = createHash('sha256').update(answer).digest('hex');
  assert.equal(await matchesPuzzle(answer, digest), true);
  assert.equal(await matchesPuzzle(`  ${answer}  `, digest), true, 'outer spaces are trimmed');
  assert.equal(await matchesPuzzle(answer.toLowerCase(), digest), false, 'case matters');
  assert.equal(await matchesPuzzle('wrong', digest), false);
  assert.equal(await matchesPuzzle(answer, 'not-a-digest'), false);
  assert.equal(await matchesPuzzle('x'.repeat(10000), digest), false);
  assert.equal(await matchesPuzzle(`${answer}\u0000`, digest), false);
  assert.equal(await matchesPuzzle(42, digest), false);
});
