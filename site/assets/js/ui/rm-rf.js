// "sudo rm -rf /" easter egg (doctrine section 7, approved command surface; owner
// request): the site "deletes itself". Each home or project module falls off the page in
// turn, then the footer and the top bar, while the shell reports what it removed. After a
// beat on the empty page it admits the joke and everything flies back into place.
//
// Purely visual and reversible, as the doctrine requires: nothing is removed from the
// DOM, storage or anywhere else. Elements only get classes (rm-gone, rm-tilt-left/right,
// rm-back; terminal.css draws the fall and the return). The shells stay put, so the
// visitor can type "reboot" at any time, and Escape restores everything at once. It
// cannot trap the visitor: the timeline is fixed and ends restored even if nothing is
// pressed. Reduced motion: elements fade out and back instead of falling.

const STEP_MS = 260; // between elements falling
const HOLD_MS = 2000; // the empty page, before the punchline
const RESTORE_MS = 1000; // rm-back animation (terminal.css)
const LABEL = /^module-([a-z0-9-]{1,32})$/;
const ROOT = '/srv/portfolio';

let running = false;

// What falls: everything on screen first, top to bottom, so the visitor sees each piece
// go; whatever is scrolled out of view goes last, all at once. Labels come from our own
// module ids, still checked against a fixed pattern before they are shown (doctrine
// section 4).
function targets() {
  const nodes = [document.querySelector('.topbar'), ...document.querySelectorAll('.modules > .module'), document.querySelector('.site-footer')].filter(Boolean);
  const list = nodes.map((node) => {
    const match = LABEL.exec(node.id || '');
    const rect = node.getBoundingClientRect();
    const label = node.classList.contains('topbar') ? 'topbar' : node.classList.contains('site-footer') ? 'footer' : match ? match[1] : 'module';
    return { node, label, visible: rect.bottom > 0 && rect.top < window.innerHeight };
  });
  return [...list.filter((item) => item.visible), ...list.filter((item) => !item.visible)];
}

// shell: the shell api that ran the command (print, live, clearLive).
export function runRmRf({ shell }) {
  if (running) {
    shell.print([{ kind: 'err', text: 'rm: already removing everything. patience.' }]);
    return;
  }
  running = true;
  const timers = [];
  const later = (fn, ms) => timers.push(window.setTimeout(fn, ms));
  const list = targets();
  let restored = false;

  const restore = () => {
    if (restored) return;
    restored = true;
    for (const t of timers) window.clearTimeout(t);
    document.removeEventListener('keydown', onKey, true);
    shell.clearLive();
    for (const { node } of list) {
      if (node.classList.contains('rm-gone')) {
        node.classList.remove('rm-gone');
        node.classList.add('rm-back');
      }
    }
    shell.print([
      { kind: 'ok', text: 'just kidding. this site is static, so nothing was deleted. restoring from backup...' },
    ]);
    window.setTimeout(() => {
      for (const { node } of list) node.classList.remove('rm-back', 'rm-tilt-left', 'rm-tilt-right');
      shell.print([{ kind: 'ok', text: '[ ok ] restored. everything is fine. probably.' }]);
      running = false;
    }, RESTORE_MS);
  };
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    restore();
  };
  document.addEventListener('keydown', onKey, true);

  shell.print([{ kind: 'err', text: `rm: it is dangerous to operate recursively on '/'. doing it anyway...` }]);
  const live = shell.live('out');
  const shown = list.filter((item) => item.visible).length;
  list.forEach(({ node, label }, i) => {
    // Off-screen pieces go together, right after the last visible one.
    later(() => {
      node.classList.add('rm-gone', i % 2 ? 'rm-tilt-left' : 'rm-tilt-right');
      live.set(`removed '${ROOT}/${label}'`);
    }, 400 + Math.min(i, shown) * STEP_MS);
  });
  const emptyAt = 400 + (shown + 1) * STEP_MS + 900;
  later(() => {
    shell.clearLive();
    shell.print([
      { kind: 'out', text: `rm: removed '${ROOT}' and all ${list.length} things in it` },
      { kind: 'err', text: 'wafflesOS: / is empty. there is nothing left to show.' },
      { kind: 'out', text: '(press Esc to undo, or wait for it...)' },
    ]);
  }, emptyAt);
  later(restore, emptyAt + HOLD_MS);
}
