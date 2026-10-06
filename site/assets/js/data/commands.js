// Terminal command metadata and argument schemas. No handlers here (doctrine section 7);
// handlers live in features/command-engine.js. Every command is simulated.

// Pages the console runs on. path is relative to the site root; depth is how many
// directories deep the page sits; cwd is the prompt's simulated working directory.
export const PAGES = Object.freeze({
  home: Object.freeze({ path: '', depth: 0, cwd: '~', title: 'Home' }),
  projects: Object.freeze({ path: 'projects/', depth: 1, cwd: '~/projects', title: 'Projects' }),
  wingg: Object.freeze({ path: 'projects/wingg/', depth: 2, cwd: '~/projects/wingg', title: 'WindowsGG' }),
  debloat: Object.freeze({ path: 'projects/windows-debloat-and-optimize/', depth: 2, cwd: '~/projects/debloat', title: 'Windows 10/11 Debloat & Optimize' }),
  'fridge-friends': Object.freeze({ path: 'projects/fridge-friends/', depth: 2, cwd: '~/projects/fridge-friends', title: 'Fridge Friends' }),
  cleanup: Object.freeze({ path: 'projects/windows-cleanup/', depth: 2, cwd: '~/projects/cleanup', title: 'Windows Cleanup' }),
  'net-reset': Object.freeze({ path: 'projects/network-stack-reset/', depth: 2, cwd: '~/projects/net-reset', title: 'Network Stack Reset' }),
  'net-refresh': Object.freeze({ path: 'projects/network-refresh/', depth: 2, cwd: '~/projects/net-refresh', title: 'Network Refresh' }),
  writeups: Object.freeze({ path: 'writeups/', depth: 1, cwd: '~/writeups', title: 'Writeups' }),
});
export const PAGE_IDS = Object.freeze(Object.keys(PAGES));

// Home page modules the console can list and jump to. elementId is a fixed page anchor.
export const MODULES = Object.freeze([
  Object.freeze({ id: 'identity', title: 'Identity', elementId: 'module-identity' }),
  Object.freeze({ id: 'certifications', title: 'Certifications and Ongoing Training', elementId: 'module-certifications' }),
  Object.freeze({ id: 'core-areas', title: 'Core Areas', elementId: 'module-core-areas' }),
  Object.freeze({ id: 'projects', title: 'Featured Projects', elementId: 'module-projects' }),
  Object.freeze({ id: 'writeups', title: 'Writeups and Documentation', elementId: 'module-writeups' }),
  Object.freeze({ id: 'links', title: 'Verification and Links', elementId: 'module-links' }),
  Object.freeze({ id: 'languages', title: 'Languages and Tools', elementId: 'module-languages' }),
]);

// Project pages reachable with "open <id>".
export const PROJECTS = Object.freeze([
  Object.freeze({ id: 'wingg', title: 'WindowsGG', page: 'wingg' }),
  Object.freeze({ id: 'debloat', title: 'Windows 10/11 Debloat & Optimize', page: 'debloat' }),
  Object.freeze({ id: 'fridge-friends', title: 'Fridge Friends', page: 'fridge-friends' }),
  Object.freeze({ id: 'cleanup', title: 'Windows Cleanup', page: 'cleanup' }),
  Object.freeze({ id: 'net-reset', title: 'Network Stack Reset', page: 'net-reset' }),
  Object.freeze({ id: 'net-refresh', title: 'Network Refresh', page: 'net-refresh' }),
]);

// args.min / args.max bound the argument count; args.oneOf names a fixed value set.
export const COMMANDS = Object.freeze([
  Object.freeze({ name: 'help', usage: 'help, ?', description: 'list available commands', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'ls', usage: 'ls', description: 'list what is here', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'cd', usage: 'cd [dir]', description: 'change directory (~, .., -, paths)', args: Object.freeze({ min: 0, max: 1 }) }),
  Object.freeze({ name: 'pwd', usage: 'pwd', description: 'print the working directory', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'open', usage: 'open <target>', description: 'open a module, page or project', args: Object.freeze({ min: 1, max: 1, oneOf: 'targets' }) }),
  Object.freeze({ name: 'whoami', usage: 'whoami', description: 'print the current user', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'clear', usage: 'clear', description: 'clear this shell', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'spawn', usage: 'spawn', description: 'open a new shell window', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'exit', usage: 'exit', description: 'close this shell window', args: Object.freeze({ min: 0, max: 0 }) }),
  // Easter egg: hidden from help and Tab completion.
  Object.freeze({ name: 'hello', usage: 'hello world', description: 'say hello', hidden: true, args: Object.freeze({ min: 0, max: 1, oneOf: 'greeting', caseless: true }) }),
  // Easter egg: typing "31337" runs this (alias in command-engine.js). Hidden from help.
  Object.freeze({ name: 'leet', usage: '31337', description: 'toggle the matrix', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  // Easter egg: the bash fork bomb ":(){ :|:& };:" runs this (matched in command-engine.js).
  Object.freeze({ name: 'forkbomb', usage: ':(){ :|:& };:', description: 'crash the machine', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  // Hidden index of the easter eggs above: lists every hidden command except itself.
  Object.freeze({ name: 'eggs', usage: 'eggs', description: 'list the easter eggs', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'reboot', usage: 'reboot', description: 'restart the machine and replay the boot', args: Object.freeze({ min: 0, max: 0 }) }),
]);
