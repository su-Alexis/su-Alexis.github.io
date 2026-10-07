// Fork bomb easter egg (owner request): typing ":(){ :|:& };:" in any shell "crashes" the
// simulated machine. Pure theatre on a fixed, short timeline; nothing forks, loops
// without bound or touches anything real:
//   1. Bomb (~2.8s): the shell prints ever-faster fork lines, spawned shells pop open up
//      to the limit, the top-bar status chips read CPU 100% / PROCESSES and the whole site
//      glitches (html.fork-bomb, terminal.css).
//   2. Crash (~4.5s): a full-screen blue "wafflesOS" stop screen with a 0-100% counter.
//   3. Power off, then reboot: the stop screen collapses like a CRT switching off (a bright
//      line, then a dot, then black), which chains into the boot's own power-on line; the
//      session is cleared and the home page plays the full boot again. This navigation
//      skips the usual sliding page transition (html.power-off, read by layers/layer1.js).
// Escape at any point skips straight to the reboot. Reduced motion: no glitch, no spawn
// storm; the stop screen appears at once (static) and reboots after a short pause.
// All text is rendered with textContent via el(); timers are tracked and cleared.

import { el } from '../utils/dom.js';

const FORK_LINES = 18; // lines printed during the bomb, each faster than the last
const BOMB_MS = 2800;
const CRASH_MS = 4500;
const STILL_CRASH_MS = 3500; // reduced motion: how long the static stop screen stays
const POWER_OFF_MS = 750; // CRT switch-off animation (terminal.css, crt-off)

let running = false;

// Fixed, authored lines; pids are cosmetic counters, not real processes.
function forkLine(i) {
  const pid = 4012 + i * 7 + (i * i) % 13;
  return `bash: fork() -> pid ${pid}  (${2 ** Math.min(i + 1, 16)} processes)`;
}

function setStatusChips(cpu, procs) {
  const chips = document.querySelectorAll('.topbar .status li');
  if (chips.length < 3) return;
  // First chip keeps its status dot; only its text node changes.
  const firstText = [...chips[0].childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (firstText) firstText.textContent = cpu;
  chips[1].textContent = procs;
  chips[2].textContent = 'User fork()';
}

// stopCode and advice: what the stop screen reports (the fork bomb, or a killed process).
function stopScreen(still, stopCode = 'FORK_BOMB_DETECTED', advice = 'stop running fork bombs on portfolios') {
  const percent = el('span', { className: 'bsod-percent', text: still ? '100' : '0' });
  const screen = el('div', { className: 'bsod', attrs: { role: 'alert', 'aria-live': 'assertive' } }, [
    el('div', { className: 'bsod-inner' }, [
      el('p', { className: 'bsod-face', text: ':(' }),
      el('p', { className: 'bsod-title', text: 'Your portfolio ran into a problem and needs to restart. We\'re just collecting some error info, and then we\'ll restart for you.' }),
      el('p', { className: 'bsod-progress' }, [percent, '% complete']),
      el('div', { className: 'bsod-details' }, [
        el('p', { text: `For more information about this issue and possible fixes, ${advice}.` }),
        el('p', { text: 'If you call a support person, give them this info:' }),
        el('p', { text: `Stop code: ${stopCode}` }),
        el('p', { text: 'What failed: wafflesOS.sys' }),
      ]),
      el('p', { className: 'bsod-hint', text: 'Press Esc to restart now' }),
    ]),
  ]);
  document.body.appendChild(screen);
  return percent;
}

// Switches the screen off like a CRT, then reboots (the end of every crash, and a
// graceful shutdown on its own). Also used by "kill" on the hypervisor (ui/terminal-ui.js).
export function powerOffAndReboot({ reboot, reducedMotion = false }) {
  if (!document.querySelector('.bsod')) stopScreen(true);
  const html = document.documentElement;
  html.classList.remove('fork-bomb', 'fork-bomb-critical');
  html.classList.add('power-off');
  window.setTimeout(reboot, reducedMotion ? 0 : POWER_OFF_MS);
}

// The crash on its own, without the bomb: the stop screen counts to 100%, then the power
// goes off and the machine reboots. Escape skips ahead. Used when a visitor SIGKILLs the
// hypervisor from btop or kill.
export function crashAndReboot({ stopCode, advice, reboot, reducedMotion = false }) {
  if (running) return;
  running = true;
  const timers = [];
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const t of timers) window.clearTimeout(t);
    document.removeEventListener('keydown', onKey, true);
    powerOffAndReboot({ reboot, reducedMotion });
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  };
  document.addEventListener('keydown', onKey, true);
  const percent = stopScreen(reducedMotion, stopCode, advice);
  if (reducedMotion) {
    later(finish, STILL_CRASH_MS);
    return;
  }
  const steps = 20;
  for (let s = 1; s <= steps; s += 1) {
    later(() => { percent.textContent = String(Math.round((s / steps) * 100)); }, (CRASH_MS - 600) * (s / steps));
  }
  later(finish, CRASH_MS);
}

// shell: the shell api that ran the command (print, live, setBusy).
// spawn(): opens one more shell or returns null when all are open.
// reboot(): clears the session and starts the full boot on the home page.
export function runForkBomb({ shell, spawn, reboot, reducedMotion = false }) {
  if (running) return;
  running = true;
  const timers = [];
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    for (const t of timers) window.clearTimeout(t);
    document.removeEventListener('keydown', onKey, true);
    // Skipped before the crash: show the stop screen so there is a screen to switch off.
    if (!document.querySelector('.bsod')) stopScreen(true);
    const html = document.documentElement;
    html.classList.remove('fork-bomb', 'fork-bomb-critical');
    html.classList.add('power-off');
    window.setTimeout(reboot, reducedMotion ? 0 : POWER_OFF_MS);
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish();
  };
  document.addEventListener('keydown', onKey, true);
  shell.setBusy(true);

  if (reducedMotion) {
    shell.print([{ kind: 'err', text: 'bash: fork: retry: Resource temporarily unavailable' }]);
    stopScreen(true);
    later(finish, STILL_CRASH_MS);
    return;
  }

  // 1. Bomb: accelerating fork lines, shells spawning, chips maxed, site glitching.
  const html = document.documentElement;
  html.classList.add('fork-bomb');
  setStatusChips('CPU 100%', 'Processes ∞');
  const line = shell.live('err');
  let at = 0;
  for (let i = 0; i < FORK_LINES; i += 1) {
    at += Math.max(40, 260 - i * 14); // each line a little faster than the last
    later(() => line.set(forkLine(i)), at);
    if (i % 5 === 2) later(() => spawn(), at);
  }
  later(() => {
    shell.clearLive();
    shell.print([
      { kind: 'err', text: 'bash: fork: retry: Resource temporarily unavailable' },
      { kind: 'err', text: 'bash: fork: retry: Resource temporarily unavailable' },
      { kind: 'err', text: 'kernel: out of memory: killed process 1 (init)' },
    ]);
    html.classList.add('fork-bomb-critical');
  }, BOMB_MS - 500);

  // 2. Crash: blue stop screen counting to 100%.
  later(() => {
    html.classList.remove('fork-bomb', 'fork-bomb-critical');
    const percent = stopScreen(false);
    const steps = 20;
    for (let s = 1; s <= steps; s += 1) {
      later(() => { percent.textContent = String(Math.round((s / steps) * 100)); }, (CRASH_MS - 600) * (s / steps));
    }
    // 3. Reboot.
    later(finish, CRASH_MS);
  }, BOMB_MS);
}
