// Layer 2 entry: the hypervisor (doctrine 1.8, Skeleton 1.10; Layer 2 design doc).
// Loaded only through core/layer-loader.js, on the lab page (site/lab/, prompt ~/lab) by
// ui/terminal-ui.js. "vm" anywhere else takes the visitor to the lab first. Nothing here
// is Layer 2 mission logic, so Layer 3 can load the same hypervisor and VMs.
//
// mountLab() turns the lab page's stage into a hypervisor manager, like VMware's library
// (owner decision): you power machines on, not missions.
//   - Library: a side panel listing every VM (data/commands.js VMS) with its state:
//     running, minimized, powered off or encrypted. Selecting one shows its details
//     (image, role, hostname, lab address) and a plain Power on / Power off control. An
//     encrypted VM has no control: its details say it needs its key, earned from a mission
//     ("vm unlock" opens it for testing). refreshGuests() unscrambles a row when its key
//     arrives.
//   - Desk: the hypervisor's screen, where the VM windows live (ui/windows-ui.js). Several
//     can be on it at once, each moved, resized or minimized on its own. The one in front
//     has the keyboard; the others keep running behind it (owner request). A click on
//     a window brings it to the front.
//   - No dock (owner request, October 13, 2026): the library does its job. A click on a
//     running or minimized VM there brings it to the front.
//   - Session (ui/vm-session.js): which VMs run, which is in front, which are minimized
//     and where each window sits, so leaving the lab suspends them all and coming back
//     resumes them as they were.
// Power actions go through tty1 as "vm start" / "vm stop", so the shell shows the same
// lines as typing them.
//
// Each VM window holds its guest's console (features/guest-engine.js): the image's boot
// text, then its shell, with its own working folder, history and screen. The folder and
// the last screen lines are kept in the session, so a VM comes back as it was.
//
// Lifecycle (doctrine section 6): stopGuest() removes a VM with its listeners; page hide
// saves the session and stops effects. Everything renders as text through utils/dom.js,
// and VM names are checked against the fixed VMS list first.

import { el } from '../utils/dom.js';
import { VMS, VM_ENCRYPTION } from '../data/commands.js';
import { VM_SESSION_VERSION, VM_LOG, LIMITS } from '../core/constants.js';
import { bootGuest, runGuest, promptFor, restoreCwd, cwdKey, isSecretPrompt, finishLogin, autoLogin, importFiles, exportFiles, nodeAt, children, completeGuest } from '../features/guest-engine.js';
import { matchesPuzzle } from '../features/puzzles.js';
import { PUZZLES } from '../data/puzzles.js';
import { createVmWindow, createFirmware } from '../ui/windows-ui.js';
import { mountWinbowsDesktop, mountParrotDesktop, mountUbuntuDesktop, mountUbuntuServer, mountSerialConsole, shutdownScreen } from '../ui/guest-desktop.js';
import { readVms, writeVms, readVmFiles, writeVmFiles } from '../ui/vm-session.js';
import { observe } from '../features/mission-engine.js';
import { missionFlags, addMissionFlags, unlockGuests, scenarioFlags, addEvidence, setFixture } from '../ui/lab-progress.js';
import { stateOf as scenarioStateOf } from '../features/scenario.js';

let stage = null; // the lab page's stage element, once mounted
let desk = null; // where the VM windows live
const windows = new Map(); // VM name -> VM window (ui/windows-ui.js), in start order
let focusOrder = []; // running VM names, the most recently in front last
let front = null; // the VM in front, or null when none is on the desk
let selected = VMS[0].id; // the VM whose details the library shows
let run = () => {}; // runs a fixed "vm ..." command in tty1
let unlocked = () => [];
const consoles = new Map(); // VM name -> its guest console (see buildConsole)
const rows = new Map(); // VM name -> { row, name, state }
let details = null; // the library's details pane
const timers = new Set(); // unscramble effects still running
const reducedMotion = Boolean(window.matchMedia) && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const GLYPHS = 'ABCDEF0123456789#$%&*+<>/=?';

