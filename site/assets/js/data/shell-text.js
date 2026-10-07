// Authored text for the console's read-only commands: "cat" files, "man" pages
// and "git log". Plain text only; the console renders it with
// textContent. Used by features/command-engine.js. (neofetch shows the logo image instead
// of ASCII art: ui/terminal-ui.js, the "logo" line kind.)
//
// The files restate what the pages already say, nothing more (owner rule: never invent
// qualifications). tests/shell-text.test.mjs checks the certifications and project
// summaries against the published HTML so the two cannot drift apart.

// ---------- cat: files per page ----------

const CERTS = Object.freeze([
  Object.freeze({ status: 'CERTIFIED', name: 'CompTIA Security+', when: '' }),
  Object.freeze({ status: 'EXAM', name: 'CompTIA SecurityX (formerly CASP+)', when: 'Oct 21, 2026' }),
  Object.freeze({ status: 'IN PROGRESS', name: 'EC-Council CEH v13 AI', when: 'Dec 2026' }),
  Object.freeze({ status: 'IN PROGRESS', name: 'CompTIA Network+', when: 'Jan 31, 2027' }),
  Object.freeze({ status: 'TARGET', name: 'EC-Council CEH v13 AI Practical', when: 'Feb 2027' }),
]);
export const CERT_ROWS = CERTS;

// Project READMEs: summary is the first paragraph of each project page, word for word.
export const PROJECT_READMES = Object.freeze({
  wingg: Object.freeze({
    file: 'winGG10&11.ps1',
    stack: 'PowerShell · Windows Internals · Registry · Security Hardening · Gaming Performance',
    status: 'ACTIVE',
    summary: 'WindowsGG is a one-shot baselining script for a freshly installed Windows 10 or 11 gaming PC. It debloats, applies a set of performance, privacy and security-hardening changes, and writes the three Utility Tools and a God Mode folder to the Desktop on its way out.',
    repo: 'su-Alexis/winGG10-11',
  }),
  debloat: Object.freeze({
    file: '',
    stack: 'PowerShell · Windows Internals · Registry Tuning · System Optimization · Virtualization Testing',
    status: 'ARCHIVED',
    summary: 'Windows 10/11 Debloat & Optimize is an all-in-one PowerShell project built to automate post-install and post-update Windows cleanup, debloating, tuning, and quality-of-life configuration.',
    repo: 'su-Alexis/w10n11debloat-optimize',
  }),
  'fridge-friends': Object.freeze({
    file: '',
    stack: 'TypeScript · React · Vite · Tailwind CSS · Zod · Service Workers',
    status: 'ACTIVE',
    summary: 'Fridge Friends is a static React and TypeScript app for planning meals around what is already in the fridge. Pick your ingredients and it ranks recipes by shared ingredients, then scales batches, converts units and combines everything into a single grocery list.',
    repo: 'su-Alexis/Fridge-Friends',
  }),
  cleanup: Object.freeze({
    file: 'cleanup_main.bat',
    stack: 'Batch · PowerShell · Disk Cleanup · Registry · Windows Internals',
    status: 'ACTIVE',
    summary: 'Windows Cleanup is a batch script that treats cleanup as a two-step job: look first, then act. It measures every cache it can clear and lists applications that have stopped responding, then offers a six-option menu. Nothing is deleted until you pick.',
    repo: 'su-Alexis/Windows-Cleanup',
  }),
  'net-reset': Object.freeze({
    file: 'net-reset-reboot.bat',
    stack: 'Batch · PowerShell · netsh · Windows Networking',
    status: 'ACTIVE',
    summary: 'Network Stack Reset is the heavy option for when Windows networking is truly broken. It resets TCP/IP, IPv6, Winsock and proxy settings, then reboots.',
    repo: 'su-Alexis/Network-Stack-Reset',
  }),
  'net-refresh': Object.freeze({
    file: 'net-reset-lite.bat',
    stack: 'Batch · PowerShell · netsh · Windows Networking',
    status: 'ACTIVE',
    summary: 'Network Refresh is the first thing to try when a connection misbehaves. It clears the DNS, NetBIOS, ARP and route caches and renews DHCP leases without a reboot, then proves whether it worked. If the network is still down, it points to Network Stack Reset.',
    repo: 'su-Alexis/Network-Refresh',
  }),
});

const freeze = (lines) => Object.freeze(lines.map((line) => Object.freeze(line)));
const o = (text) => ['out', text];
const h = (text) => ['ok', text];

