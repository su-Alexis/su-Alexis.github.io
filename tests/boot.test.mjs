// Consistency checks for the Layer 1 boot sequence (doctrine section 12, "Boot animation").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { SESSION_KEYS } from '../site/assets/js/core/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const gate = read('site/assets/js/layers/layer1.js');
const css = read('site/assets/css/layer1.css');
const html = read('site/index.html');

test('the boot gate uses the shared session keys', () => {
  for (const key of [SESSION_KEYS.bootPlayed, SESSION_KEYS.visited, SESSION_KEYS.fromDepth]) assert.ok(gate.includes(`'${key}'`), key);
});

test('the boot gate only toggles the fixed classes and imports nothing', () => {
  assert.doesNotMatch(gate, /\bimport\b/);
  const added = [...gate.matchAll(/classList\.(?:add|remove)\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(added)].sort(), ['boot-done', 'boot-run', 'page-boot', 'page-cached']);
});

test('nothing is hidden unless the boot sequence is running', () => {
  // Every rule that hides or animates content must be scoped to .boot-run.
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selector, body = ''] = rule.split('{');
    if (!selector || selector.includes('@') || /^\s*(?:from|to|\d+%)(?:\s*,\s*(?:from|to|\d+%))*\s*$/.test(selector)) continue;
    if (selector.trim() === '.cursor') continue; // decorative blink; hides no content
    if (selector.includes('::view-transition')) continue; // page transition snapshots, not content
    if (/\banimation\s*:|opacity\s*:\s*0|visibility\s*:\s*hidden/.test(body)) {
      assert.match(selector, /\.boot-run/, selector.trim());
    }
  }
});

test('the skip control, boot screen and focus target exist', () => {
  assert.match(html, /id="boot-skip"/);
  assert.match(html, /id="boot-screen"[^>]*aria-hidden="true"/);
  assert.match(html, /<main id="content"[^>]*tabindex="-1"/);
  assert.match(css, /@keyframes boot-complete/);
});

const pages = ['site/index.html', 'site/projects/index.html', 'site/projects/windows-debloat-and-optimize/index.html', 'site/projects/wingg/index.html', 'site/projects/fridge-friends/index.html', 'site/projects/windows-cleanup/index.html', 'site/projects/network-stack-reset/index.html', 'site/projects/network-refresh/index.html', 'site/writeups/index.html'].map(read);

test('every page runs its load sequence: step count, typed widths, matching modules', () => {
  for (const page of pages) {
    const stepsMatch = page.match(/<html[^>]*class="(?:[^"]* )?steps-(\d+)/);
    const steps = Number(stepsMatch[1]);
    for (let n = 1; n <= steps; n += 1) {
      assert.match(page, new RegExp(`console-line boot-step step-${n}"`), `console line ${n}`);
      assert.match(page, new RegExp(`class="module[^"]*boot-step step-${n}"`), `module ${n}`);
    }
    assert.doesNotMatch(page, new RegExp(`boot-step step-${steps + 1}"`));
  }
});

test('every typed command has a matching character count', () => {
  for (const m of pages.join(' ').matchAll(/class="typed (typed-[a-z-]+)">([^<]+)</g)) {
    const rule = css.match(new RegExp(`\\.${m[1]}\\s*\\{\\s*--n:\\s*(\\d+);`));
    assert.ok(rule, `${m[1]} has --n`);
    assert.equal(Number(rule[1]), m[2].length, m[1]);
  }
});

test('every terminal module points at a module on the page, with a matching boot step', async () => {
  const { MODULES } = await import('../site/assets/js/data/commands.js');
  for (const module of MODULES) {
    const section = html.match(new RegExp(String.raw`<section class="module[^"]*\b(step-\d+)\b[^"]*" id="${module.elementId}"`));
    assert.ok(section, `${module.elementId} exists with a boot step`);
    assert.match(html, new RegExp(String.raw`console-line boot-step ${section[1]}"[^\n]*load --module ${module.id}<`), `${module.id} loads at ${section[1]}`);
  }
});

