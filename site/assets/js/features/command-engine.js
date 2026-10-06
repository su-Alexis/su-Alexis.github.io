// Terminal command engine. Doctrine section 7: a strict dispatcher, not a shell.
//
// Input is parsed by utils/validate.js, matched against a fixed Map of handlers, and
// arguments are checked against each command's schema before a handler runs. Handlers
// return authored output lines and, at most, one fixed UI action. Nothing here touches
// the DOM, the network, storage, or browser navigation; the UI applies actions.
// Error messages never repeat what the visitor typed.

import { parseCommand, knownId, pickKnown } from '../utils/validate.js';
import { COMMANDS, MODULES, PROJECTS, PAGES, PAGE_IDS, BACKGROUNDS, BACKGROUND_IDS } from '../data/commands.js';
import { LIMITS, TERMINAL_USER, SHELL_IDS } from '../core/constants.js';

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

const ARG_SETS = new Map([['targets', [...TARGETS.keys()]], ['greeting', ['world']], ['backgrounds', BACKGROUND_IDS]]);
const VISIBLE = COMMANDS.filter((command) => !command.hidden);
// help's usage column fits the longest visible usage.
const HELP_WIDTH = Math.max(...VISIBLE.map((command) => command.usage.length)) + 2;
// Easter eggs listed by the hidden "eggs" command; read from the metadata so new eggs
// show up automatically.
const EGGS = COMMANDS.filter((command) => command.hidden && command.name !== 'eggs');

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
    if (context.page === 'home') {
      return { lines: [...dirLines, out('modules:'), ...MODULES.map((module) => out(`  ${pad(module.id, 16)}${module.title}`))] };
    }
    if (context.page === 'writeups') {
      return { lines: [out('writeups:'), out('  (none published yet)'), out("type 'cd ..' or 'open home'")] };
    }
    // Every project detail page has the same three modules.
    if (PROJECTS.some((project) => project.page === context.page)) {
      return { lines: [out('  overview  notes  screenshots'), out("type 'cd ..' for all projects")] };
    }
    return {
      lines: [
        ...dirLines,
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
  ['whoami', () => ({ lines: [out(TERMINAL_USER)] })],
  ['clear', () => ({ lines: [], action: Object.freeze({ type: 'clear' }) })],
  // Easter egg: "hello world" opens a new shell and plays an ASCII animation there.
  ['hello', (args) => (args.length === 0
    ? { lines: [out(`hello, ${TERMINAL_USER}. (psst: try 'hello world')`)] }
    : { lines: [ok('hello_world: opening a fresh shell...')], action: Object.freeze({ type: 'hello' }) })],
  // Easter egg: the UI toggles the matrix rain and prints whether it is on or off.
  ['leet', () => ({ lines: [], action: Object.freeze({ type: 'matrix' }) })],
  // Easter egg: the fork bomb crashes the simulated machine (ui/fork-bomb.js), then reboots.
  ['forkbomb', () => ({ lines: [], action: Object.freeze({ type: 'forkbomb' }) })],
  // Hidden: lists the easter eggs (owner request). Usage strings are fixed metadata.
  ['eggs', () => ({
    lines: [
      ok('easter eggs hidden on this machine:'),
      ...EGGS.map((command) => out(`  ${pad(command.usage, 16)}${command.description}`)),
      out("(you didn't hear it from me)"),
    ],
  })],
  ['spawn', () => ({ lines: [ok('spawning a new shell...')], action: Object.freeze({ type: 'spawn' }) })],
  ['exit', (args, context) => (context.shell === 'tty1'
    ? { lines: [err("exit: tty1 is the login shell. Use 'reboot' to restart the machine.")] }
    : { lines: [ok('logout')], action: Object.freeze({ type: 'exit' }) })],
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
      const hint = meta.args.oneOf === 'targets' ? "Try 'ls', or 'open home'." : `Try '${meta.usage}'.`;
      return { lines: [err(`${name}: unknown target. ${hint}`)], action: null, recognized: true, valid: false, echo: null };
    }
  }

  const oldpwd = context && typeof context.oldpwd === 'string' && DIRS.has(context.oldpwd) ? context.oldpwd : null;
  const background = pickKnown(context && context.background, BACKGROUND_IDS, 'default');
  const result = handler(args, { page, shell, oldpwd, background });
  if (result.invalid) return { lines: result.lines, action: null, recognized: true, valid: false, echo: null };
  return {
    lines: result.lines,
    action: result.action || null,
    recognized: true,
    valid: true,
    echo: alias || [name, ...args].join(' '),
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
