// Interactive console windows. Doctrine sections 5, 7, 8 and 9.
//
// - Input goes through features/command-engine.js only; output renders as text.
// - tty1 is the login shell, docked at the top of every page; it can pop out, be dragged
//   by its title bar, resized (CSS resize), docked and minimized. "spawn" opens up to two
//   more floating shells (tty2, tty3); "exit" or their close button closes them.
//   Positions and sizes are finite numbers clamped to the viewport and applied to fixed
//   individual style properties only (doctrine section 9).
// - Persistence standard: every shell keeps what it shows as the visitor moves through
//   the site, including each page's load log. Only "clear" (one shell), "reboot", or a
//   browser refresh empties it. State lives in sessionStorage, versioned and bounded.
//   Only validated command lines and authored output are kept; unrecognized input is
//   stored as a fixed placeholder, and raw command history stays in memory.

import { el, byId } from '../utils/dom.js';
import { execute, complete } from '../features/command-engine.js';
import { sessionStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { restoreTerminalState, appendLines, clampWindow, defaultShell, nextShellId, fitToBudget } from '../core/state.js';
import { LIMITS, TERMINAL_STORAGE_KEY, TERMINAL_USER, TERMINAL_HOST, TERMINAL_WINDOW, SESSION_KEYS, SHELL_IDS } from '../core/constants.js';
import { PAGES, PAGE_IDS } from '../data/commands.js';
import { pickKnown } from '../utils/validate.js';
import { playHello } from './hello-animation.js';
import { resumeMatrix, matrixActive } from './matrix-rain.js';
import { resumeBackground, setBackground, currentBackground, toggleMatrixBackground } from './backgrounds.js';
import { runForkBomb, crashAndReboot, powerOffAndReboot } from './fork-bomb.js';
import { runBtop } from './btop.js';
import { scrambleProcess, killStatusScramble } from './status-scramble.js';
import { runRmRf } from './rm-rf.js';
import { foundEggs, recordEgg, resetHunt } from './hunt.js';
import { resumeTheme, setTheme, currentTheme } from './theme.js';
import { startScreensaver, screensaverRunning, killScreensaver } from './screensaver.js';
import { matchesPuzzle } from '../features/puzzles.js';
import { PUZZLES } from '../data/puzzles.js';

const NOT_KEPT = '(input not kept)';

const LOG_COMMAND = /^[a-z0-9 ./~_-]{1,64}$/;
// Typing speed for lines a shell types out (ms). Commands type a character at a time
// after their prompt appears; output lines print a few characters at a time.
const TYPE = Object.freeze({ cmd: 24, out: 8, outStep: 4, afterCmd: 140, afterOut: 50 });
const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });
const BAR_FULL = '#'.repeat(20);
// sudo, as on Linux: three password tries, a pause after a wrong one (PAM's fail delay),
// and the password remembered for a while after it is accepted.
const SUDO_TRIES = 3;
const FAIL_DELAY_MS = 1200;
const SUDO_REMEMBER_MS = 15 * 60 * 1000;

function isReload() {
  try {
    const nav = window.performance.getEntriesByType('navigation')[0];
    return Boolean(nav) && nav.type === 'reload';
  } catch {
    return false;
  }
}

// Turns the page's decorative load log into transcript lines so it stays in the shell's
// history on later pages. The log is our own markup, but its text is still validated and
// is only ever rendered as text.
// from is the directory the visitor came from: the arrival "cd" line shows its prompt.
function captureLog(log, cached, cwd, fromShell, from = '~') {
  const lines = [];
  // A page already loaded this session resumes instead of loading again.
  // When the visitor typed cd/open themselves, their own line already shows the move.
  if (cached) {
    const resumed = { kind: 'ok', text: `[ ok ] resumed ${cwd} (cached)` };
    return fromShell ? [resumed] : [{ kind: 'cmd', text: `cd ${cwd}`, cwd: from }, resumed];
  }
  for (const p of log.querySelectorAll('.console-line')) {
    const typed = p.querySelector('.typed');
    const command = typed ? typed.textContent.trim() : '';
    if (typed && !LOG_COMMAND.test(command)) continue;
    if (p.classList.contains('line-prompt')) {
      if (!fromShell) lines.push({ kind: 'cmd', text: command, cwd: from });
    }
    else if (typed) lines.push({ kind: 'out', text: `$ ${command} [${BAR_FULL}] 100%` });
    else {
      const text = p.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push({ kind: text.startsWith('[ ok ]') ? 'ok' : 'out', text });
    }
  }
  return lines;
}

function isMobile() {
  const touchOnly = Boolean(window.matchMedia) && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  return touchOnly || window.innerWidth < 768;
}

// Desktop default: a floating window in the top-left, just under the top bar, sized to
// sit in the margin beside the page when the screen is wide enough.
function defaultPlacement() {
  const docked = { floating: false, minimized: false, x: 16, y: 80, w: TERMINAL_WINDOW.defaultWidth, h: TERMINAL_WINDOW.defaultHeight };
  if (isMobile()) return docked;
  const topbar = document.querySelector('.topbar');
  const content = document.querySelector('.site-main');
  // offsetHeight, not the bounding box: the top bar may be mid slide-in during the boot.
  const top = (topbar ? topbar.offsetHeight : 48) + 16;
  const margin = content ? Math.round(content.getBoundingClientRect().left) : 0;
  const w = margin >= 460 ? Math.min(margin - 16, 720) : 560;
  return clampWindow({ floating: true, minimized: false, x: 12, y: top, w, h: 430 }, window.innerWidth, window.innerHeight);
}

