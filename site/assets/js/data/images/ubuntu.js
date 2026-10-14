// Image profile: Ubuntu 24.04 LTS (simulated). Used by features/guest-engine.js for every VM
// built from this image (data/commands.js VMS: ubuntu-blue, ubuntu-red). Its power-on (the
// splash and the GDM login) and its GNOME desktop are drawn by ui/guest-desktop.js. The
// Terminal opens straight to a prompt, as GNOME Terminal does, so there is no boot text.
// Authored and fictional: hosts and addresses come from the lab plan (doctrine section 3).
// {user}, {host}, {id} and {ip} are filled in per VM.

export const UBUNTU = Object.freeze({
  id: 'ubuntu',
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
  boot: Object.freeze([]),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'splash' }),
  dirs: Object.freeze([
    // The home folder as Ubuntu creates it (the XDG folders Thunar shows; owner
    // screenshot, October 12, 2026).
    'etc', 'home', 'home/{user}',
    ...['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Public', 'Templates', 'Videos'].map((name) => `home/{user}/${name}`),
    'tmp', 'var', 'var/log',
  ]),
  files: Object.freeze({
    'etc/hostname': '{host}',
    'etc/os-release': 'PRETTY_NAME="Ubuntu 24.04.1 LTS (simulated)"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble Numbat)"\nID=ubuntu\nID_LIKE=debian\nHOME_URL="https://lab.example/"',
    'etc/motd': 'This machine is part of the wafflesOS lab. Everything on it is simulated.',
    'home/{user}/notes.txt': 'notes for {id} ({ip})\n- this box sits on lab.example, 198.51.100.0/24\n- the other VMs share the same network\n- missions arrive in a later update',
    'home/{user}/Documents/runbook.txt': 'runbook ({id})\n- check the logs in /var/log\n- keep the lab network to 198.51.100.0/24\n- missions fill in the rest',
    'var/log/syslog': 'Oct  8 09:00:01 {id} systemd[1]: Started Daily apt download activities.\nOct  8 09:00:02 {id} systemd[1]: Reached target timers.target.',
  }),
});
