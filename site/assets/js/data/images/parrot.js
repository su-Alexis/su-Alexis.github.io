// Image profile: ParrotOS (simulated), the lab's attack machine. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: parrot01).
// Its desktop (GRUB, splash, greeter, MATE-style panels) is drawn by ui/guest-desktop.js.
// Authored and fictional; the tools it will offer arrive with the lab network segment and
// only ever answer from the lab map. {user}, {host}, {id} and {ip} are filled in per VM.

export const PARROT = Object.freeze({
  id: 'parrot',
  shell: 'bash',
  // apt (features/guest-engine.js) and parrot-upgrade: the lab mirror and what an upgrade
  // brings. Fictional versions; the mirror is a lab.example host (doctrine section 3).
  apt: Object.freeze({
    sources: Object.freeze(['https://mirror.lab.example/parrot parrot', 'https://mirror.lab.example/parrot parrot-security', 'https://mirror.lab.example/parrot parrot-backports']),
    arch: 'amd64',
    parrot: true,
    triggers: Object.freeze(['man-db (2.11.2-2)', 'desktop-file-utils (0.26-1)', 'mailcap (3.70+nmu1)']),
    upgrades: Object.freeze([
      Object.freeze({ name: 'parrot-core', from: '7.4.0', to: '7.4.1', kb: 58 }),
      Object.freeze({ name: 'firecat-esr', from: '128.3.0esr-1', to: '128.3.1esr-1', kb: 71210 }),
      Object.freeze({ name: 'openssl', from: '3.0.14-1~deb12u2', to: '3.0.15-1~deb12u1', kb: 1428 }),
      Object.freeze({ name: 'libssl3', from: '3.0.14-1~deb12u2', to: '3.0.15-1~deb12u1', kb: 2022 }),
      Object.freeze({ name: 'tzdata', from: '2024a-0+deb12u1', to: '2024b-0+deb12u1', kb: 257 }),
    ]),
  }),
  boot: Object.freeze([
    { text: 'ParrotOS 7.4 (simulated) {id} tty1', tone: 'dim' },
    { text: '[  OK  ] Started NetworkManager.service', tone: 'dim' },
    { text: '[  OK  ] Reached target graphical.target', tone: 'dim' },
    { text: '{id} login: {user} (automatic login)' },
    { text: "[{user}@{id}]-[~]  type 'help' for the commands this machine knows." },
  ]),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'log', lines: Object.freeze([
    "[  OK  ] Stopped target Graphical Interface.",
    "         Stopping LightDM Display Manager...",
    "[  OK  ] Stopped LightDM Display Manager.",
    "[  OK  ] Stopped NetworkManager.service - Network Manager.",
    "[  OK  ] Stopped target Network.",
    "[  OK  ] Stopped systemd-journald.service - Journal Service.",
    "[  OK  ] Unmounted /home.",
    "[  OK  ] Reached target System Shutdown.",
    "[  OK  ] Reached target Late Shutdown Services.",
    "[  412.338120] reboot: Power down",
  ]) }),
  // The home folder as ParrotOS creates it (the XDG folders Caja shows; owner screenshot,
  // October 11, 2026), plus the lab's notes.
  dirs: Object.freeze(['etc', 'home', 'home/{user}', ...['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos', 'notes'].map((name) => `home/{user}/${name}`), 'tmp']),
  files: Object.freeze({
    'etc/hostname': '{host}',
    'etc/os-release': 'PRETTY_NAME="ParrotOS 7.4 (simulated)"\nNAME="ParrotOS"\nVERSION_ID="7.4"\nID_LIKE=debian\nHOME_URL="https://lab.example/"',
    'home/{user}/Desktop/README.license': 'README.license\n\nParrotOS 7.4 (simulated) for the wafflesOS lab.\nThis machine is a teaching simulation: every tool answers from the lab map,\nand nothing here reaches a real network.\nSee ~/notes/rules.txt for the lab rules.',
    'home/{user}/notes/rules.txt': 'lab rules\n1. stay inside lab.example and 198.51.100.0/24\n2. nothing here touches the real internet\n3. take notes; the blue team reads the logs',
    'home/{user}/notes/targets.txt': 'targets\n(empty for now: missions add them)',
  }),
});
