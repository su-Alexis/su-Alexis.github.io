// Install as features/fake-network.js. All responses are synchronous, fictional,
// and derived from the authored lab data. No sockets, requests, or subprocesses.
// Each exported handler takes (guest, args) and returns { lines, echo, failed }.
// Once a lab host is named, curl, ssh and ping also say what happened to it, for the
// mission result contract (features/mission-engine.js) and the shared scenario state
// (features/scenario.js): target (the VM's id), reason (a fixed word when it did not
// work: unreachable, refused, protocol, not-found, auth, filtered) and contact ({ service, user? }
// when the request reached a listening service, so the target's logs can show it).
import { VMS } from '../data/commands.js';
import { SERVICES, HTTP_SERVERS, LATENCY } from '../data/lab-network.js';
import { PAGES } from '../data/lab-web.js';
import { fixtureRoute, blocked } from './scenario.js';

const out = (text) => ({ kind: 'out', text });
const err = (text) => ({ kind: 'err', text });
const success = (text, echo) => ({ lines: text.map(out), echo, failed: false });
const failure = (text, echo = null) => ({ lines: [err(text)], echo, failed: true });
const own = (map, key, fallback) => Object.hasOwn(map, key) ? map[key] : fallback;
const validArgs = (args) => Array.isArray(args) && args.length <= 32
  && args.every((arg) => typeof arg === 'string' && arg.length > 0
    && arg.length <= 512 && /^[\x21-\x7e]+$/.test(arg));
const hostName = (vm) => vm.host || vm.id;
const services = (vm) => own(SERVICES, vm.id, []);
const latency = (vm) => own(LATENCY, vm.id, LATENCY.default);
const portNumber = (raw) => /^\d{1,5}$/.test(raw || '')
  && Number(raw) >= 1 && Number(raw) <= 65535 ? Number(raw) : null;

function resolveHost(guest, raw) {
  const name = raw.toLowerCase().replace(/\.$/, '');
  // Only the name "localhost": the security check allows no loopback address literal.
  if (name === 'localhost') {
    return VMS.find((vm) => vm.id === guest?.vm?.id) || null;
  }
  return VMS.find((vm) => [vm.id, hostName(vm), vm.ip]
    .some((alias) => alias.toLowerCase() === name)) || null;
}

// A lab machine answers only while its VM is powered on (layers/layer2.js sets
// guest.running); the machine you are on always does.
const isUp = (guest, vm) => vm.id === guest?.vm?.id || typeof guest?.running !== 'function' || guest.running(vm.id);

// Whether the target's firewall drops this seat's packets (ufw deny on a scenario machine,
// features/scenario.js blocked). A drop is silent: the sender waits and times out, where a
// closed port would refuse at once (Blue 1 spec: deny drops, reject would refuse).
const dropped = (guest, vm) => vm.id !== guest?.vm?.id
  && blocked(vm.id, guest?.vm?.id, typeof guest?.scenario === 'function' ? guest.scenario() : []);

function help(command, args, usage, details) {
  if (validArgs(args) && args.length === 1 && ['--help', '-h', '?', '/?', '-?'].includes(args[0])) {
    return success([`Usage: ${usage}`, ...details], `${command} --help`);
  }
  return null;
}

