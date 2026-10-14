// Layer 1 in-place navigation (owner request, October 14, 2026: moving between pages
// should be seamless, with no reload). Doctrine section 12, "In-place navigation".
//
// Every page is still a complete static HTML file, and every link still works as a plain
// link: without JavaScript, or for the lab, a modified click, another tab, or anything
// this module cannot handle, the browser simply loads the page. When it can, a click on a
// link to another Layer 1 page is handled here instead:
//   1. The page is fetched from this site only, by a path from the fixed page map
//      (data/commands.js PAGES); nothing typed or taken from the link's text builds it.
//      The response must be a same-origin HTML page of bounded size.
//   2. It is parsed with DOMParser into an inert document (its scripts never run, its
//      images never load), checked for anything executable (script-like elements or
//      on* attributes: none of our pages has any), and only then its top bar, main
//      content, footer and screenshot viewers are imported into this page. The live shell (#terminal) stays
//      where it is; the new page's load log moves into it.
//   3. The address bar, title, description and the page's load-sequence classes follow,
//      inside a same-document view transition (the same desktop slide as before; off
//      for reduced motion), then layers/layer1.js replays the page's load sequence
//      ("rwa:page") and onArrive() lets the shell and the page features catch up.
// Back and forward work through the history entries this module adds; scroll positions
// are kept in them. Any failure falls back to loading the page normally.
//
// Pages are prefetched (fetch, kept in memory, a few at a time) when a link is hovered
// or focused, so the swap is usually instant.

import { PAGES, PAGE_IDS } from '../data/commands.js';
import { el } from '../utils/dom.js';

const MAX_BYTES = 600000; // our largest page is well under this
const CACHE_PAGES = 12;
const HASH = /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const PAGE_CLASS = /^(?:steps|long-step)-\d{1,2}$/;
// The lab builds Layer 2 when it loads, so it is always a normal page load.
const SOFT_PAGES = Object.freeze(PAGE_IDS.filter((id) => id !== 'lab'));

// The site's root path, from this page's path and its reviewed place in the page map
// (pure; tested): "/" on the live site, or a sub-path when served from one.
export function siteRootFor(pathname, pageId) {
  const own = PAGES[pageId] ? PAGES[pageId].path : '';
  const path = pathname.replace(/index\.html$/, '');
  return own && path.endsWith(own) ? path.slice(0, path.length - own.length) : path;
}

// The page a path leads to, or null (pure; tested). Only paths in the page map count.
export function pageForPath(pathname, siteRoot) {
  if (typeof pathname !== 'string' || !pathname.startsWith(siteRoot)) return null;
  const rel = pathname.slice(siteRoot.length).replace(/index\.html$/, '');
  return PAGE_IDS.find((id) => PAGES[id].path === rel) || null;
}

// Whether a click on a link should be handled here (pure apart from the event fields).
export function isPlainClick(event) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

let router = null;

// Asks the running router to go to a page (the shell's cd and open). Returns false when
// it cannot (no router, the lab, a page it does not handle), and the caller loads the
// page normally.
export function softNavigate(pageId, anchor = null) {
  if (!router || !SOFT_PAGES.includes(pageId)) return false;
  router.go(pageId, anchor ? `#${anchor}` : '', { push: true });
  return true;
}

// Holds anything executable (none of our pages has any inside the parts that move).
function executable(root) {
  if (root.querySelector('script, iframe, frame, object, embed, base, form, link, meta, style')) return true;
  for (const node of root.querySelectorAll('*')) {
    for (const attr of node.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') return true;
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) return true;
    }
  }
  return false;
}