const onDesk = (id) => windows.has(id) && !windows.get(id).minimized();
const isOpen = (vm) => !VM_ENCRYPTION || !vm.unlock || unlocked().includes(vm.id);

// ---------- Missions (features/mission-engine.js) ----------
// What the visitor does on a VM, as mission results (the engine's result contract): a
// shell command's result from the guest engine, or a file opened or saved or an app
// opened on the desktop. Evidence a result left joins the shared scenario state; the
// engine says which objectives it meets; the flags are kept (ui/lab-progress.js), a
// finished mission's reward is given, and the VM's desktop shows a notification.
function reportMission(vmId, type, value) {
  reportResult({ seat: vmId, type, value });
}
// Whether a file exists on a running VM (a report waits on its findings file).
function hasFile(vmId, path) {
  const con = consoles.get(vmId);
  const node = con && typeof path === 'string' ? nodeAt(con.guest, path.split('/')) : null;
  return Boolean(node && !node.dir);
}
// The files in a folder on a running VM, as [{ content }] (Blue 1's preserved evidence:
// the engine only compares their text with the scenario's known lines and versions).
function filesIn(vmId, path) {
  const con = consoles.get(vmId);
  const dir = con && typeof path === 'string' ? nodeAt(con.guest, path.split('/')) : null;
  if (!dir || !dir.dir) return [];
  return children(con.guest, dir).filter((node) => !node.dir && typeof node.content === 'string').map((node) => ({ content: node.content }));
}
function reportResult(event) {
  if (!event) return;
  // The shared scenario first: the evidence it left (in order), then any change it made
  // (lab-restore apply), so the result carries the target's state just after it.
  if (Array.isArray(event.evidence) && event.evidence.length) addEvidence(event.evidence);
  if (event.effect) setFixture(event.effect.vm, event.effect.fixture, event.effect.value);
  const target = typeof event.target === 'string' ? event.target : event.seat;
  const result = observe(missionFlags(), { ...event, state: scenarioStateOf(target, scenarioFlags()) }, { scenario: scenarioFlags(), hasFile, files: filesIn });
  if (!result.flags.length) return;
  addMissionFlags(result.flags);
  const con = consoles.get(event.seat);
  const notify = (text) => {
    if (con && con.desktop && con.desktop.notify) con.desktop.notify(text);
  };
  // A step played on another machine (Blue 1: web01's console, parrot01) is also told on
  // the mission's own desk, where its Tickets app is; web01 has no desktop to show it.
  const tellDesk = (mission, text) => {
    const desk = mission.seat !== event.seat ? consoles.get(mission.seat) : null;
    if (desk && desk.desktop && desk.desktop.notify) desk.desktop.notify(text);
  };
  for (const { mission, objective } of result.completed) {
    const text = `Ticket #${mission.ticket}: ${objective.text.replace(/\.$/, '')}: done`;
    notify(text);
    tellDesk(mission, text);
  }
  // A step's questions just opened (Blue 1): say so where its Tickets app is, and on the
  // machine where the step was played (B8's check runs on parrot01).
  for (const { mission } of result.asked) {
    const text = `Ticket #${mission.ticket}: new questions in Tickets`;
    tellDesk(mission, text);
    notify(mission.seat === event.seat ? text : `${text} on ${mission.seat}`);
  }
  if (result.unlocks.length) unlockGuests(result.unlocks);
  for (const mission of result.finished) {
    const key = result.unlocks.includes(mission.reward && mission.reward.unlock) ? ` Key for ${mission.reward.unlock} granted.` : '';
    notify(`Ticket #${mission.ticket} resolved.${key}`);
  }
  refreshGuests([]);
}
// A shell line's results, one per command that ran (a ; or && line reports each).
function reportCommands(results) {
  for (const result of Array.isArray(results) ? results : []) reportResult(result);
}
// Files saved since the last look: each new or changed file is a 'saved' event.
function reportSaved(con, vmId) {
  const now = new Map(exportFiles(con.guest).files);
  for (const [path, text] of now) if (con.files.get(path) !== text) reportMission(vmId, 'saved', path);
  con.files = now;
}

