// Validation for every untrusted input: terminal text, puzzle answers, identifiers,
// URL state and stored state. Doctrine sections 4, 5 and 8.
//
// Every function returns a result object and never throws on bad input. Callers use
// only the validated values, never the raw input.

import { LIMITS } from '../core/constants.js';

const ok = (value) => Object.freeze({ ok: true, value });
const fail = (reason) => Object.freeze({ ok: false, reason });

// C0 controls (U+0000-U+001F), DEL (U+007F) and C1 controls (U+0080-U+009F).
// Tabs and pasted newlines are rejected too; Enter submits separately.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const COMMAND_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const ASCII_ONLY = /^[\x20-\x7e]*$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function hasControlChars(text) {
  return CONTROL_CHARS.test(text);
}

// Terminal input contract (doctrine section 5, "Input normalization contract"):
// raw limits first; reject control characters; trim and split on ASCII spaces only;
// command names are ASCII, checked before lowercasing; arguments keep their case.
// Returns { name, args } on success. Argument values are still checked per command schema.
export function parseCommand(raw) {
  if (typeof raw !== 'string') return fail('invalid');
  if (raw.length > LIMITS.commandRaw) return fail('too-long');
  if (hasControlChars(raw)) return fail('control-chars');
  const trimmed = raw.replace(/^ +| +$/g, '');
  if (trimmed.length === 0) return fail('empty');
  if (trimmed.length > LIMITS.commandNormalized) return fail('too-long');
  const tokens = trimmed.split(/ +/);
  const [rawName, ...args] = tokens;
  if (!ASCII_ONLY.test(rawName)) return fail('non-ascii-command');
  const name = rawName.toLowerCase();
  if (!COMMAND_NAME.test(name)) return fail('invalid-command');
  if (args.length > LIMITS.commandArgs) return fail('too-many-args');
  if (args.some((arg) => arg.length > LIMITS.commandArgLength)) return fail('arg-too-long');
  return ok(Object.freeze({ name, args: Object.freeze(args) }));
}

// Puzzle answers: raw and normalized length limits, NFC normalization,
// puzzle-specific case and whitespace rules.
export function normalizePuzzleAnswer(raw, { caseSensitive = false, collapseSpaces = true } = {}) {
  if (typeof raw !== 'string') return fail('invalid');
  if (raw.length > LIMITS.puzzleAnswerRaw) return fail('too-long');
  if (hasControlChars(raw)) return fail('control-chars');
  let value = raw.normalize('NFC').trim();
  if (collapseSpaces) value = value.replace(/\s+/g, ' ');
  if (!caseSensitive) value = value.toLowerCase();
  if (value.length === 0) return fail('empty');
  if (value.length > LIMITS.puzzleAnswerNormalized) return fail('too-long');
  return ok(value);
}

// Exact match against a known, finite set of identifiers (layers, nodes, files, sections).
// Uses an own-property-safe lookup so inherited names such as "constructor" never match.
export function knownId(raw, allowed) {
  if (typeof raw !== 'string') return fail('invalid');
  if (raw.length === 0 || raw.length > LIMITS.identifierLength) return fail('invalid');
  if (!IDENTIFIER.test(raw)) return fail('invalid');
  const set = allowed instanceof Set ? allowed : new Set(allowed);
  return set.has(raw) ? ok(raw) : fail('unknown');
}

// Picks a known identifier or falls back to a safe default. For URL hashes, query values
// and restored state, where failing closed to the default is the required behavior.
export function pickKnown(raw, allowed, fallback) {
  const result = knownId(raw, allowed);
  return result.ok ? result.value : fallback;
}

// Reads a presentation choice from a URL hash such as "#projects".
// The hash only ever selects among known IDs; anything else returns the fallback.
export function hashChoice(hash, allowed, fallback) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return fallback;
  return pickKnown(hash.slice(1), allowed, fallback);
}

// Bounded JSON parsing for stored state: string length first, then UTF-8 byte length,
// then parse. Returns the parsed value only; callers must reconstruct trusted state
// field by field and never merge it directly.
export function parseBoundedJson(raw, { maxCodeUnits = LIMITS.storageCodeUnits, maxBytes = LIMITS.storageBytes } = {}) {
  if (typeof raw !== 'string') return fail('invalid');
  if (raw.length > maxCodeUnits) return fail('too-large');
  if (new TextEncoder().encode(raw).length > maxBytes) return fail('too-large');
  try {
    return ok(JSON.parse(raw));
  } catch {
    return fail('malformed');
  }
}

// True only for plain objects created from JSON (no prototype tricks, no arrays).
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Reads one own property without consulting the prototype chain.
export function ownField(object, key) {
  return isPlainObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;
}
