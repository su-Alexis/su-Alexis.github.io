// Mission: Blue 1, "Who was here?" (owner-approved spec, October 11, 2026: the Claude Doc
// "Blue 1 spec: Who was here?", steps B1 to B8). A defensive investigation on the
// defender's desk, ubuntu-blue: read web01's forwarded logs, work out what reached web01
// and in what order, keep copies of the evidence, fix the setting that allowed the
// change, restore the page, and prove the fix holds. Finishing it earns ubuntu-red's key.
//
// Blue 1 meets the red missions only through web01's shared scenario state
// (data/scenarios/web01.js, features/scenario.js): it never reads red mission data. Its
// `expects` lists the handoff slots it reads (tests/handoff.test.mjs checks a red mission
// provides each one). Every Tickets answer is worked out from the evidence actually
// recorded (features/mission-engine.js askView), so if the trail came from another seat,
// the right answer follows it. The defender's own traffic (ubuntu-blue) is known and never
// a suspect.
//
// Conditions used here (described above meets() in features/mission-engine.js):
//   programs, target  a command by name that acted on web01 (nmap)
//   reads             a cat, grep, tail or cp of that forwarded log
//   lookup            a name lookup that answered (nslookup)
//   preserved         copies in ~/evidence/ of the altered page and the maintenance log line
//   labState          web01's fixtures right now (the fix holds)
//   seats             a step played from another VM (B8's check from parrot01)
// A step with `ask` opens its Tickets questions once its action is done; the right
// answers finish it. Choices are fixed (doctrine: no free text kept).
// Conclusions stay narrow (owner review, October 11, 2026): an address and the VM behind
// it are the observed source, not a person; www-data is a service account; a curl -I 200
// shows only that the web server answered.

const ACCESS_LOG = 'var/log/remote/web01/apache2/access.log';
const AUTH_LOG = 'var/log/remote/web01/auth.log';
// The evidence kinds behind each handoff slot (data/scenarios/web01.js).
const SITE_REQUESTS = Object.freeze(['http', 'maintenance-page']); // R1-a
const LOGIN_ATTEMPTS = Object.freeze(['ssh-existing-denied', 'ssh-invalid-denied']); // R1-b
const MAINTENANCE = Object.freeze(['maintenance-restore-applied']); // R2-a
const FIXED = Object.freeze({ status: 'baseline', publicRestore: 'disabled' });

const q = (question) => Object.freeze(question);
const opt = (value, label) => Object.freeze({ value, label });

