# Resume Web App

Static, terminal-themed portfolio rebuilt from the previous Jekyll site (`su-Alexis/su-Alexis.github.io`).

Planning whiteboard (read before building, do not edit unless the owner says so). It is kept outside this repository, in the parent folder `Projects & Code/`:

- `../!Security Doctrine/` — security rules (authoritative)
- `../!Skeleton/` — architecture and file responsibilities
- `../!Stages/` — product stages and ideas

## Layout

- `site/` — the only directory published to GitHub Pages
- `.github/workflows/`, `scripts/`, `tests/` — checks and deployment, never published
- `legacy/` — previous Jekyll machinery kept for reference, never published
- `MIGRATION.md` — where the previous site's files went and what still needs converting

`_PLACEHOLDER.md` files mark empty skeleton directories. Delete each one once its directory has real content; none may be published.

## Checks

Requires Node.js 22 or newer. No packages to install.

```bash
node scripts/check-security.mjs        # banned code patterns, page policies, simulation identifiers, secrets
node scripts/check-publish.mjs --dev   # publish allowlist; placeholders and missing pages only warn
node scripts/check-publish.mjs         # strict: what deploy.yml requires before uploading site/
node --test "tests/**/*.test.mjs"      # proves the checks catch what they should
```

To publish a new file, add its path to `scripts/publish-inventory.txt`. That list is the reviewed allowlist.

## Previewing locally

```bash
node scripts/serve.mjs
```

Then open http://127.0.0.1:8765/ (`PORT=8766 node scripts/serve.mjs` for another port). It serves only `site/`, on 127.0.0.1, revalidating HTML on every load and caching CSS/JS/images for 60 seconds (Ctrl+Shift+R shows asset edits immediately; assets must stay cacheable or Chrome skips the page slide transitions), and sends the doctrine's CSP and referrer policy as headers. Module scripts do not run from `file://`.

`site/404.html` uses root-absolute paths (`/assets/...`) because GitHub Pages serves it for unknown URLs at any depth. That is correct on the custom domain. While the site lives on a `github.io` repository subpath, the 404 page's styles and home link point at the domain root instead.
