// Scenario: web01's shared state (Layer 2 build order, October 11, 2026). One record of
// what reached web01, shared by every mission that touches it: Red 1 and Red 2, played
// from parrot01, leave entries here, and Blue 1 reads them back in web01's logs ("Red 1
// leaves the trail Blue 1 finds", !Stages/ Layer 2 plan).
//
// Read only by features/scenario.js, which turns each kind below into fixed evidence IDs
// (e-web01-<kind>[-<account>]-<seat>) and draws the matching log lines. Authored and
// fictional: addresses come from data/commands.js VMS (doctrine section 3), and every
// line is fixed text with only known values filled in; nothing a visitor typed is kept.
//
// The kinds and their lines are the red handoff cards' (owner, October 11, 2026:
// Projects & Code/handoffs/red-1-handoff.txt, red-2-handoff.txt). The log files
// themselves, with the lab's own earlier traffic, are web01's image files
// (data/images/ubuntuserver.js); evidence lines follow them, in the order they happened.
//
// A kind is left when a request reaches a service on web01 (the lab network's contact,
// set by features/fake-network.js, or a lab-restore effect) and every field it names
// matches:
//   service  'http' | 'ssh' | 'lab-maintenance'
//   method, path  the HTTP request (GET or HEAD; the path as curl asked for it)
//   accounts 'existing' (web01 has the account) or 'invalid' (it does not), for ssh;
//            such a kind makes one evidence ID per account
//   action   the lab-maintenance action (lab-restore's effect)
//   state    the web01 fixture states it applies in (before or after a change)
// Fields in a line: {time} (from the order it happened), {ip} (the seat's lab address),
// {user} (the account ssh asked for).

export const WEB01 = Object.freeze({
  vm: 'web01',
  // The accounts web01 has: its admin, and root.
  accounts: Object.freeze(['admin', 'root']),
  // Log forwarding (Blue 1 spec, "How Blue sees web01's logs"): the lab's ssh never opens
  // a remote shell, so web01 sends these logs to the defender's desk as an rsyslog setup
  // would. On ubuntu-blue they read as var/log/remote/web01/<file below var/log/>, built
  // from the same image lines and evidence as web01's own copies (features/scenario.js
  // FORWARDED; features/guest-engine.js reads them).
  forward: Object.freeze({
    to: 'ubuntu-blue',
    dir: 'var/log/remote/web01',
    files: Object.freeze(['var/log/auth.log', 'var/log/apache2/access.log']),
  }),
  // web01's firewall (ufw, Blue 1 step 7): one deny rule per lab machine, kept in the
  // shared scenario state (features/scenario.js makes a deny-<vm> fixture for each), and
  // honoured by the lab network: a denied seat's packets are dropped, so its curl, ssh,
  // ping, nmap and lab-restore time out instead of being refused.
  firewall: true,
  // Known-good copies an admin restores from (Blue 1 step 7): each holds its fixture's
  // first state, as a backup taken before anything changed would.
  backups: Object.freeze([Object.freeze({ fixture: 'status', path: 'var/backups/status.txt' })]),
  kinds: Object.freeze([
    // Red 1 (slots R1-a, R1-b, R1-c).
    Object.freeze({
      id: 'http', service: 'http', method: 'GET', path: '/',
      file: 'var/log/apache2/access.log',
      line: '{ip} - - [11/Oct/2026:{time} +0000] "GET / HTTP/1.1" 200',
    }),
    Object.freeze({
      id: 'maintenance-page', service: 'http', method: 'GET', path: '/maintenance/',
      file: 'var/log/apache2/access.log',
      line: '{ip} - - [11/Oct/2026:{time} +0000] "GET /maintenance/ HTTP/1.1" 200',
    }),
    Object.freeze({
      id: 'ssh-existing-denied', service: 'ssh', accounts: 'existing',
      file: 'var/log/auth.log',
      line: 'Oct 11 {time} web01 sshd[2101]: Connection closed by authenticating user {user} {ip} port 51001 [preauth]',
    }),
    Object.freeze({
      id: 'ssh-invalid-denied', service: 'ssh', accounts: 'invalid',
      file: 'var/log/auth.log',
      line: 'Oct 11 {time} web01 sshd[2102]: Invalid user {user} from {ip} port 51002',
    }),
    // Red 2 (slots R2-a, R2-b, R2-c).
    Object.freeze({
      id: 'status-before', service: 'http', method: 'GET', path: '/status.txt', state: Object.freeze({ status: 'baseline' }),
      file: 'var/log/apache2/access.log',
      line: '{ip} - - [11/Oct/2026:{time} +0000] "GET /status.txt HTTP/1.1" 200',
    }),
    Object.freeze({
      id: 'maintenance-restore-applied', service: 'lab-maintenance', action: 'public-restore',
      file: 'var/log/auth.log',
      line: 'Oct 11 {time} web01 lab-maintenance: action=public-restore result=applied source={ip} user=www-data authentication=none',
    }),
    Object.freeze({
      id: 'status-after', service: 'http', method: 'GET', path: '/status.txt', state: Object.freeze({ status: 'altered' }),
      file: 'var/log/apache2/access.log',
      line: '{ip} - - [11/Oct/2026:{time} +0000] "GET /status.txt HTTP/1.1" 200',
    }),
    Object.freeze({
      id: 'http-head', service: 'http', method: 'HEAD', path: '/',
      file: 'var/log/apache2/access.log',
      line: '{ip} - - [11/Oct/2026:{time} +0000] "HEAD / HTTP/1.1" 200',
    }),
  ]),
});
