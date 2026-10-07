// Checks a typed puzzle answer against a stored SHA-256 digest (data/puzzles.js).
// Used by ui/terminal-ui.js for the sudo password prompt.
//
// The typed text is untrusted: it is length-checked and normalized by
// utils/validate.js (case-sensitive, spaces kept) before hashing, and it is never stored,
// echoed or logged. Fails closed: no Web Crypto (an insecure context) means no match.

import { normalizePuzzleAnswer } from '../utils/validate.js';

const HEX = /^[0-9a-f]{64}$/;

export async function matchesPuzzle(raw, sha256Hex) {
  if (typeof sha256Hex !== 'string' || !HEX.test(sha256Hex)) return false;
  const answer = normalizePuzzleAnswer(raw, { caseSensitive: true, collapseSpaces: false });
  if (!answer.ok) return false;
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return false;
  try {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(answer.value));
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex === sha256Hex;
  } catch {
    return false;
  }
}