export function startRouter({ page, onArrive = () => {}, reducedMotion = false }) {
  if (router || !SOFT_PAGES.includes(page)) return;
  if (typeof window.fetch !== 'function' || typeof window.DOMParser !== 'function' || !window.history || !window.history.pushState) return;
  const siteRoot = siteRootFor(window.location.pathname, page);
  const urlFor = (id) => `${siteRoot}${PAGES[id].path}`;
  const cache = new Map(); // page id -> Promise of its HTML text
  let current = page;
  let busy = false;
  let queued = null;

  // Visually hidden: tells screen readers which page arrived.
  const announcer = el('p', { className: 'visually-hidden', attrs: { 'aria-live': 'polite' } });
  document.body.appendChild(announcer);

  try {
    window.history.scrollRestoration = 'manual';
  } catch {
    // Older browsers restore scroll themselves.
  }
  window.history.replaceState({ rwa: 1, page, scroll: Math.round(window.scrollY) }, '');

  function fetchPage(id) {
    if (cache.has(id)) return cache.get(id);
    const request = window.fetch(urlFor(id), { credentials: 'same-origin', redirect: 'follow', cache: 'default' })
      .then((response) => {
        const at = new URL(response.url, window.location.href);
        const type = response.headers.get('content-type') || '';
        if (!response.ok || at.origin !== window.location.origin || pageForPath(at.pathname, siteRoot) !== id || !type.startsWith('text/html')) {
          throw new Error('not a page');
        }
        return response.text();
      })
      .then((text) => {
        if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('too large');
        return text;
      });
    cache.set(id, request);
    request.catch(() => cache.delete(id));
    while (cache.size > CACHE_PAGES) cache.delete(cache.keys().next().value);
    return request;
  }

  // The parts of a fetched page that move in, checked first.
  function readPage(text) {
    const doc = new window.DOMParser().parseFromString(text, 'text/html');
    const topbar = doc.querySelector('.site > .topbar');
    const main = doc.querySelector('.site > main#content');
    const footer = doc.querySelector('.site > .site-footer');
    if (!topbar || !main || !footer || !main.querySelector('#terminal')) throw new Error('unexpected page');
    // Screenshot viewers sit after .site, beside it (project pages with galleries).
    const lightboxes = [...doc.body.children].filter((node) => node.matches('div.lightbox'));
    for (const part of [topbar, main, footer, ...lightboxes]) if (executable(part)) throw new Error('unexpected content');
    const title = (doc.title || '').slice(0, 200);
    const description = doc.querySelector('meta[name="description"]');
    return {
      title,
      description: description ? (description.getAttribute('content') || '').slice(0, 400) : null,
      classes: [...doc.documentElement.classList].filter((name) => PAGE_CLASS.test(name)),
      boot: doc.documentElement.getAttribute('data-boot') === 'page',
      topbar,
      main,
      footer,
      lightboxes,
    };
  }

  // Puts the new page in place of this one. Runs after the address has changed, so the
  // imported links and images resolve against the new page's address.
  function swap(next) {
    const html = document.documentElement;
    for (const name of [...html.classList]) if (PAGE_CLASS.test(name)) html.classList.remove(name);
    for (const name of next.classes) html.classList.add(name);
    if (next.boot) html.setAttribute('data-boot', 'page');
    else html.removeAttribute('data-boot');
    if (next.title) document.title = next.title;
    const description = document.querySelector('meta[name="description"]');
    if (description && next.description !== null) description.setAttribute('content', next.description);

    const live = document.querySelector('.site');
    const liveTopbar = live.querySelector(':scope > .topbar');
    const liveMain = live.querySelector(':scope > main#content');
    const liveFooter = live.querySelector(':scope > .site-footer');
    const terminal = liveMain.querySelector('#terminal');
    liveTopbar.replaceWith(document.importNode(next.topbar, true));
    liveFooter.replaceWith(document.importNode(next.footer, true));
    for (const box of document.querySelectorAll('body > .lightbox')) box.remove();
    live.after(...next.lightboxes.map((box) => document.importNode(box, true)));

    // Everything in main but the live shell goes; the new page's parts take their places
    // around it, so the shell itself is never moved (that would restart its animations).
    const fresh = next.main.querySelector('#terminal');
    const log = fresh.querySelector('.console-log');
    const before = [];
    const after = [];
    let seen = false;
    for (const node of [...next.main.childNodes]) {
      if (node === fresh) seen = true;
      else (seen ? after : before).push(document.importNode(node, true));
    }
    for (const node of [...liveMain.childNodes]) if (node !== terminal) node.remove();
    terminal.before(...before);
    terminal.after(...after);
    return log ? document.importNode(log, true) : null;
  }

  async function go(id, hash, { push = true, scroll = 0 } = {}) {
    if (busy) {
      queued = { id, hash, push, scroll };
      return;
    }
    busy = true;
    const from = current;
    const target = urlFor(id) + (HASH.test(hash) ? hash : '');
    try {
      const next = readPage(await fetchPage(id));
      const oldScroll = Math.round(window.scrollY);
      let log = null;
      const update = () => {
        if (push) {
          window.history.replaceState({ ...(window.history.state || {}), rwa: 1, page: from, scroll: oldScroll }, '');
          window.history.pushState({ rwa: 1, page: id, scroll: 0 }, '', target);
        }
        log = swap(next);
        current = id;
        const anchor = HASH.test(hash) ? document.getElementById(hash.slice(1)) : null;
        const top = anchor ? Math.max(0, Math.round(window.scrollY + anchor.getBoundingClientRect().top - 16)) : (push ? 0 : scroll);
        window.scrollTo({ top, behavior: 'instant' });
        // The slide lines the old picture up with where it was scrolled (layer1.css).
        const html = document.documentElement;
        const newScroll = Math.round(window.scrollY);
        const middle = Math.round(window.innerHeight / 2);
        html.style.setProperty('--vt-shift', `${newScroll - oldScroll}px`);
        html.style.setProperty('--vt-old-origin', `${oldScroll + middle}px`);
        html.style.setProperty('--vt-new-origin', `${newScroll + middle}px`);
        // The page's load sequence (layers/layer1.js), then the shell and page features.
        document.dispatchEvent(new Event('rwa:page'));
        onArrive(id, log);
        announcer.textContent = next.title;
      };
      const clear = () => {
        const html = document.documentElement;
        html.style.removeProperty('--vt-shift');
        html.style.removeProperty('--vt-old-origin');
        html.style.removeProperty('--vt-new-origin');
      };
      const direction = PAGES[id].depth < PAGES[from].depth ? 'back' : 'forward';
      // A hidden tab renders nothing, so a view transition there would wait for the tab
      // to come back before the page even changes: swap straight away instead.
      if (!reducedMotion && typeof document.startViewTransition === 'function' && document.visibilityState === 'visible') {
        let transition;
        try {
          transition = document.startViewTransition({ update, types: [direction] });
        } catch {
          transition = document.startViewTransition(update);
        }
        transition.ready.catch(() => {}); // skipped (a hidden tab, say): nothing to report
        transition.finished.then(clear, clear);
        await transition.updateCallbackDone;
      } else {
        update();
        clear();
      }
    } catch {
      // Anything unexpected: load the page the ordinary way.
      window.location.assign(target);
      return;
    } finally {
      busy = false;
    }
    if (queued) {
      const wait = queued;
      queued = null;
      go(wait.id, wait.hash, wait);
    }
  }

  function linkTarget(event) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return null;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const id = pageForPath(url.pathname, siteRoot);
    return id && SOFT_PAGES.includes(id) ? { id, hash: url.hash } : null;
  }

  document.addEventListener('click', (event) => {
    if (!isPlainClick(event)) return;
    const found = linkTarget(event);
    if (!found) return;
    // A link within this page (#section, a screenshot) stays with the browser.
    if (found.id === current && found.hash) return;
    event.preventDefault();
    if (found.id === current) {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      return;
    }
    go(found.id, found.hash, { push: true });
  });

  // Hovering or focusing a link fetches its page ahead of the click.
  const warm = (event) => {
    const found = linkTarget(event);
    if (found && found.id !== current) fetchPage(found.id).catch(() => {});
  };
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);

  // Back and forward between pages this module added; a change of #hash on the same page
  // (a screenshot, a section) stays with the browser.
  window.addEventListener('popstate', (event) => {
    const id = pageForPath(window.location.pathname, siteRoot);
    if (!id || !SOFT_PAGES.includes(id)) {
      window.location.reload();
      return;
    }
    if (id === current) return;
    const saved = event.state && Number.isInteger(event.state.scroll) ? Math.min(Math.max(event.state.scroll, 0), 1000000) : 0;
    go(id, window.location.hash, { push: false, scroll: saved });
  });

  // Keep this entry's scroll position for when the visitor comes back to it (back and
  // forward land on the entry first, so it is recorded as the visitor scrolls).
  let scrollTimer = 0;
  const keepScroll = () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = 0;
    if (busy) return;
    window.history.replaceState({ ...(window.history.state || {}), rwa: 1, page: current, scroll: Math.round(window.scrollY) }, '');
  };
  window.addEventListener('scroll', () => {
    if (!scrollTimer) scrollTimer = window.setTimeout(keepScroll, 200);
  }, { passive: true });
  window.addEventListener('pagehide', keepScroll);

  router = { go };
}
