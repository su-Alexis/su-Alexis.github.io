// Image profile: Ubuntu Server 24.04 LTS (simulated), a server with no desktop. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: web01). Its
// power-on (GRUB, the systemd boot log, the tty1 login) is drawn by ui/guest-desktop.js;
// the lines below are what the console shows once the user has logged in: the 24.04 LTS
// message of the day. Authored and fictional: hosts and addresses come from the lab plan
// (doctrine section 3), and the help links point at lab.example, since the site may only
// name reserved hosts. {user}, {host}, {id}, {ip} and {date} are filled in per VM.

export const UBUNTU_SERVER = Object.freeze({
  id: 'ubuntuserver',
  shell: 'bash',
  // apt (features/guest-engine.js): the lab mirror and what an upgrade brings. Fictional
  // versions in Ubuntu's style; the mirror is a lab.example host (doctrine section 3).
  apt: Object.freeze({
    sources: Object.freeze(['https://mirror.lab.example/ubuntu noble', 'https://mirror.lab.example/ubuntu noble-updates', 'https://mirror.lab.example/ubuntu noble-security']),
    arch: 'amd64',
    triggers: Object.freeze(['man-db (2.12.0-4build2)', 'libc-bin (2.39-0ubuntu8.3)']),
    upgrades: Object.freeze([
      Object.freeze({ name: 'libssl3t64', from: '3.0.13-0ubuntu3.4', to: '3.0.13-0ubuntu3.5', kb: 1940 }),
      Object.freeze({ name: 'openssl', from: '3.0.13-0ubuntu3.4', to: '3.0.13-0ubuntu3.5', kb: 1003 }),
      Object.freeze({ name: 'curl', from: '8.5.0-2ubuntu10.4', to: '8.5.0-2ubuntu10.5', kb: 227 }),
      Object.freeze({ name: 'libcurl4t64', from: '8.5.0-2ubuntu10.4', to: '8.5.0-2ubuntu10.5', kb: 341 }),
      Object.freeze({ name: 'tzdata', from: '2024a-3ubuntu1.1', to: '2024b-0ubuntu0.24.04', kb: 273 }),
    ]),
  }),
  boot: Object.freeze([
    { text: 'Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64) (simulated)' },
    { text: ' ' },
    { text: ' * Documentation:  https://help.lab.example/ubuntu', tone: 'dim' },
    { text: ' * Management:     https://landscape.lab.example', tone: 'dim' },
    { text: ' * Support:        https://support.lab.example', tone: 'dim' },
    { text: ' ' },
    { text: ' System information as of {date}' },
    { text: ' ' },
    { text: '  System load:  0.08               Processes:             112' },
    { text: '  Usage of /:   23.4% of 24.44GB   Users logged in:       0' },
    { text: '  Memory usage: 11%                IPv4 address for eth0: {ip}' },
    { text: '  Swap usage:   0%' },
    { text: ' ' },
    { text: 'Expanded Security Maintenance for Applications is not enabled.', tone: 'dim' },
    { text: ' ' },
    { text: '0 updates can be applied immediately.' },
    { text: ' ' },
    { text: 'Last login: Wed Oct  8 21:14:07 2026 from 198.51.100.20', tone: 'dim' },
  ]),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'log', lines: Object.freeze([
    "[  OK  ] Removed slice system-modprobe.slice - Slice /system/modprobe.",
    "[  OK  ] Stopped target multi-user.target - Multi-User System.",
    "         Stopping ssh.service - OpenBSD Secure Shell server...",
    "         Stopping cron.service - Regular background program processing daemon...",
    "[  OK  ] Stopped ssh.service - OpenBSD Secure Shell server.",
    "[  OK  ] Stopped cron.service - Regular background program processing daemon.",
    "[  OK  ] Stopped rsyslog.service - System Logging Service.",
    "[  OK  ] Stopped systemd-networkd.service - Network Configuration.",
    "[  OK  ] Reached target shutdown.target - System Shutdown.",
    "[  OK  ] Reached target final.target - Late Shutdown Services.",
    "[  918.402117] reboot: Power down",
  ]) }),
  dirs: Object.freeze(['etc', 'home', 'home/{user}', 'tmp', 'var', 'var/backups', 'var/log', 'var/log/apache2', 'var/www', 'var/www/html']),
  files: Object.freeze({
    'etc/hostname': '{host}',
    'etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS (simulated)"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://lab.example/"',
    'etc/motd': 'This machine is part of the wafflesOS lab. Everything on it is simulated.',
    'home/{user}/notes.txt': 'notes for {id} ({ip})\n- web server for the lab: Apache serves the lab app on ports 80 and 443\n- the other VMs share lab.example, 198.51.100.0/24\n- missions arrive in a later update',
    'var/www/html/index.html': '<!doctype html>\n<title>lab app</title>\n<h1>lab app (simulated)</h1>',
    // The lab's own earlier traffic (ws01 checks the site, then logs in, as the message
    // of the day's "Last login" says). On web01, features/scenario.js adds what other
    // machines did after these lines when the file is read (data/scenarios/web01.js).
    'var/log/apache2/access.log': '198.51.100.20 - - [08/Oct/2026:21:12:44 +0000] "GET / HTTP/1.1" 200 10671 "-" "Mozzarella/5.0 (Winbows NT 10.0; Win64; x64; rv:131.0) Gekko/20100101 Firecat/131.0"\n198.51.100.20 - - [08/Oct/2026:21:12:44 +0000] "GET /icons/ubuntu-logo.png HTTP/1.1" 200 3607 "-" "Mozzarella/5.0 (Winbows NT 10.0; Win64; x64; rv:131.0) Gekko/20100101 Firecat/131.0"',
    'var/log/auth.log': 'Oct  8 21:14:07 {id} sshd[1184]: Accepted publickey for {user} from 198.51.100.20 port 50212 ssh2: ED25519 (simulated lab key)\nOct  8 21:14:07 {id} sshd[1184]: pam_unix(sshd:session): session opened for user {user}(uid=1000) by {user}(uid=0)\nOct  8 21:31:52 {id} sshd[1184]: pam_unix(sshd:session): session closed for user {user}',
    'var/log/syslog': 'Oct  8 09:00:01 {id} systemd[1]: Started Daily apt download activities.\nOct  8 09:00:02 {id} systemd[1]: Reached target timers.target.',
  }),
});