// A VM's console: its image's boot text, then its shell. Lines typed or printed are kept
// (the last VM_LOG.lines, as text) with the working folder for the session record.
function buildConsole(vm, saved, resumed) {
  const guest = bootGuest(vm);
  // Which VMs are powered on, for the lab network's commands (features/fake-network.js).
  guest.running = (id) => windows.has(id);
  // The shared scenario state, for a scenario machine's logs and fixtures
  // (features/scenario.js).
  guest.scenario = scenarioFlags;
  // The files and folders made on this VM earlier this session (its disk, in effect).
  importFiles(guest, readVmFiles(vm.id));
  const startFiles = new Map(exportFiles(guest).files);
  const logEl = el('div', { className: 'vm-log', attrs: { role: 'log', 'aria-live': 'polite', 'aria-label': `${vm.id} console output` } });
  const promptEl = el('span', { className: 'vm-prompt' });
  const input = el('input', {
    className: 'vm-input',
    attrs: {
      type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      enterkeyhint: 'enter', maxlength: String(LIMITS.commandRaw), 'aria-label': `Command on ${vm.id}. Type help for commands.`,
    },
  });
  const row = el('div', { className: 'vm-input-row' }, [promptEl, input]);
  const content = el('div', { className: 'vm-console' }, [logEl, row]);
  // A console filled while its window was hidden, or resized, comes back with the prompt
  // in view (a hidden element cannot scroll; print() handles the visible case).
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      content.scrollTop = content.scrollHeight;
    }).observe(content);
  }
  const con = { guest, log: [], history: [], at: 0, logEl, promptEl, input, content, files: startFiles };
  const line = (kind, text, tone = '') => el('p', { className: `vm-line vm-${kind}${tone ? ` vm-${tone}` : ''}`, text });
  let lastBlock = 0; // lines the last block entry printed (sl's frames)
  const print = (entries, keep = true) => {
    for (const entry of entries) {
      // block: several lines drawn together (sl's train); with replace, they take the
      // place of the block before them, so the frames animate in place.
      if (Array.isArray(entry.block)) {
        if (entry.replace) {
          for (let i = 0; i < lastBlock && logEl.lastElementChild; i += 1) logEl.lastElementChild.remove();
          if (keep) con.log = con.log.slice(0, Math.max(0, con.log.length - lastBlock));
        }
        for (const text of entry.block) {
          logEl.appendChild(line(entry.kind, text));
          if (keep) con.log.push({ kind: entry.kind, text: text.slice(0, VM_LOG.length) });
        }
        lastBlock = entry.block.length;
        continue;
      }
      // replace: a progress line (sfc, DISM) redraws the line before it in place.
      if (entry.replace && logEl.lastElementChild) {
        logEl.lastElementChild.replaceWith(line(entry.kind, entry.text));
        if (keep && con.log.length) con.log[con.log.length - 1] = { kind: entry.kind, text: entry.text.slice(0, VM_LOG.length) };
        continue;
      }
      logEl.appendChild(line(entry.kind, entry.text));
      if (keep) con.log.push({ kind: entry.kind, text: entry.text.slice(0, VM_LOG.length) });
    }
    con.log = con.log.slice(-VM_LOG.lines);
    // Bounded on screen too: the oldest lines go first.
    while (logEl.childElementCount > LIMITS.terminalLines) logEl.firstElementChild.remove();
    // The console scrolls (not the log), so the prompt sits right under the last line.
    content.scrollTop = content.scrollHeight;
  };
  const refreshPrompt = () => {
    promptEl.textContent = `${promptFor(guest)} `;
    // A password prompt hides what is typed, as a real console does (reviewed code sets
    // only these two fixed values).
    input.type = isSecretPrompt(guest) ? 'password' : 'text';
    // A full-screen program (the vim trap) keeps its command line on the bottom row, as
    // vim does; a shell's prompt follows the last line printed.
    content.classList.toggle('is-fullscreen', Boolean(guest.vim));
  };
  for (const boot of guest.boot) logEl.appendChild(line('out', boot.text, boot.tone ? `${boot.tone} vm-boot` : 'boot'));
  if (saved) {
    restoreCwd(guest, saved.cwd);
    print(saved.log);
  }
  // A device that signs in by itself (cam01, for testing): the login shows on a fresh
  // boot; a VM coming back from suspend is simply still signed in.
  if (guest.image.shell === 'login' && guest.image.autoLogin) {
    const lines = autoLogin(guest);
    if (!saved) print(lines);
  }
  if (resumed) print([{ kind: 'ok', text: '-- resumed from suspend --' }], false);
  refreshPrompt();

  // Prints lines one after another, each after its own pause (ms), then gives the prompt
  // back. Stops if the console has left the page (the VM was powered off).
  const stream = (entries) => {
    row.hidden = true;
    let i = 0;
    const next = () => {
      if (!logEl.isConnected) return;
      if (i >= entries.length) {
        row.hidden = false;
        refreshPrompt();
        save();
        input.focus({ preventScroll: true });
        return;
      }
      const entry = entries[i];
      i += 1;
      window.setTimeout(() => {
        if (!logEl.isConnected) return;
        print([{ kind: entry.kind, text: entry.text, replace: entry.replace, block: entry.block }]);
        next();
      }, entry.ms || 40);
    };
    next();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const raw = input.value;
      input.value = '';
      const prompt = promptFor(guest);
      // A password prompt's answer is never shown, kept or recalled (verify, below).
      const secret = isSecretPrompt(guest);
      const result = runGuest(guest, raw);
      // A device login's password: checked against its digest, never shown or kept.
      if (result.verify) {
        const logins = PUZZLES.deviceLogins || {};
        const digests = Object.hasOwn(logins, vm.id) ? logins[vm.id].sha256 : [];
        print([{ kind: 'cmd', text: prompt }]);
        input.disabled = true;
        matchesPuzzle(raw, digests).then((ok) => {
          input.disabled = false;
          print(finishLogin(guest, ok));
          refreshPrompt();
          save();
          input.focus({ preventScroll: true });
        });
        return;
      }
      // As the home page's console does (ui/terminal-ui.js; doctrine: only validated lines
      // are stored, raw history stays in memory): the line shows as typed on this screen,
      // the record keeps the canonical command or "(input not kept)", and Up/Down recall
      // what was typed (owner request, October 12, 2026).
      const typed = raw.slice(0, LIMITS.terminalLineLength);
      const shown = result.echo === null ? typed : result.echo;
      const cmdEntry = { kind: 'cmd', text: shown ? `${prompt} ${shown}` : prompt };
      const keptCmd = { kind: 'cmd', text: result.echo === null ? `${prompt} (input not kept)` : cmdEntry.text };
      const printCmd = () => {
        print([cmdEntry], false);
        con.log.push({ kind: keptCmd.kind, text: keptCmd.text.slice(0, VM_LOG.length) });
        con.log = con.log.slice(-VM_LOG.lines);
      };
      if (result.clear) {
        // A cleared screen may come with a new one (vim's).
        logEl.replaceChildren();
        con.log = [];
        if (result.lines.length) print(result.lines);
      } else if (!reducedMotion && result.lines.some((entry) => entry.ms)) {
        // Streamed output (apt): lines arrive over time, the prompt hidden until the
        // command is done, as on a real terminal.
        printCmd();
        stream(result.lines);
      } else {
        printCmd();
        print(result.lines);
      }
      // In memory only, bounded; never the answer to a password prompt.
      if (!secret && raw.trim() && con.history[con.history.length - 1] !== raw) {
        con.history = [...con.history, raw.slice(0, LIMITS.commandRaw)].slice(-LIMITS.terminalHistory);
      }
      con.at = con.history.length;
      refreshPrompt();
      save();
      // mkdir changed the VM's files: keep them for the session.
      if (result.changed) writeVmFiles(vm.id, exportFiles(guest));
      reportCommands(result.results);
      // Something the guest's desktop acts on: a blue screen, the console closing
      // (features/guest-engine.js, Winbows processes).
      if (result.event && con.desktop && con.desktop.guestEvent) con.desktop.guestEvent(result.event);
    } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
      // Tab completes (features/guest-engine.js completeGuest) and never leaves the
      // terminal; a second Tab with nothing to add lists the matches, as bash does. The
      // list is shown but not kept, and the typed line is never echoed with it.
      event.preventDefault();
      const done = completeGuest(guest, input.value);
      if (done && done.value) {
        input.value = done.value.slice(0, LIMITS.commandRaw);
        con.tabbed = null;
      } else if (done && done.options) {
        if (con.tabbed === input.value) print([{ kind: 'out', text: done.options.join('  ') }], false);
        con.tabbed = input.value;
      }
    } else if (event.key === 'ArrowUp' && con.history.length) {
      event.preventDefault();
      con.at = Math.max(0, con.at - 1);
      input.value = con.history[con.at];
    } else if (event.key === 'ArrowDown' && con.history.length) {
      event.preventDefault();
      con.at = Math.min(con.history.length, con.at + 1);
      input.value = con.at === con.history.length ? '' : con.history[con.at];
    } else if (event.key === 'l' && event.ctrlKey) {
      event.preventDefault();
      logEl.replaceChildren();
      con.log = [];
      save();
    }
  });
  // A click on the screen types into the console, unless the visitor is selecting text.
  content.addEventListener('mouseup', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) input.focus({ preventScroll: true });
  });
  return con;
}

