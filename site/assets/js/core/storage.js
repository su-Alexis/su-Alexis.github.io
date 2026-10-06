// Bounded, failure-tolerant storage access. Doctrine section 8.
// Storage is convenience only: every read is validated by the caller, every failure
// (blocked storage, quota, malformed data) falls back to safe in-memory defaults.

import { LIMITS, STORAGE_PREFIX } from './constants.js';
import { parseBoundedJson } from '../utils/validate.js';

export function sessionStore() {
  try {
    const store = window.sessionStorage;
    return store && typeof store.getItem === 'function' ? store : null;
  } catch {
    return null;
  }
}

function isAppKey(key) {
  return typeof key === 'string' && key.startsWith(STORAGE_PREFIX) && key.length <= 64;
}

// Returns the parsed value, or undefined when missing, oversized, malformed or unavailable.
export function readJson(store, key) {
  if (!store || !isAppKey(key)) return undefined;
  let raw;
  try {
    raw = store.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  const parsed = parseBoundedJson(raw);
  return parsed.ok ? parsed.value : undefined;
}

// Writes only when the serialized value is within the doctrine's size limits.
export function writeJson(store, key, value) {
  if (!store || !isAppKey(key)) return false;
  let raw;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  if (typeof raw !== 'string' || raw.length > LIMITS.storageCodeUnits) return false;
  if (new TextEncoder().encode(raw).length > LIMITS.storageBytes) return false;
  try {
    store.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(store, key) {
  if (!store || !isAppKey(key)) return;
  try {
    store.removeItem(key);
  } catch {
    // Nothing to do: storage is unavailable.
  }
}
