// Layer 2: the network configuration commands (owner request, October 12, 2026): Winbows'
// ipconfig, and ifconfig and ip on the Linux machines, each in its own system's format.
// Used by features/guest-engine.js (its PowerShell and Linux command tables).
//
// Everything is authored from the lab plan (data/commands.js VMS, doctrine section 3): the
// machine's own 198.51.100.0/24 address, router01 as gateway, DHCP and DNS (dc01 is static
// and answers its own DNS). Nothing is read from the visitor's real network. The subnet is
// written as a prefix length (/24) and the loopback adapter is left out, so every address
// shown stays inside RFC 5737 (scripts/check-security.mjs checks the source for that).
// Arguments are compared with fixed words; anything else gets the tool's own usage error
// and is never repeated. The only state is presentation: an ipconfig /release (until
// /renew) and a flushed DNS cache, kept on the guest for this session.
//
// Fun, and public-safe: every adapter's hardware address starts 02:57:41:46:46, which
// spells "WAFF" in hex (02 marks it locally administered, as a VM's is); the last byte is
// the machine's last address octet. And `ipconfig /breakfast` checks the waffle iron
// (eggs.txt lists it).

import { VMS } from '../data/commands.js';

const out = (text) => ({ kind: 'out', text });
const err = (text) => ({ kind: 'err', text });
const ROUTER = VMS.find((vm) => vm.id === 'router01');
const hex = (n) => n.toString(16).padStart(2, '0');
const lastOctet = (vm) => Number(vm.ip.split('.')[3]);
// The adapter's hardware address: "WAFF" in hex, then the last address octet.
export const macOf = (vm, sep = ':') => ['02', '57', '41', '46', '46', hex(lastOctet(vm))].join(sep);
const broadcastOf = (vm) => `${vm.ip.split('.').slice(0, 3).join('.')}.255`;
const subnetOf = (vm) => `${vm.ip.split('.').slice(0, 3).join('.')}.0/24`;
const isRouter = (vm) => vm.id === ROUTER.id;
// dc01 is the domain's DNS server and has a static address; everything else uses DHCP.
const isStatic = (vm) => vm.image === 'winserver' || isRouter(vm);

// ---------- Winbows: ipconfig ----------
// "   Host Name . . . . . . . . . . . . : WS01": the label, then dot leaders on the odd
// columns up to the colon, as ipconfig lines them up.
const row = (label, value) => {
  let lead = `   ${label}`;
  while (lead.length < 36) lead += lead.length % 2 ? '.' : ' ';
  return out(`${lead} : ${value}`.trimEnd());
};
const LEASE = Object.freeze({ obtained: 'Sunday, October 11, 2026 9:00:00 AM', expires: 'Monday, October 12, 2026 9:00:00 AM' });
const IPCONFIG_USAGE = Object.freeze([
  'USAGE:',
  '    ipconfig [/? | /all | /renew | /release | /flushdns | /displaydns]',
  ' ',
  'Options:',
  '    /?           Display this help message',
  '    /all         Display full configuration information.',
  '    /release     Release the IPv4 address for the specified adapter.',
  '    /renew       Renew the IPv4 address for the specified adapter.',
  '    /flushdns    Purges the DNS Resolver cache.',
  '    /displaydns  Display the contents of the DNS Resolver Cache.',
]);

function adapter(g, all) {
  const vm = g.vm;
  const released = g.adapter && g.adapter.released;
  const dns = vm.image === 'winserver' ? vm.ip : ROUTER.ip;
  const lines = [out(''), out('Ethernet adapter Ethernet0:'), out(''), row('Connection-specific DNS Suffix', released ? '' : vm.dnsSuffix)];
  if (all) {
    lines.push(
      row('Description', 'wafflesOS Virtual Ethernet Adapter'),
      row('Physical Address', macOf(vm, '-').toUpperCase()),
      row('DHCP Enabled', isStatic(vm) ? 'No' : 'Yes'),
      row('Autoconfiguration Enabled', 'Yes'),
    );
  }
  if (!released) {
    lines.push(row('IPv4 Address', `${vm.ip}${all ? '(Preferred)' : ''}`), row('Prefix Length', '24'));
    if (all && !isStatic(vm)) lines.push(row('Lease Obtained', LEASE.obtained), row('Lease Expires', LEASE.expires));
  }
  lines.push(row('Default Gateway', released ? '' : ROUTER.ip));
  if (all && !released) {
    if (!isStatic(vm)) lines.push(row('DHCP Server', ROUTER.ip));
    lines.push(row('DNS Servers', dns), row('NetBIOS over Tcpip', 'Enabled'));
  }
  lines.push(out(''));
  return lines;
}