export const BLUE_1 = Object.freeze({
  id: 'blue-1',
  ticket: '1045',
  seat: 'ubuntu-blue',
  scenario: 'web01',
  targets: Object.freeze(['web01']),
  title: 'Who was here?',
  from: 'Lab Ops',
  // Open once both ParrotOS missions are done (they also unlock this machine).
  requires: Object.freeze(['m-red-2-done']),
  // The handoff slots Blue 1 reads (R1-c is optional and has no Blue question).
  expects: Object.freeze(['R1-a', 'R1-b', 'R2-a', 'R2-b', 'R2-c']),
  briefing: Object.freeze([
    'web01 was noisy overnight. Find out who was here, what they touched, and shut the door.',
    'web01 forwards its logs to this desk, so you can read them under /var/log/remote/web01/ without logging in to it. Each step opens its questions here once you have looked at the right evidence.',
    'Follow the incident-response order: understand what happened, preserve the evidence, then contain, fix and recover, and finally prove the fix holds. Closing the ticket earns the key for ubuntu-red.',
  ]),
  objectives: Object.freeze([
    Object.freeze({
      id: 'surface',
      text: 'Find out what web01 exposes to the lab network.',
      when: Object.freeze({ match: 'all', programs: Object.freeze(['nmap']), target: Object.freeze(['web01']) }),
      hints: Object.freeze([
        'Start from the attack surface: which services does web01 offer?',
        'nmap is not installed on this desk yet. apt can install it from the lab mirror.',
        'Type: sudo apt install nmap, then: nmap -sV web01',
      ]),
    }),
    Object.freeze({
      id: 'site-log',
      text: "Read web01's web server log and find the unusual requests.",
      dependsOn: Object.freeze(['surface']),
      when: Object.freeze({ match: 'all', reads: Object.freeze([ACCESS_LOG]) }),
      ask: Object.freeze({
        questions: Object.freeze([q({
          id: 'source',
          prompt: 'Which address made the unusual requests? The earlier lines from ws01 are the lab\'s own known traffic.',
          multiple: true,
          options: 'addresses',
          answer: Object.freeze({ seatsOf: SITE_REQUESTS, field: 'ip' }),
        })]),
      }),
      hints: Object.freeze([
        'The Apache access log lists every request with the address it came from.',
        'It is forwarded to /var/log/remote/web01/apache2/access.log. The lines at the end are the newest.',
        'Type: cat /var/log/remote/web01/apache2/access.log, then answer in Tickets.',
      ]),
    }),
    Object.freeze({
      id: 'which-vm',
      text: 'Turn that address into a machine name.',
      dependsOn: Object.freeze(['site-log']),
      when: Object.freeze({ match: 'all', lookup: true }),
      ask: Object.freeze({
        questions: Object.freeze([q({
          id: 'vm',
          prompt: 'Which lab VM is behind that address?',
          multiple: true,
          options: 'vms',
          answer: Object.freeze({ seatsOf: SITE_REQUESTS, field: 'vm' }),
        })]),
      }),
      hints: Object.freeze([
        'An address is a lead; a hostname is an answer.',
        'The lab\'s DNS answers reverse lookups for its own addresses.',
        'Type: nslookup followed by the address you found, then answer in Tickets.',
      ]),
    }),
    Object.freeze({
      id: 'auth-log',
      text: "Read web01's login log: what was tried at the door?",
      dependsOn: Object.freeze(['which-vm']),
      when: Object.freeze({ match: 'all', reads: Object.freeze([AUTH_LOG]) }),
      ask: Object.freeze({
        questions: Object.freeze([
          q({
            id: 'accounts',
            prompt: 'Which accounts were tried over SSH?',
            multiple: true,
            options: 'accounts',
            answer: Object.freeze({ accountsOf: LOGIN_ATTEMPTS }),
          }),
          q({
            id: 'accepted',
            prompt: 'Did any of those SSH logins succeed?',
            options: Object.freeze([
              opt('no', 'No: every attempt was closed before login'),
              opt('yes', 'Yes: at least one login was accepted'),
            ]),
            answer: Object.freeze({ fixed: Object.freeze(['no']) }),
          }),
        ]),
      }),
      hints: Object.freeze([
        'sshd writes every login attempt to auth.log, with the account name it was asked for.',
        '"Invalid user" means a name web01 does not have; "authenticating user" means a real account was targeted.',
        'Type: grep sshd /var/log/remote/web01/auth.log, then answer in Tickets.',
      ]),
    }),
    Object.freeze({
      id: 'timeline',
      text: 'Put the events in order and find what changed the site.',
      dependsOn: Object.freeze(['auth-log']),
      when: Object.freeze({ match: 'all', reads: Object.freeze([AUTH_LOG, ACCESS_LOG]) }),
      ask: Object.freeze({
        questions: Object.freeze([
          q({
            id: 'cause',
            prompt: "What changed web01's status page?",
            options: Object.freeze([
              opt('maintenance', 'The lab-maintenance public restore, run by the www-data service account'),
              opt('ssh', 'An SSH login as admin'),
              opt('apache', 'An ordinary GET request to the site'),
            ]),
            answer: Object.freeze({ fixed: Object.freeze(['maintenance']) }),
          }),
          q({
            id: 'first',
            prompt: 'What came first?',
            options: Object.freeze([
              opt('recon', 'The site requests and the SSH login attempts'),
              opt('change', 'The maintenance restore that changed the page'),
            ]),
            answer: Object.freeze({ firstOf: Object.freeze({ recon: [...SITE_REQUESTS, ...LOGIN_ATTEMPTS], change: MAINTENANCE }) }),
          }),
        ]),
      }),
      hints: Object.freeze([
        'An incident is a timeline. Both logs use lab times, one line per distinct event.',
        'Look for the lab-maintenance line in auth.log and compare its time with the other entries.',
        'Type: grep lab-maintenance /var/log/remote/web01/auth.log, then answer in Tickets.',
      ]),
    }),
    Object.freeze({
      id: 'preserve',
      text: 'Before changing anything, keep copies of the evidence in ~/evidence/.',
      dependsOn: Object.freeze(['timeline']),
      when: Object.freeze({
        match: 'all',
        preserved: Object.freeze({
          dir: 'home/{user}/evidence',
          holds: Object.freeze([Object.freeze({ fixture: 'status', state: 'altered' }), Object.freeze({ kind: 'maintenance-restore-applied' })]),
        }),
      }),
      hints: Object.freeze([
        'Recovering first destroys the proof. Copy the altered page and the log line that shows the change.',
        'Make the folder with mkdir. cp copies a forwarded log; curl -o saves the page as web01 serves it now (web01 must be powered on).',
        'Type: mkdir ~/evidence, then cp /var/log/remote/web01/auth.log ~/evidence/, then curl -o ~/evidence/status.txt https://web01.lab.example/status.txt',
      ]),
    }),
    Object.freeze({
      id: 'recover',
      text: "On web01's console, turn off public restore and put back the known-good status.txt.",
      dependsOn: Object.freeze(['preserve']),
      when: Object.freeze({ match: 'all', labState: FIXED }),
      hints: Object.freeze([
        'Fix the cause first: /etc/lab-maintenance.conf allows unauthenticated restores. Then recover the page from /var/backups/.',
        'Both files belong to root on web01, so use sudo there. sed -i edits the setting in place; cp restores the backup.',
        "On web01: sudo sed -i 's/public_restore=enabled/public_restore=disabled/' /etc/lab-maintenance.conf, then sudo cp /var/backups/status.txt /var/www/html/status.txt",
      ]),
    }),
    Object.freeze({
      id: 'verify',
      text: 'Prove the fix holds from parrot01, then close the ticket.',
      dependsOn: Object.freeze(['recover']),
      when: Object.freeze({
        match: 'all',
        seats: Object.freeze(['parrot01']),
        commands: Object.freeze(['lab-restore apply web01']),
        target: Object.freeze(['web01']),
        // Refused by the setting itself, not hidden by a firewall drop (reason 'filtered').
        outcome: 'denied',
        reason: 'permission',
        state: FIXED,
      }),
      ask: Object.freeze({
        questions: Object.freeze([
          q({
            id: 'source',
            prompt: 'Which lab machine was the observed source of the change?',
            multiple: true,
            options: 'vms',
            answer: Object.freeze({ seatsOf: MAINTENANCE, field: 'vm' }),
          }),
          q({
            id: 'account',
            prompt: 'Which account made the change on web01?',
            options: Object.freeze([
              opt('www-data', "www-data, the web server's service account"),
              opt('admin', 'admin, after an SSH login'),
              opt('root', 'root, after an SSH login'),
            ]),
            answer: Object.freeze({ fixed: Object.freeze(['www-data']) }),
          }),
          q({
            id: 'changed',
            prompt: 'What was changed?',
            options: Object.freeze([
              opt('status', 'The contents of /var/www/html/status.txt'),
              opt('accounts', 'A new login account on web01'),
              opt('apache', "Apache's configuration"),
            ]),
            answer: Object.freeze({ fixed: Object.freeze(['status']) }),
          }),
          q({
            id: 'actions',
            prompt: 'What did you do? Choose everything you did.',
            multiple: true,
            options: Object.freeze([
              opt('preserved', 'Kept copies of the evidence before changing anything'),
              opt('disabled', 'Turned off public restore in /etc/lab-maintenance.conf'),
              opt('restored', 'Restored status.txt from the known-good backup'),
              opt('verified', 'Checked from parrot01 that the restore is now refused'),
              opt('blocked', 'Blocked the source address with ufw on web01'),
            ]),
            answer: Object.freeze({
              fixed: Object.freeze(['preserved', 'disabled', 'restored', 'verified']),
              addIfDenied: Object.freeze({ value: 'blocked', seatOf: MAINTENANCE }),
            }),
          }),
          q({
            id: 'head',
            prompt: 'curl -I https://web01.lab.example/ now answers 200 OK. What does that show?',
            options: Object.freeze([
              opt('answered', 'The web server answered the request'),
              opt('healthy', 'The whole site is healthy and safe'),
            ]),
            answer: Object.freeze({ fixed: Object.freeze(['answered']) }),
          }),
        ]),
      }),
      hints: Object.freeze([
        'A fix is only done once you have tested it the same way the change was made.',
        'Run the same lab-restore apply from parrot01. It should now be refused, and status.txt should stay as restored. Test before (or without) any firewall block, so the block cannot hide an unfixed setting.',
        'On parrot01: lab-restore apply web01, then answer the closing questions in Tickets on ubuntu-blue.',
      ]),
    }),
  ]),
  // Finished only while the fix still holds.
  completeWhen: Object.freeze({ state: FIXED }),
  reward: Object.freeze({ unlock: 'ubuntu-red' }),
  closing: 'Resolved: the source is identified, the evidence is kept, public restore is off and status.txt is restored. ubuntu-red is unlocked, so power it on from the hypervisor library.',
});