function readme(title, project) {
  return freeze([
    h(`# ${title}`),
    o(''),
    ...(project.file ? [o(`file:   ${project.file}`)] : []),
    o(`status: [ ${project.status} ]`),
    o(`stack:  ${project.stack}`),
    o(''),
    o(project.summary),
    o(''),
    o(`source: on GitHub, ${project.repo}`),
    o('scroll the page for the full write-up and screenshots.'),
  ]);
}

// Files by page id. Each value is a list of [kind, text] lines.
export const FILES = Object.freeze({
  home: Object.freeze({
    'about.txt': freeze([
      h('# Alexis Pontious'),
      o('Ethical Hacker | Cybersecurity-Focused IT Specialist'),
      o(''),
      o('I focus on practical cybersecurity, systems, and technical problem-solving across Windows, Linux, and macOS. My work includes system hardening, malware remediation, endpoint and network troubleshooting, virtualization, scripting, and hands-on lab practice.'),
      o(''),
      o("I use PowerShell, Python, and AI-assisted tools to speed up research, analysis, troubleshooting, and remediation. I'm currently completing a C, C++, and C# bootcamp to strengthen my malware analysis and vulnerability research, and to build my own tooling for authorized security testing."),
    ]),
    'certs.txt': freeze([
      h('# certifications and ongoing training'),
      o(''),
      ...CERTS.map((cert) => [cert.status === 'CERTIFIED' ? 'ok' : 'out', `[ ${cert.status.padEnd(11)} ] ${cert.name}${cert.when ? `  · ${cert.when}` : ''}`]),
      o(''),
      o('plus digital badge-backed coursework and platform training.'),
      o("verify them: type 'open links' for Credly and Skillsoft."),
    ]),
    'skills.txt': freeze([
      h('# languages and tools'),
      o('proficient:   HTML, CSS, JavaScript, Python, PowerShell, Bash'),
      o('web app:      TypeScript, React, Node.js / npm, Vite, Tailwind CSS, Zod, ESLint, Service Workers'),
      o('windows:      Batch, netsh, Registry, DISM / SFC, Disk Cleanup'),
      o('learning:     C, C++, C#'),
      o(''),
      h('# core areas'),
      o('cybersecurity:   defensive fundamentals, ethical hacking labs, Windows and Linux hardening, threat analysis'),
      o('it / systems:    endpoint support, DNS/DHCP/VPN diagnosis, virtualization, OS deployment and repair'),
      o('automation:      PowerShell, Python and Bash tooling for repeatable system tasks'),
      o('ai:              AI-assisted workflows, AI attack and defense, LLM threats like prompt injection'),
    ]),
    'links.txt': freeze([
      h('# verification and links'),
      o('Credly profile         verified certification badges'),
      o('Skillsoft badges       digital badge wallet for coursework'),
      o('GitHub                 su-Alexis: the code behind the projects'),
      o('LinkedIn               the professional profile'),
      o('Humble Beginnings      the original portfolio site'),
      o(''),
      o("type 'open links' to jump to them."),
    ]),
  }),
  projects: Object.freeze({
    'README.md': freeze([
      h('# projects'),
      o('security tooling, Windows automation and a web app. each has its own page.'),
      o(''),
      o('  wingg            WindowsGG, the newest Windows baselining script'),
      o('  debloat          Windows 10/11 Debloat & Optimize (archived)'),
      o('  fridge-friends   a meal planning web app'),
      o('  cleanup          Windows Cleanup'),
      o('  net-reset        Network Stack Reset'),
      o('  net-refresh      Network Refresh'),
      o(''),
      o("type 'cd <name>' to open one, or 'cat' its README.md once you are there."),
    ]),
  }),
  writeups: Object.freeze({
    'README.md': freeze([
      h('# writeups'),
      o('no writeups are published yet. the first ones are on the way.'),
    ]),
  }),
  wingg: Object.freeze({ 'README.md': readme('WindowsGG', PROJECT_READMES.wingg) }),
  debloat: Object.freeze({ 'README.md': readme('Windows 10/11 Debloat & Optimize', PROJECT_READMES.debloat) }),
  'fridge-friends': Object.freeze({ 'README.md': readme('Fridge Friends', PROJECT_READMES['fridge-friends']) }),
  cleanup: Object.freeze({ 'README.md': readme('Windows Cleanup', PROJECT_READMES.cleanup) }),
  'net-reset': Object.freeze({ 'README.md': readme('Network Stack Reset', PROJECT_READMES['net-reset']) }),
  'net-refresh': Object.freeze({ 'README.md': readme('Network Refresh', PROJECT_READMES['net-refresh']) }),
});