// ping [-c COUNT|-n COUNT] HOST. Finite by design: four replies by default,
// at most ten; -c is Unix, -n is Winbows. No timers or guest state changes.
export function ping(guest, args) {
  const usage = `ping [${guest?.winbows ? '-n' : '-c'} count] <host>`;
  const info = help('ping', args, usage, ['Simulated replies only; count must be 1 through 10 (default 4).']);
  if (info) return info;
  if (!validArgs(args)) return failure(`Usage: ${usage}`);
  let target = null;
  let count = 4;
  let explicitCount = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === (guest?.winbows ? '-n' : '-c')) {
      const value = args[++i];
      if (explicitCount || !/^(?:[1-9]|10)$/.test(value || '')) return failure(`Usage: ${usage}`);
      count = Number(value);
      explicitCount = true;
    } else if (args[i].startsWith('-') || target !== null) return failure(`Usage: ${usage}`);
    else target = args[i];
  }
  if (target === null) return failure(`Usage: ${usage}`);
  const vm = resolveHost(guest, target);
  if (!vm) return failure(guest?.winbows
    ? 'Ping request could not find host. Please check the name and try again.'
    : 'ping: Name or service not known');
  if (!isUp(guest, vm)) {
    const from = guest?.vm?.ip || '';
    return {
      target: vm.id,
      reason: 'unreachable',
      lines: guest?.winbows
        ? Array.from({ length: count }, () => out(`Reply from ${from}: Destination host unreachable.`))
        : Array.from({ length: count }, (_, i) => out(`From ${from} icmp_seq=${i + 1} Destination Host Unreachable`)),
      echo: `ping${explicitCount ? ` ${guest?.winbows ? '-n' : '-c'} ${count}` : ''} ${hostName(vm)}`,
      failed: true,
    };
  }
  if (dropped(guest, vm)) {
    const echoDropped = `ping${explicitCount ? ` ${guest?.winbows ? '-n' : '-c'} ${count}` : ''} ${hostName(vm)}`;
    return {
      target: vm.id,
      reason: 'filtered',
      lines: guest?.winbows
        ? [out(''), out(`Pinging ${hostName(vm)} [${vm.ip}] with 32 bytes of data:`), ...Array.from({ length: count }, () => out('Request timed out.')),
          out(''), out(`Ping statistics for ${vm.ip}:`), out(`    Packets: Sent = ${count}, Received = 0, Lost = ${count} (100% loss),`)]
        : [out(`PING ${hostName(vm)} (${vm.ip}) 56(84) bytes of data.`), out(''), out(`--- ${hostName(vm)} ping statistics ---`),
          out(`${count} packets transmitted, 0 received, 100% packet loss, time ${(count - 1) * 1000 + 30}ms`)],
      echo: echoDropped,
      failed: true,
    };
  }
  const ms = latency(vm);
  const reached = (result) => ({ ...result, target: vm.id });
  const ttl =['winbows', 'winserver'].includes(vm.image) ? 128 : 64;
  const echo = `ping${explicitCount ? ` ${guest?.winbows ? '-n' : '-c'} ${count}` : ''} ${hostName(vm)}`;
  if (guest?.winbows) {
    const time = ms < 1 ? 'time<1ms' : `time=${Math.round(ms)}ms`;
    const rounded = Math.round(ms);
    return reached(success([
      '', `Pinging ${hostName(vm)} [${vm.ip}] with 32 bytes of data:`,
      ...Array.from({ length: count }, () => `Reply from ${vm.ip}: bytes=32 ${time} TTL=${ttl}`),
      '', `Ping statistics for ${vm.ip}:`,
      `    Packets: Sent = ${count}, Received = ${count}, Lost = 0 (0% loss),`,
      'Approximate round trip times in milli-seconds:',
      `    Minimum = ${rounded}ms, Maximum = ${rounded}ms, Average = ${rounded}ms`,
    ], echo));
  }
  const time = ms.toFixed(2);
  return reached(success([
    `PING ${hostName(vm)} (${vm.ip}) 56(84) bytes of data.`,
    ...Array.from({ length: count }, (_, i) => `64 bytes from ${vm.ip}: icmp_seq=${i + 1} ttl=${ttl} time=${time} ms`),
    '', `--- ${hostName(vm)} ping statistics ---`,
    `${count} packets transmitted, ${count} received, 0% packet loss, time ${(count - 1) * 1000}ms`,
    `rtt min/avg/max/mdev = ${time}/${time}/${time}/0.00 ms`,
  ], echo));
}

