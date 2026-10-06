// Certifications load-and-verify on the home page (owner request).
// Certifications loads in its normal place in the boot, with a longer console bar than
// other modules (.long-step-2 in layer1.css). While that bar fills, the module opens like
// any other and then each certification line appears in turn: its badge runs a short load
// bar, then "verify" with a spinner, then resolves into its real status with a flash.
// The lines are paced from the module's own --bar-delay, --bar-dur and --fill-at, so the
// last one resolves as the console bar reaches 100% (site standard: a module loads in
// sync with its console bar). Pairs with the per-status pulses and .cert-wait in
// layout.css.
//
// Pure enhancement (doctrine section 12): the badge text never changes. While waiting or
// checking it is hidden or transparent, and the load bar/spinner is a separate aria-hidden
// span rendered with textContent. app.js is render-blocking, so lines are hidden before
// first paint. Only runs while the page's load sequence runs (html.boot-run); skipping the
// sequence, a page already loaded this session, or reduced motion show everything at once.
// Timers are bounded and cleared on pagehide.

import { el } from '../utils/dom.js';

const SPINNER = ['|', '/', '-', '\\'];
const BAR_CELLS = 6;
const VERIFY_TICKS = 6; // spinner frames before the status resolves
const LINE_TICKS = BAR_CELLS + VERIFY_TICKS + 1; // ticks from a line appearing to resolving
const MIN_TICK_MS = 30;
const MAX_TICK_MS = 120;
const MAX_BADGES = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Days from today (local) to a YYYY-MM-DD date, or null when the value is not a valid date.
export function daysUntil(value, now = new Date()) {
  const match = ISO_DATE.exec(String(value));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const target = new Date(year, month - 1, day);
  if (target.getMonth() !== month - 1 || target.getDate() !== day) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / DAY_MS);
}

// Countdown label for a scheduled exam: "T-18D", "T-1D", "TODAY", or null once it has passed.
export function countdownLabel(days) {
  if (!Number.isInteger(days) || days < 0 || days > 999) return null;
  return days === 0 ? 'today' : `T-${days}d`;
}

// Scheduled exams (.cert-scheduled with a <time datetime="YYYY-MM-DD">) get a live
// countdown after the date. Shown with or without motion; the date itself stays the
// accessible text, so the countdown is aria-hidden.
function addCountdowns(list) {
  for (const badge of list.querySelectorAll('.cert-scheduled')) {
    const time = badge.querySelector('time');
    const label = time ? countdownLabel(daysUntil(time.getAttribute('datetime'))) : null;
    if (!label) continue;
    badge.classList.add('has-countdown');
    badge.appendChild(el('span', { className: 'cert-countdown', text: ` · ${label}`, attrs: { 'aria-hidden': 'true' } }));
  }
}

// What a badge shows on a given tick: a filling load bar, then the verify spinner,
// then null once the real status should show.
export function badgeFrame(tick) {
  if (tick <= BAR_CELLS) return `[${'#'.repeat(tick)}${'.'.repeat(BAR_CELLS - tick)}]`;
  if (tick <= BAR_CELLS + VERIFY_TICKS) return `verify ${SPINNER[tick % SPINNER.length]}`;
  return null;
}

// Paces `count` lines into `availableMs`: each line takes LINE_TICKS ticks and the next
// starts halfway through the previous one, so the last resolves at the end.
// Returns { tickMs, gapMs }, with the tick clamped to a readable range.
export function lineSchedule(count, availableMs) {
  const n = Math.max(1, count);
  const units = LINE_TICKS * (1 + (n - 1) / 2);
  const tickMs = Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, availableMs / units));
  return { tickMs, gapMs: (LINE_TICKS * tickMs) / 2 };
}

// CSS time ("0.4s", "350ms") from a custom property, in milliseconds; NaN when invalid.
function cssMs(element, name) {
  const value = window.getComputedStyle(element).getPropertyValue(name).trim();
  const match = /^(-?\d*\.?\d+)(ms|s)$/.exec(value);
  if (!match) return Number.NaN;
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
}

function resolve(line, badge) {
  line.classList.remove('cert-wait');
  const overlay = badge.querySelector('.cert-check');
  if (overlay) overlay.remove();
  badge.classList.remove('is-checking');
  badge.classList.add('is-verified');
}

// One certification line: show it, run its badge frames, then reveal the real status.
function runLine(line, badge, tickMs, stops) {
  line.classList.remove('cert-wait');
  const overlay = el('span', { className: 'cert-check', text: badgeFrame(0), attrs: { 'aria-hidden': 'true' } });
  badge.appendChild(overlay);
  let tick = 1;
  const timer = window.setInterval(() => {
    const frame = badgeFrame(tick);
    tick += 1;
    if (frame !== null) {
      overlay.textContent = frame;
      return;
    }
    window.clearInterval(timer);
    resolve(line, badge);
  }, tickMs);
  stops.push(() => window.clearInterval(timer));
}

export function mountCertVerify(root = document) {
  const list = root.querySelector('.cert-list');
  if (!list) return;
  addCountdowns(list);
  const html = document.documentElement;
  if (!html.classList.contains('boot-run')) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const module = list.closest('.module.boot-step');
  const lines = [...list.querySelectorAll('.cert')].slice(0, MAX_BADGES);
  const badges = lines.map((line) => line.querySelector('.cert-status'));
  if (!module || !lines.length || badges.some((badge) => !badge)) return;

  // Before first paint: every line waits hidden until its turn.
  for (const [i, line] of lines.entries()) {
    line.classList.add('cert-wait');
    badges[i].classList.add('is-checking');
  }

  const stops = [];
  const finishAll = () => {
    for (const stop of stops.splice(0)) stop();
    lines.forEach((line, i) => resolve(line, badges[i]));
  };

  // The module's title bar opens (window-open) exactly as its console bar starts.
  const onOpen = (event) => {
    if (event.target !== module || event.animationName !== 'window-open') return;
    module.removeEventListener('animationstart', onOpen);
    const barMs = cssMs(module, '--bar-dur');
    const fillAt = cssMs(module, '--fill-at');
    if (!Number.isFinite(barMs) || !Number.isFinite(fillAt)) {
      finishAll();
      return;
    }
    // Lines begin once the heading and list frame have filled in; the last one resolves
    // as the console bar reaches 100%.
    const begin = fillAt + 150;
    const { tickMs, gapMs } = lineSchedule(lines.length, barMs - begin);
    lines.forEach((line, i) => {
      const timeout = window.setTimeout(() => runLine(line, badges[i], tickMs, stops), begin + i * gapMs);
      stops.push(() => window.clearTimeout(timeout));
    });
  };
  module.addEventListener('animationstart', onOpen);

  // The sequence ended (normally, skipped, or by the fallback): nothing is left waiting.
  const boot = new MutationObserver(() => {
    if (html.classList.contains('boot-run')) return;
    boot.disconnect();
    module.removeEventListener('animationstart', onOpen);
    finishAll();
  });
  boot.observe(html, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide', () => { for (const stop of stops.splice(0)) stop(); }, { once: true });
}
