// "Decrypting" status tags: green [ ACTIVE ] tags on every page (owner request).
// Amber [ ONGOING ] and archive-gold [ ARCHIVED ] tags keep their own styles.
// Loop per tag: hold the readable word, a scanner head sweeps right-to-left scrambling it,
// the glyphs churn for a moment, then the head sweeps left-to-right decrypting it again.
//
// Pure enhancement (doctrine section 12): without JavaScript, or with reduced motion, the
// authored tag text stays as is. The real text moves into a .visually-hidden span so
// assistive technology always reads the word, never the noise; the animated copy is
// aria-hidden. Everything renders with textContent via el(), and the beam is a class on a
// character span, so no style attributes or CSSOM properties are needed (doctrine section 9).
// One shared interval drives every tag; it stops while the tab is hidden and on pagehide.

import { el } from '../utils/dom.js';

const TICK_MS = 60;
const HOLD_TICKS = 60; // readable word on screen (~3.6s)
const STEP_TICKS = 2; // ticks per character while the head sweeps
const CHURN_TICKS = 14; // fully scrambled before decrypting (~0.85s)
const STAGGER_TICKS = 20; // offset between consecutive tags, inside the hold window
const MAX_TAGS = 24; // bounded work: pages only carry a handful of tags
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+<>/\\=?!';
// "[ WORD ]": the capture starts and ends on a letter so surrounding spaces stay outside.
const TAG_TEXT = /^\[\s*([A-Z](?:[A-Z ]{0,22}[A-Z])?)\s*\]$/;

const randomGlyph = (random) => GLYPHS[Math.floor(random() * GLYPHS.length) % GLYPHS.length];
const noise = (length, random) => Array.from({ length }, () => randomGlyph(random)).join('');

export function cycleTicks(length) {
  return HOLD_TICKS + 2 * length * STEP_TICKS + CHURN_TICKS;
}

// Frame for a word at position `tick` in its cycle: the decrypted prefix, the scanner head
// character (empty when no sweep is running) and the scrambled remainder. Lengths always
// add up to the word length, so the monospace tag never changes width.
export function frameAt(word, tick, random = Math.random) {
  const n = word.length;
  const sweep = n * STEP_TICKS;
  let t = ((tick % cycleTicks(n)) + cycleTicks(n)) % cycleTicks(n);
  if (t < HOLD_TICKS) return { done: word, head: '', rest: '' };
  t -= HOLD_TICKS;
  if (t < sweep) {
    // Scramble pass: head travels right to left, noise grows behind it.
    const at = n - 1 - Math.floor(t / STEP_TICKS);
    return { done: word.slice(0, at), head: randomGlyph(random), rest: noise(n - at - 1, random) };
  }
  t -= sweep;
  if (t < CHURN_TICKS) return { done: '', head: '', rest: noise(n, random) };
  t -= CHURN_TICKS;
  // Decrypt pass: head travels left to right, leaving the real word behind it.
  const at = Math.floor(t / STEP_TICKS);
  return { done: word.slice(0, at), head: randomGlyph(random), rest: noise(n - at - 1, random) };
}

export function parseTag(text) {
  const match = TAG_TEXT.exec(text.trim());
  return match ? match[1] : null;
}

function prepare(tag, index) {
  const label = tag.textContent.trim();
  const word = parseTag(label);
  if (!word) return null;
  const parts = { done: el('span'), head: el('span', { className: 'status-scramble-head' }), rest: el('span', { className: 'status-scramble-rest' }) };
  const visual = el('span', { className: 'status-scramble', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { text: '[ ' }), parts.done, parts.head, parts.rest, el('span', { text: ' ]' }),
  ]);
  tag.replaceChildren(el('span', { className: 'visually-hidden', text: label }), visual);
  return { word, parts, offset: index * STAGGER_TICKS, last: {} };
}

function paint(item, tick) {
  const frame = frameAt(item.word, tick + item.offset);
  for (const key of ['done', 'head', 'rest']) {
    if (item.last[key] !== frame[key]) item.parts[key].textContent = frame[key];
  }
  item.last = frame;
}

// The running scrambler, for btop/ps/kill (ui/terminal-ui.js): how many tags it drives,
// and a kill that stops it and leaves every tag showing its word.
let mounted = null;

export function scrambleProcess() {
  return mounted ? { tags: mounted.count } : null;
}

export function killStatusScramble() {
  if (mounted) mounted.kill();
}

export function mountStatusScramble(root = document) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tags = [...root.querySelectorAll('.status-tag:not(.status-ongoing):not(.status-archived)')].slice(0, MAX_TAGS);
  const items = tags.map(prepare).filter(Boolean);
  if (!items.length) return;

  let tick = 0;
  let timer = 0;
  const step = () => { tick += 1; for (const item of items) paint(item, tick); };
  const start = () => { if (!timer && !document.hidden) timer = window.setInterval(step, TICK_MS); };
  const stop = () => { window.clearInterval(timer); timer = 0; };

  let killed = false;
  const onVisibility = () => (document.hidden ? stop() : start());
  const onShow = () => { if (!killed) start(); };
  items.forEach((item) => paint(item, tick));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', onShow); // back/forward cache restores the page
  start();
  mounted = {
    count: items.length,
    kill() {
      killed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      // Settle on the readable word, as if the decrypt had just finished.
      for (const item of items) {
        item.parts.done.textContent = item.word;
        item.parts.head.textContent = '';
        item.parts.rest.textContent = '';
      }
      mounted = null;
    },
  };
}
