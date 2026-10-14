// Local preview server for site/. Development only; never deployed.
// Usage: node scripts/serve.mjs   (then open http://127.0.0.1:8765/; PORT=8766 to change)
//
// - Listens on 127.0.0.1 only.
// - Serves files strictly inside site/ (no path traversal, no directory listings).
// - Caching: HTML is revalidated on every load (no-cache + ETag), so page edits show on
//   the next reload. CSS, JS and images may be reused for 60 seconds (like GitHub Pages,
//   which allows 10 minutes); press Ctrl+Shift+R to see asset edits sooner.
//   Do not make assets no-store or no-cache: Chrome skips cross-document view
//   transitions (the desktop slide) when the incoming page has to re-fetch its
//   stylesheets and scripts over the network.
// - Sends the doctrine's CSP and referrer policy as headers too, so local testing
//   matches a header-capable host.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep, extname } from 'node:path';
import { SITE_DIR } from './lib.mjs';
import { REQUIRED_CSP } from './check-security.mjs';

// Port 8765 by default; PORT=<1024-65535> overrides it.
const PORT = /^\d{4,5}$/.test(process.env.PORT || '') && Number(process.env.PORT) <= 65535 ? Number(process.env.PORT) : 8765;
const HOST = '127.0.0.1';
const ROOT = resolve(SITE_DIR);
const CSP = Object.entries(REQUIRED_CSP).map(([d, v]) => (v ? `${d} ${v}` : d)).join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  let full = resolve(join(ROOT, decoded));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  try {
    if ((await stat(full)).isDirectory()) full = join(full, 'index.html');
    return (await stat(full)).isFile() ? full : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const headers = {
    'Content-Security-Policy': `${CSP}; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, headers).end();
    return;
  }
  let file = await resolveFile(req.url || '/');
  let status = 200;
  if (!file) {
    file = join(ROOT, '404.html');
    status = 404;
  }
  try {
    const body = await readFile(file);
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    const cache = extname(file) === '.html' ? 'no-cache' : 'max-age=60';
    if (status === 200 && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ...headers, 'Cache-Control': cache, ETag: etag }).end();
      return;
    }
    res.writeHead(status, {
      ...headers,
      'Cache-Control': cache,
      ETag: etag,
      'Content-Length': body.length,
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500, headers).end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serving site/ at http://${HOST}:${PORT}/ (HTML revalidated, assets cached 60s, CSP headers). Ctrl+C to stop.`);
});
