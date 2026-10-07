// Terminal command engine. Doctrine section 7: a strict dispatcher, not a shell.
//
// Input is parsed by utils/validate.js, matched against a fixed Map of handlers, and
// arguments are checked against each command's schema before a handler runs. Handlers
// return authored output lines and, at most, one fixed UI action. Nothing here touches
// the DOM, the network, storage, or browser navigation; the UI applies actions.
// Error messages never repeat what the visitor typed.

import { parseCommand, knownId, pickKnown, hasControlChars } from '../utils/validate.js';
import { COMMANDS, MODULES, PROJECTS, PAGES, PAGE_IDS, BACKGROUNDS, BACKGROUND_IDS, THEMES, THEME_IDS, EGGS, EGG_IDS } from '../data/commands.js';
import { FILES, MANUAL, CHANGELOG, NEOFETCH_LOGO, CERT_ROWS } from '../data/shell-text.js';
import { LIMITS, TERMINAL_USER, TERMINAL_HOST, SHELL_IDS } from '../core/constants.js';

const META = new Map(COMMANDS.map((command) => [command.name, command]));
// "31337" starts with a digit, so the command-name grammar cannot express it directly.
const ALIASES = Object.freeze({ '?': 'help', 31337: 'leet' });
// Easter egg: the classic bash fork bomb. Matched exactly (whitespace ignored, so the
// usual spacing variants work) and only ever mapped to the fixed "forkbomb" command;
// nothing in it is parsed or run. Canonical form is what the shell echoes and keeps.
const FORK_BOMB = ':(){:|:&};:';
const FORK_BOMB_ECHO = ':(){ :|:& };:';

// "open" targets: home modules (anchors on the home page), the home and projects pages,
// and each project page. "projects" opens the Projects hub, as in the Stages plan.
const TARGETS = new Map();
// A module that shares its name with a page ("projects", "writeups") opens the page.
for (const module of MODULES) {
  if (!Object.hasOwn(PAGES, module.id)) TARGETS.set(module.id, Object.freeze({ page: 'home', anchor: module.elementId, label: `module // ${module.id}` }));
}
for (const id of ['home', 'projects', 'writeups']) TARGETS.set(id, Object.freeze({ page: id, anchor: null, label: PAGES[id].cwd }));
for (const project of PROJECTS) TARGETS.set(project.id, Object.freeze({ page: project.page, anchor: null, label: PAGES[project.page].cwd }));

const VISIBLE = COMMANDS.filter((command) => !command.hidden);
// Every file name on any page; "cat" then checks the file is in the current directory.
const FILE_NAMES = [...new Set(Object.values(FILES).flatMap((files) => Object.keys(files)))];
const ARG_SETS = new Map([
  ['targets', [...TARGETS.keys()]], ['greeting', ['world']], ['backgrounds', BACKGROUND_IDS],
  ['themes', THEME_IDS], ['hunt', ['reset']], ['git', ['log']], ['files', FILE_NAMES],
  ['manpages', VISIBLE.map((command) => command.name)],
]);
// help's usage column fits the longest visible usage.
const HELP_WIDTH = Math.max(...VISIBLE.map((command) => command.usage.length)) + 2;
// "sudo rm -rf" is matched against fixed flags and targets only (doctrine section 7).
const RM_FLAGS = new Set(['-rf', '-fr', '-Rf', '-fR', '-rF', '-RF']);
const RM_TARGETS = new Set(['/', '/*', '*', '~', '~/', '.', '--no-preserve-root']);
// "sudo su" and friends: become root without running anything else.
const ROOT_SHELLS = new Set(['su', '-i', '-s', 'bash', 'sh']);
// neofetch: the logo column width; "fetch" lines are split here when rendered.
export const FETCH_COLUMN = NEOFETCH_LOGO[0].length;

// ---------- Simulated directory tree for cd, pwd and ls ----------
// Directories are exactly the pages' working directories ("~", "~/projects", ...).
// Paths typed by the visitor are only ever matched against this fixed map.
const DIRS = new Map(PAGE_IDS.map((id) => [PAGES[id].cwd, id]));
const PATH_ARG = /^[A-Za-z0-9~._/-]{1,128}$/;
const HOME_PATH = '/home/visitor';

function segments(path) {
  return path === '~' ? [] : path.slice(2).split('/');
}

