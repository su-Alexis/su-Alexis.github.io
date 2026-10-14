// Image profile: Winbows (simulated), the starting workstation. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: ws01), and
// by ui/guest-desktop.js for its desktop. Authored and fictional. {user}, {host}, {id}
// and {ip} are filled in per VM.

export const WINBOWS = Object.freeze({
  id: 'winbows',
  shell: 'powershell',
  // The PowerShell banner. The boot screen, sign-in and desktop are drawn by
  // ui/guest-desktop.js; this text opens the PowerShell app inside it.
  boot: Object.freeze([
    { text: 'Winbows PowerShell (simulated)' },
    { text: 'Copyright (C) wafflesOS lab. All rights reserved.', tone: 'dim' },
    { text: "Type 'help' for the commands this machine knows.", tone: 'dim' },
  ]),
  // The versions sfc and DISM report (features/guest-engine.js): Winbows 11 23H2.
  servicing: Object.freeze({ dism: '10.0.22621.2792', image: '10.0.22631.4317' }),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'winbows' }),
  dirs: Object.freeze(['Users', 'Users/{user}', 'Users/{user}/Desktop', 'Users/{user}/Documents', 'Users/{user}/Downloads', 'Users/{user}/Music', 'Users/{user}/Pictures', 'Users/{user}/Videos', 'Winbows']),
  files: Object.freeze({
    'Users/{user}/Desktop/readme.txt': 'Welcome to {id}, your lab workstation.\nThe other VMs live on lab.example (198.51.100.0/24).\nPowerShell basics: dir, cd, type, whoami, ipconfig.',
    'Users/{user}/Documents/baseline.txt': 'hardening baseline (draft)\n- updates on\n- firewall on\n- the starter mission fills in the rest',
  }),
});
