// Puzzle answers for in-site progression (doctrine section 8, "puzzle progress").
//
// These are game answers, not credentials: everything in this static site is public, and
// solving a puzzle only changes what the console shows (root's prompt, whoami). Nothing on
// the site, and nothing real, is protected by them. Only a SHA-256 digest is kept so the
// answer is not sitting in plain text in the source; that is obscurity for the game's
// sake, not security. Checked by features/puzzles.js.

export const PUZZLES = Object.freeze({
  // sudo and su: either password makes the visitor root (owner request, Layer 2
  // groundwork; the second was added on October 7, 2026).
  root: Object.freeze({ sha256: Object.freeze(['7e7762b14afd03c1e19070b1a202c3ee66041d69deefee543ce209bd001b4f41', 'e27b8b92211177bddb6570c15400465588faff1689b9c31670410418c754adcf']) }),
});
