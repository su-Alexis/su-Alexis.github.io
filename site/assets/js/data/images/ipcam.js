// Image profile: an IP camera's firmware (simulated), a lab target. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: cam01). Its
// power-on (U-Boot, the kernel log, its services starting) is drawn by ui/guest-desktop.js.
// Its serial console ends at a login prompt. root's password is checked as a digest
// (data/puzzles.js deviceLogins); for testing the console signs root in by itself
// (autoLogin, owner request October 10, 2026). Its web login page
// is reached from the other VMs with the lab network segment.
// Authored and fictional: no real vendor, model or firmware; the address comes from the
// lab plan (doctrine section 3). {user}, {host}, {id} and {ip} are filled in per VM.

export const IPCAM = Object.freeze({
  id: 'ipcam',
  shell: 'login',
  homeDir: 'root',
  autoLogin: true,
  // Shown once root is signed in.
  loginBanner: Object.freeze([
    { text: ' ' },
    { text: 'BusyBox v1.31.1 (2025-03-14 10:22:31 CST) built-in shell (ash)' },
    { text: ' ' },
  ]),
  // The serial console's boot (ui/guest-desktop.js, mountSerialConsole): the bootloader
  // counts down, loads the kernel, and the firmware starts its services.
  serial: Object.freeze({
    lines: Object.freeze([
      { text: 'U-Boot 2019.07 (simulated) (Mar 14 2025 - 10:22:31 +0800)' },
      { text: ' ' },
      { text: 'CPU:   ARMv7 Processor (simulated)', tone: 'dim' },
      { text: 'DRAM:  128 MiB', tone: 'dim' },
      { text: 'SF: Detected flash with page size 256 Bytes, total 16 MiB', tone: 'dim' },
      { text: 'Net:   eth0', tone: 'dim' },
      { text: 'Hit any key to stop autoboot:  ', countdown: 2 },
      { text: '## Booting kernel from Legacy Image at 80800000 ...', pause: 300 },
      { text: '   Image Name:   Linux-4.9.84', tone: 'dim' },
      { text: '   Verifying Checksum ... OK', tone: 'dim' },
      { text: 'Starting kernel ...', pause: 300 },
      { text: ' ' },
      { text: '[    0.000000] Booting Linux on physical CPU 0x0', tone: 'dim', pause: 400 },
      { text: '[    0.000000] Linux version 4.9.84 (builder@lab.example) (simulated)', tone: 'dim' },
      { text: '[    1.214000] eth0: link up (100Mbps/Full duplex)', tone: 'dim' },
      { text: '[    2.006000] sensor: image sensor ready', tone: 'dim' },
      { text: 'Starting syslogd: OK' },
      { text: 'Starting network: OK ({ip})' },
      { text: 'Starting httpd: OK' },
      { text: 'Starting video service: OK' },
    ]),
  }),
  boot: Object.freeze([
    { text: ' ' },
    { text: 'IPCam firmware 5.2.1 (simulated)  [{id} / {ip}]' },
    { text: ' ' },
  ]),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'log', lines: Object.freeze([
    "Stopping video service: OK",
    "Stopping httpd: OK",
    "Stopping network: OK",
    "Stopping syslogd: OK",
    " ",
    "The system is going down NOW!",
    "Sent SIGTERM to all processes",
    "Sent SIGKILL to all processes",
    "Requesting system poweroff",
    "[  733.410000] reboot: Power down",
  ]) }),
  dirs: Object.freeze(['etc', 'mnt', 'mnt/mtd', 'root', 'var', 'www']),
  files: Object.freeze({
    'etc/hostname': '{id}',
    'etc/version': 'IPCam firmware 5.2.1 (simulated)',
  }),
});
