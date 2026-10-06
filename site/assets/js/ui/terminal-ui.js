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
import { LIMITS, TERMINAL_STORAGE_KEY, TERMINAL_USER, TERMINAL_HOST, TERMINAL_WINDOW, SESSION_KEYS } from '../core/constants.js';
import { PAGES, PAGE_IDS } from '../data/commands.js';
import { pickKnown } from '../utils/validate.js';
import { playHello } from './hello-animation.js';
import { resumeMatrix } from './matrix-rain.js';
import { resumeBackground, setBackground, currentBackground, toggleMatrixBackground } from './backgrounds.js';
import { runForkBomb } from './fork-bomb.js';

const NOT_KEPT = '(input not kept)';

const LOG_COMMAND = /^[a-z0-9 ./~_-]{1,64}$/;
// Typing speed for lines a shell types out (ms). Commands type a character at a time
// after their prompt appears; output lines print a few characters at a time.
const TYPE = Object.freeze({ cmd: 24, out: 8, outStep: 4, afterCmd: 140, afterOut: 50 });
const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });
const BAR_FULL = '#'.repeat(20);

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
  }
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

    const prompt = (where = cwd) => [el('span', { className: 'console-user', text: `${TERMINAL_USER}@${TERMINAL_HOST}` }), `:${where}$ `];
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
    const inputLine = el('div', { className: 'term-input-line' }, [...prompt(), el('span', { className: 'term-mirror', attrs: { 'aria-hidden': 'true' } }, [before, cursor, after]), input]);

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
      if (entry.kind === 'cmd') return el('p', { className: 'term-line term-cmd' }, [...prompt(entry.cwd || cwd), el('span', { text: entry.text })]);
      return el('p', { className: `term-line term-${entry.kind}`, text: entry.text });
    }

    function trimOutput() {
      while (output.childElementCount > LIMITS.terminalLines) output.firstElementChild.remove();
    }

    function scrollToEnd() {
      body.scrollTop = body.scrollHeight;
    }

    function updateMirror() {
      const value = input.value;
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

    function run(raw) {
      const result = execute(raw, { page, shell: id, oldpwd: state.oldpwd, background: currentBackground() });
      if (raw.trim().length === 0 && result.lines.length === 0) {
        print([{ kind: 'cmd', text: '', cwd }]);
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
      show([{ kind: 'cmd', text: raw.slice(0, LIMITS.terminalLineLength), cwd }, ...result.lines]);
      shellState.transcript = appendLines(shellState.transcript, [{ kind: 'cmd', text: result.valid ? result.echo : NOT_KEPT, cwd }, ...result.lines]);
      save();

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
      else if (action.type === 'forkbomb') {
        runForkBomb({ shell: api, spawn: () => spawn(api, { quiet: true }), reboot: () => reboot({ home: true }), reducedMotion });
      }
      else if (action.type === 'exit') window.setTimeout(() => close(id), 300);
    }

    listen(input, 'keydown', (event) => {
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

    const api = {
      root,
      print,
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