// ---------- man: one page per visible command ----------
// NAME and SYNOPSIS come from the command metadata; this is the DESCRIPTION.

export const MANUAL = Object.freeze({
  help: ['Lists every command this console understands. ? does the same.', 'Some commands are not listed. Finding them is half the fun.'],
  ls: ['Lists what is in the current directory: subdirectories, files you can cat, and', 'the modules on this page.'],
  cd: ['Changes directory, which moves you to that page. Supports ~, /, ., .., - and', 'relative or absolute paths. The shell comes with you.'],
  pwd: ['Prints the working directory, for example /home/visitor/projects.'],
  cat: ['Prints a file from the current directory. ls shows which files are here.', 'The home directory has about.txt, certs.txt, skills.txt and links.txt; every', 'project has a README.md.'],
  open: ['Opens a home page module, a page or a project by name, from anywhere.', 'Examples: open certifications, open projects, open wingg.'],
  whoami: ['Prints the current user. You are a visitor. For now.'],
  neofetch: ['Shows a summary of this machine: wafflesOS, uptime, projects, certifications', 'and the look you have picked.'],
  uptime: ['Shows how long this machine has been up since its last boot. A refresh or', 'reboot starts the clock again.'],
  history: ['Lists the commands run in this shell, oldest first. Lines that were not', 'commands are shown as (input not kept): typed text is never stored.'],
  man: ['Shows the manual page for a command. You are reading one.'],
  git: ['git log shows how this site was built, newest change first.'],
  clear: ['Clears this shell. Ctrl+L does the same.'],
  background: ['With no name, lists the page backgrounds and marks the current one. With a', 'name, switches to it. Your pick follows you between pages until a refresh.'],
  theme: ['With no name, lists the color themes and marks the current one. With a name,', 'switches to it: cyan, amber, green or purple. Lasts until a refresh.'],
  hunt: ['Shows the easter eggs you have found, with hints for the rest. Progress is', 'kept in this browser, even across reboots. hunt reset hides them again.'],
  spawn: ['Opens another shell window, up to three in all. Each one keeps its own', 'history as you move between pages.'],
  exit: ['Closes a spawned shell. tty1 is the login shell and stays open.'],
  reboot: ['Restarts the machine: clears every shell and replays the boot.'],
});

// ---------- git log: this site's history, newest first ----------
// Hashes are cosmetic. Messages describe real milestones of the build.

export const CHANGELOG = Object.freeze([
  ['e41a9c7', 'feat: idle screensaver, with a CRT power-off and power-on'],
  ['b07d2f1', 'feat: color themes and three more backgrounds'],
  ['5c9e310', 'feat: neofetch, cat, man, history, uptime and git log'],
  ['a3f86d2', 'feat: hunt for the easter eggs; sudo says no'],
  ['ff3ef58', 'feat: background command with floating neon hexagons'],
  ['41004c0', 'feat: a hidden list of the easter eggs'],
  ['07527aa', 'feat: fork bomb crashes wafflesOS, then powers it off like a CRT'],
  ['5f691fb', 'release: Layer 1 goes public'],
  ['9be41c3', 'feat: themed screenshot viewer with keyboard support'],
  ['3d27a8e', 'feat: WindowsGG featured; Debloat archived with a stamp and dust'],
  ['c18f5b4', 'feat: Fridge Friends web app link and screenshots'],
  ['6a0e9d2', 'feat: certifications verify themselves during the boot'],
  ['d45b7e0', 'feat: modules load in step with the console loading bar'],
  ['8f2c61a', 'feat: 31337 matrix rain'],
  ['27e9a3b', 'feat: a page for every project and utility tool'],
  ['b6d0f48', 'feat: decrypting [ ACTIVE ] status tags'],
  ['4c7a1e9', 'feat: spawn, exit and the hello world easter egg'],
  ['e93b25d', 'feat: the console follows you between pages'],
  ['1a8d6c3', 'feat: BIOS boot sequence and the hypervisor shell'],
  ['0f00d1e', 'init: strict CSP, no trackers, static by design'],
].map((entry) => Object.freeze(entry)));
