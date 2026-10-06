// Abuse tests for the terminal command engine (doctrine sections 7 and 14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute, complete } from '../site/assets/js/features/command-engine.js';
import { COMMANDS, MODULES } from '../site/assets/js/data/commands.js';
import { LIMITS } from '../site/assets/js/core/constants.js';

const texts = (result) => result.lines.map((l) => l.text).join('\n');

test('every command in the metadata has a handler and runs', () => {
  for (const command of COMMANDS) {
    // The fork bomb is only reachable through its own syntax (its usage string).
    const raw = command.name === 'forkbomb' ? command.usage
      : command.args.min > 0 ? `${command.name} ${MODULES[0].id}` : command.name;
    const result = execute(raw);
    assert.equal(result.recognized, true, command.name);
    assert.equal(result.valid, true, command.name);
  }
});

test('help lists exactly the allowlisted commands', () => {
  const text = texts(execute('help'));
  for (const command of COMMANDS) assert.equal(text.includes(command.usage), !command.hidden, command.name);
});

test('inherited and unknown names never dispatch', () => {
  for (const raw of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'eval', 'rm', 'sudo', 'ls2', 'nmap']) {
    const result = execute(raw);
    assert.equal(result.recognized, false, raw);
    assert.equal(result.action, null, raw);
    assert.equal(result.echo, null, raw);
  }
});

test('errors never repeat what the visitor typed', () => {
  const typed = 'hunter2' + 'typed';
  for (const raw of [typed, `open ${typed}`, `ls ${typed}`, `${typed} ${typed}`]) {
    const result = execute(raw);
    assert.equal(result.valid, false, raw);
    assert.ok(!texts(result).includes(typed), raw);
    assert.equal(result.echo, null, raw);
  }
});

test('arguments are checked against the schema', () => {
  assert.equal(execute('open').valid, false);
  assert.equal(execute('open identity links').valid, false);
  assert.equal(execute('open IDENTITY').valid, false); // ids are exact
  assert.equal(execute('open ../links').valid, false);
  assert.equal(execute('open constructor').valid, false);
  assert.equal(execute('help me').valid, false);
});

test('open returns fixed pages and anchors, never something typed', () => {
  const links = execute('open links');
  assert.deepEqual({ ...links.action }, { type: 'goto', page: 'home', anchor: 'module-links' });
  assert.equal(links.echo, 'open links');
  assert.deepEqual({ ...execute('open projects').action }, { type: 'goto', page: 'projects', anchor: null });
  assert.deepEqual({ ...execute('open debloat').action }, { type: 'goto', page: 'debloat', anchor: null });
  assert.deepEqual({ ...execute('open home').action }, { type: 'goto', page: 'home', anchor: null });
});

test('ls depends on the page, and unknown pages fall back to home', () => {
  assert.match(texts(execute('ls', { page: 'home' })), /certifications/);
  assert.match(texts(execute('ls', { page: 'projects' })), /debloat/);
  assert.match(texts(execute('ls', { page: 'constructor' })), /certifications/);
  assert.match(texts(execute('ls', { page: '../../etc' })), /certifications/);
  assert.match(texts(execute('ls', null)), /certifications/);
});

test('command names are case-insensitive; echo is the normalized form', () => {
  const result = execute('  HELP  ');
  assert.equal(result.valid, true);
  assert.equal(result.echo, 'help');
});

test('hostile input is rejected or rendered as inert text', () => {
  for (const raw of ['<img src=x onerror=alert(1)>', 'help\nreboot', 'сlear', 'x'.repeat(LIMITS.commandRaw + 1), "'; DROP TABLE x; --"]) {
    const result = execute(raw);
    assert.equal(result.valid, false, raw);
    assert.equal(result.action, null, raw);
  }
});

test('output lines are bounded', () => {
  for (const command of COMMANDS) {
    for (const entry of execute(command.args.min > 0 ? `${command.name} ${MODULES[0].id}` : command.name).lines) {
      assert.ok(entry.text.length <= LIMITS.terminalLineLength);
    }
  }
});

