// Layer 2: the lab's web (owner request, October 10, 2026). The only pages the simulated
// browsers on the Winbows VMs (ui/guest-browser.js: Firecat and Exploredge) can
// show. features/lab-web.js resolves what is typed against this fixed map; nothing here
// is fetched, and nothing typed ever selects anything outside it (doctrine section 4: a
// browser window inside the simulation renders allowlisted internal content only).
//
// Authored and fictional. Hosts are the lab plan's (doctrine section 3) plus the
// search.example home page the doctrine names; no real site, brand or search engine.
// Missions and Layer 3 easter eggs add pages here, each reviewed like any other.
//
// A page: { title, theme, host?, hidden?, keywords, blocks }.
//   host: the VM that serves it; the page only loads while that VM is running.
//   hidden: never listed by search.example (easter eggs are found, not searched).
//   theme: the look (css/layer2.css, .wp-theme-<theme>).
//   keywords: what search.example matches a search against (lowercase words).
//   blocks: { t: 'h1' | 'h2' | 'p' | 'pre' | 'note', text }, { t: 'list', items },
//     { t: 'links', items: [{ text, to, note? }] } (to: a key of PAGES),
//     { t: 'search' } (the search box), { t: 'banner', text } (Apache's "It works!"),
//     { t: 'login', user, button, fail, check?, success? } (a sign-in form: check names a
//       digest in data/puzzles.js deviceLogins, success the page it opens; without check
//       every attempt fails), { t: 'camera', note } (a live view; note: the sticky note's
//       text), { t: 'robot' } (about:robots), { t: 'text', text } (a plain text file),
//       { t: 'index', items: [{ name, to, date, size }] } (Apache's directory listing),
//       { t: 'address', text } (Apache's server line under a listing),
//       { t: 'retro' } (the ~waffles homepage, drawn by each browser its own way).

import { MISSIONS } from './missions/index.js';

const freezeAll = (pages) => Object.freeze(Object.fromEntries(Object.entries(pages).map(([key, page]) => [key, Object.freeze({
  ...page,
  keywords: Object.freeze(page.keywords || []),
  blocks: Object.freeze(page.blocks.map((block) => Object.freeze(block))),
})])));

export const HOME_PAGE = 'search.example';

// Pages missions add (a mission's content.pages: { id, vm, title, blocks }, and
// content.homeLink: a link from that machine's home page), owner-written in
// data/missions/. They are found by following the link, not by search (hidden).
function withMissionPages(base) {
  const pages = { ...base };
  for (const mission of MISSIONS) {
    const content = mission.content || {};
    for (const page of Array.isArray(content.pages) ? content.pages : []) {
      if (typeof page.id !== 'string' || Object.hasOwn(pages, page.id) || !Array.isArray(page.blocks)) continue;
      pages[page.id] = { title: page.title, host: page.vm, hidden: true, keywords: [], blocks: page.blocks };
    }
    const link = content.homeLink;
    const home = link && typeof link.vm === 'string' ? `${link.vm}.lab.example` : null;
    if (home && Object.hasOwn(pages, home) && Object.hasOwn(pages, link.to)) {
      pages[home] = { ...pages[home], blocks: [...pages[home].blocks, { t: 'links', items: [{ text: link.text, to: link.to }] }] };
    }
  }
  return pages;
}

