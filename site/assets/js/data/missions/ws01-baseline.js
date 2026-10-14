// Mission: Baseline ws01 (owner request, October 11, 2026: the first lab). A defensive
// starter on the Winbows workstation: check the system's health with the tools an IT
// analyst reaches for first, look at what is running, read the team's baseline, and write
// down what you found. Finishing it earns parrot01's key (data/commands.js VMS: "finish
// the Winbows starter mission").
//
// Read by features/mission-engine.js; shown in ws01's Tickets app (ui/guest-desktop.js).
// Authored data only: objectives are met by events the simulation already produces (a
// shell command's canonical form, a file opened or saved, an app opened); nothing typed is
// stored, and every step teaches a real, safe administration habit.
//
// An objective's `when` lists what completes it (any one is enough):
//   commands: canonical command lines, lowercase, as the shell shows and keeps them
//   opened: files opened in an editor (paths below the VM's root, {user} filled in)
//   saved: files saved on the VM (same paths)
//   apps: desktop apps opened (taskmgr)
// Optional where a mission needs them (none here): outcome (what counts: 'ok' by default,
// or 'denied', 'failed', 'any'), as (accounts), target (VMs acted on) and evidence
// (evidence IDs left, features/scenario.js). So every step here counts only once it works.
// hints are tiered: the first nudges, the last says exactly what to do.

export const WS01_BASELINE = Object.freeze({
  id: 'ws01-baseline',
  ticket: '1042',
  seat: 'ws01', // where it is played from (features/mission-engine.js result contract)
  title: 'Baseline ws01 before it joins the lab',
  from: 'Lab Ops',
  briefing: Object.freeze([
    'ws01 is the analyst workstation everyone in the lab starts from. Before the other machines come online, we need to know it is healthy and that nothing unexpected is running.',
    'Work through the checklist below from ws01 itself. PowerShell is already running as administrator.',
    'When every box is ticked, the ticket closes and you get the key for parrot01, the next machine in the lab.',
  ]),
  objectives: Object.freeze([
    Object.freeze({
      id: 'sfc',
      text: 'Check the protected system files for damage.',
      when: Object.freeze({ commands: Object.freeze(['sfc /scannow', 'sfc /verifyonly']) }),
      hints: Object.freeze([
        'Winbows has a built-in System File Checker.',
        'In PowerShell, run the System File Checker with its scan-and-repair switch.',
        'Type: sfc /scannow',
      ]),
    }),
    Object.freeze({
      id: 'dism',
      text: 'Check the Winbows component store that sfc repairs from.',
      when: Object.freeze({ commands: Object.freeze(['dism /online /cleanup-image /restorehealth', 'dism /online /cleanup-image /scanhealth', 'dism /online /cleanup-image /checkhealth']) }),
      hints: Object.freeze([
        'sfc repairs files from the component store. DISM is the tool that checks and repairs that store.',
        'DISM works on the running system with /online and /cleanup-image.',
        'Type: dism /online /cleanup-image /restorehealth',
      ]),
    }),
    Object.freeze({
      id: 'processes',
      text: 'Review what is running on the machine.',
      when: Object.freeze({ commands: Object.freeze(['tasklist', 'get-process', 'ps', 'gps']), apps: Object.freeze(['taskmgr']) }),
      hints: Object.freeze([
        'There is a command (and an app) that lists every running process.',
        'Try tasklist or Get-Process in PowerShell, or right-click the desktop for Task Manager.',
        'Type: tasklist',
      ]),
    }),
    Object.freeze({
      id: 'baseline',
      text: "Read the team's hardening baseline in Documents.",
      when: Object.freeze({
        commands: Object.freeze(['type c:\\users\\{user}\\documents\\baseline.txt']),
        opened: Object.freeze(['Users/{user}/Documents/baseline.txt']),
      }),
      hints: Object.freeze([
        'The baseline is a text file in your Documents folder.',
        'Open it in File Explorer, or print it in PowerShell with type.',
        'Type: type Documents\\baseline.txt',
      ]),
    }),
    Object.freeze({
      id: 'findings',
      text: 'Write up what you found in Documents\\findings.txt.',
      when: Object.freeze({ saved: Object.freeze(['Users/{user}/Documents/findings.txt']) }),
      hints: Object.freeze([
        'A short note is enough: what you ran and what it said.',
        'Open Notepad, write your notes, and Save As into Documents.',
        'Notepad > File > Save as > Documents, name it findings.txt.',
      ]),
    }),
  ]),
  // What finishing earns, and what the ticket says when it closes.
  reward: Object.freeze({ unlock: 'parrot01' }),
  closing: 'Resolved: ws01 is healthy and documented. parrot01 is unlocked, so power it on from the hypervisor library.',
});
