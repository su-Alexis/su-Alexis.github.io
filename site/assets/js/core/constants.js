// Shared defaults, finite identifiers, resource limits and storage keys.
// Doctrine sections 5 and 17. Changing a limit requires review and abuse testing.
// Character limits are JavaScript UTF-16 code units.

export const LIMITS = Object.freeze({
  commandRaw: 512,
  commandNormalized: 512,
  commandArgs: 8,
  commandArgLength: 128,
  identifierLength: 128,
  searchLength: 256,
  puzzleAnswerRaw: 256,
  puzzleAnswerNormalized: 256,
  terminalLines: 200,
  terminalLineLength: 1024,
  terminalHistory: 50,
  storageCodeUnits: 32768,
  storageBytes: 32768,
});

// Presentation layers. Unlock state controls presentation only, never authorization.
export const LAYER_IDS = Object.freeze(['portfolio', 'workstation', 'hidden']);
export const DEFAULT_LAYER = 'portfolio';

// Layer 2 images: the simulated operating systems VMs are built from (data/commands.js).
export const OS_IDS = Object.freeze(['winbows', 'parrot', 'ubuntu', 'winserver', 'ubuntuserver', 'openwrt', 'ipcam']);

// Layer 1 portfolio sections reachable by fixed internal navigation.
export const SECTION_IDS = Object.freeze(['badges', 'certifications', 'projects', 'writeups']);

// Namespaced storage. Reset only keys that start with STORAGE_PREFIX.
export const STORAGE_PREFIX = 'rwa:';
export const STORAGE_KEYS = Object.freeze({
  state: `${STORAGE_PREFIX}state`,
});
export const STORAGE_VERSION = 1;
// localStorage: easter eggs found, as { v: HUNT_VERSION, found: [egg ids] } (ui/hunt.js).
// It outlives refresh and reboot on purpose; "hunt reset" clears it.
export const HUNT_STORAGE_KEY = `${STORAGE_PREFIX}hunt`;
export const HUNT_VERSION = 1;
// localStorage: Layer 2 progress, as { v: PROGRESS_VERSION, flags: [UNLOCK_IDS] }
// (ui/lab-progress.js; doctrine section 8). VM keys now (vm-<name>, one per encrypted VM),
// mission flags later. "vm lock" clears keys again.
export const PROGRESS_STORAGE_KEY = `${STORAGE_PREFIX}progress`;
export const PROGRESS_VERSION = 1;
export const UNLOCK_IDS = Object.freeze(['vm-parrot01', 'vm-ubuntu-blue', 'vm-ubuntu-red', 'vm-dc01', 'vm-web01', 'vm-router01', 'vm-cam01']);

// Terminal window and transcript, kept per tab so the console follows the visitor
// between pages. Only validated output is stored; raw typed input never is.
export const TERMINAL_STORAGE_KEY = `${STORAGE_PREFIX}terminal`;
export const TERMINAL_STATE_VERSION = 2;
// Shell windows: tty1 is the login shell docked on every page; spawn opens up to two more.
export const SHELL_IDS = Object.freeze(['tty1', 'tty2', 'tty3']);
export const TERMINAL_USER = 'visitor';
export const TERMINAL_HOST = 'portfolio';
export const TERMINAL_WINDOW = Object.freeze({
  minWidth: 280,
  minHeight: 160,
  defaultWidth: 620,
  defaultHeight: 360,
  barHeight: 30,
  maxCoordinate: 10000,
});