// The VM in front, or null.
export function frontGuest() {
  return front;
}

// Every running VM (in front, behind it or minimized), in start order.
export function runningGuests() {
  return [...windows.keys()];
}

function save() {
  writeVms({
    v: VM_SESSION_VERSION,
    front,
    vms: [...windows.values()].map((win) => {
      const con = consoles.get(win.id);
      return { id: win.id, ...win.state(), cwd: con ? cwdKey(con.guest) : '', log: con ? con.log : [] };
    }),
  });
}

// Marks the front window: on top, with the keyboard. The others keep running.
function settle() {
  for (const win of windows.values()) win.setFront(win.id === front);
  refreshGuests([]);
  save();
}

function bringFront(id) {
  const win = windows.get(id);
  if (!win) return;
  if (win.minimized()) win.show();
  front = id;
  selected = id;
  focusOrder = [...focusOrder.filter((other) => other !== id), id];
  settle();
}

// The next window on the desk to come forward when the front one leaves it.
function nextFront(leaving) {
  const rest = focusOrder.filter((id) => id !== leaving && onDesk(id));
  return rest.length ? rest[rest.length - 1] : null;
}

// Minimizes a VM (the one in front when no name is given); the library brings it back.
export function minimizeGuest(id = front) {
  const win = id ? windows.get(id) : null;
  if (!win || win.minimized()) return false;
  win.hide();
  if (front === id) front = nextFront(id);
  settle();
  return true;
}

