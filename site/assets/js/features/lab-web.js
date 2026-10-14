// Layer 2: resolves what is typed into a simulated browser's address bar (owner request,
// October 10, 2026). Pure: no DOM, no storage, so Node tests cover it. Used by
// ui/guest-browser.js (Firecat and Exploredge on the Winbows VMs).
//
// Doctrine section 4: typed text is only compared with the fixed page map
// (data/lab-web.js) and the lab's machines (data/commands.js VMS). It never becomes a URL,
// a request or a module path, and it is never shown back: the results and error pages
// name only authored hosts, never what was typed.

import { PAGES } from '../data/lab-web.js';
import { VMS } from '../data/commands.js';

export const MAX_ADDRESS = 200;

const page = (key) => (Object.hasOwn(PAGES, key) ? PAGES[key] : null);

// What a typed line opens:
//   { kind: 'page', key }                  an authored page
//   { kind: 'search' }                     words, not an address: search the lab
//   { kind: 'error', error, host? }        error: 'notfound' (no such host), 'timeout'
//     (a lab machine that is powered off), 'refused' (a running machine with no web
//     page), 'missing' (a page path its server does not have); host is the lab's own
//     name for the machine, never the typed text.
// null: nothing to do (empty or too long). running(id) says whether a VM is powered on;
// signedIn(id) whether this browser has signed in to that device's page.
export function resolveAddress(raw, { running = () => true, signedIn = () => false } = {}) {
  if (typeof raw !== 'string') return null;
  const typed = raw.trim().toLowerCase();
  if (!typed || typed.length > MAX_ADDRESS) return null;
  if (/\s/.test(typed)) return { kind: 'search' };
  if (typed.startsWith('about:')) return page(typed) ? { kind: 'page', key: typed } : { kind: 'error', error: 'notfound' };
  const bare = typed.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const slash = bare.indexOf('/');
  const hostPart = (slash === -1 ? bare : bare.slice(0, slash)).replace(/:\d{1,5}$/, '');
  const path = slash === -1 ? '' : bare.slice(slash + 1).replace(/\/+$/, '').replace(/^index\.html$/, '');
  // Another scheme (javascript:, file:, data:) or no host at all: nothing to open.
  if (!hostPart || hostPart.includes(':')) return { kind: 'error', error: 'notfound' };
  // One word is a search, as both browsers treat it.
  if (!hostPart.includes('.')) return { kind: 'search' };
  const byAddress = VMS.find((vm) => vm.ip === hostPart);
  const host = byAddress ? byAddress.host : hostPart;
  const vm = VMS.find((entry) => entry.host === host);
  const key = path ? `${host}/${path}` : host;
  const found = page(key);
  if (vm) {
    if (!running(vm.id)) return { kind: 'error', error: 'timeout', host };
    if (!page(host)) return { kind: 'error', error: 'refused', host };
    if (!found) return { kind: 'error', error: 'missing', host };
    // A page behind a sign-in opens the sign-in page until this browser has signed in.
    if (found.signedIn && !signedIn(found.signedIn)) return { kind: 'page', key: host };
    return { kind: 'page', key };
  }
  if (found && !found.signedIn) return { kind: 'page', key };
  if (page(host)) return { kind: 'page', key: host };
  return { kind: 'error', error: 'notfound' };
}

// search.example's results for a typed line: the keys of the pages whose keywords or
// title share a word with it, best first. Pages behind a sign-in, hidden pages (easter
// eggs) and about: pages are never listed.
export function searchLab(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_ADDRESS) return [];
  const words = new Set(raw.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1));
  if (!words.size) return [];
  return Object.entries(PAGES)
    .filter(([key, entry]) => !entry.signedIn && !entry.hidden && !key.startsWith('about:'))
    .map(([key, entry]) => {
      const terms = new Set([...entry.keywords, ...entry.title.toLowerCase().split(/[^a-z0-9]+/)]);
      return { key, score: [...words].filter((word) => terms.has(word)).length };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.key);
}
