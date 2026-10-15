// Tests for the console's read-only commands and easter eggs added in the Layer 1 shell
// extras: cat, man, neofetch, uptime, history, git log, hunt, theme, sudo and rm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execute, complete } from '../site/assets/js/features/command-engine.js';
import { COMMANDS, EGGS, PROJECTS, PAGES, THEME_IDS } from '../site/assets/js/data/commands.js';
import { FILES, MANUAL, CERT_ROWS, PROJECT_READMES } from '../site/assets/js/data/shell-text.js';
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

test('neofetch shows the logo image and reports the context it is given', () => {
  const lines = execute('neofetch').lines;
  assert.deepEqual({ ...lines[0] }, { kind: 'logo', text: '' }, 'the logo is a line kind, not text');
  assert.ok(lines.slice(1, -1).every((l) => l.kind === 'fetch'));
  assert.deepEqual({ ...lines[lines.length - 1] }, { kind: 'swatch', text: '' }, 'the colour blocks close it, as a line kind');
  const text = texts(execute('neofetch', { theme: 'amber', background: 'bubbles', uptime: 125, shell: 'tty2' }));
  assert.match(text, /Theme: amber/);
  assert.match(text, /Background: bubbles/);
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

test('sudo behaves as on Linux: usage, one command as root, or a root shell', () => {
  // Bare sudo prints its usage and asks for nothing.
  const bare = execute('sudo');
  assert.equal(bare.action, null);
  assert.match(texts(bare), /^usage: sudo/);
  // sudo <command>: one command as root.
  assert.deepEqual({ ...execute('sudo rm -rf /').action }, { type: 'sudo', via: 'sudo', inner: 'rm -rf /' });
  assert.deepEqual({ ...execute('sudo whoami').action }, { type: 'sudo', via: 'sudo', inner: 'whoami' });
  // sudo su, -i, -s: a root shell.
  for (const raw of ['sudo su', 'sudo -i', 'sudo -s', 'sudo bash', 'sudo su -']) {
    assert.deepEqual({ ...execute(raw).action }, { type: 'sudo', via: 'sudo', inner: null }, raw);
  }
  for (const raw of ['sudo nmap', 'sudo sudo ls', 'sudo su root now']) assert.equal(execute(raw).action.inner, 'unknown', raw);
  for (const raw of ['sudo -k', 'sudo -K']) assert.deepEqual({ ...execute(raw).action }, { type: 'sudo-forget' }, raw);
  assert.doesNotMatch(texts(execute('help')), /sudo|rm </);
  assert.equal(complete('su'), null);
});

test('su behaves as on Linux: a root shell, or one command with -c', () => {
  for (const raw of ['su', 'su -', 'su -l', 'su root', 'su - root', 'su --login root']) {
    assert.deepEqual({ ...execute(raw).action }, { type: 'sudo', via: 'su', inner: null }, raw);
  }
  for (const raw of ['su -c whoami', 'su root -c whoami', 'su - root -c whoami']) {
    const result = execute(raw);
    assert.deepEqual({ ...result.action }, { type: 'sudo', via: 'su', inner: 'whoami' }, raw);
    assert.equal(result.echo, raw);
  }
  assert.equal(execute('su -c nmap').action.inner, 'unknown');
  // The first word after the options is a user name, as on Linux; only root exists.
  for (const raw of ['su ls', 'su bob', 'su visitor']) {
    const result = execute(raw);
    assert.equal(result.action, null, raw);
    assert.match(texts(result), /su: user does not exist/, raw);
  }
  assert.match(texts(execute('su -c')), /requires an argument/);
  assert.equal(execute('su root extra').action, null);
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
  assert.equal(PUZZLES.root.sha256.length, 2, 'two accepted answers');
  for (const digest of PUZZLES.root.sha256) assert.match(digest, /^[0-9a-f]{64}$/);
  const other = createHash('sha256').update('Other-Answer<3').digest('hex');
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
  // A list: any one of the answers matches.
  assert.equal(await matchesPuzzle(answer, [other, digest]), true);
  assert.equal(await matchesPuzzle('Other-Answer<3', [other, digest]), true);
  assert.equal(await matchesPuzzle('neither', [other, digest]), false);
  assert.equal(await matchesPuzzle(answer, []), false);
  assert.equal(await matchesPuzzle(answer, ['bad', 7]), false);
});

// ---------- ps, kill and btop ----------
const PROCS = [
  { pid: 1, user: 'root', name: 'init', cmd: '/sbin/init', tty: '?', cpu: 0, mem: 0.4 },
  { pid: 300, user: 'root', name: 'hypervisord', cmd: '/usr/sbin/hypervisord', tty: '?', cpu: 0.8, mem: 3.1 },
  { pid: 1201, user: 'visitor', name: 'bash', cmd: '-bash', tty: 'tty1', cpu: 0.1, mem: 0.6 },
  { pid: 1202, user: 'visitor', name: 'bash', cmd: '-bash', tty: 'tty2', cpu: 0.1, mem: 0.6 },
  { pid: 2101, user: 'visitor', name: 'hexfloat', cmd: 'bgd --scene hex_float', tty: '?', cpu: 5, mem: 1.6 },
];

test('ps shows this shell, or every process with aux, -e and -ef', () => {
  const mine = texts(execute('ps', { processes: PROCS, nextPid: 4100, shell: 'tty2' }));
  assert.match(mine, /1202 tty2 .* bash/);
  assert.match(mine, /4100 tty2 .* ps/);
  assert.doesNotMatch(mine, /1201|init/);
  // Everything on this terminal, btop included, and nothing from elsewhere.
  const withBtop = texts(execute('ps', { processes: [...PROCS, { pid: 4300, user: 'visitor', name: 'btop', cmd: 'btop', tty: 'tty2', cpu: 1, mem: 0.8 }], nextPid: 4301, shell: 'tty2' }));
  assert.match(withBtop, /4300 tty2 .* btop/);
  assert.doesNotMatch(withBtop, /hexfloat/);
  const aux = texts(execute('ps aux', { processes: PROCS }));
  for (const proc of PROCS) assert.ok(aux.includes(proc.cmd), proc.name);
  assert.match(texts(execute('ps -ef', { processes: PROCS })), /^UID/);
  assert.match(texts(execute('ps -e', { processes: PROCS })), /hypervisord/);
  const secret = 'hunter2' + 'ps';
  const bad = execute(`ps ${secret}`, { processes: PROCS });
  assert.ok(!texts(bad).includes(secret) && !bad.echo.includes(secret));
});

test('ps drops malformed or hostile process entries', () => {
  const hostile = [
    ...PROCS,
    { pid: 'x', user: 'root', name: 'a', cmd: 'a', tty: '?' },
    { pid: 5, user: 'admin', name: 'a', cmd: 'a', tty: '?' },
    { pid: 6, user: 'root', name: '<img src=x>', cmd: 'a', tty: '?' },
    { pid: 7, user: 'root', name: 'ok', cmd: 'a\u0000b', tty: '?' },
    { pid: 1, user: 'root', name: 'dupe', cmd: 'dupe', tty: '?' },
    Object.create({ pid: 8, user: 'root', name: 'proto', cmd: 'p', tty: '?' }),
  ];
  const aux = texts(execute('ps aux', { processes: hostile }));
  assert.doesNotMatch(aux, /admin|<img|dupe|proto/);
  assert.equal(aux.split('\n').length, PROCS.length + 2, 'header, the table and ps itself');
  assert.equal(execute('ps aux', { processes: Array(65).fill(PROCS[0]) }).lines.length, 2, 'oversized tables are dropped');
});

test('kill sends TERM by default and KILL with -9; only root may signal root', () => {
  assert.deepEqual({ ...execute('kill 2101', { processes: PROCS }).action }, { type: 'kill', signal: 'TERM', pids: [2101] });
  for (const raw of ['kill -9 2101', 'kill -KILL 2101', 'kill -SIGKILL 2101', 'kill -s KILL 2101']) {
    assert.deepEqual({ ...execute(raw, { processes: PROCS }).action }, { type: 'kill', signal: 'KILL', pids: [2101] }, raw);
  }
  const denied = execute('kill 1', { processes: PROCS });
  assert.equal(denied.action, null);
  assert.match(texts(denied), /\(1\) - Operation not permitted/);
  assert.deepEqual({ ...execute('kill -9 1', { processes: PROCS, root: true }).action }, { type: 'kill', signal: 'KILL', pids: [1] });
  assert.match(texts(execute('kill 4242', { processes: PROCS })), /No such process/);
  assert.match(texts(execute('kill')), /^kill: usage/);
  assert.match(texts(execute('kill -l')), /SIGKILL/);
  assert.match(texts(execute('kill -HUP 2101', { processes: PROCS })), /invalid signal/);
  const secret = 'hunter2' + 'kill';
  for (const raw of [`kill ${secret}`, `kill -${secret} 2101`, `kill -s ${secret} 2101`]) {
    const result = execute(raw, { processes: PROCS });
    assert.equal(result.action, null, raw);
    assert.ok(!texts(result).includes(secret) && !result.echo.includes(secret), raw);
  }
});

test('btop, top and htop open the monitor; its graphs keep their size', async () => {
  for (const raw of ['btop', 'top', 'htop']) assert.deepEqual({ ...execute(raw).action }, { type: 'btop' }, raw);
  assert.match(texts(execute('help')), /btop/);
  const { brailleGraph, asciiGraph } = await import('../site/assets/js/ui/btop.js');
  for (const graph of [brailleGraph, asciiGraph]) {
    const rows = graph([0, 0.25, 0.5, 1, 2, -1, NaN], 12, 4);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((row) => row.length === 12));
  }
  assert.equal(brailleGraph([], 3, 2).join(''), String.fromCharCode(0x2800).repeat(6), 'empty is blank');
});

test('every command answers --help (and ?, /?; -h only where Linux has it)', () => {
  for (const command of COMMANDS) {
    if (command.name === 'forkbomb' || command.name === 'leet') continue;
    for (const flag of ['--help', '?', '/?']) {
      const result = execute(`${command.name} ${flag}`);
      assert.equal(result.valid, true, `${command.name} ${flag}`);
      assert.equal(result.action, null, `${command.name} ${flag} runs nothing`);
      assert.equal(texts(result).split('\n')[0], `Usage: ${command.usage}`, command.name);
      assert.equal(result.echo, `${command.name} ${flag}`);
    }
  }
  assert.equal(execute('sudo -h').valid, true);
  assert.equal(execute('ls -h').valid, false, 'ls -h is not help on Linux');
  assert.equal(execute('ls --help now').valid, false, 'help with more arguments is not help');
});

const { VM_ENCRYPTION } = await import('../site/assets/js/data/commands.js');
const encryptionOff = VM_ENCRYPTION ? false : 'VM encryption is switched off for testing (data/commands.js)';

test('with encryption off, every VM powers on without a key', { skip: VM_ENCRYPTION }, () => {
  for (const id of ['parrot01', 'ubuntu-red', 'ubuntu-blue']) {
    assert.deepEqual({ ...execute(`vm start ${id}`).action }, { type: 'vm-start', guest: id }, id);
  }
  assert.doesNotMatch(texts(execute('vm list')), /encrypted/);
  assert.equal(execute('vm unlock --all').action, null, 'nothing to unlock');
});

test('vm lists named VMs built from images; ws01 autostarts and the rest are encrypted', { skip: encryptionOff }, async () => {
  const { VMS, VM_IDS, IMAGES } = await import('../site/assets/js/data/commands.js');
  const { OS_IDS, UNLOCK_IDS } = await import('../site/assets/js/core/constants.js');
  assert.deepEqual(IMAGES.map((image) => image.id), [...OS_IDS], 'images match the OS ids');
  assert.deepEqual([...VM_IDS], ['ws01', 'parrot01', 'ubuntu-blue', 'ubuntu-red', 'dc01', 'web01', 'router01', 'cam01']);
  for (const vm of VMS) {
    assert.ok(OS_IDS.includes(vm.image), `${vm.id} is built from a known image`);
    assert.match(vm.ip, /^198\.51\.100\.\d{1,3}$/, `${vm.id} uses the reviewed lab range`);
    assert.match(vm.host, /\.(lab|corp)\.example$/);
    // Every encrypted VM has its own key flag; ws01 never is encrypted.
    assert.equal(UNLOCK_IDS.includes(`vm-${vm.id}`), Boolean(vm.unlock), vm.id);
  }
  assert.equal(VMS.filter((vm) => vm.image === 'ubuntu').length, 2, 'two VMs from one image');
  assert.deepEqual(VMS.filter((vm) => vm.autostart).map((vm) => vm.id), ['ws01']);
  // Bare vm goes to the lab page from anywhere else; on the lab it lists the VMs.
  assert.deepEqual({ ...execute('vm', { page: 'home' }).action }, { type: 'goto', page: 'lab', anchor: null });
  assert.match(texts(execute('ls', { page: 'lab' })), /virtual machines:/);
  assert.match(texts(execute('ls', { page: 'lab' })), /ubuntu-red .*\(encrypted\)/);
  const list = texts(execute('vm', { page: 'lab' }));
  assert.match(list, /ws01 .*winbows .*workstation .*198\.51\.100\.20 .*powered off/);
  assert.match(list, /parrot01 .*encrypted/);
  assert.match(list, /ubuntu-blue .*ubuntu .*defender .*encrypted/);
  assert.match(texts(execute('vm list', { vm: 'ws01' })), /ws01 .* running/);
  assert.match(texts(execute('vm list', { vm: 'ws01' })), /1 running/);
  assert.deepEqual({ ...execute('vm start ws01').action }, { type: 'vm-start', guest: 'ws01' });
  for (const id of ['parrot01', 'ubuntu-red', 'ubuntu-blue']) {
    const result = execute(`vm start ${id}`);
    assert.equal(result.action, null, id);
    assert.match(texts(result), /encrypted. It needs its key/, id);
  }
  // Images are not VMs.
  assert.equal(execute('vm start winbows').action, null);
  assert.equal(execute('vm start ws01', { vm: 'ws01' }).action, null, 'already running');
  assert.deepEqual({ ...execute('vm stop', { vm: 'ws01' }).action }, { type: 'vm-stop', guest: 'ws01' });
  assert.equal(execute('vm stop').action, null, 'nothing to stop');
  assert.match(texts(execute('vm list', { vm: '__proto__' })), /0 running/, 'unknown running VM is ignored');
  const secret = 'hunter2' + 'vm';
  for (const raw of [`vm start ${secret}`, `vm ${secret}`, `vm list ${secret}`, `vm stop ${secret}`]) {
    const result = execute(raw);
    assert.equal(result.action, null, raw);
    assert.ok(!texts(result).includes(secret) && !result.echo.includes(secret), raw);
  }
  // help lists vm briefly (vm [command] [vm]); vm --help gives the full usage.
  assert.match(texts(execute('vm --help')), /vm \[list\|start <vm>\|stop \[vm\]\|unlock/);
});

test('vm runs several VMs side by side, one in front, stoppable from any page', { skip: encryptionOff }, () => {
  const open = ['parrot01', 'ubuntu-blue', 'ubuntu-red'];
  const lab = { page: 'lab', vm: 'parrot01', vms: ['ws01', 'parrot01'], unlocked: open };
  const list = texts(execute('vm list', lab));
  assert.match(list, /2 running/);
  assert.match(list, /ws01 .* running/, 'VMs behind the front one keep running');
  assert.match(list, /parrot01 .* running/);
  assert.match(list, /ubuntu-red .* powered off/);
  // Starting a running VM brings it forward; starting the front one does nothing.
  assert.match(texts(execute('vm start ws01', lab)), /resuming ws01/);
  assert.deepEqual({ ...execute('vm start ws01', lab).action }, { type: 'vm-start', guest: 'ws01' });
  assert.match(texts(execute('vm start ubuntu-red', lab)), /powering on ubuntu-red \(Ubuntu 24\.04/);
  assert.equal(execute('vm start parrot01', lab).action, null);
  // Away from the lab nothing is in front: bare stop asks for a name, named stop works.
  const away = { page: 'home', vms: ['ws01', 'parrot01'], unlocked: open };
  assert.equal(execute('vm stop', away).action, null);
  assert.match(texts(execute('vm stop', away)), /vm stop <vm>/);
  assert.deepEqual({ ...execute('vm stop parrot01', away).action }, { type: 'vm-stop', guest: 'parrot01' });
  assert.equal(execute('vm stop ubuntu-red', away).action, null, 'not running');
  assert.match(texts(execute('vm list', away)), /ws01 .* suspended/, 'away from the lab they are suspended');
  // A running VM cannot be locked under itself.
  assert.equal(execute('vm lock --all', away).action, null);
  assert.match(texts(execute('vm lock --all', away)), /vm stop parrot01/);
  // Hostile running lists are reduced to known VMs.
  assert.match(texts(execute('vm list', { vms: ['__proto__', 'ws01', 'ws01', 'x'] })), /1 running/);
  assert.match(texts(execute('vm list', { vms: 'ws01' })), /0 running/);
});

test('vm unlock asks for the passphrase; root uses its key file; each VM has its own key', { skip: encryptionOff }, async () => {
  const { PUZZLES } = await import('../site/assets/js/data/puzzles.js');
  assert.equal(PUZZLES.vmImages.sha256.length, 1);
  assert.match(PUZZLES.vmImages.sha256[0], /^[0-9a-f]{64}$/);
  assert.ok(!PUZZLES.root.sha256.includes(PUZZLES.vmImages.sha256[0]), 'the cheat code is not a root password');
  // Visitor: the UI is asked to prompt for the passphrase; nothing is printed yet.
  const all = execute('vm unlock --all');
  assert.deepEqual({ ...all.action, guests: [...all.action.guests] }, { type: 'vm-unlock', guests: ['parrot01', 'ubuntu-blue', 'ubuntu-red', 'dc01', 'web01', 'router01', 'cam01'], keyFile: false });
  assert.equal(all.lines.length, 0);
  assert.equal(all.echo, 'vm unlock --all');
  // One VM's key leaves the other Ubuntu encrypted.
  assert.deepEqual([...execute('vm unlock ubuntu-blue').action.guests], ['ubuntu-blue']);
  assert.match(texts(execute('vm list', { unlocked: ['ubuntu-blue'] })), /ubuntu-red .* encrypted/);
  assert.match(texts(execute('vm list', { unlocked: ['ubuntu-blue'] })), /ubuntu-blue .* powered off/);
  // Root (a root shell, or sudo running it) needs no passphrase.
  const rooted = execute('vm unlock --all', { root: true });
  assert.equal(rooted.action.keyFile, true);
  assert.match(texts(rooted), /key file/);
  // Already open: nothing to do. ws01 is never encrypted.
  assert.equal(execute('vm unlock --all', { unlocked: ['parrot01', 'ubuntu-blue', 'ubuntu-red', 'dc01', 'web01', 'router01', 'cam01'] }).action, null);
  assert.match(texts(execute('vm unlock ws01')), /not encrypted/);
  assert.deepEqual([...execute('vm unlock --all', { unlocked: ['parrot01'] }).action.guests], ['ubuntu-blue', 'ubuntu-red', 'dc01', 'web01', 'router01', 'cam01']);
  assert.deepEqual({ ...execute('vm start parrot01', { unlocked: ['parrot01'] }).action }, { type: 'vm-start', guest: 'parrot01' });
  // Unknown or hostile unlock lists are ignored.
  assert.equal(execute('vm start parrot01', { unlocked: 'parrot01' }).action, null);
  assert.equal(execute('vm start parrot01', { unlocked: ['__proto__', 'PARROT01'] }).action, null);
  // vm lock: puts encryption back, but never under a running VM.
  const lock = execute('vm lock --all', { unlocked: ['parrot01', 'ubuntu-red'] });
  assert.deepEqual([...lock.action.guests], ['parrot01', 'ubuntu-red']);
  assert.equal(execute('vm lock --all', { unlocked: ['parrot01'], vm: 'parrot01' }).action, null);
  assert.equal(execute('vm lock --all').action, null, 'nothing to lock');
  assert.match(texts(execute('vm lock ws01')), /never encrypted/);
  // Through sudo the command is re-run by its echo, which is exact.
  assert.deepEqual({ ...execute('sudo vm unlock --all').action }, { type: 'sudo', inner: 'vm unlock --all', via: 'sudo' });
  // Free arguments are never echoed.
  const secret = 'hunter2' + 'img';
  for (const raw of [`vm unlock ${secret}`, `vm lock ${secret}`]) {
    const result = execute(raw);
    assert.equal(result.action, null, raw);
    assert.ok(!texts(result).includes(secret) && !result.echo.includes(secret), raw);
  }
});

test('the layer loader maps only known layers to literal paths', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../site/assets/js/core/layer-loader.js', import.meta.url), 'utf8');
  assert.match(source, /workstation: \(\) => import\('\.\.\/layers\/layer2\.js'\)/);
  assert.doesNotMatch(source, /import\(\s*[^'"\s]/, 'every dynamic import is a literal');
  // In Node the loader module itself can be imported; unknown ids are refused before any load.
  globalThis.document = globalThis.document || { querySelectorAll: () => [], head: { appendChild() {} } };
  const { loadLayer } = await import('../site/assets/js/core/layer-loader.js');
  for (const id of ['hidden', 'portfolio', '__proto__', 'constructor', '../layers/layer2', '', 42]) {
    await assert.rejects(loadLayer(id), /unknown layer/, String(id));
  }
});
