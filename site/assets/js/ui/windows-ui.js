// Layer 2 VM windows (Skeleton: ui/windows-ui.js). Used only by layers/layer2.js on the
// lab page. A VM window is built from the Layer 1 console window: the same .console frame,
// title bar, lights and buttons (terminal.css), so it reads as one more window of the
// hypervisor, and it moves the way the consoles do.
//
// Several windows can be on the desk at once (owner request): the one in front runs, the
// others keep running behind it (owner request, October 10, 2026: the lab needs VMs
// running side by side), and minimizing hides one until the lab's library brings it back.
// A click anywhere on a window brings it to the front (onFocus).
//
// A window starts fitted: it fills the lab's desk at 16:9 (layer2.css). Dragging its title
// bar floats it inside the desk, its edges and corners resize it (owner bug report,
// October 12, 2026: only the bottom-right corner did), and a double-click on
// the title bar fits it again. Positions are desk-relative, clamped to the desk, and only
// ever applied as the individual left/top/width/height properties (doctrine section 9).
// Phones and tablets work the same way (owner request, October 14, 2026: modern phones
// handle it): a window starts fitted to the screen's width and can be dragged, resized
// and run beside others there too.
//
// Full screen uses the browser's own mode from the visitor's click; where that is missing
// the window maximises to the browser window instead, and Escape restores it.
//
// Lifecycle: every listener is removed by destroy(). onChange() fires when the visitor
// finishes moving, resizing or fitting it, so layer2 can keep the session record.

import { el } from '../utils/dom.js';
import { VM_WINDOW } from '../core/constants.js';

// Keeps a floating window inside a desk of deskW x deskH (pure; tested in Node).
export function clampVm(state, deskW, deskH) {
  const roomW = Math.max(VM_WINDOW.minWidth, Math.floor(deskW));
  const roomH = Math.max(VM_WINDOW.minHeight, Math.floor(deskH));
  const w = Math.min(Math.max(state.w, VM_WINDOW.minWidth), roomW);
  const h = Math.min(Math.max(state.h, VM_WINDOW.minHeight), roomH);
  return { ...state, w, h, x: Math.min(Math.max(state.x, 0), roomW - w), y: Math.min(Math.max(state.y, 0), roomH - h) };
}

// A floating window resized by one edge or corner (n, s, e, w, ne, nw, se, sw) by dx, dy
// pixels. The opposite edges stay put; it never gets smaller than VM_WINDOW's minimum or
// leaves the desk (pure; tested in Node).
export const VM_EDGES = Object.freeze(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
export function resizeVm(from, edge, dx, dy, deskW, deskH) {
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
  let left = from.x;
  let top = from.y;
  let right = from.x + from.w;
  let bottom = from.y + from.h;
  if (edge.includes('e')) right = clamp(right + dx, left + VM_WINDOW.minWidth, deskW);
  if (edge.includes('w')) left = clamp(left + dx, 0, right - VM_WINDOW.minWidth);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + VM_WINDOW.minHeight, deskH);
  if (edge.includes('n')) top = clamp(top + dy, 0, bottom - VM_WINDOW.minHeight);
  return { ...from, x: left, y: top, w: right - left, h: bottom - top };
}