// Run the real gate with controlled browser events: these tests cover when scrolling
// is allowed, completion/skip cleanup, and the absence of motion on other visits.
function bootBrowser({ page = false, played = false, reduced = false } = {}) {
  const listeners = new Map();
  const windowListeners = new Map();
  const frames = new Map();
  let frameId = 0;
  let now = 0;
  const scrolls = [];
  const classes = new Set();
  const saved = new Map(played ? [[SESSION_KEYS.bootPlayed, '1']] : []);
  const timers = new Map();
  let timerId = 0;
  const document = {
    documentElement: {
      scrollHeight: 6000,
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
      getAttribute: () => page ? 'page' : null,
    },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 48 }) }),
    getElementById: () => ({ focus() {} }),
  };
  const window = {
    location: { pathname: page ? '/projects/' : '/' },
    performance: { getEntriesByType: () => [{ type: 'navigate' }], now: () => now },
    sessionStorage: { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) },
    matchMedia: (query) => ({ matches: reduced && query.includes('reduced-motion') }),
    addEventListener: (name, fn) => windowListeners.set(name, fn),
    removeEventListener: (name) => windowListeners.delete(name),
    requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    scrollY: 0,
    innerHeight: 768,
    scrollTo: (options) => { scrolls.push(options); window.scrollY = options.top; },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  };
  runInNewContext(gate, { window, document });
  return {
    scrolls, listeners, classes, frames,
    event: (name, event) => listeners.get(name)?.(event),
    windowEvent: (name) => windowListeners.get(name)?.(),
    frame(time) {
      now = time;
      const pending = [...frames.values()];
      frames.clear();
      for (const fn of pending) fn(time);
    },
    fallback: () => [...timers.values()].find(timer => timer.delay === 25000)?.fn(),
    deadline: () => [...timers.values()].find(timer => timer.delay < 25000)?.fn(),
    // grow: how much taller the module's body becomes once it expands (it starts collapsed).
    module(top, bottom, grow = 0) {
      listeners.get('animationstart')?.({
        animationName: 'window-open',
        target: {
          matches: () => true,
          getBoundingClientRect: () => ({ top, bottom }),
          querySelector: () => ({ scrollHeight: grow, clientHeight: 0 }),
        },
      });
    },
  };
}

test('full homepage boot follows only off-screen modules and returns to the top', () => {
  const browser = bootBrowser();
  browser.module(80, 500);
  assert.equal(browser.scrolls.length, 0);
  browser.module(700, 1000);
  browser.frame(0);
  browser.frame(275);
  assert.ok(browser.scrolls.at(-1).top > 0 && browser.scrolls.at(-1).top < 636, 'intermediate positions, not a jump');
  browser.frame(550);
  assert.equal(browser.scrolls.at(-1).top, 636);
  browser.event('animationend', { animationName: 'boot-complete' });
  browser.frame(550);
  browser.frame(975);
  assert.ok(browser.scrolls.at(-1).top > 0 && browser.scrolls.at(-1).top < 636, 'return also glides');
  browser.frame(1400);
  assert.equal(browser.scrolls.at(-1).top, 0);
  assert.ok(browser.classes.has('boot-done'));
  assert.equal(browser.listeners.has('animationstart'), false);
  const completedScrolls = browser.scrolls.length;
  browser.module(900, 1200);
  browser.fallback();
  assert.equal(browser.scrolls.length, completedScrolls);
  assert.equal(browser.frames.size, 0);
});

test('skipping full boot cancels following and returns immediately to the top', () => {
  const browser = bootBrowser();
  browser.module(700, 1000);
  browser.frame(0);
  browser.frame(275);
  browser.event('keydown', { key: 'Escape' });
  assert.equal(browser.scrolls.at(-1).top, 0);
  assert.equal(browser.scrolls.at(-1).behavior, 'instant');
  assert.equal(browser.listeners.has('animationstart'), false);
  assert.equal(browser.frames.size, 0);
});