test('tab completion only completes known names', () => {
  assert.equal(complete('he'), 'help ');
  assert.equal(complete('op'), 'open ');
  assert.equal(complete('open li'), 'open links');
  assert.equal(complete('o'), 'open ');
  assert.equal(complete('zz'), null);
  assert.equal(complete('cl'), 'clear ');
  assert.equal(complete('<sc'), null);
});

test('spawn opens a shell; exit closes only spawned shells', () => {
  assert.deepEqual({ ...execute('spawn').action }, { type: 'spawn' });
  assert.equal(execute('exit', { shell: 'tty1' }).action, null);
  assert.match(texts(execute('exit', { shell: 'tty1' })), /login shell/);
  assert.deepEqual({ ...execute('exit', { shell: 'tty2' }).action }, { type: 'exit' });
  assert.equal(execute('exit', { shell: 'constructor' }).action, null); // unknown shell falls back to tty1
  assert.equal(execute('spawn now').valid, false);
});

test('hello world easter egg: hidden, case-insensitive, opens a shell', async () => {
  const result = execute('hello world');
  assert.equal(result.valid, true);
  assert.deepEqual({ ...result.action }, { type: 'hello' });
  assert.equal(execute('Hello World').valid, true);
  assert.match(texts(execute('hello')), /try 'hello world'/);
  assert.equal(execute('hello').action, null);
  assert.equal(execute('hello there').valid, false);
  assert.doesNotMatch(texts(execute('help')), /hello/);
  assert.equal(complete('hel'), 'help ');
  const { finalLines } = await import('../site/assets/js/ui/hello-animation.js');
  const { appendLines } = await import('../site/assets/js/core/state.js');
  const lines = finalLines();
  assert.ok(lines.some((l) => /Hello, World!/.test(l.text)));
  assert.equal(appendLines([], lines).length, lines.length, 'every final line is storable');
});

test('? is an alias for help and is kept as typed', () => {
  const q = execute('?');
  assert.equal(q.valid, true);
  assert.equal(q.echo, '?');
  assert.equal(texts(q), texts(execute('help')));
  assert.equal(execute(' ? ').echo, '?');
  assert.equal(execute('??').valid, false);
  assert.equal(execute('? me').valid, false);
});

test('cd resolves paths like a real shell, within the fixed tree only', async () => {
  const { resolvePath } = await import('../site/assets/js/features/command-engine.js');
  const cases = [
    ['~', undefined, '~'], ['~/projects', '', '~'], ['~/projects', '~', '~'], ['~/projects', '/', '~'],
    ['~', 'projects', '~/projects'], ['~', 'projects/', '~/projects'], ['~', './projects', '~/projects'],
    ['~', 'projects/debloat', '~/projects/debloat'], ['~/projects', 'debloat', '~/projects/debloat'],
    ['~/projects/debloat', '..', '~/projects'], ['~/projects/debloat', '../..', '~'], ['~/projects/debloat', '../../writeups', '~/writeups'],
    ['~/writeups', '~/projects/debloat', '~/projects/debloat'], ['~', '/home/visitor/projects', '~/projects'], ['~', '..', '~'],
    ['~/projects', '.', '~/projects'],
  ];
  for (const [cwd, arg, expected] of cases) assert.equal(resolvePath(cwd, arg), expected, `${cwd} + ${arg}`);
  for (const bad of ['nope', '~/etc', '/etc/passwd', 'projects/nope', 'Projects', '~root', 'a b', '<script>', '..%2f']) {
    assert.equal(resolvePath('~', bad), null, bad);
  }
});

