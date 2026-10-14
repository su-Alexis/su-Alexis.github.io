// Image profile: Winbows Server 2022 (simulated), the lab's domain controller. Used by
// features/guest-engine.js for every VM built from it (data/commands.js VMS: dc01), and by
// ui/guest-desktop.js for its desktop (Ctrl+Alt+Delete, sign-in, Server Manager). The
// lines below are the PowerShell banner. Authored and fictional: the domain is
// corp.example (doctrine section 3). {user}, {host}, {id} and {ip} are filled in per VM.

export const WINSERVER = Object.freeze({
  id: 'winserver',
  shell: 'powershell',
  boot: Object.freeze([
    { text: 'Winbows PowerShell (simulated)' },
    { text: 'Copyright (C) wafflesOS lab. All rights reserved.', tone: 'dim' },
    { text: ' ' },
    { text: 'Install the latest PowerShell for new features and improvements!', tone: 'dim' },
  ]),
  // Server Manager's dashboard (ui/guest-desktop.js): it opens on sign-in, as on a real
  // server. Text only.
  serverManager: Object.freeze({
    steps: Object.freeze(['Configure this local server', 'Add roles and features', 'Add other servers to manage', 'Create a server group']),
    tiles: Object.freeze(['AD DS', 'DNS', 'File and Storage Services', 'Local Server', 'All Servers']),
    rows: Object.freeze(['Manageability', 'Events', 'Services', 'Performance', 'BPA results']),
  }),
  // The versions sfc and DISM report (features/guest-engine.js): Server 2022.
  servicing: Object.freeze({ dism: '10.0.20348.1', image: '10.0.20348.2700' }),
  // How it shuts down (ui/guest-desktop.js, shutdownScreen): owner request, October 10, 2026.
  shutdown: Object.freeze({ style: 'winbows' }),
  dirs: Object.freeze([
    'Users', 'Users/{user}', 'Users/{user}/Desktop', 'Users/{user}/Documents',
    'Users/{user}/Downloads', 'Users/{user}/Music', 'Users/{user}/Pictures', 'Users/{user}/Videos',
    'Winbows', 'Winbows/NTDS', 'Winbows/SYSVOL', 'Winbows/SYSVOL/domain',
  ]),
  files: Object.freeze({
    'Users/{user}/Documents/dc-notes.txt': 'domain controller notes ({id})\n- domain: corp.example (CORP)\n- roles: AD DS, DNS, File and Storage Services\n- address: {ip}\n- the domain missions add users and policy later',
    'Winbows/SYSVOL/domain/README.txt': 'SYSVOL for corp.example (simulated). Group Policy arrives with the domain missions.',
  }),
});