function header(g) {
  const vm = g.vm;
  return [
    out(''),
    out('Winbows IP Configuration'),
    out(''),
    row('Host Name', vm.id.toUpperCase()),
    row('Primary Dns Suffix', vm.netbios ? vm.dnsSuffix : ''),
    row('Node Type', 'Hybrid'),
    row('IP Routing Enabled', 'No'),
    row('WINS Proxy Enabled', 'No'),
    row('DNS Suffix Search List', vm.dnsSuffix),
  ];
}

// The lab names this machine has looked up (authored: its gateway and the lab's web server).
function dnsCache(g) {
  if (g.adapter && g.adapter.flushed) return [out(''), out('Winbows IP Configuration'), out(''), err('Could not display the DNS Resolver Cache.')];
  const records = [ROUTER, VMS.find((vm) => vm.id === 'web01')].filter(Boolean);
  return [
    out(''), out('Winbows IP Configuration'), out(''),
    ...records.flatMap((vm) => [
      out(`    ${vm.host}`),
      out('    ----------------------------------------'),
      out(`    Record Name . . . . . : ${vm.host}`),
      out('    Record Type . . . . . : 1'),
      out(`    Time To Live  . . . . : ${3000 + lastOctet(vm)}`),
      out('    Data Length . . . . . : 4'),
      out('    Section . . . . . . . : Answer'),
      out(`    A (Host) Record . . . : ${vm.ip}`),
      out(''),
    ]),
  ];
}

export function ipconfig(g, args) {
  const flag = args.length === 1 ? args[0].toLowerCase() : args.length ? null : '';
  g.adapter = g.adapter || {};
  if (flag === '') return { lines: [out(''), out('Winbows IP Configuration'), ...adapter(g, false)], echo: 'ipconfig' };
  if (flag === '/all') return { lines: [...header(g), ...adapter(g, true)], echo: 'ipconfig /all' };
  if (flag === '/?' || flag === '-?') return { lines: IPCONFIG_USAGE.map(out), echo: 'ipconfig /?' };
  if (flag === '/flushdns') {
    g.adapter.flushed = true;
    return { lines: [out(''), out('Winbows IP Configuration'), out(''), out('Successfully flushed the DNS Resolver Cache.')], echo: 'ipconfig /flushdns' };
  }
  if (flag === '/displaydns') return { lines: dnsCache(g), echo: 'ipconfig /displaydns' };
  if (flag === '/release' || flag === '/renew') {
    if (isStatic(g.vm)) {
      return { lines: [out(''), out('Winbows IP Configuration'), out(''), err('The operation failed as no adapter is in the state permissible for'), err('this operation.')], echo: `ipconfig ${flag}`, failed: true };
    }
    g.adapter.released = flag === '/release';
    return { lines: [out(''), out('Winbows IP Configuration'), ...adapter(g, false)], echo: `ipconfig ${flag}` };
  }
  // Hidden: the waffle iron's own adapter (the BIOS's WAFFLE IRON MODE, ui/windows-ui.js).
  if (flag === '/breakfast') {
    return {
      lines: [
        out(''), out('Winbows IP Configuration'), out(''), out('Waffle Iron adapter WAFFLE0:'), out(''),
        row('Batter', 'Golden'),
        row('Syrup Voltage', '1.35 V (maple)'),
        row('Crispiness Multiplier', 'x11'),
        row('Pockets per Square', '16'),
        row('IPv4 Address', `${g.vm.ip} (still; waffles are not routable)`),
        out(''),
      ],
      echo: 'ipconfig /breakfast',
    };
  }
  return { lines: [err('Error: unrecognized or incomplete command line.'), out(''), ...IPCONFIG_USAGE.map(out)], echo: null, failed: true };
}