// Resolves a cd argument against the current directory, like a real shell: "~", "/",
// absolute "~/a/b", relative "a/b", ".", "..", and trailing slashes. Returns a known
// directory or null.
export function resolvePath(cwd, arg) {
  if (arg === undefined || arg === '' || arg === '~' || arg === '/') return '~';
  if (typeof arg !== 'string' || !PATH_ARG.test(arg)) return null;
  let parts;
  let rest = arg;
  if (arg.startsWith('~/')) { parts = []; rest = arg.slice(2); }
  else if (arg.startsWith(`${HOME_PATH}/`)) { parts = []; rest = arg.slice(HOME_PATH.length + 1); }
  else if (arg === HOME_PATH) return '~';
  else if (arg.startsWith('~') || arg.startsWith('/')) return null;
  else parts = segments(cwd);
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const path = parts.length ? `~/${parts.join('/')}` : '~';
  return DIRS.has(path) ? path : null;
}

function childDirs(cwd) {
  const depth = segments(cwd).length;
  return [...DIRS.keys()].filter((path) => path !== '~' && segments(path).length === depth + 1
    && (cwd === '~' || path.startsWith(`${cwd}/`)));
}

const absolute = (cwd) => (cwd === '~' ? HOME_PATH : `${HOME_PATH}/${cwd.slice(2)}`);

const line = (kind, text) => Object.freeze({ kind, text: String(text).slice(0, LIMITS.terminalLineLength) });
const out = (text) => line('out', text);
const ok = (text) => line('ok', text);
const err = (text) => line('err', text);

const PARSE_ERRORS = Object.freeze({
  'too-long': 'input too long',
  'control-chars': 'input contains unsupported characters',
  'non-ascii-command': "command not found. Type 'help' for available commands.",
  'invalid-command': "command not found. Type 'help' for available commands.",
  'too-many-args': 'too many arguments',
  'arg-too-long': 'argument too long',
  invalid: 'invalid input',
});

function pad(text, width) {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length);
}

// "4 min", "1:07" (hours:minutes) or "2 days, 3:15", like uptime(1).
function formatUptime(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const clock = `${hours % 24}:${String(minutes % 60).padStart(2, '0')}`;
  const days = Math.floor(hours / 24);
  return days ? `${days} day${days === 1 ? '' : 's'}, ${clock}` : clock;
}

// Context values come from the UI and storage, so each is validated here (doctrine section 4).
function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-LIMITS.terminalLines)
    .filter((text) => typeof text === 'string' && text.length > 0 && text.length <= LIMITS.terminalLineLength && !hasControlChars(text));
}

function cleanFound(value) {
  if (!Array.isArray(value) || value.length > EGG_IDS.length) return [];
  return [...new Set(value.filter((id) => knownId(id, EGG_IDS).ok))];
}

const ONE_YEAR_S = 365 * 24 * 3600;
function cleanSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= ONE_YEAR_S ? Math.floor(value) : 0;
}

// sudo and su: the command that would run as root, checked by this same engine. Returns
// its validated echo, or 'unknown'. Nesting (sudo sudo, su su) is not followed.
function asRoot(args, context) {
  if (args.length === 0) return null;
  if (args[0] === 'sudo' || args[0] === 'su') return 'unknown';
  const inner = execute(args.join(' '), { ...context, root: true });
  return inner.valid ? inner.echo : 'unknown';
}

// The action for sudo/su. inner: null (a root shell), 'unknown', or a validated echo.
// The UI prompts for the password unless the visitor is root already. The stored echo
// is built from the validated echo or fixed words only; free arguments never reach it.
function elevate(via, inner, shellEcho) {
  const echo = shellEcho || (inner === 'unknown' ? `${via} (arguments not kept)` : `${via} ${inner}`);
  return { lines: [], action: Object.freeze({ type: 'sudo', via, inner }), echo };
}

// What a rejected argument says, per argument set. Never repeats the argument.
const ARG_ERRORS = Object.freeze({
  targets: "unknown target. Try 'ls', or 'open home'.",
  files: "no such file here. Try 'ls'.",
  manpages: "no manual entry for that. Try 'man man'.",
});