// Session-only flag so the boot animation plays at most once per visit.
export const SESSION_KEYS = Object.freeze({
  bootPlayed: `${STORAGE_PREFIX}boot-played`,
  // Pages already loaded this session: revisits skip their load sequence.
  visited: `${STORAGE_PREFIX}visited`,
  // Depth of the page being left, for the slide direction of the next transition.
  fromDepth: `${STORAGE_PREFIX}from-depth`,
  // The one-time startup tip in the console.
  hintShown: `${STORAGE_PREFIX}hint-shown`,
  // Set when the console itself navigated (cd, open), so the next page does not echo
  // a second synthetic "cd" line.
  shellNav: `${STORAGE_PREFIX}shell-nav`,
  // The 31337 matrix rain is on: it follows the visitor across Layer 1 pages until
  // toggled off, a refresh or a reboot (ui/matrix-rain.js, ui/terminal-ui.js).
  matrix: `${STORAGE_PREFIX}matrix`,
  // The background picked with the "background" command, when it is not the default.
  // Same lifetime as the matrix flag (ui/backgrounds.js, ui/terminal-ui.js).
  background: `${STORAGE_PREFIX}background`,
  // The color theme picked with "theme" (ui/theme.js), when it is not the default.
  theme: `${STORAGE_PREFIX}theme`,
  // When this machine booted (ms since the epoch), for uptime and neofetch.
  bootedAt: `${STORAGE_PREFIX}booted-at`,
  // The visitor gave sudo the right password: the shells show root (cosmetic only).
  // Cleared on refresh and reboot like the rest of the machine session.
  root: `${STORAGE_PREFIX}root`,
  // When sudo last accepted the password (ms since the epoch): like real sudo it does not
  // ask again for a while (SUDO_REMEMBER_MS in ui/terminal-ui.js). Cleared with the session.
  sudoAt: `${STORAGE_PREFIX}sudo-at`,
  // The screensaver was killed (btop or kill): it stays off until a refresh or reboot.
  noScreensaver: `${STORAGE_PREFIX}no-screensaver`,
  // The circuit board background's layout seed (ui/bg-circuit.js): every page of the
  // session draws the same board, so it stays put while pages slide over it. Refresh and
  // reboot clear it, and the next page lays out a new board.
  bgSeed: `${STORAGE_PREFIX}bg-seed`,
  // btop is running: { v: 1, shell, pid, samples }, so it keeps running in the same shell
  // on the next page with its graph intact (ui/terminal-ui.js). Cleared on quit and reset.
  btop: `${STORAGE_PREFIX}btop`,
  // "vm start <guest>" typed on another page: the guest to boot once the lab page loads.
  vmPending: `${STORAGE_PREFIX}vm-pending`,
  // The running VMs: { v: VM_SESSION_VERSION, front, vms: [{ id, minimized, floating, x, y, w,
  // h, cwd, log }] }
  // (ui/vm-session.js). Leaving the lab suspends them; a refresh or reboot powers them off.
  vms: `${STORAGE_PREFIX}vms`,
  // Each VM's own files and folders (doctrine section 8: the bounded file overlay on its
  // image's tree): { v: VM_FILES.version, vms: { <vm>: { dirs: [keys], files: [[key,
  // text]] } } } (ui/vm-session.js). Kept while VMs power off and on; a refresh or reboot
  // of the machine clears it.
  vmFiles: `${STORAGE_PREFIX}vm-files`,
});
// 2: keyed by VM name (images and VMs, October 8, 2026); older records read as empty.
export const VM_SESSION_VERSION = 2;
// VM windows on the lab's desk (ui/windows-ui.js): the smallest a visitor can resize
// one to, the size a fitted window floats at when nothing better is known, and the
// bound on any stored coordinate. minWidth fits a phone's desk (owner request, October
// 14, 2026: VM windows float and resize on phones too).
export const VM_WINDOW = Object.freeze({
  minWidth: 280,
  minHeight: 260,
  defaultWidth: 960,
  defaultHeight: 540,
  maxCoordinate: 10000,
});
// Each VM console's kept screen (ui/vm-session.js): the last lines, each cut to a length,
// so four VMs fit well inside the storage limit (LIMITS.storageCodeUnits).
export const VM_LOG = Object.freeze({ lines: 24, length: 120, cwd: 256 });
// Files a visitor saves on a VM (text editors, mkdir; features/guest-engine.js): per VM at
// most this many files and folders, each file this many characters, each name this long.
export const VM_FILES = Object.freeze({ version: 1, files: 16, dirs: 16, content: 6000, name: 64, key: 256 });

// Hosts that reviewed external links may point to (https only). Doctrine section 12.
export const EXTERNAL_LINK_HOSTS = Object.freeze([
  'www.credly.com',
  'skillsoft.digitalbadges.skillsoft.com',
  'github.com',
  'www.linkedin.com',
]);

// Class names toggled on <html> by app.js. CSS reads these; nothing else may set classes there.
export const ROOT_CLASSES = Object.freeze({
  scriptEnabled: 'js',
  reducedMotion: 'reduced-motion',
});
