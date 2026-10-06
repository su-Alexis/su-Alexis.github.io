// Keyboard support for the script-free screenshot viewer (project pages with galleries).
// The viewer itself is plain links and :target (layout.css); this only adds what CSS
// cannot do, so without JavaScript the viewer still works:
//   - opening a shot moves focus into the viewer (its Next control), so keyboard users
//     are not left on the page underneath;
//   - Escape closes it, Left/Right arrows step through shots;
//   - closing returns focus to the gallery tile that opened that shot.
// Only fixed, validated ids are used: "#shot-N" for lightboxes on this page.

const SHOT_HASH = /^#shot-([1-9][0-9]?)$/;

function openLightbox() {
  const match = SHOT_HASH.exec(window.location.hash);
  if (!match) return null;
  const box = document.getElementById(`shot-${match[1]}`);
  return box && box.classList.contains('lightbox') ? box : null;
}

export function mountShotViewer() {
  if (!document.querySelector('.lightbox')) return;
  let lastShot = null;

  const sync = () => {
    const box = openLightbox();
    if (box) {
      lastShot = box.id;
      const next = box.querySelector('.lightbox-nav a:last-child');
      if (next) next.focus({ preventScroll: true });
      return;
    }
    // Closed: give focus back to the tile that opened the last shot.
    if (lastShot) {
      const tile = document.querySelector(`.shot-link[href="#${lastShot}"]`);
      if (tile) tile.focus({ preventScroll: true });
      lastShot = null;
    }
  };

  window.addEventListener('hashchange', sync);
  document.addEventListener('keydown', (event) => {
    const box = openLightbox();
    if (!box) return;
    const links = box.querySelectorAll('.lightbox-nav a');
    if (links.length !== 3) return;
    const [prev, close, next] = links;
    if (event.key === 'Escape') close.click();
    else if (event.key === 'ArrowLeft') prev.click();
    else if (event.key === 'ArrowRight') next.click();
    else return;
    event.preventDefault();
  });
  sync();
}
