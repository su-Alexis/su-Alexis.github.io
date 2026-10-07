// Simulated btop (owner request): a live process monitor drawn in box-drawing text inside
// a shell window. Opened by "btop", "top" or "htop" (ui/terminal-ui.js, which also owns
// the process table and what killing each process does).
//
// What is real and what is not: the process list is what is actually running on the page
// (shells, the background, the screensaver, the status scramblers, btop itself), the
// frame rate is measured, and uptime counts from the boot. CPU and memory percentages are
// estimates from what is running; the network panel is always zero because the page's
// policy (connect-src 'none') allows no connections at all.
//
// Keys, as in btop: Up/Down (or a click) select a process, t sends SIGTERM, k sends
// SIGKILL (each asks y/n first), q or Escape quits. It redraws once a second, plus on
// every key, and stops when its shell closes or the page is left. Everything is text,
// rendered through the shell's screen() with el() (doctrine sections 5 and 9).

const TICK_MS = 1000;
const MESSAGE_MS = 2500;
const SIGNAL_NAMES = Object.freeze({ TERM: 'SIGTERM', KILL: 'SIGKILL' });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Graph samples: anything that is not a finite number counts as zero.
const level = (v, height) => Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 1) * height * 4);

function formatUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

// A braille line graph, newest sample on the right. Each character is 2 samples wide and
// 4 dots tall; values are 0..1. Returns `height` strings, top row first.
export function brailleGraph(samples, width, height) {
  const LEFT = [0x40, 0x04, 0x02, 0x01]; // dots from the bottom up, left column
  const RIGHT = [0x80, 0x20, 0x10, 0x08]; // and the right column
  const need = width * 2;
  const data = samples.slice(-need);
  while (data.length < need) data.unshift(0);
  const levels = data.map((v) => level(v, height));
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    const base = (height - 1 - r) * 4; // dots below this character row
    let text = '';
    for (let c = 0; c < width; c += 1) {
      let bits = 0;
      for (let d = 0; d < 4; d += 1) {
        if (levels[c * 2] > base + d) bits |= LEFT[d];
        if (levels[c * 2 + 1] > base + d) bits |= RIGHT[d];
      }
      text += String.fromCharCode(0x2800 + bits);
    }
    rows.push(text);
  }
  return rows;
}

// The same graph in plain ASCII, for fonts whose braille is not the same width as other
// characters (it would push the box edges out of line).
export function asciiGraph(samples, width, height) {
  const GLYPHS = ' .:|#';
  const data = samples.slice(-width);
  while (data.length < width) data.unshift(0);
  const levels = data.map((v) => level(v, height));
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    const base = (height - 1 - r) * 4;
    rows.push(levels.map((n) => GLYPHS[clamp(n - base, 0, 4)]).join(''));
  }
  return rows;
}

// A meter like btop's: filled and empty blocks.
function meter(fraction, width) {
  const filled = Math.round(clamp(fraction, 0, 1) * width);
  return ['█'.repeat(filled), '░'.repeat(width - filled)];
}

// ---------- Row building: a row is a list of [className, text] segments ----------

const len = (row) => row.reduce((n, [, text]) => n + text.length, 0);

// Pads (or cuts) a row to exactly `width` characters.
function fit(row, width) {
  const out = [];
  let used = 0;
  for (const [cls, text] of row) {
    if (used >= width) break;
    const piece = text.slice(0, width - used);
    out.push([cls, piece]);
    used += piece.length;
  }
  if (used < width) out.push(['', ' '.repeat(width - used)]);
  return out;
}

function boxTop(title, right, width) {
  const fill = Math.max(0, width - 4 - title.length - (right ? right.length + 2 : 0));
  return [['b-line', '┌─'], ['b-title', title], ['b-line', '─'.repeat(fill)], ...(right ? [['b-dim', ` ${right} `]] : []), ['b-line', '─┐']];
}

function boxRow(inner, width) {
  return [['b-line', '│'], ...fit(inner, width - 2), ['b-line', '│']];
}

function boxBottom(width) {
  return [['b-line', `└${'─'.repeat(width - 2)}┘`]];
}

// Joins two boxes side by side, row by row.
function beside(left, right) {
  return left.map((row, i) => [...row, ...(right[i] || [])]);
}

