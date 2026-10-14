// Layer 2: the simulated web browsers (owner requests, October 10, 2026; renamed Firecat
// and Exploredge, October 13): Firecat on ws01, parrot01 (Firecat ESR, dark) and the
// Ubuntu VMs (the snap, light), and Exploredge on ws01 and dc01. Used by
// ui/guest-desktop.js (openBrowser), which puts each in an app window on its desktop.
//
// Doctrine section 4: a controlled UI shell, not a browser. Pages come only from the fixed
// map in data/lab-web.js, resolved by features/lab-web.js; typed text is compared, never
// fetched or shown back (an error page names only the lab's own hosts). Links are buttons
// to page keys, not <a> elements, so nothing can leave the page. A lab machine's page only
// loads while that VM is running (running(id) from layers/layer2.js).
//
// Each browser has tabs with their own back and forward history, a reload and home
// button, and a short loading state (skipped for reduced motion). Sign-in forms on device
// pages check a password against its digest (data/puzzles.js deviceLogins) and never keep
// or show it; a successful sign-in lasts until the browser window closes.
//
// Timers and intervals go through the desktop's lifecycle (later/every), so powering the
// VM off clears them.

import { el } from '../utils/dom.js';
import { PAGES, HOME_PAGE } from '../data/lab-web.js';
import { PUZZLES } from '../data/puzzles.js';
import { resolveAddress, searchLab, MAX_ADDRESS } from '../features/lab-web.js';
import { matchesPuzzle } from '../features/puzzles.js';

const MAX_TABS = 6;
const LOAD_MS = Object.freeze({ page: 420, error: 650, timeout: 2600, login: 500 });
// cam01's night shift (easter egg): how long the live view must stay open before someone
// walks past, and when in their walk the note goes on the door (css/layer2.css,
// wp-cam-walk: 9s, stopping at the door from 40% to 60%).
const NIGHT_SHIFT_MS = 30000;
const NOTE_AT_MS = 4500;

// Each browser's own words: window title, tab names and error pages.
const FLAVORS = Object.freeze({
  firecat: Object.freeze({
    suffix: ' — Firecat (simulated)',
    newTab: 'New Tab',
    errorTitle: { notfound: 'Server Not Found', timeout: 'Problem loading page', refused: 'Problem loading page' },
  }),
  exploredge: Object.freeze({
    suffix: ' - Exploredge (simulated)',
    newTab: 'New tab',
    errorTitle: { notfound: "This page can't be displayed", timeout: "This page can't be displayed", refused: "This page can't be displayed" },
  }),
});

const button = (className, text, label) => el('button', { className, text, attrs: label ? { 'aria-label': label, title: label } : {} });

