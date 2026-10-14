// Image profile: OpenWrt 23.05 (simulated), the lab's router. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: router01). Its
// power-on (GRUB, the kernel log, "Please press Enter to activate this console.") is drawn
// by ui/guest-desktop.js; the lines below are the banner its console shows before the
// shell. Its web interface is reached from the other VMs with the lab network segment.
// Authored and fictional: the address comes from the lab plan (doctrine section 3); the
// config uses CIDR so no address outside the reserved ranges appears.
// {user}, {host}, {id} and {ip} are filled in per VM.

export const OPENWRT = Object.freeze({
  id: 'openwrt',
  shell: 'ash',
  homeDir: 'root',
  // The serial console's boot (ui/guest-desktop.js, mountSerialConsole): GRUB, then the
  // kernel and procd, then the console waits for Enter, which the hypervisor sends.
  serial: Object.freeze({
    grub: Object.freeze(['OpenWrt', 'OpenWrt (failsafe)']),
    lines: Object.freeze([
      { text: '[    0.000000] Linux version 5.15.167 (builder@lab.example) (simulated) #0 SMP', tone: 'dim' },
      { text: '[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz root=/dev/sda2 rootwait console=ttyS0', tone: 'dim' },
      { text: '[    0.512000] e1000 0000:00:03.0 eth0: Intel PRO/1000 network connection (simulated)', tone: 'dim' },
      { text: '[    1.104000] init: Console is alive', tone: 'dim' },
      { text: '[    1.398000] kmodloader: loading kernel modules from /etc/modules-boot.d/*', tone: 'dim' },
      { text: '[    1.986000] init: - preinit -', tone: 'dim' },
      { text: '[    2.540000] mount_root: mounting /dev/root', tone: 'dim' },
      { text: '[    2.812000] procd: - early -', tone: 'dim' },
      { text: '[    3.118000] procd: - ubus -', tone: 'dim' },
      { text: '[    3.402000] procd: - init -', tone: 'dim' },
      { text: 'Please press Enter to activate this console.', pause: 500 },
      { text: '[    5.310000] br-lan: port 1(eth0) entered forwarding state', tone: 'dim', pause: 400 },
    ]),
  }),
  uname:'Linux {id} 5.15.167 #0 SMP Thu Sep 12 08:12:44 2026 x86_64 GNU/Linux (simulated)',
  boot: Object.freeze([
    { text: ' ' },
    { text: 'BusyBox v1.36.1 (2026-09-12 08:12:44 UTC) built-in shell (ash)' },
    { text: ' ' },
    { text: ' OpenWrt 23.05.5 (simulated), r24106-10cc5fcd00' },
    { text: ' -----------------------------------------------------' },
    { text: ' ' },
  ]),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'log', lines: Object.freeze([
    "[  611.203114] procd: - shutdown -",
    "[  611.481302] br-lan: port 1(eth0) entered disabled state",
    "[  611.512870] device eth0 left promiscuous mode",
    "[  612.004417] sd 0:0:0:0: [sda] Synchronizing SCSI cache",
    "[  612.118003] reboot: Power down",
  ]) }),
  dirs: Object.freeze(['etc', 'etc/config', 'root', 'tmp', 'www']),
  files: Object.freeze({
    'etc/openwrt_release': "DISTRIB_ID='OpenWrt'\nDISTRIB_RELEASE='23.05.5'\nDISTRIB_REVISION='r24106-10cc5fcd00'\nDISTRIB_TARGET='x86/64'\nDISTRIB_DESCRIPTION='OpenWrt 23.05.5 (simulated)'",
    'etc/config/network': "config interface 'lan'\n    option device 'br-lan'\n    option proto 'static'\n    option ipaddr '{ip}/24'\n\nconfig device\n    option name 'br-lan'\n    option type 'bridge'\n    list ports 'eth0'",
    'etc/config/system': "config system\n    option hostname '{id}'\n    option timezone 'UTC'\n    option log_size '64'",
    'etc/config/firewall': "config defaults\n    option input 'REJECT'\n    option output 'ACCEPT'\n    option forward 'REJECT'\n\nconfig zone\n    option name 'lan'\n    list network 'lan'\n    option input 'ACCEPT'",
    'etc/hostname': '{id}',
    'www/index.html': '<!doctype html>\n<title>{id} - LuCI</title>\n<!-- the web interface arrives with the lab network -->',
  }),
});