// ---------- Linux: ifconfig (net-tools, or BusyBox) and ip (iproute2) ----------
const ifaceOf = (g) => (g.image.shell === 'ash' ? 'br-lan' : 'eth0');
const busybox = (g) => g.image.shell === 'ash' || g.image.shell === 'login';
// Counters that look lived-in, fixed per machine.
const counters = (vm) => {
  const n = lastOctet(vm);
  const rx = 4000 + n * 37;
  const tx = 2000 + n * 19;
  return { rx, tx, rxBytes: rx * 812, txBytes: tx * 433 };
};
const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${(bytes / 1e3).toFixed(1)} KB`);

export function ifconfig(g, args) {
  const vm = g.vm;
  const iface = ifaceOf(g);
  // Ubuntu leaves net-tools out; ParrotOS and the BusyBox devices have it.
  const has = busybox(g) || (g.image.apt && g.image.apt.parrot) || (g.installed && g.installed['net-tools']);
  if (!has) return { lines: [err("Command 'ifconfig' not found, but can be installed with:"), err(' '), err('sudo apt install net-tools'), err(' ')], echo: 'ifconfig', failed: true };
  if (!(args.length === 0 || (args.length === 1 && (args[0] === '-a' || args[0] === iface)))) {
    if (args.length === 1 && !args[0].startsWith('-')) return { lines: [err(busybox(g) ? 'ifconfig: interface not found' : 'error fetching interface information: Device not found')], echo: null, failed: true };
    return { lines: [err('ifconfig: option not supported here; try ifconfig, ifconfig -a or ifconfig ' + iface)], echo: null, failed: true };
  }
  const c = counters(vm);
  const echo = args.length ? `ifconfig ${args[0]}` : 'ifconfig';
  if (busybox(g)) {
    return {
      lines: [
        out(`${iface.padEnd(10)}Link encap:Ethernet  HWaddr ${macOf(vm).toUpperCase()}`),
        out(`          inet addr:${vm.ip}  Bcast:${broadcastOf(vm)}  Prefix:/24`),
        out('          UP BROADCAST RUNNING MULTICAST  MTU:1500  Metric:1'),
        out(`          RX packets:${c.rx} errors:0 dropped:0 overruns:0 frame:0`),
        out(`          TX packets:${c.tx} errors:0 dropped:0 overruns:0 carrier:0`),
        out(`          RX bytes:${c.rxBytes} (${size(c.rxBytes)})  TX bytes:${c.txBytes} (${size(c.txBytes)})`),
        out(''),
      ],
      echo,
    };
  }
  return {
    lines: [
      out(`${iface}: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500`),
      out(`        inet ${vm.ip}  prefixlen 24  broadcast ${broadcastOf(vm)}`),
      out(`        ether ${macOf(vm)}  txqueuelen 1000  (Ethernet)`),
      out(`        RX packets ${c.rx}  bytes ${c.rxBytes} (${size(c.rxBytes)})`),
      out('        RX errors 0  dropped 0  overruns 0  frame 0'),
      out(`        TX packets ${c.tx}  bytes ${c.txBytes} (${size(c.txBytes)})`),
      out('        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0'),
      out(''),
    ],
    echo,
  };
}

const IP_USAGE = Object.freeze([
  'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }',
  'where  OBJECT := { address | link | route }',
  '       OPTIONS := { -br[ief] }',
]);
export function ipCommand(g, args) {
  const vm = g.vm;
  const iface = ifaceOf(g);
  const words = [...args];
  const brief = words[0] === '-br' || words[0] === '-brief';
  if (brief) words.shift();
  const [object = '', command = 'show', ...rest] = words;
  const pick = (names) => names.includes(object);
  if (rest.length || !['show', 'list', 'ls'].includes(command)) return { lines: IP_USAGE.map(err), echo: null, failed: true };
  const flags = '<BROADCAST,MULTICAST,UP,LOWER_UP>';
  if (pick(['a', 'addr', 'address'])) {
    const echo = `ip${brief ? ' -br' : ''} a`;
    if (brief) return { lines: [out(`${iface.padEnd(17)}UP             ${vm.ip}/24`)], echo };
    return {
      lines: [
        out(`2: ${iface}: ${flags} mtu 1500 qdisc fq_codel state UP group default qlen 1000`),
        out(`    link/ether ${macOf(vm)}`),
        out(`    inet ${vm.ip}/24 brd ${broadcastOf(vm)} scope global ${isStatic(vm) ? '' : 'dynamic '}${iface}`),
        out(`       valid_lft ${isStatic(vm) ? 'forever' : `${86000 + lastOctet(vm)}sec`} preferred_lft ${isStatic(vm) ? 'forever' : `${86000 + lastOctet(vm)}sec`}`),
      ],
      echo,
    };
  }
  if (pick(['l', 'link'])) {
    const echo = `ip${brief ? ' -br' : ''} link`;
    if (brief) return { lines: [out(`${iface.padEnd(17)}UP             ${macOf(vm)} ${flags}`)], echo };
    return { lines: [out(`2: ${iface}: ${flags} mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000`), out(`    link/ether ${macOf(vm)}`)], echo };
  }
  if (pick(['r', 'route'])) {
    const local = `${subnetOf(vm)} dev ${iface} proto kernel scope link src ${vm.ip}`;
    return {
      lines: isRouter(vm) ? [out(local)] : [out(`default via ${ROUTER.ip} dev ${iface} proto ${isStatic(vm) ? 'static' : 'dhcp'} src ${vm.ip} metric 100`), out(`${local} metric 100`)],
      echo: 'ip route',
    };
  }
  return { lines: IP_USAGE.map(err), echo: null, failed: true };
}
