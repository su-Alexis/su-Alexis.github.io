// Layer 2 guest engine (Skeleton 1.10): boots a VM from its image profile and runs its
// shell. Pure: no DOM, no storage, so Node tests cover it and Layer 3 can reuse it.
// Used by layers/layer2.js, which owns the VM windows and the session record.
//
// A VM is an image (data/images/) plus its own name, user, host and address
// (data/commands.js VMS). bootGuest() builds its authored file tree with those filled in;
// runGuest() runs one typed line against it. Doctrine section 7 applies as in Layer 1:
// a fixed command set per image shell, arguments only compared with known paths and fixed
// words, errors never repeat what was typed, and nothing real is touched. Network-shaped
// commands only report the VM's own lab address until the lab network segment.
//
// Shells: 'powershell' (Winbows), 'bash' (Linux), 'ash' (BusyBox on the router, as root)
// and 'login' (the camera's guarded login prompt: every attempt fails, nothing typed is
// shown or kept).
//
// Output lines are { kind: 'out' | 'err' | 'ok', text } and are rendered as text only.

import { parseCommand } from '../utils/validate.js';
import { VM_FILES } from '../core/constants.js';
// The lab network's commands (owner-written, October 11, 2026): each takes (guest, args)
// and answers only from the lab map (data/lab-network.js).
import { ping, nmap, curl, ssh, nslookup } from './fake-network.js';
import { ipconfig, ifconfig, ipCommand } from './netconfig.js';
// Shared scenario state: the evidence a command leaves, the lines it adds to a scenario
// machine's logs, and its fixture files (features/scenario.js). guest.scenario(), set by
// layers/layer2.js, returns the scenario list (evidence in order, fixture states).
import { evidenceFrom, evidenceLines, fixtureText, fixturePaths, stateOf, forwardedFiles, forwardedFile, fixtureAt, stateForText, backupFiles, blocked, firewallRules } from './scenario.js';
import { VMS } from '../data/commands.js';
// Files missions put on their seats (a mission's content.files).
import { seatFiles, missionCommands } from './mission-engine.js';

// The network commands' pacing (owner request, October 11, 2026): their lines arrive over
// time, like the real tools, through the console's streaming (each line's ms). Applied
// here, around the module, so features/fake-network.js stays plain data-in, lines-out.
// Blank lines become a space so the console keeps their height.
const PACE = Object.freeze({
  // A reply a second; the rest of the output quickly.
  ping: (line, i) => (/bytes from|Reply from|timed out/.test(line.text) ? (i < 3 ? 350 : 1000) : /100% (packet )?loss/.test(line.text) ? 3000 : i === 0 ? 80 : 60),
  // A short start, the scan itself, then the report.
  nmap: (line, i) => (i === 0 ? 80 : i === 1 ? 1600 : 45),
  // The connection, then the page.
  // A dropped connection (a firewall's deny) waits before it gives up.
  curl: (line, i) => (/timed out/.test(line.text) ? 2500 : i === 0 ? 300 : 15),
  // Each step of the handshake, then the refusal.
  ssh: (line, i, last) => (/timed out/.test(line.text) ? 2500 : i === last ? 900 : 450),
});
function paced(name, result) {
  if (!result || !Array.isArray(result.lines)) return result;
  const last = result.lines.length - 1;
  return {
    ...result,
    lines: result.lines.map((line, i) => ({ ...line, text: line.text === '' ? ' ' : line.text, ms: PACE[name](line, i, last) })),
  };
}
import { WINBOWS } from '../data/images/winbows.js';
import { PARROT } from '../data/images/parrot.js';
import { UBUNTU } from '../data/images/ubuntu.js';
import { WINSERVER } from '../data/images/winserver.js';
import { UBUNTU_SERVER } from '../data/images/ubuntuserver.js';
import { OPENWRT } from '../data/images/openwrt.js';
import { IPCAM } from '../data/images/ipcam.js';

// Fixed image mapping; never built from input or storage (doctrine section 6).
const IMAGES = Object.freeze({
  winbows: WINBOWS, parrot: PARROT, ubuntu: UBUNTU,
  winserver: WINSERVER, ubuntuserver: UBUNTU_SERVER, openwrt: OPENWRT, ipcam: IPCAM,
});

const out = (text) => ({ kind: 'out', text });
const err = (text) => ({ kind: 'err', text });

export function imageFor(vm) {
  return vm && Object.hasOwn(IMAGES, vm.image) ? IMAGES[vm.image] : null;
}

// Fills {user}, {host}, {id} and {ip} from the VM's own data, and {date} (boot text only)
// with the time the VM booted, written the way Ubuntu's message of the day does.
function fill(text, vm, date = '') {
  return text.replace(/\{(user|host|id|ip|date)\}/g, (match, field) => (field === 'date' ? date : vm[field]));
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n) => String(n).padStart(2, '0');
// "Thu Oct  9 03:34:04 UTC 2026".
export function motdDate(now = new Date()) {
  return `${DAY_NAMES[now.getUTCDay()]} ${MONTH_NAMES[now.getUTCMonth()]} ${String(now.getUTCDate()).padStart(2, ' ')} ${two(now.getUTCHours())}:${two(now.getUTCMinutes())}:${two(now.getUTCSeconds())} UTC ${now.getUTCFullYear()}`;
}

// The file tree as a Map: key -> { name, dir, content, path }. Keys are paths below the
// root joined with '/'; Winbows keys are lowercase, since its paths ignore case.
function buildTree(vm, image) {
  const winbows = image.shell === 'powershell';
  const key = (segments) => (winbows ? segments.join('/').toLowerCase() : segments.join('/'));
  const tree = new Map([['', { path: [], dir: true }]]);
  for (const dir of image.dirs) {
    const path = fill(dir, vm).split('/');
    tree.set(key(path), { path, dir: true });
  }
  for (const [file, content] of Object.entries(image.files)) {
    const path = fill(file, vm).split('/');
    tree.set(key(path), { path, dir: false, content: fill(content, vm) });
  }
  // Logs another machine forwards here (web01's, on ubuntu-blue): their folders, and the
  // source image's own lines, filled in for the source VM. The source's evidence is added
  // when the file is read (fileText), so the two copies always agree.
  for (const entry of forwardedFiles(vm.id)) {
    const source = VMS.find((other) => other.id === entry.vm);
    const sourceImage = imageFor(source);
    const path = entry.path.split('/');
    for (let depth = 1; depth < path.length; depth += 1) {
      if (!tree.has(key(path.slice(0, depth)))) tree.set(key(path.slice(0, depth)), { path: path.slice(0, depth), dir: true });
    }
    const content = sourceImage && Object.hasOwn(sourceImage.files, entry.source) ? fill(sourceImage.files[entry.source], source) : '';
    tree.set(key(path), { path, dir: false, content });
  }
  // Mission files on this VM, and its scenario fixtures (their text comes from the
  // scenario state when read). Only below folders the image already has.
  // Known-good backups (web01's /var/backups/status.txt) are ordinary authored files.
  const extra = [...seatFiles(vm.id), ...fixturePaths(vm.id).map((path) => ({ path, content: '' })), ...backupFiles(vm.id)];
  for (const file of extra) {
    const path = file.path.split('/');
    const parent = tree.get(key(path.slice(0, -1)));
    if (parent && parent.dir) tree.set(key(path), { path, dir: false, content: file.content });
  }
  return { tree, key };
}

export function bootGuest(vm) {
  const image = imageFor(vm);
  if (!image) return null;
  const { tree, key } = buildTree(vm, image);
  const winbows = image.shell === 'powershell';
  const home = image.homeDir ? fill(image.homeDir, vm).split('/') : winbows ? ['Users', vm.user] : ['home', vm.user];
  return {
    vm,
    image,
    winbows,
    login: 'user', // the 'login' shell's step: 'user' or 'password'
    tree,
    key,
    home,
    cwd: home,
    boot: image.boot.map((line) => ({ text: fill(line.text, vm, motdDate()), tone: line.tone || '' })),
  };
}

// How a path is shown: C:\Users\analyst on Winbows, ~/notes or /etc on Linux.
export function showPath(guest, segments) {
  if (guest.winbows) return `C:\\${segments.join('\\')}`;
  const home = guest.home.join('/');
  const joined = segments.join('/');
  if (joined === home) return '~';
  if (joined.startsWith(`${home}/`)) return `~/${joined.slice(home.length + 1)}`;
  return `/${joined}`;
}

export function promptFor(guest) {
  if (guest.vim) return ':';
  if (guest.winbows) return `PS ${showPath(guest, guest.cwd)}>`;
  if (guest.confirm) return 'Do you want to continue? [Y/n]';
  if (guest.image.shell === 'login' && !signedIn(guest)) return guest.login === 'password' ? 'Password:' : `${guest.vm.id} login:`;
  // Root's prompt ends in #, as on Linux.
  return `${guest.vm.user}@${guest.vm.id}:${showPath(guest, guest.cwd)}${guest.vm.user === 'root' ? '#' : '$'}`;
}

// True while the console is asking for a password: its input hides what is typed.
export const isSecretPrompt = (guest) => guest.image.shell === 'login' && guest.login === 'password';

// A login shell that has signed in behaves as root's BusyBox shell.
const signedIn = (guest) => guest.image.shell === 'login' && guest.login === 'in';