// Parse compact ranges without expanding all 65,535 ports into output rows.
function portRanges(raw) {
  if (raw === '-') return [[1, 65535]];
  const parts = raw.split(',');
  if (parts.length > 32) return null;
  const ranges = [];
  for (const part of parts) {
    if (!/^\d{1,5}(?:-\d{1,5})?$/.test(part)) return null;
    const [left, right = left] = part.split('-');
    const start = portNumber(left);
    const end = portNumber(right);
    if (start === null || end === null || start > end) return null;
    ranges.push([start, end]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce((merged, range) => {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
    return merged;
  }, []);
}

function ipv4(raw) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(raw)) return null;
  const octets = raw.split('.').map(Number);
  return octets.every((n) => n <= 255) ? octets.reduce((value, n) => value * 256 + n, 0) : null;
}

function scanTargets(guest, raw) {
  if (!raw.includes('/')) {
    const vm = resolveHost(guest, raw);
    return vm ? { hosts: [vm], count: 1, echo: hostName(vm) } : null;
  }
  const match = /^(198\.51\.100\.\d{1,3})\/(\d{1,2})$/.exec(raw);
  if (!match) return null;
  const ip = ipv4(match[1]);
  const prefix = Number(match[2]);
  if (ip === null || prefix < 24 || prefix > 32) return null;
  const count = 2 ** (32 - prefix);
  const start = Math.floor(ip / count) * count;
  const hosts = VMS.filter((vm) => {
    const address = ipv4(vm.ip);
    return address !== null && address >= start && address < start + count;
  });
  return { hosts, count, echo: `198.51.100.${start % 256}/${prefix}` };
}

// Default scan: a small teaching set plus every configured service port.
// This deliberately does not claim to implement Nmap's real top-1000 database.
const COMMON_PORTS = Object.freeze({
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 80: 'http',
  110: 'pop3', 135: 'msrpc', 139: 'netbios-ssn', 143: 'imap', 443: 'https',
  445: 'macrosoft-ds', 3306: 'mysql', 3389: 'ms-wbt-server', 8080: 'http-proxy',
});