// guest: a VM from data/commands.js VMS ({ id, image, os, ... }).
// content: the node its screen shows (layer2 builds the guest console). resumed: shown at
// once, no power-on.
export function createVmWindow({ guest, desk, saved = null, content = null, resumed = false, onFocus = () => {}, onMinimize = () => {}, onPower = () => {}, onChange = () => {} }) {
  const cleanups = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const minimize = el('button', { className: 'console-button', text: '_', attrs: { 'aria-label': `Minimize ${guest.id}`, title: 'Minimize' } });
  const full = el('button', { className: 'console-button', text: '[ ]', attrs: { 'aria-label': 'Full screen', title: 'Full screen' } });
  const power = el('button', { className: 'console-button', text: 'x', attrs: { 'aria-label': `Power off ${guest.id}`, title: 'Power off' } });
  const bar = el('div', { className: 'console-bar vm-bar', attrs: { title: 'Drag to move · double-click to fit' } }, [
    el('span', { className: 'console-lights' }, [el('span'), el('span'), el('span')]),
    el('span', { text: `${guest.id} · ${guest.image}` }),
    el('span', { className: 'console-controls' }, [minimize, full, power]),
  ]);
  const screen = el('div', { className: `vm-screen${resumed ? '' : ' is-booting'}` }, content ? [content] : []);
  // The corner grip (bottom right, drawn) and thin invisible handles on every other edge
  // and corner, as a desktop window has.
  const grip = el('span', { className: 'vm-grip', attrs: { 'aria-hidden': 'true' } });
  const handles = new Map([['se', grip], ...VM_EDGES.filter((edge) => edge !== 'se')
    .map((edge) => [edge, el('span', { className: `vm-edge vm-edge-${edge}`, attrs: { 'aria-hidden': 'true' } })])]);
  const frame = el('section', {
    className: `console vm-window vm-image-${guest.image} ${resumed ? 'is-resuming' : 'is-powering'}`,
    attrs: { 'aria-label': `Virtual machine ${guest.id}: ${guest.os}`, tabindex: '-1' },
  }, [bar, screen, ...handles.values()]);
  frame.hidden = true;

  let state = saved
    ? { floating: saved.floating, x: saved.x, y: saved.y, w: saved.w, h: saved.h }
    : { floating: false, x: 0, y: 0, w: VM_WINDOW.defaultWidth, h: VM_WINDOW.defaultHeight };

  function apply() {
    const floating = state.floating;
    // Not the console's .is-floating: that one is fixed to the viewport with CSS resize.
    frame.classList.toggle('is-afloat', floating);
    if (!floating) {
      for (const property of ['left', 'top', 'width', 'height']) frame.style.removeProperty(property);
      return;
    }
    if (!frame.hidden) state = clampVm(state, desk.clientWidth, desk.clientHeight);
    frame.style.left = `${state.x}px`;
    frame.style.top = `${state.y}px`;
    frame.style.width = `${state.w}px`;
    frame.style.height = `${state.h}px`;
  }

  // Floats a fitted window exactly where it sits, so the first drag does not jump. Layout
  // offsets (the desk is the frame's offset parent), not the bounding box: the power-on
  // animation scales the frame for a moment, and a drag then must not shrink it.
  function floatHere() {
    if (state.floating) return;
    state = { floating: true, x: frame.offsetLeft, y: frame.offsetTop, w: frame.offsetWidth, h: frame.offsetHeight };
    apply();
  }

  // One pointer gesture at a time: a drag by the title bar or a resize by an edge.
  let gesture = null;
  const begin = (event, kind, target, edge = null) => {
    if (event.button !== 0 || isFull()) return;
    floatHere();
    gesture = { kind, edge, id: event.pointerId, target, startX: event.clientX, startY: event.clientY, from: { ...state } };
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already released; the gesture ends on the next pointerup.
    }
    frame.classList.add(kind === 'move' ? 'is-dragging' : 'is-resizing');
    event.preventDefault();
  };
  const move = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    const from = gesture.from;
    state = gesture.kind === 'move' ? { ...from, x: from.x + dx, y: from.y + dy } : resizeVm(from, gesture.edge, dx, dy, desk.clientWidth, desk.clientHeight);
    apply();
  };
  const end = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    frame.classList.remove('is-dragging', 'is-resizing');
    gesture = null;
    onChange();
  };
  listen(bar, 'pointerdown', (event) => {
    if (!event.target.closest('button')) begin(event, 'move', bar);
  });
  for (const [edge, handle] of handles) listen(handle, 'pointerdown', (event) => begin(event, 'resize', handle, edge));
  for (const target of [bar, ...handles.values()]) {
    listen(target, 'pointermove', move);
    listen(target, 'pointerup', end);
    listen(target, 'pointercancel', end);
  }
  listen(bar, 'dblclick', (event) => {
    if (event.target.closest('button') || !state.floating) return;
    state = { ...state, floating: false };
    apply();
    onChange();
  });
  listen(window, 'resize', () => {
    if (state.floating) apply();
  });

  // Full screen: the browser's own mode when it offers it, otherwise maximised.
  const native = typeof frame.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  function isFull() {
    return native ? document.fullscreenElement === frame : frame.classList.contains('is-maximized');
  }
  const label = () => {
    full.setAttribute('aria-label', isFull() ? 'Exit full screen' : 'Full screen');
    full.setAttribute('aria-pressed', isFull() ? 'true' : 'false');
  };
  const leaveFull = () => {
    if (document.fullscreenElement === frame) document.exitFullscreen().catch(() => {});
    frame.classList.remove('is-maximized');
    label();
  };
  listen(full, 'click', () => {
    if (isFull()) leaveFull();
    else if (native) frame.requestFullscreen().then(label, () => { frame.classList.add('is-maximized'); label(); });
    else {
      frame.classList.add('is-maximized');
      label();
    }
  });
  listen(frame, 'keydown', (event) => {
    if (event.key === 'Escape' && frame.classList.contains('is-maximized')) {
      event.preventDefault();
      leaveFull();
    }
  });
  listen(document, 'fullscreenchange', label);
  listen(minimize, 'click', () => onMinimize());
  // Any press on the window brings it forward (before a drag or a button does its job).
  listen(frame, 'pointerdown', () => onFocus(), true);
  listen(power, 'click', () => onPower());
  label();

  desk.appendChild(frame);

  return {
    id: guest.id,
    element: frame,
    // Puts it on the desk (a minimized one comes back with a short restore effect).
    show() {
      frame.hidden = false;
      apply();
    },
    // In front: on top and focused. Behind: still running, just lower in the stack.
    setFront(front) {
      frame.classList.toggle('is-front', front);
      // The console's input takes the keyboard when there is one.
      if (front && !frame.hidden && !frame.contains(document.activeElement)) (frame.querySelector('.vm-input') || frame).focus({ preventScroll: true });
    },
    minimized: () => frame.hidden,
    // Minimizes it: hidden, so nothing inside it runs, until shown again.
    hide() {
      leaveFull();
      frame.hidden = true;
      frame.classList.remove('is-powering');
      frame.classList.add('is-resuming');
      screen.classList.remove('is-booting');
    },
    state: () => ({ ...state, minimized: frame.hidden }),
    destroy() {
      leaveFull();
      for (const cleanup of cleanups.splice(0)) cleanup();
      frame.remove();
    },
  };
}

