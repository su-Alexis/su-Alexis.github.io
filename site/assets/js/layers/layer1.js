// Layer 1 boot sequence gate and desktop transitions. Doctrine section 12, "Boot animation".
//
// Loaded as a classic script in <head> so the decision is made before first paint;
// a module script would run after the content has already flashed on screen.
// All content is already in the HTML and CSS owns the boot/reveal timeline. This script:
//   - picks the sequence by toggling fixed classes on <html>:
//       "boot-run"            full boot (home, first visit or refresh)
//       "boot-run page-boot"  short console load (a page not yet loaded this session)
//       "boot-done page-cached" page already loaded this session: shown at once
//       "boot-done"           reduced motion
//   - lets the visitor skip: Escape on keyboard devices, a tap on touch-only devices
//     (mouse clicks never skip),
//   - remembers which pages have loaded this session,
//   - follows off-screen homepage modules during full boot, then returns to the top,
//   - tags page-to-page view transitions as "forward" or "back" for the slide direction.
// The CSS timeline always ends with every element visible, so content never waits on
// this script, even if it stops running halfway.
(function () {
  'use strict';

  // Must match SESSION_KEYS in core/constants.js (checked by tests/boot.test.mjs).
  var BOOT_PLAYED_KEY = 'rwa:boot-played';
  var VISITED_KEY = 'rwa:visited';
  var FROM_DEPTH_KEY = 'rwa:from-depth';
  // Safety net only: must stay above the longest full boot (about 18s on the home page).
  var FALLBACK_MS = 25000;
  var MODULE_SCROLL_MS = 550;
  var RETURN_SCROLL_MS = 850;
  var root = document.documentElement;

  // Paths are only compared for membership, never used to load anything.
  var path = window.location.pathname.replace(/index\.html$/, '').slice(0, 256);
  var depth = path.split('/').filter(Boolean).length;

  function isReload() {
    try {
      var nav = window.performance.getEntriesByType('navigation')[0];
      return Boolean(nav) && nav.type === 'reload';
    } catch (e) {
      return false;
    }
  }

  function storageGet(key) {
    try {
      return window.sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch (e) {
      // Storage unavailable: sequences simply play again next time.
    }
  }

  function storageRemove(key) {
    try {
      window.sessionStorage.removeItem(key);
    } catch (e) {
      // Nothing to remove.
    }
  }

  function readVisited() {
    var raw = storageGet(VISITED_KEY);
    if (!raw || raw.length > 8192) return [];
    try {
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(function (p) { return typeof p === 'string' && p.length <= 256; }).slice(-32);
    } catch (e) {
      return [];
    }
  }

  function markVisited() {
    var list = readVisited();
    if (list.indexOf(path) === -1) list.push(path);
    storageSet(VISITED_KEY, JSON.stringify(list.slice(-32)));
  }

  // ---------- Desktop transitions (cross-document view transitions) ----------

  window.addEventListener('pageswap', function (event) {
    if (event.viewTransition) storageSet(FROM_DEPTH_KEY, String(depth));
  });
  window.addEventListener('pagereveal', function (event) {
    if (!event.viewTransition) return;
    var from = Number(storageGet(FROM_DEPTH_KEY));
    try {
      event.viewTransition.types.add(Number.isFinite(from) && from > depth ? 'back' : 'forward');
    } catch (e) {
      // Older browsers: the default (forward) slide plays.
    }
  });

  // ---------- Boot sequence ----------

  // A refresh starts the machine from scratch at the top of the page: nothing counts
  // as loaded or played, and the browser does not restore the old scroll position.
  if (isReload()) {
    storageRemove(VISITED_KEY);
    storageRemove(BOOT_PLAYED_KEY);
    try {
      window.history.scrollRestoration = 'manual';
    } catch (e) {
      // Older browsers: the scroll below still runs.
    }
    window.scrollTo(0, 0);
    window.addEventListener('load', function () { window.scrollTo(0, 0); });
  }

  var reducedMotion = Boolean(window.matchMedia) && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    root.classList.add('boot-done');
    markVisited();
    return;
  }

  // The data-boot attribute is our own markup but is still read as untrusted:
  // anything other than "page" means the home page.
  var full = root.getAttribute('data-boot') !== 'page' && storageGet(BOOT_PLAYED_KEY) !== '1';
  if (!full && readVisited().indexOf(path) !== -1) {
    root.classList.add('boot-done');
    root.classList.add('page-cached');
    return;
  }

  root.classList.add('boot-run');
  if (!full) root.classList.add('page-boot');
  var finished = false;
  var scrollFrame = 0;
  var scrollDeadline = 0;
  var paintScroll = null;

  function cancelScroll() {
    window.cancelAnimationFrame(scrollFrame);
    window.clearTimeout(scrollDeadline);
    scrollFrame = 0;
    scrollDeadline = 0;
    paintScroll = null;
    window.removeEventListener('pagehide', cancelScroll);
    document.removeEventListener('wheel', cancelScroll);
  }

  // Native smooth scrolling stalled during the live Chrome boot/reveal sequence.
  // This one bounded frame loop owns only page scrolling, not the CSS boot timeline.
  // Retarget from the current position; never queue competing animations. The longer
  // return eases the trip back from the bottom. Skip, navigation and wheel input cancel.
  function scrollPage(top, immediate) {
    // Catch up an older target before replacing it if the tab did not receive frames.
    // In a visible tab this advances by at most the fraction since its last frame.
    if (!immediate && paintScroll) paintScroll(window.performance.now());
    cancelScroll();
    if (immediate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      window.scrollTo({ top: top, behavior: 'instant' });
      return;
    }
    var from = window.scrollY;
    // Start the clock at the request, not the first frame. Chrome can throttle frames
    // in an obscured tab; a delayed frame must catch up instead of restarting at zero.
    var started = window.performance.now();
    var duration = top === 0 ? RETURN_SCROLL_MS : MODULE_SCROLL_MS;
    // Not capped at the current page bottom: the module being followed is still expanding,
    // so the page grows while the glide runs. Each scrollTo is clamped by the browser to
    // what exists at that moment, and the final frame lands once the module has opened.
    top = Math.max(0, top);
    if (Math.abs(top - from) < 1) return;
    paintScroll = function (time) {
      var progress = Math.min(1, Math.max(0, (time - started) / duration));
      var eased = progress * progress * (3 - 2 * progress);
      window.scrollTo({ top: from + (top - from) * eased, behavior: 'instant' });
      return progress < 1;
    };
    function step(time) {
      if (paintScroll && paintScroll(time)) scrollFrame = window.requestAnimationFrame(step);
      else cancelScroll();
    }
    window.addEventListener('pagehide', cancelScroll);
    document.addEventListener('wheel', cancelScroll, { passive: true });
    scrollFrame = window.requestAnimationFrame(step);
    // A background/obscured tab may stop delivering frames entirely. A single
    // deadline settles the target and releases the loop; it never extends boot timing.
    scrollDeadline = window.setTimeout(function () {
      window.scrollTo({ top: top, behavior: 'instant' });
      cancelScroll();
    }, duration + 100);
  }

  // Follow the existing CSS timeline instead of maintaining another set of timers.
  // Owner-requested enhancement: only the full homepage boot controls page scrolling.
  function onModuleStart(event) {
    if (!full || finished || event.animationName !== 'window-open') return;
    var module = event.target;
    if (!module || !module.matches || !module.matches('.modules > .module.boot-step')) return;
    var bar = document.querySelector('.topbar');
    var inset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
    var rect = module.getBoundingClientRect();
    // The module opens in stages: when its title bar appears the body is still collapsed
    // (height and padding 0). Judge visibility by the height it is about to grow to, so a
    // module that fits now but not once expanded is still brought fully into view.
    var body = module.querySelector('.module-body');
    var grow = body ? Math.max(0, body.scrollHeight - body.clientHeight) + 32 : 0;
    var bottom = rect.bottom + grow;
    if (rect.top >= inset && bottom <= window.innerHeight - 16) return;
    scrollPage(Math.max(0, window.scrollY + rect.top - inset), false);
  }

  function finish(skipped) {
    if (finished) return;
    finished = true;
    root.classList.remove('boot-run');
    root.classList.remove('page-boot');
    root.classList.add('boot-done');
    if (full) storageSet(BOOT_PLAYED_KEY, '1');
    markVisited();
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('animationend', onAnimationEnd);
    document.removeEventListener('animationstart', onModuleStart);
    document.removeEventListener('pointerdown', onPointerdown);
    window.clearTimeout(fallbackTimer);
    if (full) scrollPage(0, skipped);
    if (skipped) {
      var main = document.getElementById('content');
      if (main) main.focus({ preventScroll: full });
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') finish(true);
  }

  // The CSS timeline ends with a marker animation named "boot-complete".
  function onAnimationEnd(event) {
    if (event.animationName === 'boot-complete') finish(false);
  }

  // Touch-only devices have no Esc key: there, a tap anywhere skips. Mouse clicks never do.
  var touchOnly = Boolean(window.matchMedia) && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  function onPointerdown(event) {
    if (event.pointerType === 'touch') finish(true);
  }

  document.addEventListener('keydown', onKeydown);
  document.addEventListener('animationend', onAnimationEnd);
  if (full) document.addEventListener('animationstart', onModuleStart);
  if (touchOnly) document.addEventListener('pointerdown', onPointerdown);
  var fallbackTimer = window.setTimeout(function () { finish(false); }, FALLBACK_MS);
})();
