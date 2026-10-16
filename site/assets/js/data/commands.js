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
  // Layer 2's lab: the hypervisor page where the VMs run (layers/layer2.js).
  lab: Object.freeze({ path: 'lab/', depth: 1, cwd: '~/lab', title: 'Lab' }),
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
  // default: the circuit board (owner decision, October 13, 2026; it was "circuit");
  // grid: the old plain grid; hex_float: the neon hexagons (the default before that);
  // bubbles: translucent bubbles floating up.
  Object.freeze({ id: 'default', description: 'circuit traces with pulses running through them' }),
  Object.freeze({ id: 'grid', description: 'the plain grid' }),
  Object.freeze({ id: 'bubbles', description: 'translucent bubbles floating up' }),
  Object.freeze({ id: 'synthwave', description: 'a retro grid racing toward a neon sun' }),
  Object.freeze({ id: 'starfield', description: 'flying through the stars' }),
  Object.freeze({ id: 'hex_float', description: 'neon wireframe hexagons drifting up' }),
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

// The hypervisor (doctrine 1.8, Skeleton 1.10; owner decision October 8, 2026).
// Images are the operating systems; ids match OS_IDS in core/constants.js. The guest
// engine (a later segment) loads each image's profile from data/images/.
// bios: false for firmware that boots without a PC BIOS (the camera starts in U-Boot).
export const IMAGES = Object.freeze([
  Object.freeze({ id: 'winbows', os: 'Winbows (simulated)', bios: true }),
  Object.freeze({ id: 'parrot', os: 'ParrotOS (simulated)', bios: true }),
  Object.freeze({ id: 'ubuntu', os: 'Ubuntu 24.04 LTS (simulated)', bios: true }),
  Object.freeze({ id: 'winserver', os: 'Winbows Server 2022 (simulated)', bios: true }),
  Object.freeze({ id: 'ubuntuserver', os: 'Ubuntu Server 24.04 LTS (simulated)', bios: true }),
  Object.freeze({ id: 'openwrt', os: 'OpenWrt 23.05 (simulated)', bios: true }),
  Object.freeze({ id: 'ipcam', os: 'IP camera firmware (simulated)', bios: false }),
]);

// VMs are named machines built from an image, each with its own role, login user, hostname and lab
// address (doctrine section 3: lab.example, 198.51.100.0/24), so one OS can run as
// several VMs, such as a red and a blue Ubuntu. Another VM is one more line here.
// autostart: powered on by the hypervisor's autostart hook when the lab opens.
// unlock: what earns its key while it is encrypted; null = never encrypted. Each VM has
// its own key (owner decision); "vm unlock" also opens it with the cheat code or, as
// root, root's key file (ui/lab-progress.js keeps which are unlocked).
// The mission names in unlock are placeholders until those missions are written.
// dnsSuffix: the VM's DNS domain (dc01 runs corp.example); netbios: its Winbows domain name.
const vm = (id, image, role, user, ip, unlock, { autostart = false, dnsSuffix = 'lab.example', netbios = null } = {}) => {
  const base = IMAGES.find((entry) => entry.id === image);
  return Object.freeze({ id, image, os: base.os, bios: base.bios, role, user, host: `${id}.${dnsSuffix}`, dnsSuffix, netbios, ip, unlock, autostart });
};
export const VMS = Object.freeze([
  vm('ws01', 'winbows', 'workstation', 'analyst', '198.51.100.20', null, { autostart: true }),
  vm('parrot01', 'parrot', 'attacker', 'operator', '198.51.100.10', 'finish the Winbows starter mission'),
  vm('ubuntu-blue', 'ubuntu', 'defender', 'admin', '198.51.100.30', 'finish the two ParrotOS missions'),
  vm('ubuntu-red', 'ubuntu', 'attacker', 'operator', '198.51.100.31', 'finish Blue 1 on ubuntu-blue'),
  // Servers and devices (owner, October 9, 2026): targets first, playable where a mission says.
  vm('dc01', 'winserver', 'domain controller', 'Administrator', '198.51.100.40', 'a domain mission (to be written)', { dnsSuffix: 'corp.example', netbios: 'CORP' }),
  vm('web01', 'ubuntuserver', 'web server', 'admin', '198.51.100.50', 'a web mission (to be written)'),
  vm('router01', 'openwrt', 'router', 'root', '198.51.100.254', 'a network mission (to be written)'),
  vm('cam01', 'ipcam', 'IP camera', 'root', '198.51.100.60', 'a device mission (to be written)'),
]);
export const VM_IDS = Object.freeze(VMS.map((entry) => entry.id));

// Encryption switch (owner, October 9, 2026): off while the VMs are being built and tested,
// so every VM powers on without a key. Turn it back on before the Layer 2 sign-off; the
// keys, `vm unlock`/`vm lock` and the library's encrypted state all come back with it.
export const VM_ENCRYPTION = false;

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
  // Layer 2: list the guests, boot one into a VM window, power it off (layers/layer2.js).
  Object.freeze({ name: 'vm', usage: 'vm [list|start <vm>|stop [vm]|unlock <vm|--all>|lock <vm|--all>|reset-missions]', brief: 'vm [command] [vm]', description: 'manage the virtual machines (vm --help for all)', args: Object.freeze({ min: 0, max: 2, free: true }) }),
  Object.freeze({ name: 'history', usage: 'history', description: 'list the commands run in this shell', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'man', usage: 'man <command>', description: 'read the manual for a command', args: Object.freeze({ min: 0, max: 1, oneOf: 'manpages' }) }),
  Object.freeze({ name: 'git', usage: 'git log', description: "show this site's history", args: Object.freeze({ min: 1, max: 1, oneOf: 'git' }) }),
  Object.freeze({ name: 'clear', usage: 'clear', description: 'clear this shell', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'screensaver', usage: 'screensaver', description: 'start the screensaver now', args: Object.freeze({ min: 0, max: 0 }) }),
  Object.freeze({ name: 'background', usage: 'background [name]', description: 'list or switch page backgrounds', args: Object.freeze({ min: 0, max: 1, oneOf: 'backgrounds' }) }),
  Object.freeze({ name: 'theme', usage: 'theme [name]', description: 'list or switch color themes', args: Object.freeze({ min: 0, max: 1, oneOf: 'themes' }) }),
  // Hides everything on the page but tty1, to look at the background; hide again undoes it.
  Object.freeze({ name: 'hide', usage: 'hide', description: 'hide all but tty1 (hide again to undo)', args: Object.freeze({ min: 0, max: 0 }) }),
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
