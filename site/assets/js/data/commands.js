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

// Page backgrounds the "background" command switches between (ui/backgrounds.js).
// The 31337 matrix rain is a hidden easter egg, not one of these.
export const BACKGROUNDS = Object.freeze([
  Object.freeze({ id: 'default', description: 'the plain grid' }),
  Object.freeze({ id: 'hex_float', description: 'neon wireframe hexagons drifting up' }),
  Object.freeze({ id: 'synthwave', description: 'a retro grid racing toward a neon sun' }),
  Object.freeze({ id: 'starfield', description: 'flying through the stars' }),
  Object.freeze({ id: 'circuit', description: 'circuit traces with pulses running through them' }),
]);
export const BACKGROUND_IDS = Object.freeze(BACKGROUNDS.map((background) => background.id));

// Console color themes for the "theme" command (ui/theme.js, theme.css). cyan is the
// site's own look; the others recolor the accent and the console text like old CRT phosphor.
export const THEMES = Object.freeze([
  Object.freeze({ id: 'cyan', description: 'the default look' }),
  Object.freeze({ id: 'amber', description: 'amber phosphor, like an old VT220' }),
  Object.freeze({ id: 'green', description: 'green phosphor, classic hacker green' }),
  Object.freeze({ id: 'purple', description: 'neon violet, straight out of cyberspace' }),
]);
export const THEME_IDS = Object.freeze(THEMES.map((theme) => theme.id));

// The hypervisor's guests ("vm"): the simulated machines Layer 2 will bring. Until then
// they are listed as not provisioned. Ids match OS_IDS in core/constants.js.
export const GUESTS = Object.freeze([
  Object.freeze({ id: 'windows', os: 'Windows (simulated)' }),
  Object.freeze({ id: 'parrot', os: 'ParrotOS (simulated)' }),
]);

// Easter eggs, in the order "hunt" lists them. Found eggs are remembered per browser
// (ui/hunt.js). label is how to trigger it, shown once found and by "eggs"; hint is
// what "hunt" shows while it is still hidden.
export const EGGS = Object.freeze([
  Object.freeze({ id: 'hello', label: 'hello world', description: 'say hello', hint: "every programmer's first words" }),
  Object.freeze({ id: 'matrix', label: '31337', description: 'toggle the matrix', hint: 'speak leet, in digits' }),
  Object.freeze({ id: 'forkbomb', label: ':(){ :|:& };:', description: 'crash the machine', hint: 'a function that calls itself, twice, forever' }),
  Object.freeze({ id: 'rmrf', label: 'sudo rm -rf /', description: 'delete everything (not really)', hint: 'the most dangerous command there is, as root (sudo knows the way)' }),
  Object.freeze({ id: 'screensaver', label: '(stay idle)', description: 'the screensaver', hint: 'step away from the keyboard for a couple of minutes' }),
  Object.freeze({ id: 'eggs', label: 'eggs', description: 'list the easter eggs', hint: 'just ask for the eggs' }),
]);
export const EGG_IDS = Object.freeze(EGGS.map((egg) => egg.id));