test('cd, pwd and cd - behave like the real thing', () => {
  assert.deepEqual({ ...execute('cd projects').action }, { type: 'goto', page: 'projects', anchor: null });
  assert.equal(execute('cd projects').lines.length, 0); // silent on success
  assert.deepEqual({ ...execute('cd ..', { page: 'debloat' }).action }, { type: 'goto', page: 'projects', anchor: null });
  assert.deepEqual({ ...execute('cd', { page: 'writeups' }).action }, { type: 'goto', page: 'home', anchor: null });
  assert.equal(execute('cd ~', { page: 'home' }).action, null); // already there
  assert.equal(texts(execute('pwd', { page: 'debloat' })), '/home/visitor/projects/debloat');
  const back = execute('cd -', { page: 'projects', oldpwd: '~/writeups' });
  assert.deepEqual({ ...back.action }, { type: 'goto', page: 'writeups', anchor: null });
  assert.equal(texts(back), '/home/visitor/writeups');
  const noOld = execute('cd -', { page: 'home' });
  assert.equal(noOld.valid, false);
  assert.match(texts(noOld), /OLDPWD not set/);
});

test('cd errors never repeat the path and are not stored', () => {
  const typed = 'hunter2' + 'path';
  const result = execute(`cd ${typed}`);
  assert.equal(result.valid, false);
  assert.equal(result.echo, null);
  assert.ok(!texts(result).includes(typed));
});

test('Tab completes directories after cd', () => {
  assert.equal(complete('cd pro', { page: 'home' }), 'cd projects/');
  assert.equal(complete('cd projects/de', { page: 'home' }), 'cd projects/debloat/');
  assert.equal(complete('cd ../wr', { page: 'projects' }), 'cd ../writeups/');
  assert.equal(complete('cd zz', { page: 'home' }), null);
});

test('every project page is reachable by cd and open, and lists its modules', async () => {
  const { PROJECTS, PAGES } = await import('../site/assets/js/data/commands.js');
  const hub = texts(execute('ls', { page: 'projects' }));
  for (const project of PROJECTS) {
    const name = PAGES[project.page].cwd.split('/').pop();
    assert.ok(hub.split(/\s+/).includes(project.id), `ls lists ${project.id}`);
    assert.deepEqual({ ...execute(`cd ${name}`, { page: 'projects' }).action }, { type: 'goto', page: project.page, anchor: null });
    assert.deepEqual({ ...execute(`open ${project.id}`).action }, { type: 'goto', page: project.page, anchor: null });
    assert.match(texts(execute('ls', { page: project.page })), /overview {2}notes {2}screenshots/);
    assert.deepEqual({ ...execute('cd ..', { page: project.page }).action }, { type: 'goto', page: 'projects', anchor: null });
  }
});

test('31337 is a hidden easter egg that toggles the matrix rain', () => {
  for (const raw of ['31337', ' 31337 ']) {
    const result = execute(raw);
    assert.equal(result.valid, true, raw);
    assert.deepEqual({ ...result.action }, { type: 'matrix' });
    assert.equal(result.echo, '31337');
  }
  assert.doesNotMatch(texts(execute('help')), /31337|leet|matrix/);
  for (const near of ['3133', '313377', '31337 x', '1337']) assert.equal(execute(near).action, null, near);
});

test('the fork bomb is a hidden easter egg matched exactly', () => {
  for (const raw of [':(){ :|:& };:', ':(){:|:&};:', '  :() { :|: & }; :  ']) {
    const result = execute(raw);
    assert.equal(result.valid, true, raw);
    assert.deepEqual({ ...result.action }, { type: 'forkbomb' });
    assert.equal(result.echo, ':(){ :|:& };:');
  }
  assert.doesNotMatch(texts(execute('help')), /forkbomb|:\(\)/);
  for (const near of [':(){ :|: };:', ':(){ :|:& }', 'forkbomb', ':(){ :|:& };: ; ls']) assert.equal(execute(near).action, null, near);
});

test('eggs is a hidden command that lists every other easter egg', () => {
  const result = execute('eggs');
  assert.equal(result.valid, true);
  assert.equal(result.action, null);
  const text = texts(result);
  for (const command of COMMANDS.filter((c) => c.hidden && c.name !== 'eggs')) assert.ok(text.includes(command.usage), command.name);
  for (const command of COMMANDS.filter((c) => !c.hidden)) assert.ok(!text.includes(`  ${command.usage} `), command.name);
  assert.doesNotMatch(texts(execute('help')), /eggs/);
  assert.equal(complete('eg'), null);
  assert.equal(execute('eggs now').valid, false);
});
