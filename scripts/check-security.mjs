// Security checks from the Website Security Doctrine (sections 5, 9, 10, 13).
// Usage: node scripts/check-security.mjs
//
// Text-based checks cannot prove data flow is safe (doctrine section 13); they catch
// forbidden patterns early so review can focus on logic. Changing any rule or the
// required CSP below needs the same review as a doctrine change.
import { join } from 'node:path';
import { ROOT, SITE_DIR, listFiles, readText, extOf, findAll, report, isMain } from './lib.mjs';

// Doctrine section 9. Every published HTML page carries exactly this policy.
export const REQUIRED_CSP = Object.freeze({
  'default-src': "'none'",
  'script-src': "'self'",
  'script-src-attr': "'none'",
  'style-src': "'self'",
  'style-src-attr': "'none'",
  'img-src': "'self'",
  'font-src': "'self'",
  'connect-src': "'none'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
  'frame-src': "'none'",
  'worker-src': "'none'",
  'media-src': "'none'",
  'manifest-src': "'none'",
  'upgrade-insecure-requests': '',
});

// Doctrine section 5: forbidden execution and HTML-injection sinks.
const JS_RULES = [
  [/\.innerHTML\b/g, 'innerHTML is forbidden; use textContent or utils/dom.js'],
  [/\.outerHTML\b/g, 'outerHTML is forbidden'],
  [/\binsertAdjacentHTML\b/g, 'insertAdjacentHTML is forbidden'],
  [/\bdocument\s*\.\s*write(?:ln)?\b/g,'document.write/writeln is forbidden'],
  [/\b(?:setHTMLUnsafe|parseHTMLUnsafe|createContextualFragment)\b/g, 'HTML parsing sink is forbidden'],
  [/\beval\s*\(/g, 'eval() is forbidden'],
  [/\bnew\s+Function\b/g, 'new Function() is forbidden'],
  [/(?<![.\w])Function\s*\(/g, 'Function() constructor is forbidden'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/g, 'string argument to setTimeout/setInterval is forbidden'],
  [/\bsrcdoc\b/g, 'srcdoc is forbidden'],
  [/\.cssText\b/g, 'style.cssText is forbidden (doctrine section 9)'],
  [/\bsetAttribute\s*\(\s*['"`](?:style|srcdoc|on[a-z]+)['"`]/gi, 'setAttribute with an executable or style attribute is forbidden'],
  [/\bimport\s*\(\s*(?!['"][^'"`$]+['"]\s*\))/g, 'dynamic import must use a literal path (use core/layer-loader.js)'],
  [/\b(?:import|from)\s*['"](?:https?:)?\/\//g, 'remote module imports are forbidden'],
  [/['"`]\s*javascript:/gi, 'javascript: URLs are forbidden'],
  [/sourceMappingURL/g, 'source maps are not approved for production'],
];

const HTML_RULES = [
  [/<[a-z][^>]*\son[a-z]+\s*=/gi, 'inline event-handler attribute'],
  [/<script\b(?![^>]*\ssrc\s*=)[^>]*>/gi, 'inline <script> (JavaScript must load from a same-origin file)'],
  [/<script\b[^>]*\ssrc\s*=\s*["']?(?:https?:)?\/\//gi, 'external script'],
  [/<[a-z][^>]*\sstyle\s*=/gi, 'inline style attribute'],
  [/<style[\s>]/gi, 'inline <style> element'],
  [/<link\b[^>]*\shref\s*=\s*["']?(?:https?:)?\/\//gi, 'external <link> resource'],
  [/<(?:iframe|frame|object|embed|base)\b/gi, 'frame, object, embed or base element'],
  [/<form\b/gi, 'forms are not permitted (doctrine section 1)'],
  [/\s(?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/gi, 'javascript: URL'],
];

const CSS_RULES = [
  [/@import\b/gi, '@import (load stylesheets from the page instead)'],
  [/url\(\s*['"]?(?:https?:)?\/\//gi, 'external url() in CSS'],
  [/\bexpression\s*\(/gi, 'CSS expression()'],
  [/javascript:/gi, 'javascript: in CSS'],
  [/sourceMappingURL/g, 'source maps are not approved for production'],
];

// http:// is allowed only for XML namespace identifiers, which are never fetched.
const HTTP_ALLOWED = /^http:\/\/www\.w3\.org\//;

function ruleHits(file, text, rules) {
  const out = [];
  for (const [re, rule] of rules) {
    for (const hit of findAll(text, re)) out.push({ file, line: hit.line, rule, detail: hit.match.trim().slice(0, 80) });
  }
  return out;
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

export function parseCsp(value) {
  const out = {};
  for (const part of value.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    out[tokens[0].toLowerCase()] = tokens.slice(1).join(' ');
  }
  return out;
}

// Doctrine section 9: CSP meta early in <head>, before governed resources, plus no-referrer.
export function checkHtmlPolicies(file, html) {
  const findings = [];
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)];
  const csp = metas.find((m) => (attrs(m[0])['http-equiv'] || '').toLowerCase() === 'content-security-policy');
  if (!csp) {
    findings.push({ file, rule: 'missing Content-Security-Policy meta' });
  } else {
    const firstResource = html.search(/<(?:link|script|style|img|picture|source|video|audio|iframe|object|embed)\b/i);
    if (firstResource !== -1 && firstResource < csp.index) {
      findings.push({ file, rule: 'CSP meta must come before the first resource it governs' });
    }
    const headClose = html.search(/<\/head>/i);
    if (headClose !== -1 && csp.index > headClose) findings.push({ file, rule: 'CSP meta must be inside <head>' });
    const policy = parseCsp(attrs(csp[0]).content || '');
    for (const [directive, value] of Object.entries(REQUIRED_CSP)) {
      if (!(directive in policy)) findings.push({ file, rule: 'CSP directive missing', detail: directive });
      else if (policy[directive] !== value) findings.push({ file, rule: 'CSP directive differs from doctrine', detail: `${directive} ${policy[directive]}` });
    }
    for (const directive of Object.keys(policy)) {
      if (!(directive in REQUIRED_CSP)) findings.push({ file, rule: 'unreviewed CSP directive', detail: directive });
    }
  }
  const referrer = metas.find((m) => {
    const a = attrs(m[0]);
    return (a.name || '').toLowerCase() === 'referrer' && (a.content || '').toLowerCase() === 'no-referrer';
  });
  if (!referrer) findings.push({ file, rule: 'missing <meta name="referrer" content="no-referrer">' });

  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.target || '').toLowerCase() === '_blank') {
      const rel = (a.rel || '').toLowerCase().split(/\s+/);
      if (!rel.includes('noopener') || !rel.includes('noreferrer')) {
        findings.push({ file, line: html.slice(0, m.index).split('\n').length, rule: 'target="_blank" link needs rel="noopener noreferrer"' });
      }
    }
  }
  return findings;
}

function inRange(a, b, c) {
  return (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

// Doctrine section 3: simulated addresses come from documentation ranges only.
export function checkAddresses(file, text) {
  const findings = [];
  for (const m of text.matchAll(/(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\d.])/g)) {
    const octets = m.slice(1, 5).map(Number);
    if (octets.some((o) => o > 255)) continue;
    if (!inRange(octets[0], octets[1], octets[2])) {
      findings.push({ file, line: text.slice(0, m.index).split('\n').length, rule: 'IPv4 outside RFC 5737 documentation ranges', detail: m[0] });
    }
  }
  for (const m of text.matchAll(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi)) {
    const token = m[0];
    if (!token.includes('::') && !/[a-f]/i.test(token)) continue; // times such as 10:30:00
    if ((token.match(/:/g) || []).length < 2) continue;
    if (!/^2001:0?db8:/i.test(token)) {
      findings.push({ file, line: text.slice(0, m.index).split('\n').length, rule: 'IPv6 outside 2001:db8::/32', detail: token });
    }
  }
  return findings;
}

// Suffixes that make a dotted name look like a real or private-network hostname.
const HOST_SUFFIX = /\.(?:com|net|org|io|dev|gov|mil|edu|int|co|us|uk|de|fr|ru|cn|jp|info|biz|app|ai|xyz|me|tv|cloud|online|site|tech|local|lan|corp|internal|intranet|home|private|domain|localdomain)$/i;
const RESERVED_HOST =/(?:\.example|\.test|\.invalid|\.localhost|(?:^|\.)example\.(?:com|net|org))$/i;
const FILE_EXT = /\.(?:js|mjs|css|html?|txt|md|json|jpe?g|png|webp|avif|gif|svg|ico|log|exe|ps1|psm1|sh|py|bat|cmd|zip|pdf|conf|cfg|ini|xml|ya?ml|csv|bak|old|db|sql|key|pem|lnk|dll|sys|msi|iso|img)$/i;

// Doctrine section 3: simulated hostnames use reserved names. Applies to simulation data and logic.
export function checkSimulatedHosts(file, text) {
  const findings = [];
  for (const m of text.matchAll(/(?<![\w@/.-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}(?![\w-])/gi)) {
    const host = m[0];
    if (FILE_EXT.test(host) || RESERVED_HOST.test(host)) continue;
    if (/^(?:document|window|console|Object|Math|Array|Number|String|JSON|Promise|Symbol|Reflect|navigator|location|event|this|self|globalThis)\./.test(host)) continue;
    // Dotted chains that do not end in a domain-like suffix are property access (meta.args.min).
    if (!HOST_SUFFIX.test(host)) continue;
    findings.push({ file, line: text.slice(0, m.index).split('\n').length, rule: 'simulated hostname must use a reserved name (.example, .test)', detail: host });
  }
  return findings;
}

// Doctrine section 13: secrets and credentials anywhere in the repository.
const SECRET_RULES = [
  [/AKIA[0-9A-Z]{16}/g, 'AWS access key ID'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}/g, 'GitHub fine-grained token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/g, 'private key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, 'Slack token'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, 'Google API key'],
  [/\b[rs]k_live_[0-9a-zA-Z]{20,}/g, 'Stripe live key'],
  [/\b(?:api[_-]?key|secret|token|passw(?:or)?d)\s*[:=]\s*['"][^'"\s]{12,}['"]/gi, 'hard-coded credential-like value'],
];

export function checkSecrets(file, text) {
  return ruleHits(file, text, SECRET_RULES);
}

const BINARY = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'pdf', 'zip', 'mp3', 'mp4', 'webm', 'ogg', 'wav']);

// Checks one file that lives under site/. `rel` is relative to site/.
export function checkSiteFile(rel, text) {
  const file = `site/${rel}`;
  const ext = extOf(rel);
  const findings = [];
  if (ext === 'js' || ext === 'mjs') {
    findings.push(...ruleHits(file, text, JS_RULES));
    findings.push(...checkAddresses(file, text));
    if (/^assets\/js\/(?:data|features)\//.test(rel)) findings.push(...checkSimulatedHosts(file, text));
  } else if (ext === 'html' || ext === 'htm') {
    findings.push(...ruleHits(file, text, HTML_RULES));
    findings.push(...checkHtmlPolicies(file, text));
    findings.push(...checkAddresses(file, text));
  } else if (ext === 'css') {
    findings.push(...ruleHits(file, text, CSS_RULES));
  }
  if (!BINARY.has(ext)) {
    for (const hit of findAll(text, /http:\/\/[^\s"'<>)]+/g)) {
      if (!HTTP_ALLOWED.test(hit.match)) findings.push({ file, line: hit.line, rule: 'insecure http:// reference', detail: hit.match.slice(0, 80) });
    }
  }
  return findings;
}

export function run() {
  const findings = [];
  for (const rel of listFiles(SITE_DIR)) {
    if (BINARY.has(extOf(rel))) continue;
    findings.push(...checkSiteFile(rel, readText(join(SITE_DIR, rel))));
  }
  for (const rel of listFiles(ROOT)) {
    const name = rel.split('/').pop();
    if (name === '.env' || name.startsWith('.env.')) findings.push({ file: rel, rule: '.env file committed' });
    if (BINARY.has(extOf(rel))) continue;
    findings.push(...checkSecrets(rel, readText(join(ROOT, rel))));
  }
  return report('check-security', findings);
}

if (isMain(import.meta.url)) process.exitCode = run();