// Powers a VM off (the one in front when no name is given). Returns false when it is not
// running here.
// A VM on the desk shuts down in its own OS's way first (ui/guest-desktop.js,
// shutdownScreen), then its window switches off like a monitor (layer2.css,
// vm-power-off). It leaves the session and the library at once, so leaving the page mid-way
// never brings it back. Minimized VMs and reduced motion switch off straight away.
export function stopGuest(id = front) {
  const win = id ? windows.get(id) : null;
  if (!win) return false;
  windows.delete(id);
  const con = consoles.get(id);
  if (con && con.desktop) con.desktop.destroy();
  if (con && con.firmware) con.firmware.destroy();
  consoles.delete(id);
  const vm = VMS.find((entry) => entry.id === id);
  const screen = win.element.querySelector('.vm-screen');
  if (reducedMotion || win.minimized() || !vm || !screen || !con) {
    win.destroy();
  } else {
    const down = shutdownScreen(vm, con.guest.image);
    screen.classList.remove('is-booting');
    screen.replaceChildren(down.node);
    win.element.classList.add('is-shutting-down');
    window.setTimeout(() => {
      down.destroy();
      win.element.classList.add('is-powering-off');
      window.setTimeout(() => win.destroy(), 450);
    }, down.ms);
  }
  focusOrder = focusOrder.filter((other) => other !== id);
  if (front === id) front = nextFront(id);
  settle();
  return true;
}

