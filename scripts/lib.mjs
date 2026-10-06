// Shared helpers for the repository checks. Node built-ins only; no dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SITE_DIR = join(ROOT, 'site');

// Directories never walked by any check.
const ALWAYS_SKIP = new Set(['.git', 'node_modules']);

export function toPosix(path) {
  return path.split(sep).join('/');
}

// Returns POSIX-style paths relative to `base` for every file under `dir`.
export function listFiles(dir, base = dir, skip = new Set()) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (ALWAYS_SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    const rel = toPosix(relative(base, full));
    if (skip.has(rel)) continue;
    if (entry.isDirectory()) out.push(...listFiles(full, base, skip));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

export function readText(path) {
  return readFileSync(path, 'utf8');
}

export function fileSize(path) {
  return statSync(path).size;
}

export function extOf(path) {
  const name = path.split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

// Collects every match of `re` (must have the g flag) as { line, match }.
export function findAll(text, re) {
  const hits = [];
  for (const m of text.matchAll(re)) hits.push({ line: lineOf(text, m.index), match: m[0] });
  return hits;
}

export function report(name, findings) {
  if (findings.length === 0) {
    console.log(`${name}: passed`);
    return 0;
  }
  console.error(`${name}: ${findings.length} problem(s)`);
  for (const f of findings) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${where}  ${f.rule}${f.detail ? `  (${f.detail})` : ''}`);
  }
  return 1;
}

export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && fileURLToPath(importMetaUrl) === resolve(process.argv[1]);
}