// shell: the shell api to draw in (screen, grab, metrics, alive, focus).
// processes(): the live process table [{ pid, user, name, cmd, tty, cpu, mem }].
// kill(pid, signal): applies a signal; returns an error message or null.
// uptime(): seconds since boot. cache(): { pages, mib }, the pages already loaded.
// samples: CPU history carried over from the last page; onSample(samples) after each
// tick, so the caller can carry it to the next one. onExit(): once btop has quit.
export function runBtop({ shell, processes, kill, uptime, cache = () => ({ pages: 0, mib: 0 }), samples: history = [], onSample = () => {}, onExit = () => {} }) {
  const screen = shell.screen();
  const samples = history.slice(-400);
  let selectedPid = null;
  let scroll = 0;
  let confirm = null; // { pid, name, signal }
  let message = null; // { text, cls, until }
  let frames = 0;
  let frameLoop = 0;
  let lastTick = performance.now();
  let fps = 60;
  let stopped = false;

  const countFrame = () => {
    frames += 1;
    frameLoop = window.requestAnimationFrame(countFrame);
  };

  function sorted() {
    return [...processes()].sort((a, b) => b.cpu - a.cpu || a.pid - b.pid);
  }

  function render() {
    if (stopped) return;
    const { cols, rows: height, braille } = shell.metrics();
    const width = clamp(cols, 40, 140);
    const lines = clamp(height, 18, 80);
    const narrow = width < 64;
    const procs = sorted();
    if (!procs.some((p) => p.pid === selectedPid)) selectedPid = procs.length ? procs[0].pid : null;
    const total = clamp(procs.reduce((n, p) => n + p.cpu, 0) / 100, 0, 1);
    const clock = new Date();
    const time = [clock.getHours(), clock.getMinutes(), clock.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    const out = [];

    // CPU box: the graph on the left, the numbers on the right.
    const infoWidth = narrow ? 0 : 24;
    const graphWidth = width - 2 - (infoWidth ? infoWidth + 1 : 0);
    const graph = (braille ? brailleGraph : asciiGraph)(samples, graphWidth, 4);
    const [cpuOn, cpuOff] = meter(total, 10);
    const info = [
      [['b-key', 'CPU  '], ['b-ok', cpuOn], ['b-dim', cpuOff], ['', ` ${String(Math.round(total * 100)).padStart(3)}%`]],
      [['b-key', 'fps  '], ['', String(Math.round(fps))]],
      [['b-key', 'up   '], ['', formatUptime(uptime())]],
      [['b-key', 'load '], ['', (total * 0.9).toFixed(2)], ['b-dim', ' 0.06 0.01']],
    ];
    const graphClass = ['b-err', 'b-warn', 'b-ok', 'b-ok'];
    out.push(boxTop('cpu', `wafflesOS ${time}`, width));
    for (let r = 0; r < 4; r += 1) {
      const inner = [[graphClass[r], graph[r]]];
      if (infoWidth) inner.push(['b-line', '│'], ...fit(info[r], infoWidth));
      out.push(boxRow(inner, width));
    }
    out.push(boxBottom(width));

    // Memory and network, side by side (left out on narrow windows).
    if (!narrow) {
      const memWidth = Math.floor(width * 0.45);
      const netWidth = width - memWidth;
      const used = clamp(0.24 + procs.length * 0.011 + total * 0.2, 0, 0.9);
      // Pages loaded once stay in the page cache, so revisits resume instead of loading.
      const { pages, mib } = cache();
      const cached = clamp(mib / 1024, 0, 0.98 - used);
      const bar = Math.max(4, memWidth - 26);
      const [memOn, memOff] = meter(used, bar);
      const [cacheOn, cacheOff] = meter(cached, bar);
      const mem = [
        boxTop('mem', '', memWidth),
        boxRow([['b-key', 'Total  '], ['', '1.00 GiB']], memWidth),
        boxRow([['b-key', 'Used   '], ['b-warn', memOn], ['b-dim', memOff], ['', ` ${Math.round(used * 1024)} MiB`]], memWidth),
        boxRow([['b-key', 'Cached '], ['b-ok', cacheOn], ['b-dim', cacheOff], ['', ` ${Math.round(cached * 1024)} MiB, ${pages} page${pages === 1 ? '' : 's'}`]], memWidth),
        boxRow([['b-key', 'Free   '], ['', `${Math.round((1 - used - cached) * 1024)} MiB`]], memWidth),
        boxBottom(memWidth),
      ];
      const net = [
        boxTop('net', 'lo', netWidth),
        boxRow([['b-ok', '▲ '], ['b-key', 'up     '], ['', '0 B/s']], netWidth),
        boxRow([['b-err', '▼ '], ['b-key', 'down   '], ['', '0 B/s']], netWidth),
        boxRow([['b-key', 'total  '], ['', '0 B, 0 connections']], netWidth),
        boxRow([['b-key', 'policy '], ['b-dim', "connect-src 'none'"]], netWidth),
        boxBottom(netWidth),
      ];
      out.push(...beside(mem, net));
    }

    // Processes: as many rows as fit, scrolled to keep the selection in view.
    const procRows = Math.max(3, lines - out.length - 4);
    const index = Math.max(0, procs.findIndex((p) => p.pid === selectedPid));
    if (index < scroll) scroll = index;
    if (index >= scroll + procRows) scroll = index - procRows + 1;
    scroll = clamp(scroll, 0, Math.max(0, procs.length - procRows));
    out.push(boxTop('proc', `${procs.length} processes`, width));
    out.push(boxRow([['b-key', narrow ? '    Pid Program        Cpu%' : '    Pid Program        User      Cpu%  Mem%  Command']], width));
    for (let i = 0; i < procRows; i += 1) {
      const proc = procs[scroll + i];
      if (!proc) {
        out.push(boxRow([], width));
        continue;
      }
      const text = narrow
        ? `${String(proc.pid).padStart(7)} ${proc.name.slice(0, 14).padEnd(14)} ${proc.cpu.toFixed(1).padStart(4)}`
        : `${String(proc.pid).padStart(7)} ${proc.name.slice(0, 14).padEnd(14)} ${proc.user.padEnd(8)} ${proc.cpu.toFixed(1).padStart(5)} ${proc.mem.toFixed(1).padStart(5)}  ${proc.cmd}`;
      const selected = proc.pid === selectedPid;
      const cls = selected ? 'b-sel' : proc.user === 'root' ? 'b-dim' : '';
      // The selected row is highlighted edge to edge, padding included.
      out.push(boxRow([[cls, ` ${text}`]], width).map((seg, k, row) => (selected && k > 0 && k < row.length - 1 ? ['b-sel', seg[1]] : seg)));
    }
    // Footer: the y/n question, a result, or the keys.
    let footer = [['b-key', ' ↑↓'], ['b-dim', ' select  '], ['b-key', 't'], ['b-dim', ' terminate  '], ['b-key', 'k'], ['b-dim', ' kill  '], ['b-key', 'q'], ['b-dim', ' quit']];
    if (confirm) footer = [['b-warn', ` Send ${SIGNAL_NAMES[confirm.signal]} to ${confirm.pid} (${confirm.name})? `], ['b-key', '[y/n]']];
    else if (message && message.until > performance.now()) footer = [[message.cls, ` ${message.text}`]];
    out.push([['b-line', `├${'─'.repeat(width - 2)}┤`]]);
    out.push(boxRow(footer, width));
    out.push(boxBottom(width));

    screen.set(out, procs.slice(scroll, scroll + procRows).map((p) => p.pid), out.length - procRows - 3);
  }

  function tick() {
    if (stopped) return;
    if (!shell.alive()) {
      quit();
      return;
    }
    const now = performance.now();
    fps = clamp((frames * 1000) / Math.max(1, now - lastTick), 0, 240);
    frames = 0;
    lastTick = now;
    const busy = processes().reduce((n, p) => n + p.cpu, 0) / 100;
    // A slow frame rate means the machine is busy, whatever the estimates say.
    samples.push(clamp(busy + Math.max(0, 55 - fps) / 60, 0, 1));
    if (samples.length > 400) samples.shift();
    onSample(samples);
    render();
  }

  function move(delta) {
    const procs = sorted();
    const index = procs.findIndex((p) => p.pid === selectedPid);
    const next = procs[clamp(index + delta, 0, procs.length - 1)];
    if (next) selectedPid = next.pid;
  }

  function ask(signal) {
    const proc = sorted().find((p) => p.pid === selectedPid);
    if (proc) confirm = { pid: proc.pid, name: proc.name, signal };
  }

  function answer(yes) {
    const target = confirm;
    confirm = null;
    if (!yes || !target) return;
    const error = kill(target.pid, target.signal);
    message = error
      ? { text: error, cls: 'b-err', until: performance.now() + MESSAGE_MS }
      : { text: `Sent ${SIGNAL_NAMES[target.signal]} to ${target.pid} (${target.name})`, cls: 'b-ok', until: performance.now() + MESSAGE_MS };
  }

  const onKey = (event) => {
    const key = event.key;
    event.preventDefault();
    if (confirm) {
      if (key === 'y' || key === 'Y' || key === 'Enter') answer(true);
      else if (key === 'n' || key === 'N' || key === 'Escape') answer(false);
    } else if (key === 'q' || key === 'Q' || key === 'Escape' || (key === 'c' && event.ctrlKey)) {
      quit();
      return;
    } else if (key === 'ArrowUp') move(-1);
    else if (key === 'ArrowDown') move(1);
    else if (key === 'PageUp') move(-10);
    else if (key === 'PageDown') move(10);
    else if (key === 'Home') move(-1000);
    else if (key === 'End') move(1000);
    else if (key === 't') ask('TERM');
    else if (key === 'k') ask('KILL');
    render();
  };
  const release = shell.grab(onKey, (pid) => {
    selectedPid = pid;
    confirm = null;
    render();
  });

  const timer = window.setInterval(tick, TICK_MS);
  const onHide = () => quit();
  window.addEventListener('pagehide', onHide);
  frameLoop = window.requestAnimationFrame(countFrame);
  if (!samples.length) samples.push(clamp(processes().reduce((n, p) => n + p.cpu, 0) / 100, 0, 1));
  render();

  function quit() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    window.cancelAnimationFrame(frameLoop);
    window.removeEventListener('pagehide', onHide);
    release();
    screen.remove();
    if (shell.alive()) shell.focus();
    onExit();
  }

  return { quit };
}
