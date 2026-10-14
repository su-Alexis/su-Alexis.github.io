// ipconfig, ifconfig and ip (features/netconfig.js; owner request, October 12, 2026), run
// through the real VM shells. Lab addresses only, fixed arguments, nothing typed repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');
const { macOf } = await import('../site/assets/js/features/netconfig.js');

function boot(id) {
  const guest = bootGuest(VMS.find((vm) => vm.id === id));
  guest.running = () => true;
  guest.scenario = () => [];
  return guest;
}
const texts = (result) => result.lines.map((line) => line.text).join('\n');
const ADDRESS = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;
// Every address shown is on the lab's 198.51.100.0/24.
const labOnly = (text) => [...text.matchAll(ADDRESS)].every((m) => m[0].startsWith('198.51.100.'));

test('ipconfig and ipconfig /all show the lab adapter as Winbows does', () => {
  const ws = boot('ws01');
  const short = runGuest(ws, 'ipconfig');
  assert.equal(short.echo, 'ipconfig');
  assert.match(texts(short), /IPv4 Address\. \. .*: 198\.51\.100\.20$/m);
  assert.match(texts(short), /Default Gateway .*: 198\.51\.100\.254$/m);
  const all = runGuest(ws, 'IPCONFIG /ALL');
  assert.equal(all.echo, 'ipconfig /all');
  assert.match(texts(all), /Host Name .*: WS01$/m);
  assert.match(texts(all), /Physical Address.*: 02-57-41-46-46-14$/m);
  assert.match(texts(all), /DHCP Server .*: 198\.51\.100\.254$/m);
  assert.ok(labOnly(texts(all)));
  // The domain controller is static and is its own DNS server.
  const dc = texts(runGuest(boot('dc01'), 'ipconfig /all'));
  assert.match(dc, /DHCP Enabled.*: No$/m);
  assert.match(dc, /DNS Servers .*: 198\.51\.100\.40$/m);
  assert.match(dc, /corp\.example/);
});

test('ipconfig /release, /renew, /flushdns and /displaydns keep their state for the session', () => {
  const ws = boot('ws01');
  assert.match(texts(runGuest(ws, 'ipconfig /displaydns')), /web01\.lab\.example/);
  assert.match(texts(runGuest(ws, 'ipconfig /flushdns')), /Successfully flushed the DNS Resolver Cache\./);
  assert.match(texts(runGuest(ws, 'ipconfig /displaydns')), /Could not display the DNS Resolver Cache\./);
  assert.doesNotMatch(texts(runGuest(ws, 'ipconfig /release')), /IPv4 Address/);
  assert.doesNotMatch(texts(runGuest(ws, 'ipconfig')), /IPv4 Address/);
  assert.match(texts(runGuest(ws, 'ipconfig /renew')), /198\.51\.100\.20/);
  // A static server refuses, as Winbows does.
  assert.equal(runGuest(boot('dc01'), 'ipconfig /release').failed, true);
  // The hidden waffle iron, and unknown switches never repeated.
  assert.match(texts(runGuest(ws, 'ipconfig /breakfast')), /Syrup Voltage/);
  const odd = runGuest(ws, 'ipconfig /hunter2');
  assert.equal(odd.failed, true);
  assert.equal(odd.echo, null);
  assert.ok(!texts(odd).includes('hunter2'));
});

test('ifconfig: ParrotOS and the BusyBox router have it; Ubuntu installs net-tools first', () => {
  const parrot = texts(runGuest(boot('parrot01'), 'ifconfig'));
  assert.match(parrot, /^eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>/m);
  assert.match(parrot, /inet 198\.51\.100\.10 /);
  assert.match(parrot, new RegExp(`ether ${macOf(VMS.find((vm) => vm.id === 'parrot01'))}`));
  assert.match(texts(runGuest(boot('router01'), 'ifconfig')), /^br-lan\s+Link encap:Ethernet {2}HWaddr 02:57:41:46:46:FE/m);
  const blue = boot('ubuntu-blue');
  const missing = runGuest(blue, 'ifconfig');
  assert.equal(missing.failed, true);
  assert.match(texts(missing), /sudo apt install net-tools/);
  runGuest(blue, 'sudo apt install -y net-tools');
  assert.match(texts(runGuest(blue, 'ifconfig')), /inet 198\.51\.100\.30 /);
  assert.equal(runGuest(blue, 'ifconfig wlan9').failed, true);
  assert.ok(!texts(runGuest(blue, 'ifconfig wlan9')).includes('wlan9'));
});

test('ip a, ip -br a, ip link and ip route', () => {
  const red = boot('ubuntu-red');
  const addr = runGuest(red, 'ip addr show');
  assert.equal(addr.echo, 'ip a');
  assert.match(texts(addr), /inet 198\.51\.100\.31\/24 brd 198\.51\.100\.255 scope global dynamic eth0/);
  assert.match(texts(runGuest(red, 'ip -br a')), /^eth0\s+UP\s+198\.51\.100\.31\/24$/);
  assert.match(texts(runGuest(red, 'ip link')), /link\/ether 02:57:41:46:46:1f/);
  const route = texts(runGuest(red, 'ip r'));
  assert.match(route, /^default via 198\.51\.100\.254 dev eth0 proto dhcp/m);
  assert.match(route, /^198\.51\.100\.0\/24 dev eth0 proto kernel scope link src 198\.51\.100\.31/m);
  // The router is the gateway: no default route of its own on the lab side.
  assert.doesNotMatch(texts(runGuest(boot('router01'), 'ip route')), /default/);
  assert.equal(runGuest(red, 'ip neigh').failed, true);
  for (const id of ['ubuntu-red', 'parrot01', 'web01', 'router01']) assert.ok(labOnly(texts(runGuest(boot(id), 'ip a'))), id);
});