export function nmap(guest, args) {
  const usage = 'nmap [-sn | -sV] [-Pn] [--open] [-p ports | -p-] <host|lab-CIDR>';
  const info = help('nmap', args, usage, [
    'Simulated TCP scans only. CIDRs are limited to 198.51.100.0/24 and its subnets.',
    'Ports: comma-separated numbers/ranges; -p- scans 1-65535.',
    'Default: common teaching ports plus all configured service ports.',
  ]);
  if (info) return info;
  if (!validArgs(args)) return failure(`Usage: ${usage}`);
  const flags = new Set();
  let ranges = null;
  let target = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (['-sn', '-sV', '-Pn', '--open'].includes(arg)) flags.add(arg);
    else if (arg === '-p' || arg.startsWith('-p')) {
      if (ranges !== null) return failure(`Usage: ${usage}`);
      const raw = arg === '-p' ? args[++i] : arg.slice(2);
      ranges = raw ? portRanges(raw) : null;
      if (!ranges) return failure('nmap: invalid port selection');
    } else if (arg.startsWith('-') || target !== null) return failure(`Usage: ${usage}`);
    else target = arg;
  }
  if (target === null || (flags.has('-sn') && (ranges || flags.size > 1))) return failure(`Usage: ${usage}`);
  const scan = scanTargets(guest, target);
  if (!scan) return failure('Failed to resolve the given target. WARNING: No targets were specified, so 0 hosts scanned.');
  const selection = ranges;
  if (!ranges) {
    const ports = new Set(Object.keys(COMMON_PORTS).map(Number));
    for (const vm of VMS) for (const service of services(vm)) ports.add(service.port);
    ranges = [...ports].sort((a, b) => a - b).map((port) => [port, port]);
  }
  const scanned = ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
  const selected = (port) => ranges.some(([start, end]) => port >= start && port <= end);
  const text = ['Starting Nmap (simulated lab)'];
  if (!flags.has('-sn')) text.push(`Scanning ${scanned} TCP ports per host.`);
  // A scan of one named host acts on it (the mission result's target).
  const single = target.includes('/') ? null : scan.hosts[0];
  // Powered-off machines do not show up at all. A machine whose firewall drops us answers
  // no probe, so it looks down too, unless -Pn skips host discovery: then every port is
  // filtered (no response).
  const silent = scan.hosts.filter((vm) => isUp(guest, vm) && dropped(guest, vm));
  scan.hosts = scan.hosts.filter((vm) => isUp(guest, vm) && (flags.has('-Pn') || !dropped(guest, vm)));
  for (const vm of scan.hosts) {
    if (dropped(guest, vm)) {
      text.push(`Nmap scan report for ${hostName(vm)} (${vm.ip})`, 'Host is up.');
      if (!flags.has('-sn')) text.push(`All ${scanned} scanned ports on ${hostName(vm)} (${vm.ip}) are in ignored states.`, `Not shown: ${scanned} filtered tcp ports (no-response)`);
      continue;
    }
    const open =services(vm).filter((service) => selected(service.port)).sort((a, b) => a.port - b.port);
    if (flags.has('--open') && !open.length) continue;
    text.push(`Nmap scan report for ${hostName(vm)} (${vm.ip})`, `Host is up (${(latency(vm) / 1000).toFixed(5)}s latency).`);
    if (flags.has('-sn')) continue;
    const closed = scanned - open.length;
    const summarize = !selection || scanned > 32 || flags.has('--open');
    if (closed) text.push(summarize ? `Not shown: ${closed} closed tcp ports (reset)` : `${closed} closed tcp port(s) (reset)`);
    const rows = new Map(open.map((service) => [service.port, { ...service, state: 'open' }]));
    if (!summarize) {
      for (const [start, end] of ranges) for (let port = start; port <= end; port += 1) {
        if (!rows.has(port)) rows.set(port, { port, state: 'closed', name: own(COMMON_PORTS, port, 'unknown'), version: '' });
      }
    }
    if (rows.size) {
      text.push(`PORT       STATE   SERVICE${flags.has('-sV') ? '          VERSION' : ''}`);
      for (const row of [...rows.values()].sort((a, b) => a.port - b.port)) {
        text.push(`${`${row.port}/tcp`.padEnd(10)} ${row.state.padEnd(7)} ${row.name.padEnd(16)}${flags.has('-sV') ? ` ${row.version}` : ''}`.trimEnd());
      }
    }
  }
  if (single && silent.includes(single) && !flags.has('-Pn')) text.push('Note: Host seems down. If it is really up, but blocking our ping probes, try -Pn');
  text.push(`Nmap done: ${scan.count} IP address${scan.count === 1 ? '' : 'es'} (${scan.hosts.length} host${scan.hosts.length === 1 ? '' : 's'} up) scanned (simulated)`);
  const portsEcho = selection ? ` -p ${selection.map(([a, b]) => a === b ? a : `${a}-${b}`).join(',')}` : '';
  const done = success(text, `nmap${[...flags].sort().map((flag) => ` ${flag}`).join('')}${portsEcho} ${scan.echo}`);
  return single ? { ...done, target: single.id } : done;
}

// HTTP bodies are authored fixtures, not VM files. Unknown paths return a
// generic 404; arbitrary paths, credentials and query strings are never echoed.
const HOME_BODY = '<!doctype html>\n<html><head><title>Lab web server</title></head>\n<body><h1>It works!</h1><p>This is a simulated lab server.</p></body></html>\n';
const NOT_FOUND_BODY = '<!doctype html>\n<html><head><title>404 Not Found</title></head>\n<body><h1>Not Found</h1></body></html>\n';