test('hub, returning-home, and reduced-motion visits do not follow modules', () => {
  for (const options of [{ page: true }, { played: true }, { reduced: true }]) {
    const browser = bootBrowser(options);
    browser.module(900, 1200);
    browser.event('animationend', { animationName: 'boot-complete' });
    assert.equal(browser.scrolls.length, 0);
  }
});

test('fallback completion returns to the top and removes the scroll listener', () => {
  const browser = bootBrowser();
  browser.module(900, 1200);
  browser.frame(0);
  browser.frame(550);
  browser.fallback();
  browser.frame(1000);
  browser.frame(1850);
  assert.equal(browser.scrolls.at(-1).top, 0);
  assert.equal(browser.listeners.has('animationstart'), false);
});

test('new modules replace pending scrolls; wheel input and page exit cancel them', () => {
  const browser = bootBrowser();
  browser.module(900, 1200);
  browser.frame(0);
  browser.frame(275);
  const current = browser.scrolls.at(-1).top;
  browser.module(1500, 1800);
  assert.equal(browser.frames.size, 1, 'only one animation is scheduled');
  browser.frame(275);
  assert.equal(browser.scrolls.at(-1).top, current, 'retarget starts at current position');
  browser.event('wheel', {});
  assert.equal(browser.frames.size, 0);
  browser.module(900, 1200);
  browser.windowEvent('pagehide');
  assert.equal(browser.frames.size, 0);
});

test('a throttled first frame catches up and does not leave a scroll loop running', () => {
  const browser = bootBrowser();
  browser.module(700, 1000);
  browser.frame(2000);
  assert.equal(browser.scrolls.at(-1).top, 636);
  assert.equal(browser.frames.size, 0);
  browser.event('animationend', { animationName: 'boot-complete' });
  browser.frame(4000);
  assert.equal(browser.scrolls.at(-1).top, 0);
  assert.equal(browser.frames.size, 0);
});

test('the deadline settles the target when the browser delivers no frames', () => {
  const browser = bootBrowser();
  browser.module(700, 1000);
  browser.deadline();
  assert.equal(browser.scrolls.at(-1).top, 636);
  assert.equal(browser.frames.size, 0);
  browser.event('animationend', { animationName: 'boot-complete' });
  browser.deadline();
  assert.equal(browser.scrolls.at(-1).top, 0);
  assert.equal(browser.frames.size, 0);
});

// Site standard (owner, October 3, 2026): a module loads in sync with its console line's
// loading bar. Module timings must be derived from the bar, never fixed on their own.
test('module opening timings are derived from the console loading bar', () => {
  for (const name of ['open-delay', 'open-dur', 'expand-at', 'expand-dur', 'fill-at', 'fill-gap', 'fill-dur']) {
    const declarations = [...css.matchAll(new RegExp(String.raw`--${name}:\s*([^;]+);`, 'g'))].map((m) => m[1]);
    assert.ok(declarations.length > 0, `--${name} is defined`);
    for (const value of declarations) assert.match(value, /var\(--bar-(?:delay|dur)\)/, `--${name}: ${value}`);
  }
  assert.match(css, /\.boot-run \.module\.boot-step \{\s*animation: window-open var\(--open-dur\)[^;]*calc\(var\(--t\) \+ var\(--open-delay\)\)/);
});

test('a module that only fits while collapsed is still scrolled fully into view', () => {
  const browser = bootBrowser();
  // Title bar at 600-640 fits the 768px viewport, but the body grows by 400px.
  browser.module(600, 640, 400);
  browser.frame(0);
  browser.frame(550);
  assert.equal(browser.scrolls.at(-1).top, 536, 'module top lands under the top bar');
  const fits = bootBrowser();
  fits.module(100, 140, 200);
  assert.equal(fits.scrolls.length, 0, 'no scroll when the expanded module still fits');
});