// platform: the desktop it runs on (winbows, ubuntu, parrot): Firecat follows each
// one's real look (css/layer2.css, .br-on-<platform>).
export function createBrowser({ flavor, platform = 'winbows', home = HOME_PAGE, running = () => true, later, every, reducedMotion = false, onTitle = () => {}, onLastTabClosed = () => {} }) {
  const words = FLAVORS[flavor] || FLAVORS.firecat;
  const edge = flavor === 'exploredge';
  const signedIn = new Set(); // device pages signed in to, until the window closes
  let noteLeft = false; // the night shift has been by: the note stays on the door
  let visitors = 1336; // the ~waffles page's visitor counter: one more each visit
  const tabs = []; // { history: [entry], at, tab, label, icon }
  let current = null;

  // ---------- Chrome ----------
  const tabStrip = el('div', { className: 'br-tabs', attrs: { role: 'tablist', 'aria-label': 'Tabs' } });
  const addTab = button('br-newtab', '+', 'Open a new tab');
  const back = button('br-back', '←', 'Back');
  const forward = button('br-forward', '→', 'Forward');
  const reload = button('br-reload', '↻', 'Reload');
  const homeButton = button('br-home', '⌂', 'Home');
  const lock = el('span', { className: 'br-lock', attrs: { 'aria-hidden': 'true' } });
  const address = el('input', {
    className: 'br-address',
    attrs: { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'enter', maxlength: String(MAX_ADDRESS), 'aria-label': edge ? 'Address' : 'Search or enter address' },
  });
  const progress = el('div', { className: 'br-progress', attrs: { 'aria-hidden': 'true' } });
  const view = el('div', { className: 'br-view', attrs: { role: 'document' } });
  let chrome;
  if (edge) {
    const urlBox = el('div', { className: 'br-url' }, [address, button('br-url-go', '⟳', 'Refresh')]);
    urlBox.lastChild.addEventListener('click', () => reloadPage());
    const notice = el('div', { className: 'br-notice', attrs: { role: 'status' } }, [
      el('span', { text: 'Exploredge (simulated) is out of support. Some lab pages may not display as intended.' }),
      button('br-notice-close', 'x', 'Close this notification'),
    ]);
    notice.lastChild.addEventListener('click', () => notice.remove());
    chrome = [
      el('div', { className: 'br-bar' }, [back, forward, urlBox, tabStrip, addTab, homeButton, button('br-fav', '☆', 'Favorites'), button('br-tools', '⚙', 'Tools')]),
      notice,
    ];
  } else {
    chrome = [
      el('div', { className: 'br-tabbar' }, [tabStrip, addTab]),
      el('div', { className: 'br-bar' }, [back, forward, reload, homeButton, el('div', { className: 'br-url' }, [lock, address]), button('br-menu', '≡', 'Open application menu')]),
    ];
  }
  const node = el('div', { className: `br br-${edge ? 'exploredge' : 'firecat'} br-on-${['ubuntu', 'parrot'].includes(platform) ? platform : 'winbows'}` }, [...chrome, progress, view]);

  // ---------- Pages ----------
  const go = (key) => navigate({ kind: 'page', key });

  // A link to another page: a button, never an <a>.
  const link = (text, key) => {
    const item = el('button', { className: 'wp-link', text });
    item.addEventListener('click', () => go(key));
    return item;
  };

  // The search box (search.example and its results).
  function searchBox() {
    const input = el('input', { className: 'wp-search-input', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(MAX_ADDRESS), 'aria-label': 'Search the lab' } });
    const submit = el('button', { className: 'wp-search-button', text: 'Search' });
    const run = () => {
      if (input.value.trim()) navigate({ kind: 'results', hits: searchLab(input.value) });
    };
    submit.addEventListener('click', run);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') run();
    });
    const mark = el('p', { className: 'wp-wordmark', attrs: { 'aria-label': 'search.example' } },
      ['s', 'e', 'a', 'r', 'c', 'h'].map((letter, i) => el('span', { className: `wp-mark-${i}`, text: letter })).concat(el('span', { className: 'wp-mark-tld', text: '.example' })));
    return el('div', { className: 'wp-search' }, [mark, el('div', { className: 'wp-search-row' }, [input, submit])]);
  }

  // A sign-in form. The password is compared with its digest and then cleared; the user
  // name only with the page's own user.
  function loginForm(block) {
    const user = el('input', { className: 'wp-field', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64', 'aria-label': 'User name' } });
    user.value = block.user;
    const password = el('input', { className: 'wp-field', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '128', 'aria-label': 'Password' } });
    // Reviewed code sets only this fixed value (utils/dom.js allows type="text" only).
    password.type = 'password';
    const message = el('p', { className: 'wp-login-fail', attrs: { role: 'alert' } });
    message.hidden = true;
    const submit = el('button', { className: 'wp-login-button', text: block.button });
    let busy = false;
    const attempt = () => {
      if (busy) return;
      busy = true;
      submit.disabled = true;
      const nameOk = user.value.trim() === block.user;
      const logins = PUZZLES.deviceLogins || {};
      const digests = block.check && Object.hasOwn(logins, block.check) ? logins[block.check].sha256 : [];
      const typed = password.value;
      password.value = '';
      const check = digests.length ? matchesPuzzle(typed, digests) : Promise.resolve(false);
      check.then((ok) => {
        later(() => {
          busy = false;
          submit.disabled = false;
          if (!node.isConnected) return;
          if (ok && nameOk && block.success) {
            signedIn.add(block.check);
            go(block.success);
          } else {
            message.textContent = block.fail;
            message.hidden = false;
            password.focus({ preventScroll: true });
          }
        }, reducedMotion ? 0 : LOAD_MS.login);
      });
    };
    submit.addEventListener('click', attempt);
    password.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') attempt();
    });
    return el('div', { className: 'wp-login' }, [
      el('p', { className: 'wp-label', text: 'Username' }), user,
      el('p', { className: 'wp-label', text: 'Password' }), password,
      submit, message,
    ]);
  }

  // The camera's live view: a drawn night-time scene with the camera's own overlay.
  // Easter egg (owner request, October 10, 2026): kept open for NIGHT_SHIFT_MS, someone
  // walks past and sticks a note on the door; it stays there while the browser is open.
  // Clicking the note zooms the camera in on it (its text comes from data/lab-web.js).
  function camera(block) {
    const figure = el('span', { className: 'wp-cam-figure' });
    const note = el('button', { className: 'wp-cam-note', attrs: { 'aria-label': 'Zoom in on the note on the door' } });
    note.hidden = !noteLeft;
    const zoom = el('div', { className: 'wp-cam-zoom' }, [el('p', { className: 'wp-cam-zoom-note' }, (block.note || '').split('\n').map((text) => el('span', { text })))]);
    zoom.hidden = true;
    const zoomOut = button('wp-cam-zoom-out', 'Zoom out', 'Zoom out');
    zoom.appendChild(zoomOut);
    note.addEventListener('click', () => {
      zoom.hidden = false;
      zoomOut.focus({ preventScroll: true });
    });
    zoomOut.addEventListener('click', () => {
      zoom.hidden = true;
    });
    const view = el('div', { className: 'wp-cam' }, [
      el('div', { className: 'wp-cam-scene', attrs: { 'aria-hidden': 'true' } }, [el('span', { className: 'wp-cam-door' }), el('span', { className: 'wp-cam-lamp' }), figure, el('span', { className: 'wp-cam-noise' })]),
      note,
      el('span', { className: 'wp-cam-name', text: 'CAM01' }),
      el('span', { className: 'wp-cam-time', text: stamp() }),
      el('span', { className: 'wp-cam-rec', text: '● REC' }),
      zoom,
    ]);
    if (!noteLeft && block.note) {
      later(() => {
        if (!view.isConnected || noteLeft) return;
        figure.classList.add('is-walking');
        later(() => {
          if (!view.isConnected) return;
          noteLeft = true;
          note.hidden = false;
        }, reducedMotion ? 0 : NOTE_AT_MS);
      }, NIGHT_SHIFT_MS);
    }
    return view;
  }

  // The ~waffles homepage: a scrolling welcome, an under-construction sign, a visitor
  // counter, a webring and a guestbook that thanks you and keeps nothing. Firecat gets
  // the "best viewed in Exploredge" warning and the page in plain Times.
  function retro() {
    visitors += 1;
    const signed = el('p', { className: 'wp-retro-thanks', attrs: { role: 'status' } });
    const sign = el('button', { className: 'wp-retro-button', text: 'Sign my Guestbook!' });
    const nameField = el('input', { className: 'wp-retro-field', attrs: { type: 'text', autocomplete: 'off', maxlength: '40', 'aria-label': 'Your name' } });
    const note = el('input', { className: 'wp-retro-field', attrs: { type: 'text', autocomplete: 'off', maxlength: '120', 'aria-label': 'Your message' } });
    sign.addEventListener('click', () => {
      // Nothing typed is shown, kept or sent.
      nameField.value = '';
      note.value = '';
      signed.textContent = 'Thanks for signing!! (the guestbook is under construction)';
    });
    const ring = (label, key) => link(label, key);
    return el('div', { className: 'wp-retro' }, [
      ...(edge ? [] : [el('p', { className: 'wp-retro-warning', text: 'This page is best viewed in Exploredge at 800x600. Your browser is not supported. Some features may not work.' })]),
      el('div', { className: 'wp-retro-marquee', attrs: { 'aria-label': "Welcome to waffles' Corner of the Web" } }, [
        el('span', { text: "*** Welcome to waffles' Corner of the Web!!! *** Thanks for stopping by *** Sign the guestbook!!! ***" }),
      ]),
      el('h1', { className: 'wp-retro-title', text: "~waffles' Homepage" }),
      el('p', { className: 'wp-retro-construction', text: 'UNDER CONSTRUCTION' }),
      el('p', { text: 'Hi!! This is my page about computers, video games and waffles. More coming soon!!!' }),
      el('ul', { className: 'wp-retro-list' }, ['My PC (it has 512 MB of RAM!!)', 'Waffle recipes (coming soon)', 'My favorite links', 'Cool GIFs (they did not load)'].map((text) => el('li', { text }))),
      el('p', { className: 'wp-retro-counter' }, ['You are visitor number ', el('span', { className: 'wp-retro-digits', text: String(visitors).padStart(6, '0') })]),
      el('div', { className: 'wp-retro-ring' }, [ring('<< Prev', 'lab.example'), el('span', { text: ' | the Lab Webring | ' }), ring('Next >>', 'search.example')]),
      el('div', { className: 'wp-retro-guestbook' }, [el('p', { text: 'Name:' }), nameField, el('p', { text: 'Message:' }), note, sign, signed]),
      el('p', { className: 'wp-retro-footer', text: 'Best viewed in Exploredge at 800x600. Last updated 03/02/2026.' }),
    ]);
  }

  const robot = () => el('div', { className: 'wp-robot', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { className: 'wp-robot-antenna' }),
    el('span', { className: 'wp-robot-head' }, [el('span', { className: 'wp-robot-eye' }), el('span', { className: 'wp-robot-eye' })]),
    el('span', { className: 'wp-robot-body' }),
  ]);

  function renderBlock(block) {
    switch (block.t) {
      case 'h1': case 'h2': case 'p': case 'pre': return el(block.t, { className: `wp-${block.t}`, text: block.text });
      case 'note': return el('p', { className: 'wp-note', text: block.text });
      case 'banner': return el('div', { className: 'wp-banner' }, [el('span', { className: 'wp-banner-logo', attrs: { 'aria-hidden': 'true' } }), el('span', { text: block.text })]);
      case 'list': return el('ul', { className: 'wp-list' }, block.items.map((text) => el('li', { text })));
      case 'links': return el('ul', { className: 'wp-links' }, block.items.map((item) => el('li', {}, [link(item.text, item.to), ...(item.note ? [el('span', { className: 'wp-link-note', text: item.note })] : [])])));
      case 'search': return searchBox();
      case 'login': return loginForm(block);
      case 'camera': return camera(block);
      case 'text': return el('pre', { className: 'wp-text', text: block.text });
      case 'address': return el('p', { className: 'wp-address', text: block.text });
      case 'index': return el('ul', { className: 'wp-index' }, [
        el('li', { className: 'wp-index-head' }, [el('span', { text: 'Name' }), el('span', { text: 'Last modified' }), el('span', { text: 'Size' })]),
        ...block.items.map((item) => el('li', {}, [link(item.name, item.to), el('span', { text: item.date }), el('span', { text: item.size })])),
      ]);
      case 'robot': return robot();
      case 'retro': return retro();
      default: return el('span');
    }
  }

  // The first paragraph of a page, for a search result.
  const snippet = (page) => {
    const block = page.blocks.find((entry) => entry.t === 'p' || entry.t === 'note');
    return block ? block.text.slice(0, 140) : '';
  };

  // ---------- Error pages: each browser's own ----------
  function errorPage(entry) {
    const retry = () => reloadPage();
    if (edge) {
      const fix = el('button', { className: 'wp-exploredge-fix', text: 'Fix connection problems' });
      const diag = el('p', { className: 'wp-note', text: "Winbows Network Diagnostics (simulated) couldn't identify the problem." });
      diag.hidden = true;
      fix.addEventListener('click', () => {
        diag.hidden = false;
      });
      return el('div', { className: 'wp wp-theme-exploredge-error' }, [
        el('h1', { className: 'wp-h1', text: "This page can't be displayed" }),
        el('ul', { className: 'wp-list' }, ['Make sure the web address is correct.', 'Look for the page with your search engine.', 'Refresh the page in a few minutes.'].map((text) => el('li', { text }))),
        fix, diag,
      ]);
    }
    const text = {
      notfound: ["Hmm. We're having trouble finding that site.", "We can't connect to the server at that address.", ['Try again later', 'Check your network connection', 'Check that Firecat has permission to access the web (you might be connected but behind a firewall)']],
      timeout: ['The connection has timed out', `The server at ${entry.host} is taking too long to respond.`, ['The site could be temporarily unavailable or too busy. Try again in a few moments.', 'If you are unable to load any pages, check your computer’s network connection.']],
      refused: ['Unable to connect', `Firecat can’t establish a connection to the server at ${entry.host}.`, ['The site could be temporarily unavailable or too busy. Try again in a few moments.', 'If you are unable to load any pages, check your computer’s network connection.']],
    }[entry.error];
    const again = el('button', { className: 'wp-ff-retry', text: 'Try Again' });
    again.addEventListener('click', retry);
    return el('div', { className: 'wp wp-theme-ff-error' }, [
      el('span', { className: 'wp-ff-error-art', attrs: { 'aria-hidden': 'true' } }),
      el('div', { className: 'wp-ff-error-text' }, [
        el('h1', { className: 'wp-h1', text: text[0] }),
        el('p', { className: 'wp-p', text: text[1] }),
        ...(entry.error === 'notfound' ? [el('p', { className: 'wp-p', text: 'If you entered the right address, you can:' })] : []),
        el('ul', { className: 'wp-list' }, text[2].map((item) => el('li', { text: item }))),
        again,
      ]),
    ]);
  }

  // A page its server does not have: Apache's own on web01, a bare one elsewhere.
  const missingPage = (host) => el('div', { className: 'wp wp-theme-plain' }, host.startsWith('web01.')
    ? [el('h1', { className: 'wp-h1', text: 'Not Found' }), el('p', { className: 'wp-p', text: 'The requested URL was not found on this server.' }), el('hr'), el('p', { className: 'wp-note', text: `Apache/2.4.58 (Ubuntu) Server at ${host} Port 443` })]
    : [el('h1', { className: 'wp-h1', text: '404 Not Found' })]);

  // What a history entry shows: { title, address (null: leave the bar as typed), body, theme }.
  function build(entry) {
    if (entry.kind === 'results') {
      const hits = entry.hits.filter((key) => Object.hasOwn(PAGES, key));
      return {
        title: 'Results - search.example',
        address: 'search.example/search',
        theme: 'search',
        body: el('div', { className: 'wp wp-theme-results' }, [
          searchBox(),
          el('p', { className: 'wp-note', text: hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'} in the lab` : 'No results in the lab. Try web01, router, camera or lab.' }),
          el('ol', { className: 'wp-results' }, hits.map((key) => el('li', {}, [link(PAGES[key].title, key), el('span', { className: 'wp-result-address', text: `https://${key}/` }), el('span', { className: 'wp-result-snippet', text: snippet(PAGES[key]) })]))),
        ]),
      };
    }
    if (entry.kind === 'error') {
      if (entry.error === 'missing') return { title: 'Not Found', address: undefined, theme: 'plain', body: missingPage(entry.host) };
      return { title: words.errorTitle[entry.error] || words.errorTitle.notfound, address: entry.host || null, theme: 'error', body: errorPage(entry) };
    }
    const page = PAGES[entry.key];
    // The machine may have been powered off since: the page times out like any other.
    const vmHost = page.host ? entry.key.split('/')[0] : null;
    if (page.host && !running(page.host)) return build({ kind: 'error', error: 'timeout', host: vmHost });
    return {
      title: entry.key === 'about:blank' ? words.newTab : page.title,
      address: entry.key === 'about:blank' ? '' : entry.key,
      theme: page.theme,
      body: el('div', { className: `wp wp-theme-${page.theme}` }, page.blocks.map(renderBlock)),
    };
  }

  // The address as each browser shows it: Firecat drops https://, Exploredge not.
  const shown = (key) => (!key || key.startsWith('about:') || !edge ? key : `https://${key}${key.includes('/') ? '' : '/'}`);

  // ---------- Tabs and history ----------
  function show(tab, { load = true } = {}) {
    const entry = tab.history[tab.at];
    // Each tab loads on its own: a newer load (or showing it again) wins over an older one.
    tab.token = (tab.token || 0) + 1;
    const token = tab.token;
    const paint = () => {
      if (token !== tab.token) return;
      const result = build(entry);
      tab.label.textContent = result.title;
      tab.icon.className = `br-favicon br-favicon-${result.theme}`;
      tab.tab.classList.remove('is-loading');
      progress.classList.toggle('is-loading', Boolean(current) && current.tab.classList.contains('is-loading'));
      if (tab !== current) return;
      view.replaceChildren(result.body);
      view.scrollTop = 0;
      if (result.address !== null && result.address !== undefined) address.value = shown(result.address);
      lock.className = `br-lock${result.address && !result.address.startsWith('about:') ? ' is-secure' : ''}`;
      onTitle(`${result.title}${words.suffix}`);
      refreshButtons();
    };
    if (!load || reducedMotion) {
      paint();
      return;
    }
    tab.tab.classList.add('is-loading');
    progress.classList.add('is-loading');
    refreshButtons();
    const ms = entry.kind === 'error' ? (entry.error === 'timeout' ? LOAD_MS.timeout : LOAD_MS.error) : LOAD_MS.page;
    later(paint, ms);
  }

  function navigate(entry) {
    const tab = current;
    tab.history = [...tab.history.slice(0, tab.at + 1), entry].slice(-30);
    tab.at = tab.history.length - 1;
    show(tab);
  }

  function reloadPage() {
    if (current) show(current);
  }

  function select(tab) {
    current = tab;
    for (const other of tabs) {
      other.tab.classList.toggle('is-current', other === tab);
      other.tab.setAttribute('aria-selected', other === tab ? 'true' : 'false');
    }
    show(tab, { load: false });
  }

  function openTab(key = home) {
    if (tabs.length >= MAX_TABS) return;
    const icon = el('span', { className: 'br-favicon', attrs: { 'aria-hidden': 'true' } });
    const label = el('span', { className: 'br-tab-label', text: words.newTab });
    const close = button('br-tab-close', 'x', 'Close tab');
    const tabButton = el('div', { className: 'br-tab', attrs: { role: 'tab' } }, [icon, label, close]);
    const tab = { history: [{ kind: 'page', key }], at: 0, tab: tabButton, label, icon };
    tabButton.addEventListener('click', (event) => {
      if (!event.target.closest('.br-tab-close')) select(tab);
    });
    close.addEventListener('click', () => closeTab(tab));
    tabs.push(tab);
    tabStrip.appendChild(tabButton);
    current = tab;
    for (const other of tabs) other.tab.classList.toggle('is-current', other === tab);
    show(tab);
    addTab.disabled = tabs.length >= MAX_TABS;
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i === -1) return;
    if (tabs.length === 1) {
      onLastTabClosed();
      return;
    }
    tabs.splice(i, 1);
    tab.tab.remove();
    addTab.disabled = false;
    if (tab === current) select(tabs[Math.min(i, tabs.length - 1)]);
  }

  function refreshButtons() {
    if (!current) return;
    back.disabled = current.at === 0;
    forward.disabled = current.at >= current.history.length - 1;
  }

  // ---------- Controls ----------
  back.addEventListener('click', () => {
    if (current.at > 0) {
      current.at -= 1;
      show(current);
    }
  });
  forward.addEventListener('click', () => {
    if (current.at < current.history.length - 1) {
      current.at += 1;
      show(current);
    }
  });
  reload.addEventListener('click', reloadPage);
  homeButton.addEventListener('click', () => go(home));
  addTab.addEventListener('click', () => openTab(home));
  address.addEventListener('focus', () => address.select());
  address.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const result = resolveAddress(address.value, { running, signedIn: (id) => signedIn.has(id) });
      if (!result) return;
      if (result.kind === 'search') navigate({ kind: 'results', hits: searchLab(address.value) });
      else if (result.kind === 'page') navigate({ kind: 'page', key: result.key });
      else navigate({ kind: 'error', error: result.error, host: result.host });
      address.blur();
    } else if (event.key === 'Escape') {
      show(current, { load: false });
      address.blur();
    }
  });

  // The camera's clock, once a second while its page is open.
  function stamp() {
    const now = new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  }
  every(() => {
    for (const time of view.querySelectorAll('.wp-cam-time')) time.textContent = stamp();
  }, 1000);

  openTab(home);
  return { node, focus: () => address.focus({ preventScroll: true }) };
}
