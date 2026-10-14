# Previous site migration

Source: `su-Alexis/su-Alexis.github.io` (Jekyll, `jekyll-theme-midnight`), copied on 2026-10-02. The previous site stays live until the new one is finished. Untouched originals remain in `Projects & Code\su-Alexis.github.io`.

## Where everything went

| Previous location | New location | Status |
|---|---|---|
| `index.md` | `legacy/pages/home.md` | **Converted** into the `site/index.html` modules (identity, certifications, links). LinkedIn link fixed (added `/in/`). |
| `projects/index.md` | `legacy/pages/projects-hub.md` | **Converted** to `site/projects/index.html` (2026-10-02). |
| `projects/windows-debloat-and-optimize/index.md` | `legacy/pages/projects/windows-debloat-and-optimize.md` | **Converted** to `site/projects/windows-debloat-and-optimize/index.html` (2026-10-02), with a script-free screenshot viewer replacing the inline-handler lightbox. |
| `writeups/index.md` | `legacy/pages/writeups-hub.md` | **Converted** to `site/writeups/index.html` (2026-10-02). |
| `writeups/portswiggerLabs/index.md` | `legacy/pages/writeups/portswigger-labs.md` | Contains only `temp`. Replace with a real writeup. |
| `assets/images/projects/windows-debloat-and-optimize/*.png` (7, 11 MB) | `site/assets/media/images/projects/windows-debloat-and-optimize/*.jpg` (7, 2.2 MB) | Resized to 1400 px wide, JPEG quality 88, metadata stripped, renamed (see below). |
| `assets/css/style.scss` | `legacy/css/style.scss` | Reference for the new CSS. |
| `_layouts/default.html` | `legacy/jekyll/_layouts/default.html` | Page shell and lightbox script. Reference only. |
| `_includes/quick-links.html` | `legacy/jekyll/_includes/quick-links.html` | Quick links block. Reference only. |
| `_config.yml`, `README.md` | `legacy/jekyll/` | Jekyll config. Not used by the new site. |

Screenshot renames: `wdebloatscriptstart` → `start`, `wdebloatscriptbloatremoval` → `bloat-removal`, `wdebloatscriptoptimizations` → `optimizations`, `wdebloatscriptNetChanges` → `net-changes`, `wdebloatscriptNetCleaner` → `net-cleaner`, `wdebloatscriptdisablingscheduledtasks` → `scheduled-tasks`, `wdebloatscriptend` → `end`.

Not copied: `assets/images/writeups/example-shot.png` (2-byte broken file), the empty `README.md` files in the writeup image folders, and `assets/images/projects/windows-debloat-and-optimize/index.md` (old note "replace with screenshots").

## Still to do while converting each page

- Write HTML with the CSP meta and `no-referrer` tags; drop Liquid tags (`{{ ... | relative_url }}`).
- Point images at `assets/media/images/projects/windows-debloat-and-optimize/<new-name>.jpg` with relative paths (the site will first live on a repository subpath).
- Rebuild the lightbox as an external module without inline `onclick`, `<script>`, or `style` strings.
- Delete `legacy/` and this file once every page is converted.