// Restarts a running VM in its own window (after a blue screen): the old screen goes, and
// a fresh boot starts with the firmware, as a real restart does. The console starts empty.
function restartGuest(id) {
  const win = windows.get(id);
  const vm = VMS.find((entry) => entry.id === id);
  const screen = win && win.element.querySelector('.vm-screen');
  if (!win || !vm || !screen) return;
  const con = consoles.get(id);
  if (con && con.desktop) con.desktop.destroy();
  if (con && con.firmware) con.firmware.destroy();
  screen.replaceChildren(bootScreen(vm, null, false));
  save();
}

// A new window opens fitted on an empty desk. With other VMs already on the desk it opens
// floating, smaller and cascaded, so they can all be seen and hopped between.
function placement() {
  const others = [...windows.values()].filter((win) => !win.minimized()).length;
  if (others === 0 || !desk) return null;
  const w = Math.round(desk.clientWidth * 0.56);
  return { minimized: false, floating: true, x: 28 + others * 44, y: 20 + others * 36, w, h: Math.round(w * 9 / 16) + 30 };
}

// A VM's screen: its console, its desktop and, on a fresh power-on, its firmware first.
// Used when a VM starts (addWindow) and when it restarts in its window (restartGuest).
function bootScreen(vm, saved, resumed) {
  const con = buildConsole(vm, saved, resumed);
  // Every VM boots to its image's desktop (ui/guest-desktop.js), whose terminal app holds
  // the console: Winbows, ParrotOS and Ubuntu.
  const DESKTOPS = { winbows: mountWinbowsDesktop, winserver: mountWinbowsDesktop, parrot: mountParrotDesktop, ubuntu: mountUbuntuDesktop, ubuntuserver: mountUbuntuServer, openwrt: mountSerialConsole, ipcam: mountSerialConsole };
  // A VM with no BIOS screen (the camera) starts its own boot straight away.
  con.desktop = Object.hasOwn(DESKTOPS, vm.image)
    ? DESKTOPS[vm.image]({ vm, guest: con.guest, consoleNode: con.content, resumed, reducedMotion, onPowerOff: () => run(`vm stop ${vm.id}`), autoStart: resumed || vm.bios === false, running: (id) => windows.has(id), onRestart: () => restartGuest(vm.id), onFilesChanged: () => {
      writeVmFiles(vm.id, exportFiles(con.guest));
      reportSaved(con, vm.id);
    },
    onEvent: (type, value) => reportMission(vm.id, type, value) })
    : null;
  // A fresh power-on shows the VM's firmware (BIOS POST) first, then hands over to the
  // guest: the Winbows boot screen, or the Linux console and its boot lines. The guest is
  // hidden until then, so its own boot animations start when it appears. A VM coming
  // back from suspend skips the firmware.
  const guestNode = con.desktop ? con.desktop.node : con.content;
  let screenNode = guestNode;
  // Firmware that has no PC BIOS (the camera) skips it.
  if (!resumed && vm.bios !== false) {
    guestNode.hidden = true;
    con.firmware = createFirmware({
      vm,
      reducedMotion,
      onDone: () => {
        con.firmware.node.remove();
        con.firmware.destroy();
        guestNode.hidden = false;
        if (con.desktop) con.desktop.start();
        const input = con.content.querySelector('.vm-input');
        if (front === vm.id && input && !con.desktop) input.focus({ preventScroll: true });
      },
    });
    screenNode = el('div', { className: 'vm-power' }, [con.firmware.node, guestNode]);
  }
  consoles.set(vm.id, con);
  return screenNode;
}