// Resolves a typed path against the tree. Returns the node, or null when it does not
// exist (the caller reports that without repeating the path).
function resolve(guest, raw) {
  let text = raw;
  let segments = [...guest.cwd];
  if (guest.winbows) {
    text = text.replace(/^[cC]:/, '');
    if (/^[\\/]/.test(text)) segments = [];
  } else if (text.startsWith('/')) {
    segments = [];
  }
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) {
    segments = [...guest.home];
    text = text.slice(1);
  }
  for (const part of text.split(guest.winbows ? /[\\/]+/ : /\/+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  const node = guest.tree.get(guest.key(segments));
  return node || null;
}

// The entries of a directory node, sorted by name (also used by the Winbows desktop's
// File Explorer, ui/guest-desktop.js).
export function children(guest, dir) {
  const prefix = dir.path.length ? `${guest.key(dir.path)}/` : '';
  return [...guest.tree.entries()]
    .filter(([k]) => k.startsWith(prefix) && k.length > prefix.length && !k.slice(prefix.length).includes('/'))
    .map(([, node]) => node)
    .sort((a, b) => a.path[a.path.length - 1].localeCompare(b.path[b.path.length - 1]));
}

export const nameOf = (node) => node.path[node.path.length - 1];
const lines = (text) => text.split('\n').map(out);

// ---------- Commands ----------
// Each shell maps command names to handlers (args, guest) -> { lines, echo? }. echo is the
// canonical form shown and kept in the VM's history; when absent, args are not kept.

function list(guest, args) {
  const target = args.length ? resolve(guest, args[0]) : guest.tree.get(guest.key(guest.cwd));
  if (!target) return { lines: [err(guest.winbows ? 'Get-ChildItem: Cannot find path because it does not exist.' : 'ls: cannot access: No such file or directory')] };
  const echoPath = args.length ? ` ${showPath(guest, target.path)}` : '';
  if (!target.dir) return { lines: [out(nameOf(target))], echo: `${guest.winbows ? 'dir' : 'ls'}${echoPath}` };
  const kids = children(guest, target);
  if (guest.winbows) {
    return {
      lines: [out(''), out(`    Directory: ${showPath(guest, target.path)}`), out(''), out('Mode    Name'), out('----    ----'),
        ...kids.map((node) => out(`${node.dir ? 'd----' : '-a---'}   ${nameOf(node)}`)), out('')],
      echo: `dir${echoPath}`,
    };
  }
  return { lines: kids.length ? [out(kids.map((node) => (node.dir ? `${nameOf(node)}/` : nameOf(node))).join('  '))] : [], echo: `ls${echoPath}` };
}

function changeDir(guest, args) {
  if (!args.length) {
    if (guest.winbows) return { lines: [], echo: 'cd' };
    guest.cwd = [...guest.home];
    return { lines: [], echo: 'cd' };
  }
  const target = resolve(guest, args[0]);
  if (!target || !target.dir) {
    return { lines: [err(guest.winbows ? 'Set-Location: Cannot find path because it does not exist.' : 'bash: cd: No such file or directory')] };
  }
  guest.cwd = [...target.path];
  return { lines: [], echo: `cd ${showPath(guest, target.path)}` };
}

function read(guest, args) {
  if (!args.length) return { lines: [err(guest.winbows ? 'Get-Content: a path is required.' : 'cat: a file name is required')] };
  const target = resolve(guest, args[0]);
  if (!target) return { lines: [err(guest.winbows ? 'Get-Content: Cannot find path because it does not exist.' : 'cat: No such file or directory')] };
  if (target.dir) return { lines: [err(guest.winbows ? 'Get-Content: the path is a directory.' : 'cat: Is a directory')] };
  return { lines: lines(fileText(guest, target)), echo: `${guest.winbows ? 'type' : 'cat'} ${showPath(guest, target.path)}`, read: guest.key(target.path) };
}

// A file's text as it reads now. A scenario machine's fixture shows its current state, and
// its logs the evidence seen so far, in order; a forwarded log (web01's, on ubuntu-blue)
// is its source's lines plus the source's evidence (features/scenario.js). Shared by cat,
// grep, tail and cp so every way of reading a file agrees.
function fileText(guest, node) {
  const flags = scenarioOf(guest);
  const at = guest.key(node.path);
  const forwarded = forwardedFile(guest.vm.id, at);
  if (forwarded) return [node.content, ...evidenceLines(forwarded.vm, forwarded.source, flags)].join('\n');
  const fixed = fixtureText(guest.vm.id, at, flags);
  return [fixed === null ? node.content : fixed.replace(/\n$/, ''), ...evidenceLines(guest.vm.id, at, flags)].join('\n');
}

// ---------- Reading logs: grep and tail (Blue 1, owner-approved spec, October 11, 2026) ----------
// Read-only, fixed flags, one authored file each. grep matches plain text (as grep -F
// does), never a regular expression, so no pattern can make it slow. The pattern is free
// text: it is kept in the echo only when it occurs in the file (then it is the site's own
// authored text); otherwise the line is not kept (echo null) and nothing typed is shown.
// A successful read reports read: the file's tree key (the mission result's read field).
const GREP_FLAGS = Object.freeze(['-i', '-n', '-c', '-v']);
function grep(guest, args) {
  const usage = [err('Usage: grep [-i] [-n] [-c] [-v] <text> <file>')];
  const flags = new Set();
  let rest = [...args];
  while (rest.length && GREP_FLAGS.includes(rest[0])) flags.add(rest.shift());
  // A quoted pattern may hold spaces: "Invalid user" arrives as two words.
  let pattern = rest.shift();
  if (pattern && /^["']/.test(pattern)) {
    const quote = pattern[0];
    const closed = (text) => text.length > 1 && text.endsWith(quote);
    let joined = pattern;
    while (!closed(joined) && rest.length) joined += ` ${rest.shift()}`;
    if (!closed(joined)) return { lines: usage, echo: null, failed: true };
    pattern = joined.slice(1, -1);
  }
  if (!pattern || rest.length !== 1 || pattern.length > 64 || !/^[\x20-\x7e]+$/.test(pattern)) return { lines: usage, echo: null, failed: true };
  const target = resolve(guest, rest[0]);
  if (!target) return { lines: [err('grep: No such file or directory')], echo: null, failed: true };
  if (target.dir) return { lines: [err('grep: Is a directory')], echo: null, failed: true };
  const text = fileText(guest, target);
  const fold = (value) => (flags.has('-i') ? value.toLowerCase() : value);
  const hit = (line) => fold(line).includes(fold(pattern));
  const all = text.split('\n');
  const picked = all.map((line, i) => [i + 1, line]).filter(([, line]) => hit(line) !== flags.has('-v'));
  // Kept only when the pattern is the file's own text (see above); quoted if it has spaces.
  const kept = fold(text).includes(fold(pattern));
  const shownPattern = /[ "'\\]/.test(pattern) ? `"${pattern.replace(/["\\]/g, '\\$&')}"` : pattern;
  const echo = kept ? `grep${[...flags].sort().map((flag) => ` ${flag}`).join('')} ${shownPattern} ${showPath(guest, target.path)}` : null;
  // grep exits 1 when nothing matched: a failed command, with no output.
  if (flags.has('-c')) return { lines: [out(String(picked.length))], echo, failed: picked.length === 0, ...(picked.length ? { read: guest.key(target.path) } : {}) };
  if (!picked.length) return { lines: [], echo, failed: true };
  return { lines: picked.map(([n, line]) => out(flags.has('-n') ? `${n}:${line}` : line)), echo, read: guest.key(target.path) };
}

// tail [-n N | -N] <file>: the last N lines (default 10, at most the terminal's 200).
function tail(guest, args) {
  const usage = { lines: [err('Usage: tail [-n lines] <file>')], echo: null, failed: true };
  let count = 10;
  let explicit = false;
  let file = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = arg === '-n' ? args[++i] : /^-\d+$/.test(arg) ? arg.slice(1) : null;
    if (value !== null) {
      if (explicit || !/^\d{1,3}$/.test(value || '') || Number(value) < 1 || Number(value) > 200) return usage;
      count = Number(value);
      explicit = true;
    } else if (arg.startsWith('-') || file !== null) return usage;
    else file = arg;
  }
  if (file === null) return usage;
  const target = resolve(guest, file);
  if (!target) return { lines: [err('tail: cannot open: No such file or directory')], echo: null, failed: true };
  if (target.dir) return { lines: [err('tail: error reading: Is a directory')], echo: null, failed: true };
  return {
    lines: lines(fileText(guest, target)).slice(-count),
    echo: `tail${explicit ? ` -n ${count}` : ''} ${showPath(guest, target.path)}`,
    read: guest.key(target.path),
  };
}

// cp <file> <file|folder>: copies a file's text as it reads now (a forwarded log keeps its
// evidence lines, as a real copy would) into the user's own files, through saveFile, so
// names, places, sizes and counts are checked as for any saved file.
function cp(guest, args) {
  if (args.length !== 2 || args.some((arg) => arg.startsWith('-'))) return { lines: [err('Usage: cp <file> <destination>')], echo: null, failed: true };
  const source = resolve(guest, args[0]);
  if (!source) return { lines: [err('cp: cannot stat: No such file or directory')], echo: null, failed: true };
  if (source.dir) return { lines: [err('cp: -r not specified; omitting directory')], echo: null, failed: true };
  const dest = destination(guest, args[1], nameOf(source));
  if (!dest) return { lines: [err('cp: cannot create regular file: No such file or directory')], echo: null, failed: true };
  const echo = `cp ${showPath(guest, source.path)} ${showPath(guest, [...dest.parent, dest.name])}`;
  // Onto a scenario fixture (restoring web01's status.txt from its backup): root only, and
  // only a known version of that file (features/scenario.js stateForText).
  const fixture = fixtureAt(guest.vm.id, guest.key([...dest.parent, dest.name]));
  if (fixture) return writeFixture(guest, fixture, fileText(guest, source), echo, 'cp: cannot create regular file', { read: guest.key(source.path) });
  const saved = saveFile(guest, dest.parent, dest.name, fileText(guest, source));
  if (!saved.ok) return writeError(saved.error, 'cp: cannot create regular file', echo, isRoot(guest));
  return { lines: [], echo, changed: true, read: guest.key(source.path) };
}

// Writes a scenario fixture's file (cp onto it, sed -i on it, curl -o onto it). As on
// Linux, only root may write there; and since the shared scenario state holds fixed IDs
// only, the new text must be one of the fixture's known versions. The change itself is an
// effect, applied by layers/layer2.js after the command's evidence (scenario withState).
function writeFixture(guest, fixture, text, echo, prefix, extra = {}, deniedText = `${prefix}: Permission denied`) {
  if (!isRoot(guest)) return { lines: [err(deniedText)], echo, failed: true, reason: 'not-root' };
  const state = stateForText(fixture, text);
  if (!state) return { lines: [err(`${prefix}: (simulated) this lab file only takes its known versions`)], echo: null, failed: true, reason: 'invalid' };
  return { lines: [], echo, ...extra, effect: { vm: guest.vm.id, fixture: fixture.id, value: state } };
}

// sed -i 's/old/new/[g]' <file> (Blue 1 step 7: turning web01's public restore off). A
// literal substitution, line by line (no regular expressions), in place only. On a
// fixture file the result must be one of its known versions; in the user's own files it
// is saved like any edit. The expression is free text: it is kept in the echo only when
// it turns a fixture into a known version (then both halves are the site's own text).
const SED_DENIED = "sed: couldn't open temporary file: Permission denied";
function sed(guest, args) {
  const usage = { lines: [err("Usage: sed -i 's/old/new/[g]' <file>")], echo: null, failed: true };
  const rest = [...args];
  if (rest[0] !== '-i') return { lines: [err("sed: (simulated) this lab's sed only edits files in place: sed -i 's/old/new/' <file>")], echo: null, failed: true };
  rest.shift();
  let expr = rest.shift();
  if (expr && /^["']/.test(expr)) {
    const quote = expr[0];
    const closed = (text) => text.length > 1 && text.endsWith(quote);
    while (!closed(expr) && rest.length) expr += ` ${rest.shift()}`;
    if (!closed(expr)) return usage;
    expr = expr.slice(1, -1);
  }
  const match = typeof expr === 'string' && expr.length <= 128 && /^[\x20-\x7e]+$/.test(expr) ? /^s\/([^/]+)\/([^/]*)\/(g?)$/.exec(expr) : null;
  if (!match || rest.length !== 1) return usage;
  const [, from, to, global] = match;
  const target = resolve(guest, rest[0]);
  if (!target) return { lines: [err("sed: can't read: No such file or directory")], echo: null, failed: true };
  if (target.dir) return { lines: [err("sed: couldn't edit: not a regular file")], echo: null, failed: true };
  const before = fileText(guest, target);
  const after = before.split('\n').map((line) => (global ? line.split(from).join(to) : line.replace(from, () => to))).join('\n');
  const fixture = fixtureAt(guest.vm.id, guest.key(target.path));
  if (fixture) {
    // Nothing matched: sed changes nothing and says nothing.
    if (after === before) return isRoot(guest) ? { lines: [], echo: null } : { lines: [err(SED_DENIED)], echo: null, failed: true, reason: 'not-root' };
    const echo = stateForText(fixture, after) !== null ? `sed -i 's/${from}/${to}/${global}' ${showPath(guest, target.path)}` : null;
    return writeFixture(guest, fixture, after, echo, 'sed', {}, SED_DENIED);
  }
  if (!canWrite(guest, target.path.slice(0, -1))) {
    return isRoot(guest)
      ? { lines: [err('sed: (simulated) root may only change the files this lab tracks')], echo: null, failed: true, reason: 'invalid' }
      : { lines: [err(SED_DENIED)], echo: null, failed: true, reason: 'not-root' };
  }
  const saved = saveFile(guest, target.path.slice(0, -1), nameOf(target), after);
  if (!saved.ok) return writeError(saved.error, "sed: couldn't edit", null);
  return { lines: [], echo: null, changed: after !== before };
}

// ufw (Blue 1 step 7, Ubuntu images): status [verbose|numbered], deny from <address>,
// delete deny from <address>. Rules live in the shared scenario state (a scenario
// machine's deny-<vm> fixtures), so the lab network honours them for every seat. Only lab
// machines' addresses are accepted (ufw takes addresses, not names); anything else is
// refused without repeating it. Root only, as the real ufw.
function ufw(guest, args) {
  const rules = firewallRules(guest.vm.id);
  const state = stateOf(guest.vm.id, scenarioOf(guest));
  const words = args.join(' ');
  const status = /^status( verbose| numbered)?$/.exec(words);
  const rule = /^(delete )?deny from (\S+)$/.exec(words);
  if (!status && !rule) return { lines: [err('Usage: ufw status [verbose|numbered] | ufw [delete] deny from <address>')], echo: null, failed: true };
  if (rule && !rules.length) return { lines: [err("ERROR: (simulated) only web01's firewall is managed in this lab")], echo: null, failed: true };
  const entry = rule ? rules.find((item) => item.seat && item.seat.ip === rule[2]) : null;
  if (rule && !entry) return { lines: [err('ERROR: Bad source address')], echo: null, failed: true };
  const echo = status ? `ufw ${words}` : `ufw ${rule[1] || ''}deny from ${entry.seat.ip}`;
  if (!isRoot(guest)) return { lines: [err('ERROR: You need to be root to run this script')], echo, failed: true, reason: 'not-root' };
  if (status) {
    if (!rules.length) return { lines: [out('Status: inactive')], echo };
    const on = rules.filter((item) => state[item.fixture.id] === 'on');
    const verbose = status[1] === ' verbose';
    const numbered = status[1] === ' numbered';
    const head = verbose
      ? ['Status: active', 'Logging: on (low)', 'Default: allow (incoming), allow (outgoing), disabled (routed)', 'New profiles: skip']
      : ['Status: active'];
    if (!on.length) return { lines: head.map(out), echo };
    const pad = numbered ? '     ' : '';
    return {
      lines: [...head, ' ', `${pad}To                         Action      From`, `${pad}--                         ------      ----`,
        ...on.map((item, i) => `${numbered ? `[${String(i + 1).padStart(2)}] ` : ''}Anywhere                   ${numbered || verbose ? 'DENY IN' : 'DENY   '}     ${item.seat.ip}`)].map(out),
      echo,
    };
  }
  const isOn = state[entry.fixture.id] === 'on';
  if (!rule[1]) {
    if (isOn) return { lines: [out('Skipping adding existing rule')], echo };
    return { lines: [out('Rule added')], echo, effect: { vm: guest.vm.id, fixture: entry.fixture.id, value: 'on' } };
  }
  if (!isOn) return { lines: [err('Could not delete non-existent rule')], echo, failed: true };
  return { lines: [out('Rule deleted')], echo, effect: { vm: guest.vm.id, fixture: entry.fixture.id, value: 'off' } };
}

// Where a copy or download lands: an existing folder keeps the given name; otherwise the
// last part is the new file's name in a folder that must exist. null when it cannot.
function destination(guest, raw, fallbackName) {
  const node = resolve(guest, raw);
  if (node && node.dir) return { parent: node.path, name: fallbackName };
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed !== raw) return null;
  const cut = raw.lastIndexOf('/');
  const name = raw.slice(cut + 1);
  const parent = cut === -1 ? guest.tree.get(guest.key(guest.cwd)) : resolve(guest, raw.slice(0, cut) || '/');
  return parent && parent.dir && name ? { parent: parent.path, name } : null;
}

// A saveFile error as bash words it; a bad name is never repeated or kept.
// root: the writer is root (sudo), who may still only write their own files and the
// lab's fixtures.
function writeError(error, prefix, echo, root = false) {
  const message = {
    denied: root ? `${prefix}: (simulated) root may only restore the files this lab tracks` : `${prefix}: Permission denied`,
    full: `${prefix}: No space left on device`,
    big: `${prefix}: File too large`,
    folder: `${prefix}: Is a directory`,
    missing: `${prefix}: No such file or directory`,
  }[error] || `${prefix}: Invalid argument`;
  return { lines: [err(message)], echo: error === 'name' ? null : echo, failed: true, ...(error === 'denied' ? { reason: 'permission' } : {}) };
}

// curl -o <file> | -O: the lab network's curl, with the page saved to the user's files
// instead of printed, and curl's progress meter shown. The request itself (its evidence,
// target and refusals) is exactly curl's; only a page that came back is saved.
function curlSave(guest, args) {
  const at = args.findIndex((arg) => arg === '-o' || arg === '-O' || arg === '--output' || arg === '--remote-name');
  const named = args[at] === '-o' || args[at] === '--output';
  const file = named ? args[at + 1] : null;
  const rest = args.filter((arg, i) => i !== at && !(named && i === at + 1));
  if ((named && !file) || rest.some((arg) => ['-o', '-O', '--output', '--remote-name', '-I', '--head'].includes(arg))) {
    return { lines: [err('curl: option -o/-O: needs a file name and a page (not -I)')], echo: null, failed: true };
  }
  const fetched = curl(guest, rest);
  if (fetched.failed || !fetched.echo) return fetched;
  const url = rest.find((arg) => !arg.startsWith('-'));
  const remote = url.replace(/^[a-z]+:\/\//i, '').split('/').slice(1).pop() || '';
  if (!named && !remote) return { ...fetched, lines: [err('curl: Remote file name has no length!')], echo: null, failed: true, contact: undefined };
  const dest = destination(guest, named ? file : remote, remote || 'index.html');
  const echo = fetched.echo.replace(/^curl/, named && dest ? `curl -o ${showPath(guest, [...dest.parent, dest.name])}` : 'curl -O');
  if (!dest) return { ...fetched, lines: [err('curl: (23) Failure writing output to destination')], echo: null, failed: true };
  const body = fetched.lines.filter((line) => line.kind === 'out').map((line) => line.text).join('\n');
  const fixture = fixtureAt(guest.vm.id, guest.key([...dest.parent, dest.name]));
  if (fixture) {
    const written = writeFixture(guest, fixture, body, echo, 'curl: (23) Failure writing output to destination');
    return written.failed ? { ...fetched, ...written } : { ...fetched, ...written, lines: [] };
  }
  const saved = saveFile(guest, dest.parent, dest.name, `${body}\n`);
  if (!saved.ok) return { ...fetched, ...writeError(saved.error, 'curl: (23) Failure writing output to destination', echo, isRoot(guest)) };
  const size = String(body.length + 1);
  return {
    ...fetched,
    echo,
    changed: true,
    lines: [
      out('  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current'),
      out('                                 Dload  Upload   Total   Spent    Left  Speed'),
      out(`100 ${size.padStart(5)}  100 ${size.padStart(5)}    0     0  ${String(body.length * 40).padStart(5)}      0 --:--:-- --:--:-- --:--:-- ${String(body.length * 40).padStart(5)}`),
    ],
  };
}

const pwd = (guest) => ({ lines: guest.winbows ? [out(''), out('Path'), out('----'), out(showPath(guest, guest.cwd)), out('')] : [out(`/${guest.cwd.join('/')}`)] });

// ---------- The VM's own files (owner request, October 10, 2026) ----------
// Text editors save files and the file managers and shells make folders: doctrine section
// 8's bounded file overlay on the image's authored tree, kept for the session by
// ui/vm-session.js. Names are checked against a fixed pattern (and Winbows' reserved
// device names); content is text only, capped, without control characters; everything is
// rendered as text. As on a real system, the user may only write in their own home
// (C:\Users\<user> on Winbows, /home/<user> and /tmp on Linux). Nodes made or changed
// here carry made: true, and only those are stored.
const NAME = /^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/;
const WINBOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Why a name cannot be used, or null when it can.
export function nameProblem(guest, name) {
  if (typeof name !== 'string' || !name.length || name.length > VM_FILES.name || !NAME.test(name) || name === '.' || name === '..') return 'name';
  if (guest.winbows && (WINBOWS_RESERVED.test(name) || /[. ]$/.test(name))) return 'name';
  return null;
}

// Whether the user may write inside the folder at these segments.
export function canWrite(guest, segments) {
  const inside = (base) => {
    const prefix = guest.key(base);
    const key = guest.key(segments);
    return key === prefix || key.startsWith(`${prefix}/`);
  };
  const { home } = guest;
  return inside(home) || (!guest.winbows && inside(['tmp']));
}

const madeCount = (guest, dir) => [...guest.tree.values()].filter((node) => node.made && node.dir === dir).length;

// Makes a folder in the folder at parent. Returns { ok: true, node } or { ok: false,
// error: 'name' | 'exists' | 'denied' | 'missing' | 'full' }.
export function makeDir(guest, parent, name) {
  const at = guest.tree.get(guest.key(parent));
  if (!at || !at.dir) return { ok: false, error: 'missing' };
  const problem = nameProblem(guest, name);
  if (problem) return { ok: false, error: problem };
  if (!canWrite(guest, parent)) return { ok: false, error: 'denied' };
  const path = [...parent, name];
  if (guest.tree.has(guest.key(path))) return { ok: false, error: 'exists' };
  if (madeCount(guest, true) >= VM_FILES.dirs) return { ok: false, error: 'full' };
  const node = { path, dir: true, made: true };
  guest.tree.set(guest.key(path), node);
  return { ok: true, node };
}

// Text as a file keeps it: newlines and tabs, no other control characters, capped.
const cleanText = (text) => String(text).replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]/gu, '').slice(0, VM_FILES.content);

// Saves text as a file in the folder at parent, replacing a file of that name. Returns
// { ok: true, node } or { ok: false, error: as makeDir, or 'folder' (a folder has that
// name) or 'big' (too long to save) }.
export function saveFile(guest, parent, name, text) {
  const at = guest.tree.get(guest.key(parent));
  if (!at || !at.dir) return { ok: false, error: 'missing' };
  const problem = nameProblem(guest, name);
  if (problem) return { ok: false, error: problem };
  if (!canWrite(guest, parent)) return { ok: false, error: 'denied' };
  if (typeof text !== 'string' || text.length > VM_FILES.content) return { ok: false, error: 'big' };
  const key = guest.key([...parent, name]);
  const existing = guest.tree.get(key);
  if (existing && existing.dir) return { ok: false, error: 'folder' };
  if (!(existing && existing.made) && madeCount(guest, false) >= VM_FILES.files) return { ok: false, error: 'full' };
  // On Winbows the name keeps the case it was first saved with.
  const node = { path: existing ? existing.path : [...parent, name], dir: false, content: cleanText(text), made: true };
  guest.tree.set(key, node);
  return { ok: true, node };
}

// What the session keeps: the folders and files made or changed here, parents first.
export function exportFiles(guest) {
  const made = [...guest.tree.values()].filter((node) => node.made);
  return {
    dirs: made.filter((node) => node.dir).sort((a, b) => a.path.length - b.path.length).map((node) => node.path.join('/')),
    files: made.filter((node) => !node.dir).map((node) => [node.path.join('/'), node.content]),
  };
}

// Puts stored folders and files back (untrusted: each goes through makeDir / saveFile,
// so names, places, sizes and counts are checked again; anything that fails is dropped).
export function importFiles(guest, stored) {
  if (!stored || !Array.isArray(stored.dirs) || !Array.isArray(stored.files)) return;
  const split = (key) => (typeof key === 'string' && key.length <= VM_FILES.key ? key.split('/') : null);
  for (const key of stored.dirs.slice(0, VM_FILES.dirs)) {
    const path = split(key);
    if (path && path.length > 1) makeDir(guest, path.slice(0, -1), path[path.length - 1]);
  }
  for (const entry of stored.files.slice(0, VM_FILES.files)) {
    const path = Array.isArray(entry) ? split(entry[0]) : null;
    if (path && path.length > 1 && typeof entry[1] === 'string') saveFile(guest, path.slice(0, -1), path[path.length - 1], entry[1]);
  }
}

// mkdir (bash, ash, PowerShell's mkdir and md): one folder, by name or path.
function mkdir(guest, args) {
  if (args.length !== 1) return { lines: [err(guest.winbows ? 'mkdir: a folder name is required.' : 'mkdir: missing operand')], echo: args.length ? null : 'mkdir', failed: true };
  // The last part is the new folder; anything before it must already be a folder.
  const raw = args[0].replace(guest.winbows ? /[\\/]+$/ : /\/+$/, '');
  const cut = Math.max(raw.lastIndexOf('/'), guest.winbows ? raw.lastIndexOf('\\') : -1);
  const leaf = raw.slice(cut + 1);
  const parentNode = cut === -1 ? guest.tree.get(guest.key(guest.cwd)) : resolve(guest, raw.slice(0, cut) || '/');
  if (!leaf || !parentNode || !parentNode.dir) return { lines: [err(guest.winbows ? 'New-Item: Could not find a part of the path.' : 'mkdir: cannot create directory: No such file or directory')], echo: null, failed: true };
  const made = makeDir(guest, parentNode.path, leaf);
  if (!made.ok) {
    const message = {
      name: guest.winbows ? 'New-Item: The given path\'s format is not supported.' : 'mkdir: cannot create directory: Invalid argument',
      exists: guest.winbows ? 'New-Item: An item with the specified name already exists.' : 'mkdir: cannot create directory: File exists',
      denied: guest.winbows ? 'New-Item: Access to the path is denied.' : 'mkdir: cannot create directory: Permission denied',
      full: guest.winbows ? 'New-Item: There is not enough space on the disk.' : 'mkdir: cannot create directory: No space left on device',
      missing: guest.winbows ? 'New-Item: Could not find a part of the path.' : 'mkdir: cannot create directory: No such file or directory',
    }[made.error];
    // A bad name is never repeated or kept.
    return { lines: [err(message)], echo: made.error === 'name' ? null : `mkdir ${showPath(guest, made.node ? made.node.path : [...parentNode.path, leaf])}`, failed: true, ...(made.error === 'denied' ? { reason: 'permission' } : {}) };
  }
  const shown = showPath(guest, made.node.path);
  if (!guest.winbows) return { lines: [], echo: `mkdir ${shown}`, changed: true };
  const now = new Date();
  const stamp = `${String(now.getMonth() + 1).padStart(2, ' ')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}  ${String(((now.getHours() + 11) % 12) + 1).padStart(2, ' ')}:${String(now.getMinutes()).padStart(2, '0')} ${now.getHours() < 12 ? 'AM' : 'PM'}`;
  return {
    lines: [out(' '), out(`    Directory: ${showPath(guest, parentNode.path)}`), out(' '), out(' '),
      out('Mode                 LastWriteTime         Length Name'), out('----                 -------------         ------ ----'),
      out(`d-----        ${stamp}                ${leaf}`), out(' ')],
    echo: `mkdir ${shown}`,
    changed: true,
  };
}

// ---------- Help (owner request, October 10, 2026) ----------
// Every shell lists its own commands for `help` and `?`, and every command explains itself
// for `<command> ?`, `<command> --help` (Linux) or `<command> -?` / `/?` (PowerShell), and
// for `help <command>`. usage is the syntax; about is what it does.
const LINUX_HELP = Object.freeze({
  ls: { usage: 'ls [path]', about: 'List the files and folders in a folder (default: the one you are in).' },
  cd: { usage: 'cd [path]', about: 'Change folder. With no path, go home. .. goes up one, ~ is your home.' },
  pwd: { usage: 'pwd', about: 'Print the full path of the folder you are in.' },
  ping: { usage: 'ping [-c count] <host>', about: 'Check that a lab machine answers.' },
  curl: { usage: 'curl [-I] <url>', about: "Fetch a page from a lab machine's web server." },
  ssh: { usage: 'ssh [user@]<host>', about: 'Connect to a lab machine over SSH.' },
  nmap: { usage: 'nmap [options] <host|lab subnet>', about: 'Scan lab machines for open ports (nmap --help for options).', needs: 'parrot' },
  mkdir: { usage: 'mkdir <folder>', about: 'Make a folder (in your home, or /tmp).' },
  cat: { usage: 'cat <file>', about: 'Print a file.' },
  grep: { usage: 'grep [-i] [-n] [-c] [-v] <text> <file>', about: 'Print the lines of a file that contain the text (-i ignores case, -n numbers lines, -c counts, -v inverts).' },
  tail: { usage: 'tail [-n lines] <file>', about: 'Print the last lines of a file (10 unless -n says).' },
  cp: { usage: 'cp <file> <destination>', about: 'Copy a file (into your home, or /tmp).' },
  nslookup: { usage: 'nslookup <host|address>', about: 'Look a lab name up for its address, or an address for its name.' },
  sed: { usage: "sed -i 's/old/new/[g]' <file>", about: 'Replace text in a file, in place (plain text, not a regex).' },
  ufw: { usage: 'ufw status | ufw [delete] deny from <address>', about: "Show or change this machine's firewall (needs sudo). deny drops the packets.", needs: 'ufw' },
  whoami: { usage: 'whoami', about: 'Print the user you are logged in as.' },
  id: { usage: 'id', about: 'Print your user and group ids.' },
  hostname: { usage: 'hostname', about: "Print this machine's name." },
  uname: { usage: 'uname [-a]', about: 'Print the system name; -a prints the kernel, host and architecture too.' },
  ip: { usage: 'ip [-br] a | link | route', about: "Show this machine's address, network link or routes on the lab network." },
  ifconfig: { usage: 'ifconfig [-a]', about: "Show this machine's network interface (Ubuntu: sudo apt install net-tools first)." },
  clear: { usage: 'clear', about: 'Clear the screen (Ctrl+L does too).' },
  help: { usage: 'help [command]', about: 'List the commands on this machine, or explain one. ? does the same.' },
  exit: { usage: 'exit', about: 'Leave the shell.' },
  sudo: { usage: 'sudo <command>', about: 'Run one command as root.', needs: 'apt' },
  apt: { usage: 'apt <command> [-y]', about: 'Packages: update (refresh the lists), upgrade, full-upgrade, list --upgradable. Needs sudo; -y skips the question.', needs: 'apt' },
  'parrot-upgrade': { usage: 'parrot-upgrade', about: "Parrot's own upgrade: refresh, then upgrade everything. Needs sudo.", needs: 'parrot' },
});

// Whether a help entry applies to this machine (sudo and apt only where they exist).
const hasUfw = (guest) => guest.image.id === 'ubuntu' || guest.image.id === 'ubuntuserver';
const hasHelp = (guest, entry) => !entry.needs || (entry.needs === 'apt' ? Boolean(guest.image.apt)
  : entry.needs === 'ufw' ? hasUfw(guest) : Boolean(guest.image.apt && guest.image.apt.parrot));
const POWERSHELL_HELP = Object.freeze({
  dir: { usage: 'dir [path]', about: 'List the items in a folder.', aliases: 'Get-ChildItem, ls, gci' },
  cd: { usage: 'cd <path>', about: 'Change folder. .. goes up one, ~ is your home.', aliases: 'Set-Location, sl' },
  pwd: { usage: 'pwd', about: 'Show the folder you are in.', aliases: 'Get-Location, gl' },
  ping: { usage: 'ping [-n count] <host>', about: 'Check that a lab machine answers.' },
  curl: { usage: 'curl <url>', about: "Fetch a page from a lab machine's web server." },
  ssh: { usage: 'ssh [user@]<host>', about: 'Connect to a lab machine over SSH.' },
  mkdir: { usage: 'mkdir <folder>', about: 'Make a folder (in your user folder).', aliases: 'md, New-Item -ItemType Directory' },
  type: { usage: 'type <file>', about: 'Show the contents of a file.', aliases: 'Get-Content, cat, gc' },
  whoami: { usage: 'whoami', about: 'Show the signed-in user as domain\\user.' },
  hostname: { usage: 'hostname', about: "Show this computer's name." },
  ipconfig: { usage: 'ipconfig [/all | /release | /renew | /flushdns | /displaydns]', about: "Show this computer's network adapter and lab address (/all for everything)." },
  cls: { usage: 'cls', about: 'Clear the screen.', aliases: 'Clear-Host, clear' },
  sfc: { usage: 'sfc /scannow', about: 'Scan the system files and repair damaged ones (/verifyonly: scan only).' },
  dism: { usage: 'dism /online /cleanup-image /restorehealth', about: 'Check, repair or clean up the component store (DISM.exe /? for the switches).' },
  tasklist: { usage: 'tasklist', about: 'List the running processes.' },
  taskkill: { usage: 'taskkill [/f] /im <name> | /pid <id>', about: 'End a process (/f forces it). Careful with system processes.' },
  'get-process': { usage: 'Get-Process', about: 'List the running processes.', aliases: 'ps, gps' },
  'stop-process': { usage: 'Stop-Process -Name <name> | -Id <id>', about: 'End a process.', aliases: 'kill, spps' },
  help: { usage: 'help [command]', about: 'List the commands on this computer, or explain one.', aliases: 'Get-Help, ?' },
  exit: { usage: 'exit', about: 'Close the session.' },
});
// The help flags each shell understands after a command.
const LINUX_HELP_FLAGS = Object.freeze(['?', '--help']);
const POWERSHELL_HELP_FLAGS = Object.freeze(['?', '-?', '/?']);

// Which machine this is, for the top of `help`.
function helpHeading(guest) {
  if (guest.winbows) return `${guest.vm.os}: commands in this PowerShell session`;
  if (guest.image.shell === 'ash' || guest.image.shell === 'login') return `${guest.vm.os}: BusyBox shell commands`;
  return `${guest.vm.os}: commands in this shell`;
}

// `help` and `?`: the machine's own list, one line each.
function helpList(guest) {
  // PowerShell lists names in a Name / Synopsis table, as Get-Help does; the switches are
  // in each command's own help (dism -?), so no long usage pushes the column out (owner
  // bug report, October 10, 2026).
  if (guest.winbows) {
    const rows = Object.values(POWERSHELL_HELP).map((entry) => [entry.usage.split(' ')[0], entry.about]);
    const width = Math.max(...rows.map(([name]) => name.length)) + 2;
    return [
      out(helpHeading(guest)),
      out(' '),
      out(`${'Name'.padEnd(width)}Synopsis`),
      out(`${'----'.padEnd(width)}--------`),
      ...rows.map(([name, about]) => out(`${name.padEnd(width)}${about}`)),
      out(' '),
      out('Type a command followed by -? (or ?) for its help, e.g. dism -?'),
    ];
  }
  const table = LINUX_HELP;
  const width = Math.min(22, Math.max(...Object.values(table).filter((entry) => hasHelp(guest, entry)).map((entry) => entry.usage.length))) + 3;
  return [
    out(helpHeading(guest)),
    out(' '),
    // A usage wider than the column puts its description on the next line.
    ...Object.values(table).filter((entry) => hasHelp(guest, entry)).flatMap((entry) => (entry.usage.length < width
      ? [out(`  ${entry.usage.padEnd(width)}${entry.about}`)]
      : [out(`  ${entry.usage}`), out(`  ${''.padEnd(width)}${entry.about}`)])),
    out(' '),
    out(guest.winbows ? 'Type a command followed by -? (or ?) for its help, e.g. dir -?' : 'Type a command followed by ? (or --help) for its help, e.g. ls ?'),
  ];
}

// One command's help, in the shell's own style. Returns null for an unknown command.
function helpFor(guest, name) {
  if (guest.winbows) {
    const canonical = POWERSHELL_ALIASES[name] || name;
    if (!Object.hasOwn(POWERSHELL_HELP, canonical)) return null;
    const entry = POWERSHELL_HELP[canonical];
    return [
      out('NAME'), out(`    ${canonical}`), out(' '),
      out('SYNTAX'), out(`    ${entry.usage}`), out(' '),
      ...(entry.aliases ? [out('ALIASES'), out(`    ${entry.aliases}`), out(' ')] : []),
      out('DESCRIPTION'), out(`    ${entry.about}`),
    ];
  }
  if (!Object.hasOwn(LINUX_HELP, name) || !hasHelp(guest, LINUX_HELP[name])) return null;
  const entry = LINUX_HELP[name];
  return [out(`Usage: ${entry.usage}`), out(' '), out(`  ${entry.about}`)];
}

// ---------- Packages: sudo, apt, parrot-upgrade (owner idea, October 10, 2026) ----------
// Only on images with apt data (Ubuntu, ParrotOS). Output follows apt's own, from the
// image's lab mirror and upgrade list; nothing is fetched. sudo runs one command as root
// with no prompt, as on a cloud image's default user (NOPASSWD). Each VM remembers whether
// its lists are fresh and whether it has upgraded, for the session.
const isRoot = (g) => g.vm.user === 'root' || g.asRoot === true;
const kbText = (kb) => `${kb.toLocaleString('en-US')} kB`;
// A line apt prints after a pause (ms): the console streams these like the real thing.
const slow = (text, ms) => ({ kind: 'out', text, ms });
// Download time for a package, by size: a quick lab mirror, never instant, never long.
const fetchMs = (kb) => Math.min(1400, 180 + Math.round(kb / 60));

function pending(g) {
  return g.apt && g.apt.upgraded ? [] : g.image.apt.upgrades;
}

function aptUpdate(g) {
  const a = g.image.apt;
  const lines = a.sources.map((source, i) => slow(i === 0 ? `Hit:1 ${source} InRelease` : `Get:${i + 1} ${source} InRelease [${kbText(126)}]`, i === 0 ? 450 : 320));
  const waiting = pending(g).length;
  g.apt = { ...(g.apt || {}), updated: true };
  return [
    ...lines,
    slow(`Fetched ${kbText(126 * (a.sources.length - 1))} in 1s (${kbText(126 * (a.sources.length - 1))}/s)`, 300),
    slow('Reading package lists... Done', 650),
    slow('Building dependency tree... Done', 350),
    slow('Reading state information... Done', 120),
    slow(waiting ? `${waiting} packages can be upgraded. Run 'apt list --upgradable' to see them.` : 'All packages are up to date.', 120),
  ];
}

// The plan apt prints before asking; full: full-upgrade ("Calculating upgrade" too).
function upgradePlan(g) {
  const list = pending(g);
  const head = [slow('Reading package lists... Done', 500), slow('Building dependency tree... Done', 300), slow('Reading state information... Done', 100), slow('Calculating upgrade... Done', 450)];
  if (!list.length) return { lines: [...head, out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.')], needed: false };
  const total = list.reduce((sum, p) => sum + p.kb, 0);
  return {
    lines: [
      ...head,
      out('The following packages will be upgraded:'),
      out(`  ${list.map((p) => p.name).join(' ')}`),
      out(`${list.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.`),
      out(`Need to get ${kbText(total)} of archives.`),
      out(`After this operation, ${kbText(Math.round(total / 40))} of additional disk space will be used.`),
    ],
    needed: true,
  };
}

function upgradeRun(g) {
  const a = g.image.apt;
  const list = pending(g);
  const total = list.reduce((sum, p) => sum + p.kb, 0);
  const source = a.sources[a.sources.length > 1 ? 1 : 0];
  g.apt = { ...(g.apt || {}), upgraded: true };
  return [
    ...list.map((p, i) => slow(`Get:${i + 1} ${source}/main ${a.arch} ${p.name} ${a.arch} ${p.to} [${kbText(p.kb)}]`, fetchMs(p.kb))),
    slow(`Fetched ${kbText(total)} in 2s (${kbText(Math.round(total / 2))}/s)`, 150),
    slow('(Reading database ... 74213 files and directories currently installed.)', 600),
    ...list.flatMap((p) => [
      slow(`Preparing to unpack .../${p.name}_${p.to}_${a.arch}.deb ...`, 160),
      slow(`Unpacking ${p.name} (${p.to}) over (${p.from}) ...`, 280 + Math.round(fetchMs(p.kb) / 3)),
    ]),
    ...list.map((p) => slow(`Setting up ${p.name} (${p.to}) ...`, 260)),
    ...a.triggers.map((t) => slow(`Processing triggers for ${t} ...`, 420)),
  ];
}

// apt without root fails the way apt does.
const aptDenied = (sub) => (sub === 'update'
  ? [err('E: Could not open lock file /var/lib/apt/lists/lock - open (13: Permission denied)'), err('E: Unable to lock directory /var/lib/apt/lists/')]
  : [err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)'), err('E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?')]);

function apt(args, g, name = 'apt') {
  if (!g.image.apt) return { lines: [err(`-ash: ${name}: not found`)], failed: true };
  const yes = args.includes('-y') || args.includes('--yes');
  const words = args.filter((arg) => arg !== '-y' && arg !== '--yes');
  const sub = words[0];
  const flag = yes ? ' -y' : '';
  if (sub === 'list' && words[1] === '--upgradable' && words.length === 2) {
    const list = pending(g);
    const suite = g.image.apt.sources[1].split(' ').pop();
    return {
      lines: [out('Listing... Done'), ...list.map((p) => out(`${p.name}/${suite} ${p.to} ${g.image.apt.arch} [upgradable from: ${p.from}]`))],
      echo: `${name} list --upgradable`,
    };
  }
  // Easter egg: Debian's cow, as apt has always had it.
  if (sub === 'moo' && words.length === 1) return { lines: MOO.map(out), echo: `${name} moo` };
  // apt install sl (or remove): the one extra package the lab mirror carries.
  if ((sub === 'install' || sub === 'remove') && words.length === 2) return aptPackage(g, name, sub, words[1], yes);
  if (words.length !== 1 || !['update', 'upgrade', 'full-upgrade', 'dist-upgrade'].includes(sub)) {
    return { lines: [err(`E: Invalid operation. Try '${name} ?' for usage.`)], failed: true };
  }
  if (!isRoot(g)) return { lines: aptDenied(sub), echo: `${name} ${sub}${flag}`, failed: true, reason: 'not-root' };
  if (sub === 'update') return { lines: aptUpdate(g), echo: `${name} update` };
  const plan = upgradePlan(g);
  if (!plan.needed) return { lines: plan.lines, echo: `${name} ${sub}${flag}` };
  if (yes) return { lines: [...plan.lines, ...upgradeRun(g)], echo: `${name} ${sub}${flag}` };
  // Without -y apt asks first; the answer is the next line typed.
  g.confirm = { kind: 'upgrade' };
  return { lines: plan.lines, echo: `${name} ${sub}` };
}

// ---------- Linux easter eggs (owner request, October 11, 2026) ----------
// apt moo, sl (after sudo apt install sl, as on a real Ubuntu or Parrot) and the vim trap.
// The cow is apt's traditional one; the train is this site's own drawing.
const MOO = Object.freeze([
  '                 (__)',
  '                 (oo)',
  '           /------\\/',
  '          / |    ||',
  '         *  /\\---/\\',
  '            ~~   ~~',
  '..."Have you mooed today?"...',
]);

// The lab mirror's extra package: sl, the steam locomotive for people who mistype ls.
// nmap too: ParrotOS ships it, Ubuntu installs it from the mirror (owner request,
// October 11, 2026: only the machines that have it can run it).
const EXTRA = Object.freeze({
  sl: Object.freeze({ version: '5.02-1', kb: 12.4, size: 58.4 }),
  nmap: Object.freeze({ version: '7.94+git20230807.3be01efb1+dfsg-3build2', kb: 1693, size: 4505 }),
  // ifconfig and friends: Ubuntu leaves them out, as the real one does.
  'net-tools': Object.freeze({ version: '2.10-0.1ubuntu4', kb: 204, size: 811 }),
});

function aptPackage(g, name, sub, pkg, yes) {
  if (!Object.hasOwn(EXTRA, pkg)) {
    // The package name is never repeated.
    return { lines: [out('Reading package lists... Done'), out('Building dependency tree... Done'), out('Reading state information... Done'), err('E: Unable to locate package')], echo: null, failed: true };
  }
  if (!isRoot(g)) return { lines: [err('E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)'), err('E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?')], echo: `${name} ${sub} ${pkg}`, failed: true, reason: 'not-root' };
  const p = EXTRA[pkg];
  const installed = Boolean(g.installed && g.installed[pkg]);
  const head = [slow('Reading package lists... Done', 300), slow('Building dependency tree... Done', 200), slow('Reading state information... Done', 120)];
  const echo = `${name} ${sub}${yes ? ' -y' : ''} ${pkg}`;
  if (sub === 'install' && installed) return { lines: [...head, out(`${pkg} is already the newest version (${p.version}).`), out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.')], echo };
  if (sub === 'remove' && !installed) return { lines: [...head, out(`Package '${pkg}' is not installed, so not removed`), out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.')], echo };
  g.installed = { ...(g.installed || {}), [pkg]: sub === 'install' };
  const deb = `${pkg}_${p.version}_${g.image.apt.arch}.deb`;
  if (sub === 'remove') {
    return { lines: [...head, out('The following packages will be REMOVED:'), out(`  ${pkg}`), out('0 upgraded, 0 newly installed, 1 to remove and 0 not upgraded.'), out(`After this operation, ${p.size} kB disk space will be freed.`), slow('(Reading database ... 201447 files and directories currently installed.)', 400), slow(`Removing ${pkg} (${p.version}) ...`, 350), slow('Processing triggers for man-db (2.12.0-4build2) ...', 500)], echo };
  }
  return {
    lines: [
      ...head,
      out('The following NEW packages will be installed:'),
      out(`  ${pkg}`),
      out('0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.'),
      out(`Need to get ${p.kb} kB of archives.`),
      out(`After this operation, ${p.size} kB of additional disk space will be used.`),
      slow(`Get:1 ${g.image.apt.sources[0]}/universe ${g.image.apt.arch} ${pkg} ${g.image.apt.arch} ${p.version} [${p.kb} kB]`, 400),
      slow(`Fetched ${p.kb} kB in 0s (${Math.round(p.kb * 9)} kB/s)`, 250),
      slow(`Selecting previously unselected package ${pkg}.`, 300),
      slow('(Reading database ... 201447 files and directories currently installed.)', 400),
      slow(`Preparing to unpack .../${deb} ...`, 250),
      slow(`Unpacking ${pkg} (${p.version}) ...`, 350),
      slow(`Setting up ${pkg} (${p.version}) ...`, 300),
      slow('Processing triggers for man-db (2.12.0-4build2) ...', 600),
    ],
    echo,
  };
}

// sl: a train crosses the console, each frame redrawing the last (block, replace), then
// it is gone, as the real one leaves an empty screen. Before it is installed, the
// shell's "command not found" hint, as Ubuntu prints it.
const TRAIN = Object.freeze([
  '      (  )   ( )    ',
  '    _____( )___     ',
  '   | |  |_____||___ ',
  '  _|_|__| [##] |   \\',
  ' |  W A F F L E S   |>',
  " '-O--O-------O--O--' ",
]);
const SMOKE = Object.freeze(['   (    )  (   )    ', '      (  )   ( )    ']);
function sl(g) {
  if (!(g.installed && g.installed.sl)) {
    return { lines: [err("Command 'sl' not found, but can be installed with:"), err(' '), err('sudo apt install sl'), err(' ')], echo: 'sl', failed: true };
  }
  const width = 64;
  const frames = [];
  for (let at = width; at > -TRAIN[0].length - 2; at -= 3) {
    const art = TRAIN.map((row, i) => (i === 0 ? SMOKE[frames.length % 2] : row));
    const block = art.map((row) => {
      const line = at >= 0 ? ' '.repeat(at) + row : row.slice(-at);
      return line.slice(0, width) || ' ';
    });
    frames.push({ kind: 'out', block, ms: frames.length ? 90 : 60, replace: frames.length > 0 });
  }
  frames.push({ kind: 'out', block: [], ms: 90, replace: true });
  return { lines: frames, echo: 'sl' };
}

// vim (and vi): the trap. The screen becomes vim's; everything typed is a vim command line
// until one of the ways out (:q, :q!, :qa!, :wq, :x). The usual escape attempts get the
// message vim really gives. Typed text is never shown back.
const VIM_SCREEN = Object.freeze([
  '~', '~', '~',
  '~                      VIM - Vi IMproved',
  '~',
  '~                      version 9.1.0016',
  '~                  by Bram Moolenaar et al.',
  '~',
  '~       type  :q<Enter>               to exit',
  '~       type  :help<Enter>  or  <F1>  for on-line help',
  '~', '~', '~',
]);
function vim(g) {
  g.vim = true;
  return { lines: VIM_SCREEN.map(out), echo: 'vim', clear: true };
}
const VIM_EXITS = Object.freeze([':q', ':q!', ':qa', ':qa!', ':wq', ':x', ':wq!', 'zz']);
function vimInput(g, raw) {
  const typed = typeof raw === 'string' ? raw.trim() : '';
  if (VIM_EXITS.includes(typed.toLowerCase())) {
    g.vim = false;
    return { lines: [], echo: typed === 'ZZ' ? 'ZZ' : typed.toLowerCase(), clear: true };
  }
  if (typed === ':help' || typed === ':h') return { lines: [err('E149: Sorry, no help for this one. Try :q')], echo: ':help', clear: false };
  if (typed.startsWith(':')) return { lines: [err('E492: Not an editor command')], echo: null, clear: false };
  return { lines: [out('Type  :qa!  and press <Enter> to abandon all changes and exit Vim')], echo: null, clear: false };
}

// Parrot's wrapper: refresh, then a full upgrade with no questions.
function parrotUpgrade(args, g) {
  if (!g.image.apt || !g.image.apt.parrot) return { lines: [err('bash: command not found')], failed: true };
  if (!isRoot(g)) return { lines: [err('parrot-upgrade: this script must be run as root (try sudo)')], echo: 'parrot-upgrade', failed: true, reason: 'not-root' };
  const plan = upgradePlan(g);
  return {
    lines: [slow('Parrot Upgrade (simulated): refreshing package lists', 200), ...aptUpdate(g), slow('Parrot Upgrade: upgrading the system', 300), ...plan.lines, ...(plan.needed ? upgradeRun(g) : [])],
    echo: 'parrot-upgrade',
  };
}

// sudo <command>: the command runs as root; its own echo follows sudo's.
function sudo(args, g) {
  if (!g.image.apt) return { lines: [err('-ash: sudo: not found')], failed: true };
  if (!args.length) return { lines: [out('usage: sudo <command>')], echo: 'sudo' };
  g.asRoot = true;
  try {
    const inner = runOne(g, args.join(' '));
    // The inner command's result (run as root) is sudo's; runOne gives it sudo's echo.
    return { lines: inner.lines, echo: inner.echo === null ? null : `sudo ${inner.echo}`, failed: inner.failed, clear: inner.clear, ...(inner.changed ? { changed: true } : {}), ...(inner.results && inner.results.length ? { result: inner.results[0] } : {}) };
  } finally {
    g.asRoot = false;
  }
}

const BASH = Object.freeze({
  sudo: (args, g) => sudo(args, g),
  apt: (args, g) => apt(args, g, 'apt'),
  'apt-get': (args, g) => apt(args, g, 'apt-get'),
  'parrot-upgrade': (args, g) => parrotUpgrade(args, g),
  // Easter eggs, kept out of help (eggs.txt lists them).
  sl: (args, g) => (g.image.apt ? sl(g) : { lines: [err('-ash: sl: not found')], failed: true }),
  vim: (args, g) => (g.image.apt ? vim(g) : { lines: [err('-ash: vim: not found')], failed: true }),
  vi: (args, g) => (g.image.apt ? vim(g) : { lines: [err('-ash: vi: not found')], failed: true }),
  help: (args, g) => helpCommand(g, args),
  ls: (args, g) => list(g, args),
  cd: (args, g) => changeDir(g, args),
  pwd: (args, g) => pwd(g),
  mkdir: (args, g) => mkdir(g, args),
  ping: (args, g) => paced('ping', ping(g, args)),
  // curl -o <file> / -O saves the page instead of printing it.
  curl: (args, g) => paced('curl', args.some((arg) => ['-o', '-O', '--output', '--remote-name'].includes(arg)) ? curlSave(g, args) : curl(g, args)),
  ssh: (args, g) => paced('ssh', ssh(g, args)),
  nslookup: (args, g) => nslookup(g, args),
  // nmap: on ParrotOS out of the box; elsewhere only after it is installed, with the
  // shell's own "not found" (and Ubuntu's install hint) until then.
  nmap: (args, g) => {
    if ((g.image.apt && g.image.apt.parrot) || (g.installed && g.installed.nmap)) return paced('nmap', nmap(g, args));
    if (g.image.apt) return { lines: [err("Command 'nmap' not found, but can be installed with:"), err(' '), err('sudo apt install nmap'), err(' ')], echo: 'nmap', failed: true };
    return { lines: [err(g.image.shell === 'ash' ? '-ash: nmap: not found' : '-sh: nmap: not found')], failed: true };
  },
  cat: (args, g) => read(g, args),
  grep: (args, g) => grep(g, args),
  tail: (args, g) => tail(g, args),
  cp: (args, g) => cp(g, args),
  sed: (args, g) => sed(g, args),
  // ufw ships with Ubuntu (desktop and server); elsewhere the shell does not know it.
  ufw: (args, g) => (hasUfw(g) ? ufw(g, args) : { lines: [err(g.image.shell === 'ash' ? '-ash: ufw: not found' : 'bash: ufw: command not found')], failed: true }),
  whoami: (args, g) => ({ lines: [out(isRoot(g) ? 'root' : g.vm.user)] }),
  id: (args, g) => ({ lines: [out(g.vm.user === 'root' ? 'uid=0(root) gid=0(root) groups=0(root)' : `uid=1000(${g.vm.user}) gid=1000(${g.vm.user}) groups=1000(${g.vm.user})`)] }),
  hostname: (args, g) => ({ lines: [out(g.vm.id)] }),
  uname: (args, g) => ({
    lines: [out(args[0] === '-a' ? (g.image.uname ? fill(g.image.uname, g.vm) : `Linux ${g.vm.id} 6.8.0-lab (simulated) x86_64 GNU/Linux`) : 'Linux')],
    echo: args[0] === '-a' ? 'uname -a' : 'uname',
  }),
  // ip, ifconfig (features/netconfig.js): the lab address in each system's own format.
  ip: (args, g) => ipCommand(g, args),
  ifconfig: (args, g) => ifconfig(g, args),
  clear: () => ({ lines: [], clear: true }),
  exit: () => ({ lines: [out("this is the VM's console. '_' minimizes it; 'vm stop' in tty1 powers it off.")] }),
});

// ---------- Winbows servicing: sfc and DISM (owner request, October 10, 2026) ----------
// The two repair tools, with their own output and progress, on every Winbows image (both
// consoles run as administrator). Nothing is scanned: the result is authored, and the
// lab's Winbows images are healthy until a mission says otherwise (later missions reuse
// these). Progress lines carry replace: true, so the console redraws one line in place
// as the real tools do. Switches are matched as fixed words, case ignored. Blank lines
// are a space, so the console keeps their height.
// sfc's "Verification n% complete." steps and DISM's progress bar steps (DISM sits at
// 62.3% for a while, as it does).
const SFC_STEPS = Object.freeze([1, 4, 9, 15, 22, 31, 38, 46, 55, 63, 71, 80, 88, 94, 100]);
const DISM_STEPS = Object.freeze([2.1, 5.9, 11.3, 18.7, 26.4, 33.0, 41.8, 52.6, 62.3, 71.5, 84.9, 92.7, 100.0]);
const DISM_LOG = 'The DISM log file can be found at C:\\Winbows\\Logs\\DISM\\dism.log';

// One progress line, redrawing the line before it after the pause (ms).
const progress = (text, ms) => ({ kind: 'out', text, ms, replace: true });
// DISM's bar: 58 places, '=' as far as it has got, the percentage in the middle.
function dismBar(pct) {
  const label = `${pct.toFixed(1)}%`;
  const fill = '='.repeat(Math.round((pct / 100) * 58)).padEnd(58, ' ');
  const at = 29 - Math.ceil(label.length / 2);
  return `[${fill.slice(0, at)}${label}${fill.slice(at + label.length)}]`;
}

function sfc(args, g) {
  const sw = args.map((arg) => arg.toLowerCase());
  const scan = sw.length === 1 && (sw[0] === '/scannow' || sw[0] === '/verifyonly') ? sw[0] : null;
  const asked = sw.length === 1 && (sw[0] === '/?' || sw[0] === '-?');
  if (!scan) {
    // No switch, or one sfc does not know: its usage, as the real tool prints it.
    return {
      lines: [
        out(' '), out('Winbows Resource Checker (simulated)'), out(' '),
        out('Scans the integrity of all protected system files and replaces incorrect versions'), out('with correct versions.'), out(' '),
        out('SFC [/SCANNOW] [/VERIFYONLY]'), out(' '),
        out('/SCANNOW        Scans integrity of all protected system files and repairs files'), out('                with problems when possible.'),
        out('/VERIFYONLY     Scans integrity of all protected system files. No repair operation'), out('                is performed.'),
      ],
      echo: asked ? `sfc ${sw[0]}` : sw.length ? null : 'sfc',
      failed: sw.length > 0 && !asked,
    };
  }
  return {
    lines: [
      slow(' ', 200),
      slow('Beginning system scan.  This process will take some time.', 700),
      slow(' ', 400),
      slow('Beginning verification phase of system scan.', 1200),
      slow(`Verification ${SFC_STEPS[0]}% complete.`, 900),
      ...SFC_STEPS.slice(1).map((n, i) => progress(`Verification ${n}% complete.`, 350 + ((i * 137) % 400))),
      slow(' ', 500),
      slow('Winbows Resource Protection did not find any integrity violations.', 120),
    ],
    echo: `sfc ${scan}`,
  };
}

// DISM's help, in its own layout (paraphrased; only what this lab's DISM does).
const DISM_HELP = Object.freeze([
  'DISM.exe {/Image:<path_to_image> | /Online} [dism_options]',
  ' {servicing_command} [<servicing_arguments>]',
  ' ',
  'DESCRIPTION:',
  ' ',
  '  DISM services Winbows images: it checks, repairs and cleans up the component',
  '  store that Winbows repairs itself from. Which commands apply depends on the',
  '  image; this lab machine services its running system (/Online).',
  ' ',
  'IMAGE SPECIFICATIONS:',
  ' ',
  '  /Online                 - Targets the running operating system.',
  ' ',
  'SERVICING COMMANDS:',
  ' ',
  '  /Cleanup-Image          - Performs cleanup and recovery operations on the image.',
  '      /CheckHealth            - Reports whether the image is flagged as corrupted.',
  '      /ScanHealth             - Scans the component store for corruption.',
  '      /RestoreHealth          - Scans for corruption and repairs it.',
  '      /AnalyzeComponentStore  - Reports the component store size and cleanup advice.',
  '      /StartComponentCleanup  - Removes superseded versions of components.',
  ' ',
  'EXAMPLES:',
  ' ',
  '    DISM.exe /Online /Cleanup-Image /RestoreHealth',
  '    DISM.exe /Online /Cleanup-Image /ScanHealth',
  ' ',
  'For more on a command, put /? right after it. For example:',
  '    DISM.exe /Online /Cleanup-Image /?',
]);
const CLEANUP_HELP = Object.freeze([
  '/Cleanup-Image /CheckHealth | /ScanHealth | /RestoreHealth |',
  '               /AnalyzeComponentStore | /StartComponentCleanup',
  ' ',
  '  /CheckHealth            Reports whether the image has been flagged as corrupted',
  '                          (quick: it only reads what earlier scans recorded).',
  '  /ScanHealth             Scans the component store for corruption.',
  '  /RestoreHealth          Scans for corruption and repairs it.',
  '  /AnalyzeComponentStore  Reports the size of the component store (WinSxS) and',
  '                          whether a cleanup is recommended.',
  '  /StartComponentCleanup  Removes superseded versions of components.',
  ' ',
  '  Example:',
  '    DISM.exe /Online /Cleanup-Image /RestoreHealth',
]);
const DISM_ACTIONS = Object.freeze(['/checkhealth', '/scanhealth', '/restorehealth', '/analyzecomponentstore', '/startcomponentcleanup']);

// The component store report; a cleanup this session reclaims what was recommended.
function componentStore(g) {
  const clean = Boolean(g.winsxsClean);
  return [
    out(' '), out('Component Store (WinSxS) information:'), out(' '),
    out(`Winbows Explorer Reported Size of Component Store : ${clean ? '6.18' : '7.42'} GB`),
    out(' '),
    out(`Actual Size of Component Store : ${clean ? '5.96' : '7.18'} GB`),
    out(' '),
    out('    Shared with Winbows : 5.61 GB'),
    out(`    Backups and Disabled Features : ${clean ? '0.12' : '1.32'} GB`),
    out(`    Cache and Temporary Data : ${clean ? '0 bytes' : '245.07 MB'}`),
    out(' '),
    out(`Date of Last Cleanup : ${clean ? '2026-10-12 (this session)' : '2026-09-28 11:52:31'}`),
    out(' '),
    out(`Number of Reclaimable Packages : ${clean ? 0 : 3}`),
    out(`Component Store Cleanup Recommended : ${clean ? 'No' : 'Yes'}`),
  ];
}

function dism(args, g) {
  const sw = args.map((arg) => arg.toLowerCase());
  const versions = g.image.servicing || { dism: '10.0', image: '10.0' };
  const head = [out(' '), out('Deployment Image Servicing and Management tool'), out(`Version: ${versions.dism}`), out(' ')];
  const asked = sw.length > 0 && (sw[sw.length - 1] === '/?' || sw[sw.length - 1] === '-?');
  if (asked) {
    // /? alone: DISM's help; after /Cleanup-Image (with or without /Online): its options.
    const rest = sw.slice(0, -1);
    if (rest.length === 0 || (rest.length === 1 && rest[0] === '/online')) return { lines: [...head, ...DISM_HELP.map(out)], echo: `dism${rest.length ? ' /online' : ''} /?` };
    if (rest.includes('/cleanup-image') && rest.every((word) => word === '/online' || word === '/cleanup-image')) {
      return { lines: [...head, ...CLEANUP_HELP.map(out)], echo: `dism ${rest.join(' ')} /?` };
    }
  }
  const action = sw.length === 3 && sw.includes('/online') && sw.includes('/cleanup-image')
    ? DISM_ACTIONS.find((word) => sw.includes(word)) : null;
  if (!action) {
    // Error 87 is DISM's "unknown option"; the option itself is never repeated.
    const missing = sw.includes('/cleanup-image') && sw.includes('/online') && sw.length === 2;
    return {
      lines: [...head, err(' '), err('Error: 87'), err(' '),
        err(missing ? 'The cleanup-image option needs one of /CheckHealth, /ScanHealth, /RestoreHealth,' : sw.length ? 'An option is unknown or is missing a value.' : 'No option was given.'),
        ...(missing ? [err('/AnalyzeComponentStore or /StartComponentCleanup.')] : []),
        err('For more information, refer to the help by running DISM.exe /?.'), out(' '), out(DISM_LOG)],
      echo: sw.length ? null : 'dism',
      failed: true,
    };
  }
  const echo = `dism /online /cleanup-image ${action}`;
  const opening = [...head.map((entry) => ({ ...entry, ms: 150 })), slow(`Image Version: ${versions.image}`, 600), slow(' ', 300)];
  if (action === '/checkhealth') {
    return { lines: [...opening, slow('No component store corruption detected.', 900), slow('The operation completed successfully.', 150)], echo };
  }
  if (action === '/analyzecomponentstore') {
    const bar = [slow(dismBar(10.0), 700), progress(dismBar(100.0), 1400)];
    return { lines: [...opening, ...bar, ...componentStore(g).map((entry) => ({ ...entry, ms: 60 })), slow(' ', 100), slow('The operation completed successfully.', 200)], echo };
  }
  const bar = [slow(dismBar(DISM_STEPS[0]), 900), ...DISM_STEPS.slice(1).map((pct, i) => progress(dismBar(pct), DISM_STEPS[i] === 62.3 ? 3200 : 500 + ((i * 211) % 600)))];
  const last = bar.length - 1;
  const done = action === '/restorehealth' ? 'The restore operation completed successfully.'
    : action === '/startcomponentcleanup' ? '' : 'No component store corruption detected.';
  if (done) bar[last] = { ...bar[last], text: `${bar[last].text} ${done}` };
  if (action === '/startcomponentcleanup') g.winsxsClean = true;
  return { lines: [...opening, ...bar, slow('The operation completed successfully.', 300)], echo };
}

// ---------- Winbows processes: tasklist, taskkill, Get-Process, Stop-Process ----------
// (owner request, October 10, 2026: the blue screen easter egg.) A fixed process table;
// names and ids typed are only compared with it, and an unknown one is never repeated.
// Force-ending a process Winbows cannot run without (csrss, wininit, smss, services,
// lsass, winlogon, every svchost) prints what the real tools print, then returns
// event: 'crash', and the desktop shows the blue screen and restarts the VM
// (ui/guest-desktop.js, layers/layer2.js). Ending powershell.exe closes the console window
// (event: 'close-console'). Nothing real is touched.
// [name, PID, session name, session #, memory (K), CPU seconds, kind]
// kind: 'critical' (blue screen), 'idle' / 'system' (refused), 'protected' (Defender),
// 'console' (this PowerShell), null (ends normally).
const PROCESSES = Object.freeze([
  ['System Idle Process', 0, 'Services', 0, 8, 0, 'idle'],
  ['System', 4, 'Services', 0, 1284, 412.3, 'system'],
  ['Registry', 120, 'Services', 0, 51220, 2.1, 'system'],
  ['smss.exe', 412, 'Services', 0, 1188, 0.1, 'critical'],
  ['csrss.exe', 612, 'Services', 0, 5876, 1.9, 'critical'],
  ['wininit.exe', 688, 'Services', 0, 6932, 0.2, 'critical'],
  ['csrss.exe', 704, 'Console', 1, 6120, 6.4, 'critical'],
  ['services.exe', 772, 'Services', 0, 10456, 9.8, 'critical'],
  ['lsass.exe', 788, 'Services', 0, 22104, 7.2, 'critical'],
  ['winlogon.exe', 852, 'Console', 1, 11380, 0.5, 'critical'],
  ['svchost.exe', 936, 'Services', 0, 31228, 14.6, 'critical'],
  ['svchost.exe', 1012, 'Services', 0, 17544, 4.3, 'critical'],
  ['svchost.exe', 1148, 'Services', 0, 9876, 1.2, 'critical'],
  ['dwm.exe', 1236, 'Console', 1, 86412, 38.7, null],
  ['MsMpEng.exe', 2964, 'Services', 0, 214560, 96.0, 'protected'],
  ['explorer.exe', 4120, 'Console', 1, 142336, 22.9, null],
  ['SearchHost.exe', 5208, 'Console', 1, 98764, 3.6, null],
  ['powershell.exe', 6544, 'Console', 1, 78212, 1.4, 'console'],
  ['conhost.exe', 6552, 'Console', 1, 14872, 0.3, null],
].map((row) => Object.freeze(row)));
const pname = (row) => row[0];
const ppid = (row) => row[1];
const kb = (n) => `${n.toLocaleString('en-US')} K`;

function tasklist() {
  return [
    out(' '),
    out('Image Name                     PID Session Name        Session#    Mem Usage'),
    out('========================= ======== ================ =========== ============'),
    ...PROCESSES.map((row) => out(`${row[0].padEnd(25)} ${String(row[1]).padStart(8)} ${row[2].padEnd(16)} ${String(row[3]).padStart(11)} ${kb(row[4]).padStart(12)}`)),
  ];
}

function getProcess() {
  // Get-Process sorts by name; the idle process is "Idle" there.
  const rows = [...PROCESSES].sort((a, b) => pname(a).toLowerCase().localeCompare(pname(b).toLowerCase()));
  return [
    out(' '),
    out('Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  SI ProcessName'),
    out('-------  ------    -----      -----     ------     --  -- -----------'),
    ...rows.map((row) => {
      const name = row[0] === 'System Idle Process' ? 'Idle' : row[0].replace(/\.exe$/, '');
      const ws = row[4];
      return out(`${String(Math.round(ws / 40) + 80).padStart(7)} ${String(Math.round(ws / 900) + 4).padStart(7)} ${String(Math.round(ws * 0.6)).padStart(8)} ${String(ws).padStart(10)} ${row[5].toFixed(2).padStart(10)} ${String(row[1]).padStart(6)} ${String(row[3]).padStart(3)} ${name}`);
    }),
    out(' '),
  ];
}

// Ends the matching rows the way taskkill does. force: /F.
function endProcesses(rows, force) {
  const lines = [];
  let event = null;
  for (const row of rows) {
    const [name, pid, , , , , kind] = row;
    if (kind === 'idle') {
      lines.push(err(`ERROR: The process with PID ${pid} could not be terminated.`), err('Reason: This is critical system process. Taskkill cannot end this process.'));
    } else if (kind === 'system' || kind === 'protected') {
      lines.push(err(`ERROR: The process "${name}" with PID ${pid} could not be terminated.`), err('Reason: Access is denied.'));
    } else if (!force && kind !== null) {
      lines.push(err(`ERROR: The process "${name}" with PID ${pid} could not be terminated.`), err('Reason: This process can only be terminated forcefully (with /F option).'));
    } else if (!force) {
      lines.push(out(`SUCCESS: Sent termination signal to the process "${name}" with PID ${pid}.`));
    } else {
      lines.push(out(`SUCCESS: The process "${name}" with PID ${pid} has been terminated.`));
      if (kind === 'critical') event = 'crash';
      else if (kind === 'console' && event !== 'crash') event = 'close-console';
    }
  }
  return { lines, event };
}

// Task Manager (ui/guest-desktop.js) shows the same table and ends tasks by PID through
// the same rules: refused for System and Defender, a blue screen for critical ones.
export const taskList = () => PROCESSES.map(([name, pid, , , mem, cpu, kind]) => ({ name, pid, mem, cpu, critical: kind === 'critical' }));
export function endTask(pid) {
  const row = PROCESSES.find((entry) => entry[1] === pid);
  if (!row) return { ok: false, event: null };
  const ended = endProcesses([row], true);
  return { ok: !ended.lines.some((line) => line.kind === 'err'), event: ended.event };
}

// taskkill [/F] /IM <name> | /PID <id> [/T], switches in any order, case ignored.
function taskkill(args) {
  const sw = args.map((arg) => arg.toLowerCase());
  const force = sw.includes('/f');
  const rest = sw.filter((arg) => arg !== '/f' && arg !== '/t');
  if (rest.length !== 2 || (rest[0] !== '/im' && rest[0] !== '/pid')) {
    return { lines: [err('ERROR: Invalid syntax. Neither /FI nor /PID nor /IM were specified.'), err('Type "TASKKILL /?" for usage.')], echo: args.length ? null : 'taskkill', failed: true };
  }
  const byName = rest[0] === '/im';
  const rows = PROCESSES.filter((row) => (byName ? pname(row).toLowerCase() === rest[1] : String(ppid(row)) === rest[1]));
  if (!rows.length) return { lines: [err(byName ? 'ERROR: The process was not found.' : 'ERROR: The process with that PID was not found.')], echo: null, failed: true };
  const target = byName ? pname(rows[0]).toLowerCase() : String(ppid(rows[0]));
  const ended = endProcesses(rows, force);
  return { lines: ended.lines, echo: `taskkill ${force ? '/f ' : ''}${byName ? '/im' : '/pid'} ${target}`, event: ended.event };
}

// Stop-Process -Name <name> | -Id <id> [-Force]: silent when it works, as in PowerShell.
// name: the alias it was typed as (kill, spps), shown back as typed.
function stopProcess(args, name = 'stop-process') {
  const sw = args.map((arg) => arg.toLowerCase());
  const force = sw.includes('-force');
  const rest = sw.filter((arg) => arg !== '-force');
  const byName = rest.length === 2 && (rest[0] === '-name' || rest[0] === '-processname');
  const byId = rest.length === 2 && rest[0] === '-id';
  if (!byName && !byId) {
    return { lines: [err('Stop-Process : Cannot bind the arguments. Use -Name <name> or -Id <id>.')], echo: args.length ? null : name, failed: true };
  }
  const rows = PROCESSES.filter((row) => (byName ? pname(row).toLowerCase().replace(/\.exe$/, '') === rest[1] : String(ppid(row)) === rest[1]));
  if (!rows.length) {
    return { lines: [err(`Stop-Process : Cannot find a process with ${byName ? 'that name' : 'that identifier'}. Verify the process ${byName ? 'name' : 'identifier'} and call the cmdlet again.`)], echo: null, failed: true };
  }
  const ended = endProcesses(rows, true);
  const refused = ended.lines.filter((line) => line.kind === 'err').length > 0;
  const echo = `${name} ${byName ? `-name ${pname(rows[0]).toLowerCase().replace(/\.exe$/, '')}` : `-id ${ppid(rows[0])}`}${force ? ' -force' : ''}`;
  if (refused) return { lines: [err(`Stop-Process : Cannot stop process "${pname(rows[0]).replace(/\.exe$/, '')} (${ppid(rows[0])})" because of the following error: Access is denied`)], echo, failed: true, reason: 'permission' };
  return { lines: [], echo, event: ended.event };
}

// The parse error Winbows PowerShell 5.1 gives for &&, which only PowerShell 7 knows.
// The column is a number; the typed line itself is not repeated.
function ampersandError(raw) {
  return [
    err(`At line:1 char:${raw.indexOf('&&') + 1}`),
    err("The token '&&' is not a valid statement separator in this version."),
    err('    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException'),
    err('    + FullyQualifiedErrorId : InvalidEndOfLine'),
  ];
}

// PowerShell's aliases and cmdlet names for the same commands.
const POWERSHELL_ALIASES = Object.freeze({ ls: 'dir', gci: 'dir', 'get-childitem': 'dir', 'set-location': 'cd', sl: 'cd', 'get-location': 'pwd', gl: 'pwd', cat: 'type', gc: 'type', 'get-content': 'type', clear: 'cls', 'clear-host': 'cls', 'get-help': 'help', ps: 'get-process', gps: 'get-process', kill: 'stop-process', spps: 'stop-process' });

// `help` lists; `help <command>` explains one. Unknown names are never repeated.
function helpCommand(guest, args) {
  if (!args.length) return { lines: helpList(guest), echo: 'help' };
  const name = args[0].toLowerCase();
  const text = args.length === 1 ? helpFor(guest, name) : null;
  if (!text) return { lines: [err(guest.winbows ? 'Get-Help: no help topic matches that name.' : 'help: no help topics match that name.')] };
  return { lines: text, echo: `help ${guest.winbows ? POWERSHELL_ALIASES[name] || name : name}` };
}

const POWERSHELL = (() => {
  const commands = {
    help: (args, g) => helpCommand(g, args),
    dir: (args, g) => list(g, args),
    cd: (args, g) => changeDir(g, args),
    pwd: (args, g) => pwd(g),
    mkdir: (args, g) => mkdir(g, args),
    md: (args, g) => mkdir(g, args),
    ping: (args, g) => paced('ping', ping(g, args)),
    curl: (args, g) => paced('curl', curl(g, args)),
    ssh: (args, g) => paced('ssh', ssh(g, args)),
    type: (args, g) => read(g, args),
    // A domain machine answers with its domain (corp\administrator), others with the host.
    whoami: (args, g) => ({ lines: [out(`${(g.vm.netbios || g.vm.id).toLowerCase()}\\${g.vm.user.toLowerCase()}`)] }),
    hostname: (args, g) => ({ lines: [out(g.vm.id.toUpperCase())] }),
    ipconfig: (args, g) => ipconfig(g, args),
    cls: () => ({ lines: [], clear: true }),
    sfc: (args, g) => sfc(args, g),
    dism: (args, g) => dism(args, g),
    tasklist: (args) => (args.length ? { lines: [err('ERROR: Invalid argument/option.'), err('Type "TASKLIST /?" for usage.')], echo: null, failed: true } : { lines: tasklist() }),
    taskkill: (args) => taskkill(args),
    'get-process': (args) => (args.length ? { lines: [err('Get-Process : Cannot find a process with that name.')], echo: null, failed: true } : { lines: getProcess() }),
    'stop-process': (args) => stopProcess(args),
    exit: BASH.exit,
  };
  // PowerShell's aliases and cmdlet names for the same commands.
  for (const [name, target] of Object.entries(POWERSHELL_ALIASES)) commands[name] = target === 'stop-process' ? (args) => stopProcess(args, name) : commands[target];
  return Object.freeze(commands);
})();

// Runs one typed line. Returns { lines, echo, clear }: echo is the canonical command to
// show and keep (null = the line is shown as not kept), clear empties the screen.
// Tab completion for a VM's shell (owner bug report, October 12, 2026: Tab did nothing and
// took the focus out of the terminal). Completes the last word of the line: the first word
// against the commands this machine knows, any later word against the names in its file
// tree (folders end in the path separator, as bash and PowerShell show them). Returns
// { value } when the line can grow (one match, or the longest common start of several),
// { options } when it cannot (the matching names, for a second Tab to list), or null.
// Read-only: it never runs anything, and offers only the machine's own names.
const COMPLETE_LIMIT = 60;
export function completeGuest(guest, raw) {
  if (typeof raw !== 'string' || raw.length > 256 || /["'`]/.test(raw)) return null;
  if (guest.vim || guest.confirm || (guest.image.shell === 'login' && !signedIn(guest))) return null;
  const fold = (text) => (guest.winbows ? text.toLowerCase() : text);
  const cut = raw.lastIndexOf(' ');
  const head = raw.slice(0, cut + 1);
  const word = raw.slice(cut + 1);
  let names;
  let prefix = '';
  let partial = word;
  if (!head.trim()) {
    // The first word: commands (and mission commands) this machine knows.
    const table = guest.winbows ? POWERSHELL : BASH;
    const helps = guest.winbows ? POWERSHELL_HELP : LINUX_HELP;
    names = Object.keys(table)
      .filter((name) => !Object.hasOwn(helps, name) || hasHelp(guest, helps[name]) || (guest.installed && guest.installed[name]))
      .concat(missionCommands().filter((spec) => spec.forms.some((form) => (form.seats || []).includes(guest.vm.id))).map((spec) => spec.name))
      .map((name) => ({ name, dir: false }));
  } else {
    // A later word: a path. Everything up to the last separator picks the folder.
    const at = Math.max(word.lastIndexOf('/'), guest.winbows ? word.lastIndexOf('\\') : -1);
    prefix = word.slice(0, at + 1);
    partial = word.slice(at + 1);
    const dir = prefix ? resolve(guest, prefix) : guest.tree.get(guest.key(guest.cwd));
    if (!dir || !dir.dir) return null;
    names = children(guest, dir).map((node) => ({ name: nameOf(node), dir: Boolean(node.dir) }));
  }
  const matches = [...new Map(names.filter((entry) => fold(entry.name).startsWith(fold(partial))).map((entry) => [entry.name, entry])).values()];
  if (!matches.length) return null;
  const sep = guest.winbows ? '\\' : '/';
  if (matches.length === 1) {
    const [only] = matches;
    return { value: `${head}${prefix}${only.name}${only.dir ? sep : ' '}` };
  }
  // Several: grow to their longest common start, or offer the list.
  let common = matches[0].name;
  for (const entry of matches.slice(1)) {
    let n = 0;
    while (n < common.length && n < entry.name.length && fold(common[n]) === fold(entry.name[n])) n += 1;
    common = common.slice(0, n);
  }
  if (common.length > partial.length) return { value: `${head}${prefix}${common}` };
  return { options: matches.slice(0, COMPLETE_LIMIT).map((entry) => `${entry.name}${entry.dir ? sep : ''}`).sort((a, b) => a.localeCompare(b)) };
}

export function runGuest(guest, raw) {
  if (guest.image.shell === 'login' && !signedIn(guest)) return loginAttempt(guest, raw);
  if (guest.vim) return vimInput(guest, raw);
  // exit on a signed-in device logs out, back to its login prompt.
  if (signedIn(guest) && typeof raw === 'string' && raw.trim() === 'exit') {
    guest.login = 'user';
    return { lines: [], echo: 'exit', clear: false };
  }
  // apt's "Do you want to continue? [Y/n]": Enter or y goes ahead, anything else aborts.
  if (guest.confirm) {
    const answer = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    guest.confirm = null;
    if (answer === '' || answer === 'y' || answer === 'yes') return { lines: upgradeRun(guest), echo: answer || '', clear: false };
    return { lines: [out('Abort.')], echo: ['n', 'no'].includes(answer) ? answer : null, clear: false };
  }
  // Winbows PowerShell 5.1: && is a parse error (nothing runs); ; runs each command in
  // turn whether or not the one before it worked.
  if (typeof raw === 'string' && guest.winbows && raw.includes('&&')) {
    return { lines: ampersandError(raw), echo: null, clear: false };
  }
  if (typeof raw === 'string' && guest.winbows && raw.includes(';')) {
    const parts = raw.split(';').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 4) return { lines: [err('Too many commands on one line.')], echo: null, clear: false };
    const lines = [];
    const echoes = [];
    const results = [];
    let event = null;
    for (const part of parts) {
      const result = runOne(guest, part);
      lines.push(...result.lines);
      echoes.push(result.echo);
      results.push(...(result.results || []));
      // A blue screen ends the line there; nothing after it runs.
      if (result.event === 'crash') {
        event = 'crash';
        break;
      }
      if (result.event) event = result.event;
    }
    const echo = echoes.length && echoes.every((value) => typeof value === 'string' && value) ? echoes.join('; ') : null;
    return { lines, echo, clear: false, results, ...(event ? { event } : {}) };
  }
  // cmd1 && cmd2: each runs only if the one before it worked, as in bash.
  if (typeof raw === 'string' && raw.includes('&&') && !guest.winbows) {
    const parts = raw.split('&&').map((part) => part.trim());
    if (parts.length > 4 || parts.some((part) => !part)) {
      return { lines: [err("bash: syntax error near unexpected token `&&'")], echo: null, clear: false };
    }
    const lines = [];
    const echoes = [];
    const results = [];
    for (const part of parts) {
      const result = runOne(guest, part);
      lines.push(...result.lines);
      echoes.push(result.echo);
      results.push(...(result.results || []));
      // A question (apt without -y) stops the chain until it is answered.
      if (result.failed || guest.confirm) break;
    }
    const echo = echoes.every((value) => typeof value === 'string' && value) ? echoes.join(' && ') : null;
    return { lines, echo, clear: false, results };
  }
  return runOne(guest, raw);
}

// One command (no && chain). failed: true when the command did not work. results: the
// mission result of each command that ran (one here; a chain collects them), none when
// nothing ran (an unknown command, --help, a line that could not be read).
// Winbows tools with their own /? text (the real usage), instead of the lab's help entry.
const OWN_HELP = Object.freeze(['dism', 'sfc', 'ipconfig']);
function runOne(guest, raw) {
  // `?` on its own lists the commands, as help does.
  if (typeof raw === 'string' && raw.trim() === '?') return { lines: helpList(guest), echo: '?', clear: false };
  // Winbows runs DISM.exe, sfc.exe and the like by their file name too (owner report,
  // October 12, 2026: DISM's own error says to run DISM.exe /?). Only a trailing .exe on
  // the command word is dropped; the rest of the line is parsed as before.
  if (guest.winbows && typeof raw === 'string') raw = raw.replace(/^(\s*[A-Za-z][A-Za-z0-9-]{0,31})\.exe(?=\s|$)/i, '$1');
  const parsed = parseCommand(raw);
  if (!parsed.ok) {
    if (parsed.reason === 'empty') return { lines: [], echo: '', clear: false };
    return { lines: [err(guest.winbows ? 'The input could not be read.' : 'bash: the input could not be read')], echo: null, clear: false, failed: true };
  }
  const { name, args } = parsed.value;
  const table = guest.winbows ? POWERSHELL : BASH;
  const notFound = guest.image.shell === 'ash' ? '-ash: not found' : signedIn(guest) ? '-sh: not found' : 'bash: command not found';
  // A mission's own command (lab-restore), on the seats its forms name.
  const special = !Object.hasOwn(table, name) ? missionCommand(guest, name) : null;
  if (special) {
    const handled = special(args, guest);
    const failed = Boolean(handled.failed);
    return { lines: handled.lines, echo: handled.echo, clear: false, failed, results: [resultOf(guest, handled.echo, failed, handled)] };
  }
  if (!Object.hasOwn(table, name)) {
    return {
      lines: [err(guest.winbows ? 'The term is not recognized as a cmdlet, function, script file, or executable program.' : notFound)],
      echo: null,
      clear: false,
      failed: true,
    };
  }
  // `<command> ?` (and --help, -?, /?): that command's help, not the command.
  const flags = guest.winbows ? POWERSHELL_HELP_FLAGS : LINUX_HELP_FLAGS;
  if (args.length === 1 && flags.includes(args[0]) && !(guest.winbows && OWN_HELP.includes(name))) {
    const text = helpFor(guest, name);
    if (text) return { lines: text, echo: `${name} ${args[0]}`, clear: false };
  }
  const result = table[name](args, guest);
  const echo = result.echo !== undefined ? result.echo : args.length ? null : name;
  const failed = Boolean(result.failed) || result.lines.some((line) => line.kind === 'err');
  return { lines: result.lines, echo, clear: Boolean(result.clear), failed, ...(result.event ? { event: result.event } : {}), ...(result.changed ? { changed: true } : {}), results: [resultOf(guest, echo, failed, result)] };
}

// ---------- Mission commands (a mission's content.commands; owner-written data) ----------
// lab-restore (Red 2): a fictional maintenance tool on the lab network. Each form is fixed
// words (args), the seats it runs on, and its authored output by state; apply also needs
// web01's fixtures in a given state and changes one (effect). Nothing is parsed beyond
// comparing the words; output is the mission's own text, rendered as text.
function missionCommand(guest, name) {
  const spec = missionCommands().find((entry) => entry.name === name);
  if (!spec || !spec.forms.some((form) => (form.seats || []).includes(guest.vm.id))) return null;
  return (args, g) => runMissionCommand(spec, args, g);
}
function runMissionCommand(spec, args, g) {
  const say = (key) => (Array.isArray(spec.output && spec.output[key]) ? spec.output[key] : []).map(out);
  const sayErr = (key) => say(key).map((line) => err(line.text));
  if (args.length === 1 && LINUX_HELP_FLAGS.includes(args[0])) return { lines: say('help'), echo: `${spec.name} ${args[0]}` };
  const form = spec.forms.find((entry) => entry.args.length === args.length && entry.args.every((word, i) => word === args[i]));
  if (!form) return { lines: sayErr('invalid'), echo: null, failed: true, reason: 'invalid', target: spec.target };
  const echo = `${spec.name} ${form.args.join(' ')}`;
  const base = { echo, target: spec.target };
  if (!(form.seats || []).includes(g.vm.id)) return { ...base, lines: sayErr('wrongSeat'), failed: true, reason: 'seat' };
  if (typeof g.running === 'function' && !g.running(spec.target)) return { ...base, lines: sayErr('unavailable'), failed: true, reason: 'unreachable' };
  // The target's firewall drops this seat (ufw deny): the connection times out, and the
  // maintenance service never sees it.
  if (blocked(spec.target, g.vm.id, scenarioOf(g))) {
    const host = (VMS.find((vm) => vm.id === spec.target) || {}).host || spec.target;
    return { ...base, lines: [err(`${spec.name}: connect to ${host} port 443: Connection timed out`)], failed: true, reason: 'filtered' };
  }
  const state = stateOf(spec.target, scenarioOf(g));
  if (!form.mutates) {
    const key = form.outputsByState && Object.hasOwn(form.outputsByState, state.status) ? form.outputsByState[state.status] : 'preview';
    return { ...base, lines: say(key) };
  }
  const needs = form.requires || {};
  if (Object.hasOwn(needs, 'publicRestore') && state.publicRestore !== needs.publicRestore) return { ...base, lines: sayErr('disabled'), failed: true, reason: 'permission' };
  if (Object.hasOwn(needs, 'status') && state.status !== needs.status) return { ...base, lines: sayErr('alreadyApplied'), failed: true };
  const effect = form.effect || {};
  return {
    ...base,
    lines: say(form.output || 'applied'),
    // The maintenance service on web01 saw it (its log line), and the fixture changes.
    contact: { service: 'lab-maintenance', action: 'public-restore' },
    effect: { vm: spec.target, fixture: effect.fixture, value: effect.value },
  };
}

// The mission result for one command that ran (features/mission-engine.js's contract):
// where it ran, what it acted on, who ran it, how it went, and the evidence it left.
// Handlers may say target, reason and contact (the lab network's commands do) or hand
// over a whole result (sudo, for the command it ran as root). A refusal (not root, no
// permission, a login denied) is 'denied'; any other error is 'failed'. Only canonical
// values go in: value is the echo, or null when the line is not kept.
const DENIED = Object.freeze(['not-root', 'permission', 'auth']);
const scenarioOf = (guest) => (typeof guest.scenario === 'function' ? guest.scenario() : []);
function resultOf(guest, echo, failed, handled) {
  if (handled.result) return { ...handled.result, value: echo || null };
  const seat = guest.vm.id;
  const target = typeof handled.target === 'string' ? handled.target : seat;
  const reason = typeof handled.reason === 'string' ? handled.reason : '';
  return {
    seat,
    type: 'command',
    value: echo || null,
    target,
    account: isRoot(guest) ? 'root' : guest.vm.user,
    outcome: !failed ? 'ok' : DENIED.includes(reason) ? 'denied' : 'failed',
    reason: failed ? reason : '',
    evidence: evidenceFrom({ seat, target, contact: handled.contact }, stateOf(target, scenarioOf(guest))),
    // The file a read-only command read (cat, grep, tail, cp's source: its tree key), and
    // the lab VM a name lookup answered with (nslookup), for missions that ask for them.
    ...(typeof handled.read === 'string' && !failed ? { read: handled.read } : {}),
    ...(typeof handled.lookup === 'string' && !failed ? { lookup: handled.lookup } : {}),
    // A change the command makes to the scenario (lab-restore apply); layers/layer2.js
    // applies it after recording the evidence.
    ...(handled.effect ? { effect: handled.effect } : {}),
  };
}

// The camera's login prompt: a name, then a password, then "Login incorrect", as getty
// and login do. Nothing typed is shown, kept or compared: the visitor has no account.
// The user name is only compared with the VM's own user; the password is checked by the
// caller against its digest (verify: true), which then calls finishLogin().
function loginAttempt(guest, raw) {
  const typed = typeof raw === 'string' && raw.trim().length > 0;
  if (guest.login !== 'password') {
    if (typed) {
      guest.loginNameOk = raw.trim() === guest.vm.user;
      guest.login = 'password';
    }
    return { lines: [], echo: '', clear: false };
  }
  return { lines: [], echo: '', clear: false, verify: true };
}

// Ends a login: signed in with the banner, or "Login incorrect" and a fresh prompt.
export function finishLogin(guest, passwordOk) {
  const ok = Boolean(guest.loginNameOk && passwordOk);
  guest.loginNameOk = false;
  guest.login = ok ? 'in' : 'user';
  if (!ok) return [out(' '), err('Login incorrect')];
  return (guest.image.loginBanner || []).map((line) => out(line.text));
}

// Signs the VM's user in without typing (the camera's test auto-login). Returns the
// lines a real console shows: the prompt with the name, the password prompt, the banner.
export function autoLogin(guest) {
  guest.login = 'in';
  return [
    { kind: 'cmd', text: `${guest.vm.id} login: ${guest.vm.user}` },
    { kind: 'cmd', text: 'Password:' },
    ...(guest.image.loginBanner || []).map((line) => out(line.text)),
  ];
}

// Restores a stored working directory (untrusted): only a known directory is kept.
export function restoreCwd(guest, stored) {
  if (typeof stored !== 'string' || stored.length > 256) return;
  const node = guest.tree.get(guest.winbows ? stored.toLowerCase() : stored);
  if (node && node.dir) guest.cwd = [...node.path];
}

// The working directory as stored in the session: its tree key.
export const cwdKey = (guest) => guest.key(guest.cwd);

// A node by its path segments, or null (the desktop's Explorer and Notepad).
export const nodeAt = (guest, segments) => guest.tree.get(guest.key(segments)) || null;