// The same pages the in-VM browsers show (data/lab-web.js), so curl and Firecat agree:
// a text file comes back as itself, a page as simple HTML built from its authored text.
// Returns the page's body, or null when the machine has no such page.
function labPage(vm, path) {
  const clean = path.replace(/\/+$/, '').replace(/^\/index\.html$/, '');
  const key = `${hostName(vm)}${clean}`;
  // A folder page may be keyed with its trailing slash (web01.lab.example/maintenance/).
  const page = Object.hasOwn(PAGES, key) ? PAGES[key] : clean && Object.hasOwn(PAGES, `${key}/`) ? PAGES[`${key}/`] : null;
  if (!page || page.host !== vm.id || page.signedIn) return null;
  if (page.theme === 'text') return page.blocks.map((block) => block.text || '').join('');
  const lines = page.blocks.flatMap((block) => {
    if (block.t === 'h1' || block.t === 'h2' || block.t === 'p' || block.t === 'note') return [`<${block.t === 'note' ? 'p' : block.t}>${block.text}</${block.t === 'note' ? 'p' : block.t}>`];
    if (block.t === 'pre') return [`<pre>${block.text}</pre>`];
    if (block.t === 'index') return block.items.map((item) => `<a href="${item.to.slice(hostName(vm).length) || '/'}">${item.name}</a>`);
    if (block.t === 'login') return ['<form method="post"><input name="username"><input name="password" type="password"></form>'];
    return [];
  });
  return `<!doctype html>\n<html><head><title>${page.title}</title></head>\n<body>\n${lines.join('\n')}\n</body></html>\n`;
}

