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
  // The lab's cheat code (owner request, October 8, 2026): the passphrase for the
  // encrypted guest images, asked for by "vm unlock". It unlocks every guest; it grants
  // nothing but Layer 2 progress (ui/lab-progress.js).
  // Device logins inside the lab, by VM name. cam01's root password was set by the owner
  // for testing (October 10, 2026); missions may change how it is found later.
  deviceLogins: Object.freeze({
    cam01: Object.freeze({ sha256: Object.freeze(['967495b0f0c63e5a13847f66f05f47b364965ac28c69b6e020dc3281ce1c3f07']) }),
  }),
  vmImages: Object.freeze({ sha256: Object.freeze(['0fe6e29223b9877b7f61a1e3fa62ba6b08e35089c4c01282b1e80afe76eb11db']) }),
});