export function mountTerminal(primaryRoot) {
  const store = sessionStore();
  // A refresh or reboot starts the machine from scratch. Moving between pages keeps
  // every shell as it was.
  if (isReload()) {
    removeKey(store, TERMINAL_STORAGE_KEY);
    removeKey(store, SESSION_KEYS.hintShown);
    removeKey(store, SESSION_KEYS.matrix);
    removeKey(store, SESSION_KEYS.background);
    removeKey(store, SESSION_KEYS.theme);
    removeKey(store, SESSION_KEYS.bootedAt);
    removeKey(store, SESSION_KEYS.root);
    removeKey(store, SESSION_KEYS.sudoAt);
    removeKey(store, SESSION_KEYS.noScreensaver);
  }
  // The machine's boot time, for uptime and neofetch: set once per machine start.
  const bootedAt = (() => {
    const now = Date.now();
    const stored = readJson(store, SESSION_KEYS.bootedAt);
    if (typeof stored === 'number' && Number.isFinite(stored) && stored <= now && stored > now - 365 * 864e5) return stored;
    writeJson(store, SESSION_KEYS.bootedAt, now);
    return now;
  })();
  // The color theme picked with "theme", applied before first paint.
  resumeTheme();
  // Root (the right sudo password, cosmetic only), shared by every shell this session.
  let isRoot = readJson(store, SESSION_KEYS.root) === true;
  // Bring the 31337 rain back if it was on when the visitor left the last page.
  resumeMatrix({ reducedMotion: document.documentElement.classList.contains('reduced-motion') });
  // And the background picked with "background" (paused under the rain, if that is on).
  resumeBackground({ reducedMotion: document.documentElement.classList.contains('reduced-motion') });
  const stored = readJson(store, TERMINAL_STORAGE_KEY);
  const state = restoreTerminalState(stored);
  // A fresh machine places tty1 by device: detached in the top-left on desktops,
  // docked at the top on phones and small screens. Later moves are kept as usual.
  if (stored === undefined) state.shells[0].window = defaultPlacement();
  // Shells carried over from an earlier page skip the window-open animation
  // (terminal.css). This runs before first paint because app.js is render-blocking.
  if (stored !== undefined) document.documentElement.classList.add('shells-resumed');

  // The page comes from a data attribute in our own markup, but DOM values are still
  // treated as untrusted: only a known page id is accepted (doctrine section 4).
  const page = pickKnown(primaryRoot.dataset.page, PAGE_IDS, 'home');
  const cwd = PAGES[page].cwd;
  const reducedMotion = document.documentElement.classList.contains('reduced-motion');
  const html = document.documentElement;
  // Arriving on a new directory, by link or by cd, makes the last one OLDPWD.
  if (state.pwd && state.pwd !== cwd) state.oldpwd = state.pwd;
  state.pwd = cwd;
  // Set when the console itself navigated (cd, open): the visitor's own command line
  // already shows the move, so the page log's synthetic "cd" line is dropped.
  const fromShell = readJson(store, SESSION_KEYS.shellNav) === true;
  removeKey(store, SESSION_KEYS.shellNav);
  const shells = new Map();
  let saveTimer = 0;
  let rebooting = false;
  let isReady = false;

  // ---------- Persistence ----------

  function writeNow() {
    window.clearTimeout(saveTimer);
    if (rebooting) return;
    writeJson(store, TERMINAL_STORAGE_KEY, fitToBudget(state));
  }

  function save() {
    window.clearTimeout(saveTimer);
    if (rebooting) return;
    saveTimer = window.setTimeout(writeNow, 150);
  }

  // ---------- Manager actions ----------

  function bringToFront(id) {
    for (const [shellId, shell] of shells) shell.root.classList.toggle('is-front', shellId === id);
  }

  // Opens the next free shell and returns it, or null when all shells are open.
  function spawn(from, { quiet = false } = {}) {
    const id = nextShellId(state);
    if (!id) {
      if (!quiet) from.print([{ kind: 'err', text: `spawn: all ${shells.size} shells are open. Use 'exit' to close one.` }]);
      return null;
    }
    const shellState = defaultShell(id);
    shellState.transcript = appendLines([], [{ kind: 'ok', text: `[ ok ] new shell on ${id}` }]);
    state.shells.push(shellState);
    const shell = createShell(shellState, buildWindow(id));
    shell.ready();
    shell.focus();
    save();
    return shell;
  }

  // Easter egg: play "hello world" in a fresh shell, or here when every shell is open.
  function helloWorld(from) {
    const fresh = spawn(from, { quiet: true });
    // A roomier window so the banner and the cup fit without scrolling.
    if (fresh) fresh.resize(760, 620);
    playHello(fresh || from, { reducedMotion });
  }

  // Root on or off for every shell: the prompts, the top bar's user chip, and the session
  // flag that carries it to the next page. Cosmetic only; it grants nothing.
  function setRoot(value) {
    isRoot = value === true;
    if (isRoot) writeJson(store, SESSION_KEYS.root, true);
    else removeKey(store, SESSION_KEYS.root);
    for (const shell of shells.values()) shell.refreshPrompt();
    showUser();
  }

  // sudo remembers an accepted password for a while, across shells and pages.
  function sudoRemembered() {
    const at = readJson(store, SESSION_KEYS.sudoAt);
    const now = Date.now();
    return typeof at === 'number' && Number.isFinite(at) && at <= now && now - at < SUDO_REMEMBER_MS;
  }

  function rememberSudo() {
    writeJson(store, SESSION_KEYS.sudoAt, Date.now());
  }

  // ---------- Processes: ps, kill and btop (owner request) ----------
  // The process table lists what is really running on this page, so killing a process
  // does what it says. Linux rules apply: init and kernel threads ignore signals; only
  // root may signal root's processes; interactive bash ignores SIGTERM but not SIGKILL;
  // a killed system daemon (cspd) is respawned with a new PID. Killing the hypervisor
  // shuts the machine down (SIGTERM) or crashes it (SIGKILL), then it reboots.
  // CPU and memory figures are estimates; ui/btop.js measures the frame rate itself.
  let cspPid = 333;
  let nextPid = 4000 + Math.floor(Math.random() * 400);
  let btop = null; // { pid, shellId, quit }
  const BG_PROCESS = Object.freeze({ hex_float: 'hexfloat', synthwave: 'synthwave', starfield: 'starfield', circuit: 'circuit' });
  const est = (base, spread) => Math.round(Math.max(0, base + (Math.random() - 0.5) * spread) * 10) / 10;

  function processTable() {
    const list = [
      { pid: 1, user: 'root', name: 'init', cmd: '/sbin/init', tty: '?', cpu: 0, mem: 0.4, kind: 'init' },
      { pid: 2, user: 'root', name: 'kthreadd', cmd: '[kthreadd]', tty: '?', cpu: 0, mem: 0, kind: 'kernel' },
      { pid: 14, user: 'root', name: 'kworker/0:1', cmd: '[kworker/0:1-events]', tty: '?', cpu: est(0.2, 0.3), mem: 0, kind: 'kernel' },
      { pid: 300, user: 'root', name: 'hypervisord', cmd: '/usr/sbin/hypervisord --vm wafflesOS', tty: '?', cpu: est(0.8, 0.6), mem: 3.1, kind: 'hypervisor' },
      { pid: cspPid, user: 'root', name: 'cspd', cmd: '/usr/sbin/cspd --policy strict', tty: '?', cpu: 0, mem: 0.3, kind: 'csp' },
    ];
    for (const shellState of state.shells) {
      list.push({
        pid: 1201 + SHELL_IDS.indexOf(shellState.id), user: isRoot ? 'root' : TERMINAL_USER, name: 'bash', cmd: '-bash',
        tty: shellState.id, cpu: est(0.1, 0.1), mem: 0.6, kind: 'shell', target: shellState.id,
      });
    }
    const background = currentBackground();
    if (matrixActive()) list.push({ pid: 2102, user: TERMINAL_USER, name: 'cmatrix', cmd: 'cmatrix -b', tty: '?', cpu: est(7, 2), mem: 1.1, kind: 'matrix' });
    else if (Object.hasOwn(BG_PROCESS, background)) {
      list.push({ pid: 2101, user: TERMINAL_USER, name: BG_PROCESS[background], cmd: `bgd --scene ${background}`, tty: '?', cpu: est(5, 2), mem: 1.6, kind: 'background' });
    }
    if (screensaverRunning()) {
      const awake = !document.querySelector('.screensaver');
      list.push({ pid: 2201, user: TERMINAL_USER, name: 'xscreensaver', cmd: 'xscreensaver -no-splash', tty: '?', cpu: awake ? 0 : est(6, 2), mem: 0.9, kind: 'screensaver' });
    }
    const scramble = scrambleProcess();
    if (scramble) list.push({ pid: 2301, user: TERMINAL_USER, name: 'statusd', cmd: `statusd --tags ${scramble.tags}`, tty: '?', cpu: est(0.4 * scramble.tags, 0.3), mem: 0.2, kind: 'scramble' });
    if (btop) list.push({ pid: btop.pid, user: TERMINAL_USER, name: 'btop', cmd: 'btop', tty: btop.shellId, cpu: est(1.2, 0.6), mem: 0.8, kind: 'btop' });
    return list;
  }

  // What the engine and btop see: the table without the internal fields.
  const publicTable = () => processTable().map(({ pid, user, name, cmd, tty, cpu, mem }) => ({ pid, user, name, cmd, tty, cpu, mem }));

  // Sends a signal. Returns an error message, or null when the signal was delivered
  // (which includes being ignored, as init, kernel threads and bash do with some).
  function signalProcess(pid, signal) {
    const proc = processTable().find((p) => p.pid === pid);
    if (!proc) return 'No such process';
    if (proc.user === 'root' && !isRoot) return 'Operation not permitted';
    const home = () => reboot({ home: true });
    switch (proc.kind) {
      case 'hypervisor':
        if (signal === 'KILL') {
          crashAndReboot({ stopCode: 'HYPERVISOR_KILLED', advice: 'let the hypervisor shut down on its own instead of SIGKILLing it', reboot: home, reducedMotion });
        } else {
          const primary = shells.get('tty1');
          if (primary) primary.print([{ kind: 'out', text: 'hypervisord: caught SIGTERM, shutting down wafflesOS...' }]);
          window.setTimeout(() => powerOffAndReboot({ reboot: home, reducedMotion }), 900);
        }
        break;
      case 'csp':
        // A system daemon: init starts it again straight away, under a new PID.
        cspPid += 1 + Math.floor(Math.random() * 40);
        break;
      case 'shell':
        if (signal !== 'KILL') break; // interactive bash ignores SIGTERM
        if (proc.target === 'tty1') {
          // The login shell died: getty logs the visitor in again on a fresh tty1.
          if (isRoot) setRoot(false);
          const primary = shells.get('tty1');
          if (primary) primary.relogin();
        } else {
          close(proc.target);
        }
        break;
      case 'background':
        setBackground('default', { reducedMotion });
        break;
      case 'matrix':
        toggleMatrixBackground({ reducedMotion });
        break;
      case 'screensaver':
        killScreensaver();
        break;
      case 'scramble':
        killStatusScramble();
        break;
      case 'btop':
        if (btop) btop.quit();
        break;
      default:
        break; // init and kernel threads ignore signals from user space
    }
    return null;
  }

  // btop opens in a big new shell window (like hello world), or here when all are open.
  function openBtop(from) {
    if (btop) {
      from.print([{ kind: 'err', text: 'btop: already running. Press q in its window to quit it.' }]);
      return;
    }
    const fresh = spawn(from, { quiet: true });
    const host = fresh || from;
    if (fresh) fresh.resize(Math.min(1000, window.innerWidth - 40), Math.min(680, window.innerHeight - 110));
    const pid = nextPid;
    nextPid += 1;
    btop = { pid, shellId: host.id, quit: () => {} };
    const handle = runBtop({
      shell: host,
      processes: publicTable,
      kill: (target, signal) => signalProcess(target, signal),
      uptime: () => (Date.now() - bootedAt) / 1000,
      onExit: () => { btop = null; },
    });
    if (btop) btop.quit = handle.quit;
  }

  function showUser() {
    const chips = document.querySelectorAll('.topbar .status li');
    if (chips.length >= 3) chips[2].textContent = `User ${isRoot ? 'root' : TERMINAL_USER}`;
  }

  function close(id) {
    const shell = shells.get(id);
    if (!shell || id === 'tty1') return;
    shell.destroy();
    shells.delete(id);
    state.shells = state.shells.filter((s) => s.id !== id);
    save();
    const primary = shells.get('tty1');
    if (primary) primary.focus();
  }

  function goto(action) {
    if (action.page === page) {
      const target = action.anchor ? byId(action.anchor) : null;
      if (!target) {
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
        return;
      }
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      target.classList.remove('module-flash');
      // Restart the highlight animation on repeated opens.
      void target.offsetWidth;
      target.classList.add('module-flash');
      return;
    }
    // Fixed internal URL built from reviewed page paths; nothing typed reaches it.
    if (!Object.hasOwn(PAGES, action.page)) return;
    const url = '../'.repeat(PAGES[page].depth) + PAGES[action.page].path + (action.anchor ? `#${action.anchor}` : '');
    writeJson(store, SESSION_KEYS.shellNav, true);
    writeNow();
    window.setTimeout(() => window.location.assign(url || './'), 250);
  }

  // home: start again on the home page (the fork bomb crash), so the full BIOS boot plays;
  // otherwise reload the current page, as the "reboot" command always has.
  function reboot({ home = false } = {}) {
    // Stop pending and future saves so nothing is written back after the reset.
    rebooting = true;
    window.clearTimeout(saveTimer);
    removeKey(store, TERMINAL_STORAGE_KEY);
    removeKey(store, SESSION_KEYS.bootPlayed);
    removeKey(store, SESSION_KEYS.visited);
    removeKey(store, SESSION_KEYS.hintShown);
    removeKey(store, SESSION_KEYS.matrix);
    removeKey(store, SESSION_KEYS.background);
    removeKey(store, SESSION_KEYS.theme);
    removeKey(store, SESSION_KEYS.bootedAt);
    removeKey(store, SESSION_KEYS.root);
    removeKey(store, SESSION_KEYS.sudoAt);
    removeKey(store, SESSION_KEYS.noScreensaver);
    for (const shell of shells.values()) shell.disable();
    window.setTimeout(() => {
      try {
        window.history.scrollRestoration = 'manual';
      } catch {
        // Older browsers: the page may reopen scrolled; the boot still covers it.
      }
      window.scrollTo(0, 0);
      // Fixed internal URL built from the reviewed page depth; nothing typed reaches it.
      if (home) window.location.assign('../'.repeat(PAGES[page].depth) || './');
      else window.location.reload();
    }, 400);
  }

  // Links that leave the page save first, so nothing typed just before is lost.
  const onPageHide = () => writeNow();
  window.addEventListener('pagehide', onPageHide);

  // ---------- Window chrome for spawned shells ----------

  function buildWindow(id) {
    const root = el('section', { className: `console console-spawned shell-${id}`, attrs: { 'aria-label': `Console ${id}` } }, [
      el('div', { className: 'console-bar' }, [
        el('span', { className: 'console-lights' }, [el('span'), el('span'), el('span')]),
        el('span', { text: `console · ${TERMINAL_USER}@${TERMINAL_HOST}` }),
        el('span', { text: id }),
      ]),
      el('div', { className: 'console-body' }),
    ]);
    document.body.appendChild(root);
    return root;
  }

  // ---------- One shell window ----------

  function createShell(shellState, root) {
    const id = shellState.id;
    const primary = id === 'tty1';
    const body = root.querySelector('.console-body');
    const bar = root.querySelector('.console-bar');
    const history = [];
    let historyIndex = 0;
    const cleanups = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanups.push(() => target.removeEventListener(type, handler, options));
    };

    const prompt = (where = cwd, asRoot = false) => [
      el('span', { className: asRoot ? 'console-user is-root' : 'console-user', text: `${asRoot ? 'root' : TERMINAL_USER}@${TERMINAL_HOST}` }),
      `:${where}${asRoot ? '#' : '$'} `,
    ];
    // Set while sudo waits for its password (see the sudo section below).
    let pendingSudo;
    const output = el('div', { className: 'term-output', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': `Console output ${id}` } });
    const before = el('span', { className: 'term-text' });
    const cursor = el('span', { className: 'term-cursor', attrs: { 'aria-hidden': 'true' } });
    const after = el('span', { className: 'term-text' });
    const input = el('input', {
      className: 'term-input',
      attrs: {
        type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        enterkeyhint: 'enter', maxlength: String(LIMITS.commandRaw), 'aria-label': `Console command on ${id}. Type help for commands.`,
      },
    });
    // The live prompt sits in its own span so it can change (root, or sudo's password prompt).
    const promptBox = el('span', { className: 'term-prompt' }, prompt(cwd, isRoot));
    const inputLine = el('div', { className: 'term-input-line' }, [promptBox, el('span', { className: 'term-mirror', attrs: { 'aria-hidden': 'true' } }, [before, cursor, after]), input]);
    function refreshPrompt() {
      promptBox.replaceChildren(...(pendingSudo ? [`${passwordPrompt(pendingSudo.via)} `] : prompt(cwd, isRoot)));
    }

    const minimizeButton = el('button', { className: 'console-button', text: '_', attrs: { 'aria-label': `Minimize ${id}`, title: 'Minimize' } });
    const secondButton = primary
      ? el('button', { className: 'console-button', text: '[ ]', attrs: { 'aria-label': 'Pop out console', title: 'Pop out / dock' } })
      : el('button', { className: 'console-button', text: 'x', attrs: { 'aria-label': `Close ${id}`, title: 'Close shell' } });
    bar.appendChild(el('span', { className: 'console-controls' }, [minimizeButton, secondButton]));

    // History sits above this page's load log until the page finishes loading; then the
    // log joins the history and the prompt follows it.
    const log = primary ? body.querySelector('.console-log') : null;
    body.insertBefore(output, log);
    body.appendChild(inputLine);
    // Make the live load log match what the history will keep, so nothing changes when it
    // joins the history: its prompt shows the directory the visitor came from, and the
    // "cd" line is dropped when the visitor typed the cd themselves.
    const logPrompt = log ? log.querySelector('.line-prompt') : null;
    if (logPrompt && fromShell) logPrompt.remove();
    else if (logPrompt) {
      const user = logPrompt.querySelector('.console-user');
      const text = user ? user.nextSibling : null;
      if (text && text.nodeType === Node.TEXT_NODE) text.textContent = `:${state.oldpwd || '~'}$ `;
    }
    // Keep the newest log line in view while the page's load sequence prints.
    for (const type of ['animationstart', 'animationend']) {
      listen(body, type, () => { if (log && log.isConnected) scrollToEnd(); });
    }
    root.classList.add('is-interactive');

    // ---------- Rendering ----------

    function renderLine(entry) {
      if (entry.kind === 'cmd') return el('p', { className: 'term-line term-cmd' }, [...prompt(entry.cwd || cwd, entry.root === true), el('span', { text: entry.text })]);
      // neofetch's logo: the wafflesOS image (terminal.css floats it beside the info). The
      // path is fixed and built from this page's reviewed depth, never from stored text.
      if (entry.kind === 'logo') {
        return el('p', { className: 'term-line term-logo', attrs: { 'aria-hidden': 'true' } }, [
          el('img', { attrs: { src: `${'../'.repeat(PAGES[page].depth)}assets/media/icons/logo-512.png`, alt: '' } }),
        ]);
      }
      // neofetch info: a short label before its colon gets the accent; lines without one
      // (user@host and its underline) take the brand color.
      if (entry.kind === 'fetch') {
        const colon = entry.text.indexOf(':');
        return el('p', { className: 'term-line term-fetch' }, colon > 0 && colon < 16
          ? [el('span', { className: 'term-key', text: entry.text.slice(0, colon + 1) }), entry.text.slice(colon + 1)]
          : [el('span', { className: 'term-lead', text: entry.text })]);
      }
      // git log: the commit hash in the brand color.
      if (entry.kind === 'git') {
        return el('p', { className: 'term-line term-git' }, [el('span', { className: 'term-lead', text: entry.text.slice(0, 7) }), entry.text.slice(7)]);
      }
      return el('p', { className: `term-line term-${entry.kind}`, text: entry.text });
    }

    function trimOutput() {
      while (output.childElementCount > LIMITS.terminalLines) output.firstElementChild.remove();
    }

    function scrollToEnd() {
      body.scrollTop = body.scrollHeight;
    }

    function updateMirror() {
      // sudo's password is never shown, not even as dots, like the real thing.
      const value = pendingSudo ? '' : input.value;
      const caret = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
      before.textContent = value.slice(0, caret);
      after.textContent = value.slice(caret);
    }

    function show(lines) {
      const fragment = document.createDocumentFragment();
      for (const entry of lines) fragment.appendChild(renderLine(entry));
      output.appendChild(fragment);
      trimOutput();
      scrollToEnd();
    }

    function print(lines) {
      show(lines);
      shellState.transcript = appendLines(shellState.transcript, lines);
      save();
    }

    // Types lines out like a fast terminal: a command's prompt appears at once and its
    // text is typed; output lines follow quicker. Shared by every shell; today it types
    // the lines a page adds on arrival (tty1's "cd <dir>" and "resumed"). The transcript
    // takes the full lines first, so leaving mid-typing loses nothing, and the prompt
    // waits (.is-busy) until typing ends. Reduced motion prints at once.
    let typing = null;
    function typeOut(lines) {
      shellState.transcript = appendLines(shellState.transcript, lines);
      save();
      if (reducedMotion) {
        show(lines);
        return Promise.resolve();
      }
      return busyWhile(() => typeLines(lines));
    }

    // Renders lines with the typing effect (no transcript change; callers keep the lines).
    async function typeLines(lines) {
      for (const entry of lines) {
        const command = entry.kind === 'cmd';
        const node = renderLine({ ...entry, text: '' });
        const target = command ? node.lastChild : node;
        output.appendChild(node);
        trimOutput();
        const step = command ? 1 : TYPE.outStep;
        for (let i = step; i < entry.text.length + step; i += step) {
          if (!alive) return;
          target.textContent = entry.text.slice(0, i);
          scrollToEnd();
          await wait(command ? TYPE.cmd : TYPE.out);
        }
        await wait(command ? TYPE.afterCmd : TYPE.afterOut);
      }
    }

    // Runs an animation with the prompt hidden (.is-busy), after any one already running.
    function busyWhile(task) {
      const previous = typing || Promise.resolve();
      const run = previous.then(() => {
        root.classList.add('is-busy');
        return task();
      });
      typing = run.finally(() => {
        if (typing === current) typing = null;
        root.classList.remove('is-busy');
        window.requestAnimationFrame(scrollToEnd);
      });
      const current = typing;
      return typing;
    }

    // ---------- Window management ----------

    function applyWindow() {
      const win = shellState.window;
      root.classList.toggle('is-floating', win.floating);
      root.classList.toggle('is-minimized', win.minimized);
      if (primary) secondButton.setAttribute('aria-label', win.floating ? 'Dock console' : 'Pop out console');
      minimizeButton.setAttribute('aria-label', win.minimized ? `Restore ${id}` : `Minimize ${id}`);
      minimizeButton.setAttribute('aria-expanded', win.minimized ? 'false' : 'true');
      if (win.floating) {
        shellState.window = clampWindow(win, window.innerWidth, window.innerHeight);
        root.style.left = `${shellState.window.x}px`;
        root.style.top = `${shellState.window.y}px`;
        root.style.width = `${shellState.window.w}px`;
        root.style.height = `${shellState.window.h}px`;
      } else {
        for (const property of ['left', 'top', 'width', 'height']) root.style.removeProperty(property);
      }
    }

    function setFloating(floating) {
      if (!primary) return;
      const win = shellState.window;
      if (floating && !win.floating) {
        // Pop out where it sits, at no more than the default window size.
        const rect = root.getBoundingClientRect();
        win.x = rect.left;
        win.y = rect.top;
        win.w = Math.min(rect.width, TERMINAL_WINDOW.defaultWidth);
        win.h = Math.min(win.minimized ? win.h : rect.height, TERMINAL_WINDOW.defaultHeight);
      }
      win.floating = floating;
      applyWindow();
      save();
    }

    listen(secondButton, 'click', () => (primary ? setFloating(!shellState.window.floating) : close(id)));
    listen(minimizeButton, 'click', () => {
      shellState.window.minimized = !shellState.window.minimized;
      applyWindow();
      save();
      if (!shellState.window.minimized) input.focus({ preventScroll: true });
    });
    listen(root, 'pointerdown', () => bringToFront(id));

    // Drag by the title bar. A docked tty1 pops out on the first drag.
    let drag = null;
    listen(bar, 'pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      if (!shellState.window.floating) setFloating(true);
      const win = shellState.window;
      // Keep the grab point on the (possibly just shrunk) title bar.
      const dx = Math.max(8, Math.min(event.clientX - win.x, win.w - 48));
      const dy = Math.max(4, Math.min(event.clientY - win.y, TERMINAL_WINDOW.barHeight - 4));
      drag = { id: event.pointerId, dx, dy };
      try {
        bar.setPointerCapture(event.pointerId);
      } catch {
        // Pointer already released; the drag simply ends on the next pointerup.
      }
      root.classList.add('is-dragging');
      event.preventDefault();
    });
    listen(bar, 'pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      shellState.window.x = event.clientX - drag.dx;
      shellState.window.y = event.clientY - drag.dy;
      applyWindow();
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = null;
      root.classList.remove('is-dragging');
      save();
    };
    listen(bar, 'pointerup', endDrag);
    listen(bar, 'pointercancel', endDrag);

    // CSS resize changes the size; record it while floating.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        const win = shellState.window;
        if (!win.floating || win.minimized || drag) return;
        const w = root.offsetWidth;
        const h = root.offsetHeight;
        if (w !== win.w || h !== win.h) {
          win.w = w;
          win.h = h;
          save();
        }
      });
      observer.observe(root);
      cleanups.push(() => observer.disconnect());
    }

    listen(window, 'resize', () => {
      if (shellState.window.floating) applyWindow();
    });

    // ---------- Commands ----------

    function context() {
      return {
        page,
        shell: id,
        oldpwd: state.oldpwd,
        background: currentBackground(),
        theme: currentTheme(),
        found: foundEggs(),
        // This shell's stored command lines: already validated, never raw input.
        history: shellState.transcript.filter((entry) => entry.kind === 'cmd' && entry.text).map((entry) => entry.text),
        uptime: (Date.now() - bootedAt) / 1000,
        now: Date.now(),
        root: isRoot,
        processes: publicTable(),
        nextPid,
      };
    }

    function run(raw) {
      const result = execute(raw, context());
      nextPid += 1; // every command line gets the next PID, as ps shows
      if (raw.trim().length === 0 && result.lines.length === 0) {
        print([cmdLine('')]);
        return;
      }

      if (history[history.length - 1] !== raw) history.push(raw);
      if (history.length > LIMITS.terminalHistory) history.shift();
      historyIndex = history.length;

      if (result.action && result.action.type === 'clear') {
        output.replaceChildren();
        if (log && log.isConnected) log.remove();
        shellState.transcript = [];
        save();
        return;
      }

      // Shown as typed in this page view; kept only in its validated form, so text that
      // is not a command (a password typed by accident, say) never reaches storage.
      show([cmdLine(raw.slice(0, LIMITS.terminalLineLength)), ...result.lines]);
      shellState.transcript = appendLines(shellState.transcript, [cmdLine(result.valid ? result.echo : NOT_KEPT), ...result.lines]);
      save();
      apply(result);
    }

    // A command line as the prompt showed it: the directory, and root's prompt if root.
    function cmdLine(text) {
      return isRoot ? { kind: 'cmd', text, cwd, root: true } : { kind: 'cmd', text, cwd };
    }

    // Applies a result's easter egg and action (its lines are already printed).
    function apply(result) {
      // An easter egg found for the first time: say so (ui/hunt.js).
      const found = result.egg ? recordEgg(result.egg) : null;
      if (found) print([found]);

      const action = result.action;
      if (!action) return;
      if (action.type === 'goto') goto(action);
      else if (action.type === 'reboot') reboot();
      else if (action.type === 'spawn') spawn(api);
      else if (action.type === 'hello') helloWorld(api);
      else if (action.type === 'matrix') print([toggleMatrixBackground({ reducedMotion })]);
      else if (action.type === 'background') {
        const lines = setBackground(action.id, { reducedMotion });
        if (lines.length) print(lines);
      }
      else if (action.type === 'theme') setTheme(action.id);
      else if (action.type === 'hunt-reset') resetHunt();
      else if (action.type === 'rmrf') runRmRf({ shell: api });
      else if (action.type === 'sudo') sudo(action.inner, action.via === 'su' ? 'su' : 'sudo');
      else if (action.type === 'unroot') setRoot(false);
      else if (action.type === 'sudo-forget') removeKey(store, SESSION_KEYS.sudoAt);
      else if (action.type === 'btop') openBtop(api);
      else if (action.type === 'kill') {
        for (const pid of action.pids) {
          const error = signalProcess(pid, action.signal);
          if (error) print([{ kind: 'err', text: `bash: kill: (${pid}) - ${error}` }]);
        }
      }
      else if (action.type === 'forkbomb') {
        runForkBomb({ shell: api, spawn: () => spawn(api, { quiet: true }), reboot: () => reboot({ home: true }), reducedMotion });
      }
      else if (action.type === 'exit') window.setTimeout(() => close(id), 300);
    }

    // ---------- sudo and su (owner request; groundwork for Layer 2) ----------
    // They behave as on Linux. sudo <command> asks for the visitor's password and runs
    // that one command as root; the shell stays the visitor's, and for a while sudo
    // remembers the password (SUDO_REMEMBER_MS). sudo su, sudo -i and sudo -s open a root
    // shell. su asks for root's password ("Password:") and opens a root shell, or with -c
    // runs one command. In a root shell nothing asks again; exit leaves it.
    // The password is never shown, stored, kept in history or logged: only
    // features/puzzles.js sees it, to compare its SHA-256 with data/puzzles.js. A wrong one
    // waits a moment, as PAM does; sudo then allows three tries in all, su just fails.
    // Escape or Ctrl+C cancels. Root is cosmetic: the prompt, whoami, and what rm does.

    function sudo(inner, via) {
      if (isRoot || (via === 'sudo' && sudoRemembered())) {
        elevated(inner, via);
        return;
      }
      askPassword({ inner, via, tries: 0 });
    }

    function askPassword(pending) {
      pendingSudo = pending;
      root.classList.add('is-secret');
      refreshPrompt();
      updateMirror();
    }

    // sudo asks for the visitor's password; su asks for root's, the way each really does.
    function passwordPrompt(via) {
      return via === 'su' ? 'Password:' : `[sudo] password for ${TERMINAL_USER}:`;
    }

    function endPassword() {
      pendingSudo = undefined;
      root.classList.remove('is-secret');
      refreshPrompt();
    }

    async function submitPassword(raw) {
      const pending = pendingSudo;
      endPassword();
      print([{ kind: 'out', text: passwordPrompt(pending.via) }]);
      api.setBusy(true);
      const accepted = await matchesPuzzle(raw, PUZZLES.root.sha256);
      if (!accepted) await wait(FAIL_DELAY_MS);
      api.setBusy(false);
      api.focus();
      if (accepted) {
        elevated(pending.inner, pending.via);
        return;
      }
      if (pending.via === 'su') {
        print([{ kind: 'err', text: 'su: Authentication failure' }]);
        return;
      }
      const tries = pending.tries + 1;
      if (tries < SUDO_TRIES) {
        print([{ kind: 'out', text: 'Sorry, try again.' }]);
        askPassword({ ...pending, tries });
        return;
      }
      print([{ kind: 'err', text: `sudo: ${SUDO_TRIES} incorrect password attempts` }]);
    }

    // The password was accepted (or was not needed): open a root shell, or run the one
    // command as root.
    function elevated(inner, via) {
      if (via === 'sudo' && !isRoot) rememberSudo();
      if (inner === null) {
        if (!isRoot) setRoot(true);
        return;
      }
      if (inner === 'unknown') {
        print([{ kind: 'err', text: `${via === 'su' ? 'bash' : 'sudo'}: command not found` }]);
        return;
      }
      // inner is the engine's own validated echo of the command, never raw input.
      const result = execute(inner, { ...context(), root: true });
      if (result.action && result.action.type === 'clear') {
        run('clear');
        return;
      }
      print(result.lines);
      apply(result);
    }

    listen(input, 'keydown', (event) => {
      // A full-screen program (btop) gets every key while it runs.
      if (grabbed) {
        grabbed.onKey(event);
        return;
      }
      if (pendingSudo) {
        if (event.key === 'Enter') {
          event.preventDefault();
          const raw = input.value;
          input.value = '';
          submitPassword(raw);
        } else if (event.key === 'Escape' || (event.key === 'c' && event.ctrlKey)) {
          event.preventDefault();
          input.value = '';
          const { via } = pendingSudo;
          endPassword();
          print([{ kind: 'out', text: `${passwordPrompt(via)} ^C` }]);
        } else if (event.key === 'Tab' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          // No completion or history while typing a password.
          event.preventDefault();
        }
        window.requestAnimationFrame(updateMirror);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const raw = input.value;
        input.value = '';
        run(raw);
      } else if (event.key === 'ArrowUp') {
        if (history.length === 0) return;
        event.preventDefault();
        historyIndex = Math.max(0, historyIndex - 1);
        input.value = history[historyIndex];
      } else if (event.key === 'ArrowDown') {
        if (history.length === 0) return;
        event.preventDefault();
        historyIndex = Math.min(history.length, historyIndex + 1);
        input.value = historyIndex === history.length ? '' : history[historyIndex];
      } else if (event.key === 'Tab' && input.value.length > 0) {
        const completed = complete(input.value, { page });
        if (completed) {
          event.preventDefault();
          input.value = completed;
        }
      } else if (event.key === 'l' && event.ctrlKey) {
        event.preventDefault();
        run('clear');
      }
      window.requestAnimationFrame(updateMirror);
    });
    for (const type of ['input', 'keyup', 'click', 'select']) listen(input, type, updateMirror);
    listen(input, 'focus', () => { root.classList.add('is-focused'); bringToFront(id); updateMirror(); });
    listen(input, 'blur', () => root.classList.remove('is-focused'));

    // Clicking the console focuses the prompt unless the visitor is selecting text.
    listen(body, 'mouseup', () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) input.focus({ preventScroll: true });
    });

    // ---------- Restore ----------

    show(shellState.transcript);
    applyWindow();
    updateMirror();

    // Animation helpers: live lines are on screen only until clearLive(); print() is
    // what the shell keeps.
    const liveNodes = [];
    let alive = true;
    function liveNode(node) {
      liveNodes.push(node);
      output.appendChild(node);
      scrollToEnd();
      return node;
    }

    // ---------- Full-screen programs (btop) ----------
    // grab() sends every key to the program instead of the prompt (which hides but keeps
    // focus); screen() is a block of rows the program redraws; metrics() is how many
    // characters fit. The program's text still renders only through el(), as text.
    let grabbed = null;
    let charBox = null;
    function grab(onKey, onPick) {
      grabbed = { onKey, onPick };
      input.value = '';
      root.classList.add('is-grabbed');
      updateMirror();
      return () => {
        grabbed = null;
        root.classList.remove('is-grabbed');
        window.requestAnimationFrame(scrollToEnd);
      };
    }
    function screen() {
      const node = el('div', { className: 'term-screen', attrs: { role: 'img', 'aria-label': 'btop process monitor. Up and Down select a process, t terminates it, k kills it, q quits.' } });
      output.appendChild(node);
      let pickPids = [];
      let pickStart = 0;
      node.addEventListener('click', (event) => {
        const row = event.target.closest('.btop-row');
        const index = row ? [...node.children].indexOf(row) - pickStart : -1;
        if (grabbed && grabbed.onPick && index >= 0 && index < pickPids.length) grabbed.onPick(pickPids[index]);
        input.focus({ preventScroll: true });
      });
      return {
        // rows: [[className, text], ...] per row. pids/start: which rows are processes.
        set(rows, pids = [], start = 0) {
          node.replaceChildren(...rows.map((row) => el('div', { className: 'btop-row' }, row.map(([cls, text]) => el('span', { className: cls, text })))));
          pickPids = pids;
          pickStart = start;
          scrollToEnd();
        },
        remove() {
          node.remove();
        },
      };
    }
    function metrics() {
      if (!charBox) {
        const probe = el('span', { className: 'term-screen term-probe', text: 'MMMMMMMMMM' });
        const braille = el('span', { className: 'term-screen term-probe', text: String.fromCharCode(0x28ff).repeat(10) });
        body.append(probe, braille);
        const a = probe.getBoundingClientRect();
        const b = braille.getBoundingClientRect();
        charBox = { w: a.width / 10 || 8, h: a.height || 18, braille: Math.abs(b.width - a.width) < a.width * 0.02 };
        probe.remove();
        braille.remove();
      }
      const style = window.getComputedStyle(body);
      const width = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height = body.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      return { cols: Math.floor(width / charBox.w) - 1, rows: Math.floor(height / charBox.h) - 1, braille: charBox.braille };
    }

    const api = {
      id,
      grab,
      screen,
      metrics,
      // The login shell was killed: start a fresh session on this tty.
      relogin() {
        output.replaceChildren();
        if (log && log.isConnected) log.remove();
        shellState.transcript = [];
        print([{ kind: 'ok', text: `[ ok ] ${id}: session restarted (login respawned by getty)` }]);
      },
      root,
      print,
      refreshPrompt,
      alive: () => alive,
      live(kind) {
        const node = liveNode(el('p', { className: `term-line term-${kind}` }));
        return { set: (text) => { node.textContent = String(text); scrollToEnd(); } };
      },
      block(kind) {
        const node = liveNode(el('p', { className: `term-line term-anim term-${kind}` }));
        return { set: (lines) => { node.textContent = lines.join(String.fromCharCode(10)); scrollToEnd(); } };
      },
      clearLive() {
        for (const node of liveNodes.splice(0)) node.remove();
      },
      // Resizes a floating window (clamped to the viewport).
      resize(w, h) {
        if (!shellState.window.floating) return;
        shellState.window.w = w;
        shellState.window.h = h;
        applyWindow();
        save();
      },
      setBusy(busy) {
        root.classList.toggle('is-busy', busy);
        input.disabled = busy;
        // The prompt line only takes space once it is shown again; scroll after layout
        // so it is fully in view instead of cut off at the bottom.
        if (!busy) window.requestAnimationFrame(scrollToEnd);
      },
      focus() {
        // The prompt is hidden while lines type out; focus it once it is back.
        const go = () => {
          if (!shellState.window.minimized) input.focus({ preventScroll: true });
          scrollToEnd();
        };
        if (typing) typing.then(go);
        else go();
      },
      disable() {
        input.disabled = true;
      },
      // The page has finished loading: its log joins the history, then the prompt shows.
      ready() {
        if (log && log.isConnected) {
          const cached = html.classList.contains('page-cached');
          const lines = captureLog(log, cached, cwd, fromShell, state.oldpwd || '~');
          log.remove();
          // A fresh page's log was already typed on screen by the CSS load sequence, so it
          // joins the history as is. A cached page has no log to show: type its lines.
          const shown = cached ? typeOut(lines) : (print(lines), Promise.resolve());
          // Once per machine start: a tip under the home page's startup log.
          if (page === 'home' && readJson(store, SESSION_KEYS.hintShown) !== true) {
            writeJson(store, SESSION_KEYS.hintShown, true);
            shown.then(() => print([{ kind: 'out', text: "tip: type 'help' or '?' to see commands. Curious? Try 'hello world'." }]));
          }
        }
        root.classList.add('is-ready');
        scrollToEnd();
      },
      destroy() {
        alive = false;
        for (const cleanup of cleanups.splice(0)) cleanup();
        root.remove();
      },
    };
    shells.set(id, api);
    return api;
  }

  // ---------- Start ----------

  // Root carried over from an earlier page shows in the top bar too.
  if (isRoot) showUser();

  for (const shellState of state.shells) {
    const shell = createShell(shellState, shellState.id === 'tty1' ? primaryRoot : buildWindow(shellState.id));
    // Spawned shells have no page load log: their prompt stays up while tty1 loads the
    // page, so they read as the same windows carried over, not new ones.
    if (shellState.id !== 'tty1') shell.ready();
  }

  const ready = () => {
    if (isReady) return;
    isReady = true;
    for (const shell of shells.values()) shell.ready();
    const finePointer = Boolean(window.matchMedia) && window.matchMedia('(pointer: fine)').matches;
    if (finePointer) shells.get('tty1').focus();
  };
  // The idle screensaver is an easter egg too: waking from it counts for "hunt".
  startScreensaver({
    reducedMotion,
    onWake: () => {
      const found = recordEgg('screensaver');
      const primary = shells.get('tty1');
      if (found && primary) primary.print([found]);
    },
  });

  if (html.classList.contains('boot-run')) {
    const observer = new MutationObserver(() => {
      if (!html.classList.contains('boot-run')) {
        observer.disconnect();
        ready();
      }
    });
    observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  } else {
    ready();
  }

  return () => {
    window.clearTimeout(saveTimer);
    window.removeEventListener('pagehide', onPageHide);
    for (const shell of shells.values()) shell.destroy();
  };
}
