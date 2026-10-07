// Color themes (owner request): the "theme" command recolors the site's accent and the
// console text like CRT phosphor. Used by ui/terminal-ui.js on every page.
//
// A theme is one class on <html> (theme-amber, theme-green); theme.css redefines the
// color tokens under it. cyan is the default and adds no class. The choice is kept in
// SESSION_KEYS.theme so it follows the visitor between Layer 1 pages, and is cleared
// with the rest of the machine session on refresh and reboot. The stored value is read
// back as untrusted and must be a known id.

import { sessionStore, readJson, writeJson, removeKey } from '../core/storage.js';
import { SESSION_KEYS } from '../core/constants.js';
import { THEME_IDS } from '../data/commands.js';
import { pickKnown } from '../utils/validate.js';

let current = 'cyan';

function apply() {
  const root = document.documentElement;
  for (const id of THEME_IDS) root.classList.toggle(`theme-${id}`, id !== 'cyan' && id === current);
}

export function currentTheme() {
  return current;
}

// Called once per page load, before first paint (app.js is render-blocking).
export function resumeTheme() {
  current = pickKnown(readJson(sessionStore(), SESSION_KEYS.theme), THEME_IDS, 'cyan');
  apply();
}

export function setTheme(id) {
  current = pickKnown(id, THEME_IDS, 'cyan');
  const store = sessionStore();
  if (current === 'cyan') removeKey(store, SESSION_KEYS.theme);
  else writeJson(store, SESSION_KEYS.theme, current);
  apply();
}