// ---------- Firmware (owner request, October 9, 2026) ----------
// What a VM shows when it powers on, before its guest boots: a POST screen in the style of
// a real hypervisor's virtual BIOS (our own wafflesOS branding, no real product's). It
// lists the virtual hardware from the VM's data, counts its memory up, finds its disk and
// network card, then boots from the disk and calls onDone(). Fictional values only: the
// MAC is a locally administered 52-54-00 address and the network is the lab plan's.
// Reduced motion shows it complete for a moment instead. destroy() clears its timers.
const FIRMWARE_SPECS = Object.freeze({
  winbows: { memory: 4096, disk: 64, cores: 2 },
  parrot: { memory: 4096, disk: 40, cores: 2 },
  ubuntu: { memory: 4096, disk: 25, cores: 2 },
});

export function createFirmware({ vm, reducedMotion = false, onDone = () => {} }) {
  const spec = Object.hasOwn(FIRMWARE_SPECS, vm.image) ? FIRMWARE_SPECS[vm.image] : FIRMWARE_SPECS.ubuntu;
  const lastOctet = Number(String(vm.ip).split('.').pop()) || 0;
  // Written with dashes: the address checker reads colon-separated hex as IPv6.
  const mac = `52-54-00-3A-7F-${lastOctet.toString(16).toUpperCase().padStart(2, '0')}`;
  const timers = [];
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
  const memory = el('span', { text: '0K' });
  const row = (text, tone = '') => el('p', { className: `bios-line${tone ? ` bios-${tone}` : ''}`, text });
  const lines = [
    el('p', { className: 'bios-line bios-title' }, [
      el('span', { className: 'bios-brand', text: 'wafflesOS' }),
      ' Virtual Platform BIOS 4.2.1 (simulated)',
    ]),
    row('Copyright (C) 2026 wafflesOS lab. All rights reserved.', 'dim'),
    row(''),
    row(`Virtual CPU @ 2.40GHz, ${spec.cores} core${spec.cores > 1 ? 's' : ''}`),
    el('p', { className: 'bios-line' }, ['Memory Test: ', memory]),
    row(''),
    row('Detecting drives...'),
    row(`  SATA Port 0: vm-images/${vm.id}.img  ${spec.disk} GB`),
    row('  SATA Port 1: CD-ROM (no media)', 'dim'),
    row(`Network: virtio-net  MAC ${mac}  lab.example`),
    row(''),
    row('Press F2 to enter Setup, F12 for Network Boot, ESC for Boot Menu', 'prompt'),
    row('Booting from Hard Disk...', 'boot'),
  ];
  const node = el('div', { className: 'bios', attrs: { role: 'status', 'aria-label': `${vm.id} firmware` } }, lines);
  const target = spec.memory * 1024;

  // ---------- Easter egg: the Konami code (owner request, October 11, 2026) ----------
  // Up Up Down Down Left Right Left Right B A while the POST is on screen opens "Waffle
  // Iron Mode", a fake overclocking screen. The first right key holds the POST so the
  // sequence can be finished; a wrong key, or two seconds without one, lets it go on.
  // Enter or Esc (or the button) leaves the screen and the boot carries on. Only keys
  // pressed while this VM's window is in front count; nothing typed is kept.
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let step = 0;
  let lastKey = 0;
  let held = false; // the POST is waiting for the sequence, or the egg is open
  let ironOpen = false;
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    onDone();
  };
  // The end of the POST: waits while a sequence is under way or the egg is open.
  const tryDone = () => {
    if (ironOpen || (held && Date.now() - lastKey < 2000)) {
      later(tryDone, 250);
      return;
    }
    done();
  };
  function openIron() {
    ironOpen = true;
    const leave = el('button', { className: 'iron-button', text: 'Save & Exit (Enter)' });
    const screen = el('div', { className: 'iron', attrs: { role: 'dialog', 'aria-label': 'Waffle Iron Mode' } }, [
      el('p', { className: 'iron-title', text: 'wafflesOS Setup Utility: WAFFLE IRON MODE (simulated)' }),
      el('p', { className: 'iron-tabs', text: ' Main   Advanced   [ Overclock ]   Boot   Exit ' }),
      ...[
        ['Batter Ratio', 'Golden'], ['Iron Temperature', '425 F'], ['Syrup Voltage', '1.35 V (maple)'],
        ['Butter Cache', 'Enabled'], ['Crispiness Multiplier', 'x11'], ['Fluffiness Throttle', 'Off'],
        ['Pockets per Square', '16'],
      ].map(([name, value]) => el('p', { className: 'iron-row' }, [el('span', { text: name.padEnd(26, '.') }), el('span', { className: 'iron-value', text: `[${value}]` })])),
      el('p', { className: 'iron-warn', text: 'WARNING: overclocking the waffle iron may void your breakfast warranty.' }),
      leave,
    ]);
    const close = () => {
      if (!ironOpen) return;
      ironOpen = false;
      held = false;
      screen.remove();
    };
    leave.addEventListener('click', close);
    node.appendChild(screen);
    leave.focus({ preventScroll: true });
    closeIron = close;
  }
  let closeIron = () => {};
  const onKey = (event) => {
    if (finished || !node.isConnected) return;
    const frame = node.closest('.vm-window');
    if (frame && !frame.classList.contains('is-front')) return;
    if (ironOpen) {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        closeIron();
      }
      return;
    }
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === KONAMI[step]) {
      event.preventDefault();
      step += 1;
      held = true;
      lastKey = Date.now();
      if (step === KONAMI.length) {
        step = 0;
        openIron();
      }
    } else {
      step = key === KONAMI[0] ? 1 : 0;
      held = step > 0;
      lastKey = Date.now();
    }
  };
  document.addEventListener('keydown', onKey);
  const finish = () => {
    memory.textContent = `${target}K OK`;
    for (const line of lines) line.classList.add('is-shown');
  };
  if (reducedMotion) {
    finish();
    later(tryDone, 900);
  } else {
    // Lines come up in order; the memory test counts while its line is up.
    lines.forEach((line, i) => later(() => line.classList.add('is-shown'), i < 12 ? 120 + i * 110 : 2700));
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) later(() => { memory.textContent = `${Math.round((target * i) / steps)}K`; }, 560 + i * 55);
    later(() => { memory.textContent = `${target}K OK`; }, 560 + (steps + 1) * 55);
    later(tryDone, 3500);
  }
  return {
    node,
    destroy() {
      for (const timer of timers) window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
    },
  };
}