function addWindow(vm, { saved = null, resumed = false } = {}) {
  const screenNode = bootScreen(vm, saved, resumed);
  const win = createVmWindow({
    guest: vm,
    desk,
    saved: saved || placement(),
    resumed,
    content: screenNode,
    onFocus: () => {
      if (front !== vm.id) bringFront(vm.id);
    },
    onMinimize: () => minimizeGuest(vm.id),
    onPower: () => run(`vm stop ${vm.id}`),
    onChange: save,
  });
  windows.set(vm.id, win);
  return win;
}

// Builds the hypervisor in the lab page's stage and resumes the VMs this session left
// running. runCommand(line) runs a fixed "vm ..." line in tty1. unlocked() lists the VMs
// whose keys this browser has (ui/lab-progress.js).
export function mountLab(host, { runCommand = () => {}, unlocked: readUnlocked = () => [] } = {}) {
  if (!host || stage) return;
  stage = host;
  run = runCommand;
  unlocked = readUnlocked;
  stage.replaceChildren();

  // ---------- Library ----------
  const list = el('ul', { className: 'lab-library-list', attrs: { 'aria-label': 'Virtual machines' } }, VMS.map((vm) => {
    const name = el('span', { className: 'lab-vm-name', text: vm.id });
    const state = el('span', { className: 'lab-vm-state' });
    const row = el('button', { className: 'lab-vm' }, [
      el('span', { className: 'lab-vm-icon', attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'lab-vm-text' }, [name, el('span', { className: 'lab-vm-image', text: vm.image })]),
      state,
    ]);
    row.addEventListener('click', () => {
      selected = vm.id;
      // A running VM comes forward; any other just shows its details.
      if (windows.has(vm.id) && front !== vm.id) run(`vm start ${vm.id}`);
      else refreshGuests([]);
    });
    // A double-click opens it, as in a hypervisor's library (owner request): a powered-off
    // VM powers on, a minimized one comes back. An encrypted one stays shut.
    row.addEventListener('dblclick', () => {
      if (!isOpen(vm) || front === vm.id) return;
      if (!windows.has(vm.id) || windows.get(vm.id).minimized()) run(`vm start ${vm.id}`);
    });
    rows.set(vm.id, { row, name, state });
    return el('li', {}, [row]);
  }));
  details = el('div', { className: 'lab-details', attrs: { 'aria-live': 'polite' } });
  const library = el('section', { className: 'lab-library', attrs: { 'aria-label': 'Library' } }, [
    el('p', { className: 'lab-library-title', text: 'library · vm-host01' }),
    list,
    details,
  ]);

  // ---------- Desk ----------
  desk = el('div', { className: 'lab-desk', attrs: { role: 'region', 'aria-label': 'Hypervisor desk' } });
  const screen = el('div', { className: 'lab-screen' }, [desk]);
  stage.append(library, screen);

  // Resume what this session left running, as it was: minimized ones stay minimized.
  const record = readVms();
  for (const saved of record.vms) {
    const vm = VMS.find((entry) => entry.id === saved.id);
    if (!vm || !isOpen(vm)) continue;
    const win = addWindow(vm, { saved, resumed: true });
    if (!saved.minimized) win.show();
    focusOrder.push(vm.id);
  }
  if (record.front && onDesk(record.front)) bringFront(record.front);
  else {
    front = nextFront(null);
    if (front) selected = front;
    settle();
  }

  window.addEventListener('pagehide', onLeave);
}

function onLeave() {
  save();
  stopEffects();
}