const HANDLERS = new Map([
  ['help', () => ({
    lines: [
      out('available commands:'),
      ...VISIBLE.map((command) => out(`  ${pad(command.usage, HELP_WIDTH)}${command.description}`)),
    ],
  })],
  ['ls', (args, context) => {
    const cwd = PAGES[context.page].cwd;
    const dirs = childDirs(cwd).map((path) => `${segments(path).pop()}/`);
    const dirLines = dirs.length ? [out(`  ${dirs.join('  ')}`)] : [];
    const files = Object.hasOwn(FILES, context.page) ? Object.keys(FILES[context.page]) : [];
    const fileLine = files.length ? [out(`files:  ${files.join('  ')}   (try 'cat ${files[0]}')`)] : [];
    if (context.page === 'home') {
      return { lines: [...dirLines, ...fileLine, out('modules:'), ...MODULES.map((module) => out(`  ${pad(module.id, 16)}${module.title}`))] };
    }
    if (context.page === 'writeups') {
      return { lines: [...fileLine, out('writeups:'), out('  (none published yet)'), out("type 'cd ..' or 'open home'")] };
    }
    // Every project detail page has the same three modules, and a README.md.
    if (PROJECTS.some((project) => project.page === context.page)) {
      return { lines: [out('  overview  notes  screenshots'), ...fileLine, out("type 'cd ..' for all projects")] };
    }
    return {
      lines: [
        ...dirLines,
        ...fileLine,
        out('projects:'),
        ...PROJECTS.map((project) => out(`  ${pad(project.id, 16)}${project.title}`)),
        out("type 'cd <name>' to open one, or 'cd ..' to go back"),
      ],
    };
  }],
  ['pwd', (args, context) => ({ lines: [out(absolute(PAGES[context.page].cwd))] })],
  ['cd', ([arg], context) => {
    const cwd = PAGES[context.page].cwd;
    let target;
    if (arg === '-') {
      if (!context.oldpwd || !DIRS.has(context.oldpwd)) return { lines: [err('cd: OLDPWD not set')], invalid: true };
      target = context.oldpwd;
    } else {
      target = resolvePath(cwd, arg);
      if (!target) return { lines: [err("cd: no such directory. Try 'ls'.")], invalid: true };
    }
    if (target === cwd) return { lines: arg === '-' ? [out(absolute(target))] : [] };
    return {
      lines: arg === '-' ? [out(absolute(target))] : [],
      action: Object.freeze({ type: 'goto', page: DIRS.get(target), anchor: null }),
    };
  }],
  ['open', ([id]) => {
    const target = TARGETS.get(id);
    return { lines: [ok(`opening ${target.label}`)], action: Object.freeze({ type: 'goto', page: target.page, anchor: target.anchor }) };
  }],
  // No argument lists the backgrounds and marks the current one (context.background, from
  // the UI); a name asks the UI to switch (ui/backgrounds.js).
  ['background', ([id], context) => (id === undefined
    ? {
      lines: [
        out('backgrounds:'),
        ...BACKGROUNDS.map((background) => out(`  ${background.id === context.background ? '*' : ' '} ${pad(background.id, 12)}${background.description}`)),
        out("type 'background <name>' to switch"),
      ],
    }
    : { lines: [ok(`background: switching to ${id}`)], action: Object.freeze({ type: 'background', id }) })],
  ['theme', ([id], context) => (id === undefined
    ? {
      lines: [
        out('themes:'),
        ...THEMES.map((theme) => out(`  ${theme.id === context.theme ? '*' : ' '} ${pad(theme.id, 12)}${theme.description}`)),
        out("type 'theme <name>' to switch"),
      ],
    }
    : { lines: [ok(`theme: switching to ${id}`)], action: Object.freeze({ type: 'theme', id }) })],
  ['whoami', (args, context) => ({ lines: [out(context.root ? 'root' : TERMINAL_USER)] })],
  ['clear', () => ({ lines: [], action: Object.freeze({ type: 'clear' }) })],

  // ---------- Read-only commands over authored text (data/shell-text.js) ----------
  ['cat', ([name], context) => {
    const files = Object.hasOwn(FILES, context.page) ? FILES[context.page] : {};
    if (!Object.hasOwn(files, name)) return { lines: [err("cat: no such file here. Try 'ls'.")], invalid: true };
    // Blank lines hold a space so they keep their height when rendered.
    return { lines: files[name].map(([kind, text]) => line(kind, text || ' ')) };
  }],
  ['neofetch', (args, context) => {
    const earned = CERT_ROWS.filter((cert) => cert.status === 'CERTIFIED').length;
    const info = [
      `${context.root ? 'root' : TERMINAL_USER}@${TERMINAL_HOST}`,
      '-'.repeat((context.root ? 4 : TERMINAL_USER.length) + TERMINAL_HOST.length + 1),
      'OS: wafflesOS x86_64 (simulated)',
      'Host: remote hypervisor',
      'Kernel: 6.1.0-waffle',
      `Uptime: ${formatUptime(context.uptime)}`,
      `Packages: ${PROJECTS.length} projects`,
      `Shell: wsh (${context.shell})`,
      `Theme: ${context.theme}`,
      `Background: ${context.background}`,
      `Certs: ${earned} earned, ${CERT_ROWS.length - earned} on the way`,
      'Security: CSP strict, trackers 0',
    ];
    return { lines: NEOFETCH_LOGO.map((art, i) => line('fetch', art + (info[i] || ''))) };
  }],
  ['uptime', (args, context) => {
    const clock = new Date(context.now);
    const time = [clock.getHours(), clock.getMinutes(), clock.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    return { lines: [out(` ${time} up ${formatUptime(context.uptime)},  1 user,  load average: 0.08, 0.03, 0.01`)] };
  }],
  // context.history: this shell's stored command lines (validated before they reach here).
  ['history', (args, context) => {
    const all = [...context.history, 'history'];
    const start = Math.max(0, all.length - LIMITS.terminalHistory);
    return { lines: all.slice(start).map((command, i) => out(`${String(start + i + 1).padStart(5)}  ${command}`)) };
  }],
  ['man', ([name]) => {
    if (name === undefined) return { lines: [err('What manual page do you want?'), out("For example, try 'man man'.")] };
    const meta = META.get(name);
    const title = `${name.toUpperCase()}(1)`;
    return {
      lines: [
        ok(`${title.padEnd(22)}${'wafflesOS Manual'.padEnd(22)}${title}`),
        ok('NAME'),
        out(`    ${meta.usage.split(' ')[0].replace(/,$/, '')} - ${meta.description}`),
        ok('SYNOPSIS'),
        out(`    ${meta.usage}`),
        ok('DESCRIPTION'),
        // One paragraph, so it wraps to the window instead of at fixed columns.
        out(`    ${MANUAL[name].join(' ')}`),
      ],
    };
  }],
  ['git', () => ({
    lines: CHANGELOG.map(([hash, message], i) => line('git', `${hash} ${i === 0 ? '(HEAD -> main) ' : ''}${message}`)),
  })],
  ['hunt', ([arg], context) => {
    if (arg === 'reset') return { lines: [ok('hunt: progress reset. happy hunting.')], action: Object.freeze({ type: 'hunt-reset' }) };
    const found = new Set(context.found);
    const lines = [ok(`egg hunt: ${found.size}/${EGGS.length} found`)];
    for (const egg of EGGS) {
      lines.push(found.has(egg.id)
        ? line('ok', `  [x] ${pad(egg.label, 16)}${egg.description}`)
        : out(`  [ ] ${pad('???', 16)}hint: ${egg.hint}`));
    }
    if (found.size === EGGS.length) lines.push(ok('every egg found. you are a legend.'));
    else if (found.size > 0) lines.push(out("type 'hunt reset' to hide them again"));
    return { lines };
  }],

  // ---------- Easter eggs (egg: the id ui/hunt.js marks as found) ----------
  // "hello world" opens a new shell and plays an ASCII animation there.
  ['hello', (args) => (args.length === 0
    ? { lines: [out(`hello, ${TERMINAL_USER}. (psst: try 'hello world')`)] }
    : { lines: [ok('hello_world: opening a fresh shell...')], action: Object.freeze({ type: 'hello' }), egg: 'hello' })],
  // The UI toggles the matrix rain and prints whether it is on or off.
  ['leet', () => ({ lines: [], action: Object.freeze({ type: 'matrix' }), egg: 'matrix' })],
  // The fork bomb crashes the simulated machine (ui/fork-bomb.js), then reboots.
  ['forkbomb', () => ({ lines: [], action: Object.freeze({ type: 'forkbomb' }), egg: 'forkbomb' })],
  // Lists every egg but itself, spoilers and all (owner request).
  ['eggs', () => ({
    lines: [
      ok('easter eggs hidden on this machine:'),
      ...EGGS.filter((egg) => egg.id !== 'eggs').map((egg) => out(`  ${pad(egg.label, 16)}${egg.description}`)),
      out("(you didn't hear it from me)"),
    ],
    egg: 'eggs',
  })],
  // sudo asks for a password (the UI prompts and checks it, features/puzzles.js); the
  // right one makes the visitor root, a cosmetic label (doctrine: whoami is presentation
  // only). The command after sudo is run through this same engine as root once the
  // password is accepted: action.inner is that command's validated echo, null for a root
  // shell (sudo su / -i / bash), or 'unknown'. Free arguments never reach the echo.
  // Bare "sudo" prompts too (owner request; real sudo would print its usage instead).
  ['sudo', (args, context) => {
    if (args.length === 0 || (ROOT_SHELLS.has(args[0]) && args.length <= 2 && (args.length === 1 || args[1] === '-'))) {
      return elevate('sudo', null, ['sudo', ...args].join(' '));
    }
    return elevate('sudo', asRoot(args, context), null);
  }],
  // su does what sudo does (owner request), with su's own "Password:" prompt: bare su,
  // "su -" and "su root" give a root shell; "su -c <command>" or "su <command>" run it.
  ['su', (args, context) => {
    if (args.length === 0 || (args.length <= 2 && args.every((arg) => arg === '-' || arg === 'root'))) {
      return elevate('su', null, ['su', ...args].join(' '));
    }
    const dashC = args[0] === '-c';
    const inner = asRoot(dashC ? args.slice(1) : args, context);
    return elevate('su', inner, dashC && inner && inner !== 'unknown' ? `su -c ${inner}` : null);
  }],
  // Free arguments, compared with fixed values only. Only root gets the breakdown.
  ['rm', (args, context) => {
    const [flags, ...targets] = args;
    if (context.root && RM_FLAGS.has(flags) && targets.every((target) => RM_TARGETS.has(target))) {
      return { lines: [], action: Object.freeze({ type: 'rmrf' }), egg: 'rmrf', echo: ['rm -rf', ...targets].join(' ') };
    }
    return {
      lines: context.root
        ? [err('rm: cannot remove: No such file or directory')]
        : [err('rm: cannot remove: Permission denied'), out('(you would need more privileges for that)')],
      echo: args.length ? 'rm (arguments not kept)' : 'rm',
    };
  }],
  ['spawn', () => ({ lines: [ok('spawning a new shell...')], action: Object.freeze({ type: 'spawn' }) })],
  // As root, exit leaves the root shell first, as it would after "sudo su".
  ['exit', (args, context) => {
    if (context.root) return { lines: [ok('logout (back to visitor)')], action: Object.freeze({ type: 'unroot' }) };
    return context.shell === 'tty1'
      ? { lines: [err("exit: tty1 is the login shell. Use 'reboot' to restart the machine.")] }
      : { lines: [ok('logout')], action: Object.freeze({ type: 'exit' }) };
  }],
  ['reboot', () => ({ lines: [ok('rebooting...')], action: Object.freeze({ type: 'reboot' }) })],
]);

// Returns { lines, action, recognized, valid, echo }.
// echo is the normalized command line to show and keep; it is only set when the whole
// input was valid, so unrecognized or rejected input is never stored.
// context.page names the page the console is on and context.shell the shell window;
// unknown values fall back to home and tty1.
export function execute(raw, context = {}) {
  const page = pickKnown(context && context.page, PAGE_IDS, 'home');
  const shell = pickKnown(context && context.shell, SHELL_IDS, 'tty1');
  // Symbol aliases that the ASCII command-name grammar cannot express.
  const forkBomb = typeof raw === 'string' && raw.length <= 64 && raw.replace(/\s+/g, '') === FORK_BOMB;
  const alias = forkBomb ? FORK_BOMB_ECHO
    : typeof raw === 'string' && Object.hasOwn(ALIASES, raw.trim()) ? raw.trim() : null;
  const parsed = parseCommand(forkBomb ? 'forkbomb' : alias ? ALIASES[alias] : raw);
  if (!parsed.ok) {
    if (parsed.reason === 'empty') return { lines: [], action: null, recognized: false, valid: false, echo: null };
    return { lines: [err(PARSE_ERRORS[parsed.reason] || PARSE_ERRORS.invalid)], action: null, recognized: false, valid: false, echo: null };
  }

  const { name, args } = parsed.value;
  const meta = META.get(name);
  const handler = HANDLERS.get(name);
  // "forkbomb" is internal: only the fork bomb syntax itself reaches it.
  if (!meta || !handler || (name === 'forkbomb' && !forkBomb)) {
    return { lines: [err(PARSE_ERRORS['invalid-command'])], action: null, recognized: false, valid: false, echo: null };
  }

  if (args.length < meta.args.min || args.length > meta.args.max) {
    return { lines: [err(`usage: ${meta.usage}`)], action: null, recognized: true, valid: false, echo: null };
  }
  if (meta.args.oneOf) {
    const allowed = ARG_SETS.get(meta.args.oneOf);
    const check = meta.args.caseless ? (arg) => arg.toLowerCase() : (arg) => arg;
    if (!args.every((arg) => knownId(check(arg), allowed).ok)) {
      const message = Object.hasOwn(ARG_ERRORS, meta.args.oneOf) ? ARG_ERRORS[meta.args.oneOf] : `unknown target. Try '${meta.usage}'.`;
      return { lines: [err(`${name}: ${message}`)], action: null, recognized: true, valid: false, echo: null };
    }
  }

  const ctx = context || {};
  const handlerContext = {
    page,
    shell,
    oldpwd: typeof ctx.oldpwd === 'string' && DIRS.has(ctx.oldpwd) ? ctx.oldpwd : null,
    background: pickKnown(ctx.background, BACKGROUND_IDS, 'default'),
    theme: pickKnown(ctx.theme, THEME_IDS, 'cyan'),
    found: cleanFound(ctx.found),
    history: cleanHistory(ctx.history),
    uptime: cleanSeconds(ctx.uptime),
    now: typeof ctx.now === 'number' && Number.isFinite(ctx.now) ? ctx.now : Date.now(),
    // Cosmetic only: changes the prompt, whoami and what rm does to the page.
    root: ctx.root === true,
  };
  const result = handler(args, handlerContext);
  if (result.invalid) return { lines: result.lines, action: null, recognized: true, valid: false, echo: null };
  return {
    lines: result.lines,
    action: result.action || null,
    recognized: true,
    valid: true,
    // Commands with free arguments set their own echo, which never contains them.
    echo: result.echo || alias || [name, ...args].join(' '),
    // An easter egg id for ui/hunt.js to mark as found, or null.
    egg: result.egg || null,
  };
}

// Tab completion over command names, "open" targets and "cd" directories. Returns the
// completed input, or null when there is no single match.
export function complete(raw, context = {}) {
  if (typeof raw !== 'string' || raw.length > LIMITS.commandRaw) return null;
  const cdMatch = raw.match(/^cd ([A-Za-z0-9~._/-]*)$/);
  if (cdMatch) {
    const page = pickKnown(context && context.page, PAGE_IDS, 'home');
    const typed = cdMatch[1];
    const slash = typed.lastIndexOf('/');
    const base = slash === -1 ? '' : typed.slice(0, slash + 1);
    const partial = typed.slice(slash + 1);
    const parent = base === '' ? PAGES[page].cwd : resolvePath(PAGES[page].cwd, base);
    if (!parent) return null;
    const names = childDirs(parent).map((path) => segments(path).pop()).filter((name) => name.startsWith(partial));
    return names.length === 1 ? `cd ${base}${names[0]}/` : null;
  }
  // cat completes only the files in the current directory.
  const catMatch = raw.match(/^cat ([A-Za-z0-9._-]*)$/);
  if (catMatch) {
    const page = pickKnown(context && context.page, PAGE_IDS, 'home');
    const names = Object.hasOwn(FILES, page) ? Object.keys(FILES[page]).filter((name) => name.startsWith(catMatch[1])) : [];
    return names.length === 1 ? `cat ${names[0]}` : null;
  }
  if (!/^[a-z_ -]*$/.test(raw)) return null;
  const parts = raw.split(' ');
  if (parts.length === 1) {
    const matches = VISIBLE.map((command) => command.name).filter((name) => name.startsWith(parts[0]));
    return matches.length === 1 ? `${matches[0]} ` : null;
  }
  const meta = META.get(parts[0]);
  if (parts.length === 2 && meta && !meta.hidden && meta.args.oneOf) {
    const matches = ARG_SETS.get(meta.args.oneOf).filter((value) => value.startsWith(parts[1]));
    return matches.length === 1 ? `${parts[0]} ${matches[0]}` : null;
  }
  return null;
}