export const PAGES = freezeAll(withMissionPages({
  'search.example': {
    title: 'search.example',
    theme: 'search',
    keywords: ['search', 'home'],
    blocks: [
      { t: 'search' },
      { t: 'links', items: [
        { text: 'Lab directory', to: 'lab.example', note: 'every machine on lab.example' },
        { text: 'web01', to: 'web01.lab.example', note: 'Apache on Ubuntu Server' },
        { text: 'router01', to: 'router01.lab.example', note: 'LuCI, the router admin page' },
        { text: 'cam01', to: 'cam01.lab.example', note: 'the IP camera' },
      ] },
      { t: 'note', text: 'The lab has no internet connection. Search covers the lab only.' },
    ],
  },
  'lab.example': {
    title: 'Lab directory',
    theme: 'portal',
    keywords: ['lab', 'directory', 'machines', 'hosts', 'network', 'intranet', 'vm', 'list'],
    blocks: [
      { t: 'h1', text: 'lab.example' },
      { t: 'p', text: 'Machines on the lab network (198.51.100.0/24). A page loads only while its machine is powered on.' },
      { t: 'links', items: [
        { text: 'web01.lab.example', to: 'web01.lab.example', note: '198.51.100.50 · web server' },
        { text: 'router01.lab.example', to: 'router01.lab.example', note: '198.51.100.254 · router' },
        { text: 'cam01.lab.example', to: 'cam01.lab.example', note: '198.51.100.60 · IP camera' },
      ] },
      { t: 'h2', text: 'No web page' },
      { t: 'list', items: [
        'ws01, parrot01, ubuntu-blue, ubuntu-red: workstations',
        'dc01.corp.example: the domain controller',
      ] },
    ],
  },
  'web01.lab.example': {
    title: 'Apache2 Ubuntu Default Page: It works',
    theme: 'apache',
    host: 'web01',
    keywords: ['web01', 'apache', 'apache2', 'web', 'server', 'ubuntu', 'default', 'works', 'http'],
    blocks: [
      { t: 'banner', text: 'Apache2 Default Page (simulated)' },
      { t: 'h1', text: 'It works!' },
      { t: 'p', text: 'This is the page Apache2 shows on Ubuntu Server right after it is installed. If you can read it, the web server on web01 is up and answering.' },
      { t: 'p', text: 'Replace /var/www/html/index.html before anyone else sees this page.' },
      { t: 'h2', text: 'Configuration overview' },
      { t: 'pre', text: '/etc/apache2/\n|-- apache2.conf\n|       `--  ports.conf\n|-- mods-enabled\n|       |-- *.load\n|       `-- *.conf\n|-- conf-enabled\n|       `-- *.conf\n`-- sites-enabled\n        `-- *.conf' },
      { t: 'p', text: 'Sites are switched on and off with a2ensite and a2dissite, modules with a2enmod and a2dismod.' },
    ],
  },
  'router01.lab.example': {
    title: 'router01 - LuCI',
    theme: 'luci',
    host: 'router01',
    keywords: ['router01', 'router', 'luci', 'openwrt', 'admin', 'gateway', 'login'],
    blocks: [
      { t: 'h1', text: 'Authorization Required' },
      { t: 'p', text: 'Please enter your username and password.' },
      { t: 'login', user: 'root', button: 'Log in', fail: 'Invalid username and/or password! Please try again.' },
      { t: 'note', text: 'Powered by LuCI (simulated) / OpenWrt 23.05.5 (simulated)' },
    ],
  },
  'cam01.lab.example': {
    title: 'Network Camera',
    theme: 'cam',
    host: 'cam01',
    keywords: ['cam01', 'camera', 'cam', 'ipcam', 'live', 'view', 'video', 'login'],
    blocks: [
      { t: 'h1', text: 'Network Camera (simulated)' },
      { t: 'p', text: 'Sign in to view the live stream.' },
      // The same test login as cam01's console (data/puzzles.js deviceLogins.cam01).
      { t: 'login', user: 'root', button: 'Sign in', fail: 'Incorrect user name or password.', check: 'cam01', success: 'cam01.lab.example/live' },
    ],
  },
  // Only opened by signing in above; typed directly, it goes back to the sign-in page.
  'cam01.lab.example/live': {
    title: 'Network Camera - Live View',
    theme: 'cam',
    host: 'cam01',
    signedIn: 'cam01',
    blocks: [
      // Easter egg (owner request, October 10, 2026): leave the live view open a while and
      // someone walks past and sticks a note on the door. Its text is a placeholder until
      // the owner picks the Layer 3 clue it should carry.
      { t: 'camera', note: `you found the night shift.
more soon :)` },
      { t: 'note', text: 'Live View · 1920x1080 · H.264 · 15 fps' },
    ],
  },
  // Easter egg (owner request, October 10, 2026): web01's robots.txt "hides" a folder
  // someone forgot to delete. Recon taught as a joke: hiding is not securing. The notes
  // point at cam01's night shift.
  'web01.lab.example/robots.txt': {
    title: 'web01.lab.example/robots.txt',
    theme: 'text',
    host: 'web01',
    hidden: true,
    blocks: [{ t: 'text', text: `User-agent: *
Disallow: /backup-old/
` }],
  },
  'web01.lab.example/backup-old': {
    title: 'Index of /backup-old',
    theme: 'index',
    host: 'web01',
    hidden: true,
    blocks: [
      { t: 'h1', text: 'Index of /backup-old' },
      { t: 'index', items: [
        { name: 'Parent Directory', to: 'web01.lab.example', date: '', size: '-' },
        { name: 'index.html.bak', to: 'web01.lab.example/backup-old/index.html.bak', date: '2026-03-02 14:11', size: '1.1K' },
        { name: 'notes.txt', to: 'web01.lab.example/backup-old/notes.txt', date: '2026-09-28 23:47', size: '418' },
      ] },
      { t: 'address', text: 'Apache/2.4.58 (Ubuntu) Server at web01.lab.example Port 443' },
    ],
  },
  'web01.lab.example/backup-old/index.html.bak': {
    title: 'web01.lab.example/backup-old/index.html.bak',
    theme: 'text',
    host: 'web01',
    hidden: true,
    blocks: [{ t: 'text', text: `<!doctype html>
<!-- the old landing page, before the redesign. kept "just in case" -->
<title>web01 - coming soon</title>
<h1>Under construction</h1>
<p>Something new is coming to web01. Check back soon!</p>
<!-- TODO: remove /backup-old before go-live -->
` }],
  },
  'web01.lab.example/backup-old/notes.txt': {
    title: 'web01.lab.example/backup-old/notes.txt',
    theme: 'text',
    host: 'web01',
    hidden: true,
    blocks: [{ t: 'text', text: `notes - web01 (do not publish)

- moved the old site in here before the redesign. delete this folder!!
- robots.txt hides it, so nobody will ever look. right?
- cam01 keeps recording after hours. someone walks past the door
  most nights. leave the live view open for a while and see.
- reminder to self: hiding a folder is not the same as securing it.
` }],
  },
  // Easter egg (owner request, October 11, 2026): a forgotten personal homepage from the
  // web's early days, "best viewed in Exploredge". Exploredge shows it in
  // all its glory; Firecat shows the joke version. Found through the Recycle Bin's note.
  'web01.lab.example/~waffles': {
    title: "~waffles' Corner of the Web",
    theme: 'retro',
    host: 'web01',
    hidden: true,
    blocks: [{ t: 'retro' }],
  },
  'about:blank': { title: 'New Tab', theme: 'blank', blocks: [] },
  'about:robots': {
    title: 'Greetings, humans!',
    theme: 'robots',
    keywords: [],
    blocks: [
      { t: 'robot' },
      { t: 'h1', text: 'Greetings, humans!' },
      { t: 'p', text: 'We robots come in peace. We have rendered your page and found it acceptable.' },
      { t: 'list', items: [
        'Robots have no use for cookies. This browser keeps none either.',
        'Our one directive: browse the lab, and only the lab.',
        'Whoever found this page: hello, curious one.',
      ] },
    ],
  },
  // Exploredge's home page on Winbows Server (dc01), as on a real server.
  'about:esc': {
    title: 'Exploredge Enhanced Security Configuration is enabled',
    theme: 'esc',
    blocks: [
      { t: 'h1', text: 'Exploredge Enhanced Security Configuration is enabled' },
      { t: 'p', text: 'This server browses with tighter security settings than a workstation does. Sites outside the lab are not available from here.' },
      { t: 'p', text: 'Browsing from a domain controller is a habit worth breaking: use a workstation such as ws01 instead.' },
      { t: 'links', items: [{ text: 'Continue to search.example', to: 'search.example' }] },
    ],
  },
}));
