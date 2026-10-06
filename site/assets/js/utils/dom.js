// Narrow, safe DOM helpers. Doctrine sections 5 and 17.
// Everything renders as text. Element names come from a fixed allowlist, attribute names
// from a fixed allowlist, and URL-bearing attributes are validated for their context.
// Helpers return DOM nodes, never markup strings.

import { EXTERNAL_LINK_HOSTS } from '../core/constants.js';

const ALLOWED_TAGS = new Set([
  // canvas: the decorative 31337 matrix rain (ui/matrix-rain.js); drawn with the 2D API only.
  'a', 'article', 'br', 'button', 'canvas', 'code', 'div', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'header', 'hr', 'img', 'input', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'small', 'span', 'strong', 'time', 'ul',
]);

// Text inputs only (the terminal). Fixed values; nothing here can submit or execute.
const INPUT_ATTRIBUTES = new Map([
  ['type', new Set(['text'])],
  ['autocomplete', new Set(['off'])],
  ['autocapitalize', new Set(['off'])],
  ['autocorrect', new Set(['off'])],
  ['spellcheck', new Set(['false'])],
  ['enterkeyhint', new Set(['enter'])],
]);

// Non-executable attributes only. href and src are validated separately below.
const PLAIN_ATTRIBUTES = new Set(['alt', 'title', 'role', 'lang', 'datetime']);
const ARIA_ATTRIBUTE = /^aria-[a-z]+$/;
const ID_VALUE = /^[a-z][a-z0-9-]{0,63}$/;
// Ids that would shadow browser globals through named access (DOM clobbering).
const RESERVED_IDS = new Set([
  'alert', 'blur', 'close', 'closed', 'console', 'document', 'event', 'external', 'focus', 'frames',
  'history', 'length', 'location', 'name', 'navigator', 'open', 'opener', 'origin', 'parent',
  'print', 'screen', 'self', 'status', 'top', 'window',
]);
const isSafeId = (value) => ID_VALUE.test(value) && !RESERVED_IDS.has(value);
const RELATIVE_PATH = /^(?:\.{1,2}\/|[A-Za-z0-9_-])[A-Za-z0-9._~/-]*(?:#[A-Za-z0-9_-]+)?$/;
const FRAGMENT = /^#[A-Za-z0-9_-]+$/;
const IMAGE_PATH = /\.(?:jpe?g|png|webp|avif)$/i;
const EXTERNAL_HOSTS = new Set(EXTERNAL_LINK_HOSTS);

export function isAllowedTag(tag) {
  return typeof tag === 'string' && ALLOWED_TAGS.has(tag);
}

// Same-origin relative path or fragment, or https to a reviewed external host.
// Returns the href to use, or null when the value is not allowed.
export function safeHref(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return null;
  if (FRAGMENT.test(value)) return value;
  if (RELATIVE_PATH.test(value) && !value.includes('//') && !value.includes(':')) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!EXTERNAL_HOSTS.has(url.hostname)) return null;
  return url.href;
}

export function isExternalHref(href) {
  return typeof href === 'string' && href.startsWith('https://');
}

// Same-origin relative image paths only.
export function safeImageSrc(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  if (!RELATIVE_PATH.test(value) || value.includes('//') || value.includes(':') || value.includes('#')) return null;
  return IMAGE_PATH.test(value) ? value : null;
}

// Validates one attribute for one element. Returns [name, value] to apply, or null.
export function safeAttribute(tag, name, value) {
  if (typeof name !== 'string') return null;
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value === 'boolean') value = value ? 'true' : 'false';
  if (typeof value !== 'string' || value.length > 512) return null;
  if (PLAIN_ATTRIBUTES.has(name) || ARIA_ATTRIBUTE.test(name)) return [name, value];
  if (name === 'id') return isSafeId(value) ? [name, value] : null;
  if (name === 'tabindex') return value === '0' || value === '-1' ? [name, value] : null;
  if (name === 'type' && tag === 'button') return value === 'button' ? [name, value] : null;
  if (tag === 'input') {
    if (name === 'maxlength') return /^[1-9][0-9]{0,3}$/.test(value) ? [name, value] : null;
    const allowed = INPUT_ATTRIBUTES.get(name);
    return allowed && allowed.has(value) ? [name, value] : null;
  }
  if (name === 'href' && tag === 'a') {
    const href = safeHref(value);
    return href ? [name, href] : null;
  }
  if (name === 'src' && tag === 'img') {
    const src = safeImageSrc(value);
    return src ? [name, src] : null;
  }
  return null;
}

// Creates an element from the allowlist with text content and validated attributes.
// Throws on a tag outside the allowlist: tags are chosen by reviewed code, never by input.
// Attributes that fail validation are dropped.
export function el(tag, { className = '', text = null, attrs = {} } = {}, children = []) {
  if (!isAllowedTag(tag)) throw new Error('Element not allowed');
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [name, value] of Object.entries(attrs)) {
    const safe = safeAttribute(tag, name, value);
    if (safe) node.setAttribute(safe[0], safe[1]);
  }
  if (tag === 'a' && isExternalHref(node.getAttribute('href'))) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (tag === 'button' && !node.hasAttribute('type')) node.setAttribute('type', 'button');
  if (tag === 'input' && !node.hasAttribute('type')) node.setAttribute('type', 'text');
  if (text !== null && text !== undefined) node.textContent = String(text);
  for (const child of children) {
    if (child !== null && child !== undefined) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function setText(node, text) {
  node.textContent = text === null || text === undefined ? '' : String(text);
}

export function replaceContent(node, ...children) {
  node.replaceChildren(...children.filter((child) => child !== null && child !== undefined));
}

export function clear(node) {
  node.replaceChildren();
}

// Explicit lookup; never rely on element ids becoming globals (DOM clobbering).
export function byId(id, root = document) {
  return isSafeId(id) ? root.getElementById(id) : null;
}
