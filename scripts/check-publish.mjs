// Publish-boundary checks from the Website Security Doctrine (sections 2, 10, 13).
// Usage:
//   node scripts/check-publish.mjs           strict: exactly what may be deployed
//   node scripts/check-publish.mjs --dev     development: placeholders and missing pages are warnings
//   node scripts/check-publish.mjs --dir X   check directory X instead of site/
//
// Every file under the publish directory must be listed in scripts/publish-inventory.txt,
// and every listed file must exist. The inventory is the reviewed allowlist; adding a
// line there is a review decision, not a formality.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT, SITE_DIR, listFiles, readText, fileSize, extOf, report, isMain } from './lib.mjs';

export const INVENTORY_PATH = join(ROOT, 'scripts', 'publish-inventory.txt');

export const ALLOWED_EXTENSIONS = new Set(['html', 'css', 'js', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'ico', 'woff2']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'ico']);

export const LIMITS = Object.freeze({
  imageBytes: 600 * 1024,
  otherBytes: 200 * 1024,
  totalBytes: 10 * 1024 * 1024,
});

export const REQUIRED_PAGES = Object.freeze(['index.html', '404.html']);

const PLACEHOLDER = '_PLACEHOLDER.md';

export function parseInventory(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line) entries.push(line);
  }
  return entries;
}

function nameRules(rel) {
  const name = rel.split('/').pop();
  const ext = extOf(rel);
  const out = [];
  if (rel.split('/').some((part) => part.startsWith('.'))) out.push('hidden file or directory');
  if (/\.map$/i.test(name)) out.push('source map');
  if (/\.(?:bak|old|orig|tmp|temp|swp|swo)$/i.test(name) || name.endsWith('~')) out.push('backup or temporary file');
  if (/(?:^|[.-])(?:test|spec|debug|draft)(?:[.-]|$)/i.test(name)) out.push('test, debug or draft file');
  if (!ALLOWED_EXTENSIONS.has(ext)) out.push(`file type .${ext || '(none)'} is not publishable`);
  return out;
}

// Doctrine section 10: published images carry no EXIF, XMP or text metadata.
export function imageMetadata(buf, ext) {
  if (ext === 'jpg' || ext === 'jpeg') {
    let i = 2;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
      const len = buf.readUInt16BE(i + 2);
      if (marker === 0xe1) return 'EXIF/XMP (APP1)';
      if (marker === 0xed) return 'IPTC (APP13)';
      if (marker === 0xfe) return 'comment (COM)';
      i += 2 + len;
    }
    return null;
  }
  if (ext === 'png') {
    let i = 8;
    while (i + 8 <= buf.length) {
      const len = buf.readUInt32BE(i);
      const type = buf.toString('latin1', i + 4, i + 8);
      if (['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(type)) return `${type} chunk`;
      if (type === 'IEND') break;
      i += 12 + len;
    }
    return null;
  }
  return null;
}

// Pure check over a file listing so it can be tested without touching disk.
// files: [{ rel, size, metadata? }], inventory: [rel], dev: boolean
export function checkPublish({ files, inventory, dev = false, label = 'site' }) {
  const findings = [];
  const warnings = [];
  const listed = new Set(inventory);
  const present = new Set();
  let total = 0;

  const seen = new Set();
  for (const entry of inventory) {
    if (seen.has(entry)) findings.push({ file: 'scripts/publish-inventory.txt', rule: 'duplicate inventory entry', detail: entry });
    seen.add(entry);
    if (entry.startsWith('/') || entry.split('/').includes('..')) findings.push({ file: 'scripts/publish-inventory.txt', rule: 'inventory entries must be relative paths inside the publish directory', detail: entry });
  }

  for (const { rel, size, metadata } of files) {
    const file = `${label}/${rel}`;
    present.add(rel);
    if (rel.split('/').pop() === PLACEHOLDER) {
      (dev ? warnings : findings).push({ file, rule: 'placeholder must be removed before publishing' });
      continue;
    }
    for (const rule of nameRules(rel)) findings.push({ file, rule });
    if (metadata) findings.push({ file, rule: 'image metadata must be stripped', detail: metadata });
    if (!listed.has(rel)) findings.push({ file, rule: 'not in scripts/publish-inventory.txt (unreviewed file)' });
    const limit = IMAGE_EXTENSIONS.has(extOf(rel)) ? LIMITS.imageBytes : LIMITS.otherBytes;
    if (size > limit) findings.push({ file, rule: 'file larger than the reviewed limit', detail: `${Math.round(size / 1024)} KB > ${Math.round(limit / 1024)} KB` });
    total += size;
  }

  for (const entry of inventory) {
    if (!present.has(entry)) findings.push({ file: 'scripts/publish-inventory.txt', rule: 'listed file does not exist', detail: entry });
  }
  for (const page of REQUIRED_PAGES) {
    if (!present.has(page)) (dev ? warnings : findings).push({ file: `${label}/${page}`, rule: 'required page missing' });
  }
  if (total > LIMITS.totalBytes) findings.push({ file: label, rule: 'publish directory larger than the reviewed total', detail: `${Math.round(total / 1024)} KB` });

  return { findings, warnings };
}

// Every same-origin href/src in published HTML must point at a published file.
// Relative paths resolve from the page; root-absolute paths (404.html) from the site root.
// Directory links ("projects/") resolve to their index.html.
export function checkInternalLinks(pages, present) {
  const out = [];
  for (const { rel, html } of pages) {
    const baseDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
    for (const m of html.matchAll(/\s(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
      const value = m[1];
      if (value === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue; // external, scheme or fragment
      let path = value.split('#')[0].split('?')[0];
      path = path.startsWith('/') ? path.slice(1) : baseDir + path;
      const parts = [];
      for (const part of path.split('/')) {
        if (part === '..') parts.pop();
        else if (part !== '.') parts.push(part);
      }
      let target = parts.join('/');
      if (target === '' || target.endsWith('/')) target += 'index.html';
      if (!present.has(target)) out.push({ file: `site/${rel}`, rule: 'internal link points at a missing file', detail: value });
    }
  }
  return out;
}

export function run(argv = process.argv.slice(2)) {
  const dev = argv.includes('--dev');
  const dirIndex = argv.indexOf('--dir');
  const dir = dirIndex !== -1 && argv[dirIndex + 1] ? resolve(argv[dirIndex + 1]) : SITE_DIR;
  let inventory = [];
  try {
    inventory = parseInventory(readText(INVENTORY_PATH));
  } catch {
    return report('check-publish', [{ file: 'scripts/publish-inventory.txt', rule: 'inventory file missing or unreadable' }]);
  }
  const files = listFiles(dir).map((rel) => {
    const path = join(dir, rel);
    const ext = extOf(rel);
    const metadata = ext === 'jpg' || ext === 'jpeg' || ext === 'png' ? imageMetadata(readFileSync(path), ext) : null;
    return { rel, size: fileSize(path), metadata };
  });
  const { findings, warnings } = checkPublish({ files, inventory, dev });
  const present = new Set(files.map((f) => f.rel));
  const pages = files.filter((f) => extOf(f.rel) === 'html').map((f) => ({ rel: f.rel, html: readText(join(dir, f.rel)) }));
  for (const broken of checkInternalLinks(pages, present)) (dev ? warnings : findings).push(broken);
  for (const w of warnings) console.warn(`  warning: ${w.file}  ${w.rule}${w.detail ? `  (${w.detail})` : ""}`);
  return report(`check-publish${dev ? ' (dev)' : ''}`, findings);
}

if (isMain(import.meta.url)) process.exitCode = run();