// The visitor left the lab for a Layer 1 page swapped in place (core/router.js; owner
// request, October 14, 2026): as when the page unloads, the running VMs are saved
// (ui/vm-session.js) and suspended, then everything the hypervisor built is taken down
// so a later visit builds it again.
export function unmountLab() {
  if (!stage) return;
  onLeave();
  window.removeEventListener('pagehide', onLeave);
  for (const con of consoles.values()) {
    if (con.desktop) con.desktop.destroy();
    if (con.firmware) con.firmware.destroy();
  }
  for (const win of windows.values()) win.destroy();
  windows.clear();
  consoles.clear();
  rows.clear();
  focusOrder = [];
  front = null;
  details = null;
  desk = null;
  stage = null;
  run = () => {};
}

// Powers a known VM on into a window, or brings a running one to the front. Returns false
// for an unknown name or no stage.
export function startGuest(id) {
  const vm = VMS.find((entry) => entry.id === id);
  if (!vm || !stage) return false;
  if (!windows.has(id)) addWindow(vm);
  bringFront(id);
  return true;
}

// A VM's state, as the library shows it.
function stateOf(vm) {
  if (front === vm.id) return 'running';
  if (windows.has(vm.id)) return windows.get(vm.id).minimized() ? 'minimized' : 'running';
  return isOpen(vm) ? 'powered off' : 'encrypted';
}

const stateClass = (state) => `is-${state.replace(' ', '-')}`;

// The details pane for the selected VM: what it is, and the one control that fits.
function renderDetails() {
  if (!details) return;
  const vm = VMS.find((entry) => entry.id === selected) || VMS[0];
  const state = stateOf(vm);
  const field = (label, value) => el('div', { className: 'lab-field' }, [el('span', { className: 'lab-field-label', text: label }), el('span', { text: value })]);
  const controls = [];
  if (state === 'encrypted') {
    controls.push(el('p', { className: 'lab-locked', text: `Disk image encrypted. It needs its key: ${vm.unlock}.` }));
  } else {
    const power = el('button', { className: 'lab-power', text: windows.has(vm.id) ? 'Power off' : 'Power on' });
    power.addEventListener('click', () => run(windows.has(vm.id) ? `vm stop ${vm.id}` : `vm start ${vm.id}`));
    controls.push(power);
  }
  details.replaceChildren(
    el('p', { className: 'lab-details-name', text: vm.id }),
    el('div', { className: 'lab-fields' }, [
      field('image', vm.os),
      field('role', vm.role),
      field('host', vm.host),
      field('address', vm.ip),
      field('network', `${vm.dnsSuffix} · 198.51.100.0/24`),
      field('state', state),
    ]),
    ...controls,
  );
}

// Brings the library and details up to date. The VMs in `opened` just got their
// keys: their library row unscrambles (not for reduced motion).
export function refreshGuests(opened = []) {
  for (const vm of VMS) {
    const parts = rows.get(vm.id);
    if (!parts) continue;
    const state = stateOf(vm);
    parts.row.className = `lab-vm ${stateClass(state)}${vm.id === selected ? ' is-selected' : ''}`;
    parts.row.setAttribute('aria-pressed', vm.id === selected ? 'true' : 'false');
    parts.row.setAttribute('aria-label', `${vm.id}, ${vm.os}: ${state}`);
    parts.state.textContent = state;
    if (!opened.includes(vm.id) || reducedMotion) continue;
    parts.row.classList.add('is-decrypting');
    for (const node of [parts.name, parts.state]) unscramble(node, node.textContent);
  }
  renderDetails();
}

// Shows `word` as noise, then reveals it left to right. Same width throughout.
function unscramble(node, word) {
  let step = 0;
  const noise = (n) => Array.from({ length: n }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join('');
  const timer = window.setInterval(() => {
    step += 1;
    const at = Math.min(word.length, Math.floor(step / 2));
    node.textContent = word.slice(0, at) + noise(word.length - at);
    if (at >= word.length) {
      window.clearInterval(timer);
      timers.delete(timer);
    }
  }, 30);
  timers.add(timer);
}

function stopEffects() {
  for (const timer of timers) window.clearInterval(timer);
  timers.clear();
}