// args.min / args.max bound the argument count; args.oneOf names a fixed value set.
// free: arguments are free text the handler only compares, never echoes or stores.
export const COMMANDS = Object.freeze([
  Object.freeze({ name: 'help', usage: 'help, ?', description: 'list available commands', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'ls', usage: 'ls', description: 'list what is here', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'cd', usage: 'cd [dir]', description: 'change directory (~, .., -, paths)', args: Object.freeze({ min: 0, max: 1 }) }),
  Object.freeze({ name: 'pwd', usage: 'pwd', description: 'print the working directory', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'cat', usage: 'cat <file>', description: 'print a file (see ls)', args: Object.freeze({ min: 1, max: 1, oneOf: 'files' }) }),
  Object.freeze({ name: 'open', usage: 'open <target>', description: 'open a module, page or project', args: Object.freeze({ min: 1, max: 1, oneOf: 'targets' }) }),
  Object.freeze({ name: 'whoami', usage: 'whoami', description: 'print the current user', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'neofetch', usage: 'neofetch', description: 'show system information', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'uptime', usage: 'uptime', description: 'how long the machine has been up', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'ps', usage: 'ps [aux|-e|-ef]', description: 'list processes', args: Object.freeze({ min: 0, max: 1, free: true }) }),
  Object.freeze({ name: 'kill', usage: 'kill [-9|-15] <pid>', description: 'send a signal to a process', args: Object.freeze({ min: 0, max: 5, free: true }) }),
  Object.freeze({ name: 'btop', usage: 'btop', description: 'process monitor (also top, htop)', args: Object.freeze({ min: 0, max: 0 }) }),
  // Layer 2 teaser (owner request): lists the planned guests; nothing can start yet.
  Object.freeze({ name: 'vm', usage: 'vm [list|start <guest>]', description: 'list the virtual machines', args: Object.freeze({ min: 0, max: 2, free: true }) }),
  Object.freeze({ name: 'history', usage: 'history', description: 'list the commands run in this shell', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'man', usage: 'man <command>', description: 'read the manual for a command', args: Object.freeze({ min: 0, max: 1, oneOf: 'manpages' }) }),
  Object.freeze({ name: 'git', usage: 'git log', description: "show this site's history", args: Object.freeze({ min: 1, max: 1, oneOf: 'git' }) }),
  Object.freeze({ name: 'clear', usage: 'clear', description: 'clear this shell', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'screensaver', usage: 'screensaver', description: 'start the screensaver now', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'background', usage: 'background [name]', description: 'list or switch page backgrounds', args: Object.freeze({ min: 0, max: 1, oneOf: 'backgrounds' }) }),
  Object.freeze({ name: 'theme', usage: 'theme [name]', description: 'list or switch color themes', args: Object.freeze({ min: 0, max: 1, oneOf: 'themes' }) }),
  Object.freeze({ name: 'hunt', usage: 'hunt [reset]', description: 'track your easter egg hunt', args: Object.freeze({ min: 0, max: 1, oneOf: 'hunt' }) }),
  Object.freeze({ name: 'spawn', usage: 'spawn', description: 'open a new shell window', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'exit', usage: 'exit', description: 'close this shell window', args: Object.freeze({ min: 0, max: 0 }) }),
  // Easter egg: hidden from help and Tab completion.
  Object.freeze({ name: 'hello', usage: 'hello world', description: 'say hello', hidden: true, args: Object.freeze({ min: 0, max: 1, oneOf: 'greeting', caseless: true }) }),
  // Easter egg: typing "31337" runs this (alias in command-engine.js). Hidden from help.
  // top and htop open btop, as the help line says; listed there, not on their own.
  Object.freeze({ name: 'top', usage: 'top', description: 'process monitor', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'htop', usage: 'htop', description: 'process monitor', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'leet', usage: '31337', description: 'toggle the matrix', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  // Easter egg: the bash fork bomb ":(){ :|:& };:" runs this (matched in command-engine.js).
  Object.freeze({ name: 'forkbomb', usage: ':(){ :|:& };:', description: 'crash the machine', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  // Hidden index of the easter eggs (EGGS above), spoilers included.
  Object.freeze({ name: 'eggs', usage: 'eggs', description: 'list the easter eggs', hidden: true, args: Object.freeze({ min: 0, max: 0 }) }),
  // Hidden: sudo and su behave as on Linux (owner request): the right password runs a
  // command as root, or opens a root shell (a cosmetic label). As root, "rm -rf /" is the
  // doctrine's breakdown egg. Their free
  // arguments are only compared against fixed values, never echoed or stored.
  Object.freeze({ name: 'sudo', usage: 'sudo <command>', description: 'run a command as root', hidden: true, args: Object.freeze({ min: 0, max: 8, free: true }) }),
  Object.freeze({ name: 'su', usage: 'su [-] [root] [-c <command>]', description: 'become root', hidden: true, args: Object.freeze({ min: 0, max: 8, free: true }) }),
  Object.freeze({ name: 'rm', usage: 'rm <file>', description: 'remove files', hidden: true, args: Object.freeze({ min: 0, max: 8, free: true }) }),
  Object.freeze({ name: 'reboot', usage: 'reboot', description: 'restart the machine and replay the boot', args: Object.freeze({ min: 0, max: 0 }) }),
]);