export function curl(guest, args) {
  const usage = 'curl [-I|--head] [-i|--include] [-f|--fail] [-s|--silent] [-S|--show-error] <http(s)://host/path>';
  const info = help('curl', args, usage, ['GET and HEAD only. Authored pages: / and /index.html; other paths return 404.']);
  if (info) return info;
  if (!validArgs(args)) return failure(`Usage: ${usage}`);
  const flags = new Set();
  const longFlags = { '--head': 'I', '--include': 'i', '--fail': 'f', '--silent': 's', '--show-error': 'S' };
  let target = null;
  for (const arg of args) {
    if (Object.hasOwn(longFlags, arg)) flags.add(longFlags[arg]);
    else if (/^-[IifsS]+$/.test(arg)) for (const flag of arg.slice(1)) flags.add(flag);
    else if (arg.startsWith('-') || target !== null) return failure(`Usage: ${usage}`);
    else target = arg;
  }
  const fail = (message, echo = null) => flags.has('s') && !flags.has('S')
    ? { lines: [], echo, failed: true } : failure(message, echo);
  if (target === null) return failure(`Usage: ${usage}`);
  // Parse only a literal host, optional TCP port, and path. No URL coercion,
  // credentials, IPv6, queries, fragments, redirects, or filesystem schemes.
  const match = /^(?:(https?):\/\/)?([A-Za-z0-9.-]+)(?:[:](\d{1,5}))?(\/[^?#\\]*)?$/.exec(target);
  if (!match) return fail('curl: (3) Unsupported or malformed lab URL');
  const [, scheme = 'http', host, rawPort, path = '/'] = match;
  const port = rawPort === undefined ? (scheme === 'https' ? 443 : 80) : portNumber(rawPort);
  if (port === null) return fail('curl: (3) Invalid port number');
  const vm = resolveHost(guest, host);
  if (!vm) return fail(guest?.winbows ? 'curl : The remote name could not be resolved' : 'curl: (6) Could not resolve host');
  // What happened at the host (see the top of this file); web is the web server's contact.
  const to = (result, reason = '', contact = null) => ({ ...result, target: vm.id, ...(reason ? { reason } : {}), ...(contact ? { contact } : {}) });
  // The request as the web server's log sees it (features/scenario.js matches evidence
  // on method and path).
  const web = { service: 'http', method: flags.has('I') ? 'HEAD' : 'GET', path };
  // A page a scenario fixture serves (web01's /status.txt) shows its current state.
  const routed = fixtureRoute(vm.id, path, typeof guest?.scenario === 'function' ? guest.scenario() : []);
  const page = routed !== null ? routed : labPage(vm, path);
  const knownPath = page !== null || path === '/' || path === '/index.html';
  const flagsEcho = [...flags].sort().join('');
  const echo = knownPath ? `curl${flagsEcho ? ` -${flagsEcho}` : ''} ${scheme}://${hostName(vm)}${port === (scheme === 'https' ? 443 : 80) ? '' : `:${port}`}${path}` : null;
  if (!isUp(guest, vm)) return to(fail(`curl: (7) Failed to connect to ${hostName(vm)} port ${port}: No route to host`, echo), 'unreachable');
  if (dropped(guest, vm)) return to(fail(`curl: (28) Failed to connect to ${hostName(vm)} port ${port} after 130000 ms: Connection timed out`, echo), 'filtered');
  const service = services(vm).find((entry) => entry.port === port);
  if (!service) return to(fail(`curl: (7) Failed to connect to ${hostName(vm)} port ${port}: Connection refused`, echo), 'refused');
  if (!['http', 'https'].includes(service.name)) return to(fail('curl: (52) Empty reply from server (not an HTTP service)', echo), 'protocol');
  if ((scheme === 'https') !== (service.name === 'https')) return to(fail(scheme === 'https'
    ? 'curl: (35) TLS handshake failed: wrong protocol for this port'
    : 'curl: (52) Empty reply from server (HTTPS requires TLS)', echo), 'protocol');
  const status = knownPath ? '200 OK' : '404 Not Found';
  if (!knownPath && flags.has('f')) return to(fail('curl: (22) The requested URL returned error: 404', echo), 'not-found', web);
  const body = page !== null ? page : knownPath ? HOME_BODY : NOT_FOUND_BODY;
  if (guest?.winbows) {
    if (!knownPath) return to(failure('curl : The remote server returned an error: (404) Not Found.', echo), 'not-found', web);
    const server = own(HTTP_SERVERS, vm.id, 'Simulated HTTP server');
    const firstLine = body.split('\n')[0];
    return to(success([
      ' ',
      'StatusCode        : 200',
      'StatusDescription : OK',
      `Content           : ${firstLine.slice(0, 40)}...`,
      `RawContent        : HTTP/1.1 200 OK`,
      `                    Server: ${server}`,
      `                    Content-Type: text/html; charset=utf-8...`,
      `Headers           : {[Server, ${server}], [Content-Type, text/html; charset=utf-8], [Content-Length, ${body.length}]}`,
      `RawContentLength  : ${body.length}`,
      ' ',
    ], echo), '', web);
  }
  const headers = [
    `HTTP/1.1 ${status}`, `Server: ${own(HTTP_SERVERS, vm.id, 'Simulated HTTP server')}`,
    'Content-Type: text/html; charset=utf-8', `Content-Length: ${body.length}`, 'Connection: close', '',
  ];
  // A 404 still reached the web server (and its log); only the page was not there.
  return to(success([
    ...(flags.has('I') || flags.has('i') ? headers : []),
    ...(flags.has('I') ? [] : body.trimEnd().split('\n')),
  ], echo), knownPath ? '' : 'not-found', web);
}

// nslookup NAME|ADDRESS (Blue 1, owner-approved spec): the lab's resolver (dnsmasq on
// router01, data/lab-network.js) answers from the lab map only, forward (a name to its
// address) or reverse (an address to its name). A name it does not know is never
// repeated. lookup: the VM the answer names (the mission result's lookup field).
const RESOLVER = VMS.find((vm) => vm.id === 'router01');
export function nslookup(guest, args) {
  const info = help('nslookup', args, 'nslookup <host|address>', ["Answers from the lab's resolver for lab.example, corp.example and 198.51.100.0/24 only."]);
  if (info) return info;
  if (!validArgs(args) || args.length !== 1 || args[0].startsWith('-')) return failure('Usage: nslookup <host|address>');
  const header = [`Server:         ${RESOLVER.ip}`, `Address:        ${RESOLVER.ip}#53`, ' '];
  const vm = resolveHost(guest, args[0]);
  const reverse = ipv4(args[0]) !== null;
  if (!vm) {
    return { lines: [...header.map(out), err(reverse ? '** server can\'t find that address: NXDOMAIN' : '** server can\'t find that name: NXDOMAIN')], echo: null, failed: true };
  }
  const name = vm.host || vm.id;
  const text = reverse
    ? [...header, `${vm.ip.split('.').reverse().join('.')}.in-addr.arpa      name = ${name}.`]
    : [...header, `Name:   ${name}`, `Address: ${vm.ip}`];
  // Only the resolver was asked; the machine named was never contacted (no target).
  return { ...success(text, `nslookup ${reverse ? vm.ip : name}`), lookup: vm.id };
}

// SSH is a completed connection/authentication transcript, not an interactive
// remote shell. No password is requested, stored, or checked; auth always fails.
// -v exposes the configured SSH version so lessons can inspect the service.
export function ssh(guest, args) {
  const usage = 'ssh [-v] [-p port] [user@]<host>';
  const info = help('ssh', args, usage, ['Simulates connection and authentication failure. No remote shell or password prompt.']);
  if (info) return info;
  if (!validArgs(args)) return failure(`Usage: ${usage}`);
  let port = 22;
  let explicitPort = false;
  let verbose = false;
  let target = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (/^-v{1,3}$/.test(arg)) verbose = true;
    else if (arg === '-p') {
      if (explicitPort) return failure(`Usage: ${usage}`);
      port = portNumber(args[++i]);
      if (port === null) return failure('ssh: invalid port');
      explicitPort = true;
    } else if (arg.startsWith('-') || target !== null) return failure(`Usage: ${usage}`);
    else target = arg;
  }
  if (target === null) return failure(`Usage: ${usage}`);
  const parts = target.split('@');
  if (parts.length > 2 || parts.some((part) => !part)) return failure(`Usage: ${usage}`);
  const vm = resolveHost(guest, parts[parts.length - 1]);
  if (!vm) return failure('ssh: Could not resolve hostname: Name or service not known');
  const user = parts.length === 2 ? parts[0] : guest?.vm?.user;
  // Reconstruct only usernames already authored in VMS (plus Unix root).
  const knownUser = [...new Set(['root', ...VMS.map((entry) => entry.user)])].find((entry) => entry === user);
  const echo = knownUser ? `ssh${verbose ? ' -v' : ''}${explicitPort ? ` -p ${port}` : ''} ${knownUser}@${hostName(vm)}` : null;
  const to = (result, reason) => ({ ...result, target: vm.id, reason });
  if (!isUp(guest, vm)) return to(failure(`ssh: connect to host ${hostName(vm)} port ${port}: No route to host`, echo), 'unreachable');
  if (dropped(guest, vm)) return to(failure(`ssh: connect to host ${hostName(vm)} port ${port}: Connection timed out`, echo), 'filtered');
  const service = services(vm).find((entry) => entry.port === port);
  if (!service) return to(failure(`ssh: connect to host ${hostName(vm)} port ${port}: Connection refused`, echo), 'refused');
  if (service.name !== 'ssh') return to(failure('kex_exchange_identification: Connection closed by remote host', echo), 'protocol');
  // sshd saw the attempt: its log keeps the account asked for (a known name only).
  return {
    target: vm.id,
    reason: 'auth',
    ...(knownUser ? { contact: { service: 'ssh', user: knownUser } } : {}),
    lines: [
      ...(verbose ? [
        out(`debug1: Connecting to ${hostName(vm)} [${vm.ip}] port ${port}.`),
        out('debug1: Connection established.'),
        out(`debug1: Remote service: ${service.version || 'SSH protocol 2.0'}`),
      ] : []),
      out('Simulated SSH: no credentials are collected; authentication is denied.'),
      err('Permission denied (publickey,password).'),
    ],
    echo,
    failed: true,
  };
}
