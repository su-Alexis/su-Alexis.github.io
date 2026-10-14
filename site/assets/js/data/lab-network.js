// Layer 2: the lab network's services (Skeleton: data/lab-network.js; doctrine sections 3
// and 7). What each VM answers on the lab network: its open TCP ports, the service name
// nmap prints, the version nmap -sV prints, and the SSH banner. features/fake-network.js
// answers ping, nslookup, curl, ssh and nmap from this map and data/commands.js VMS (names
// and addresses); nothing is scanned or sent anywhere.
//
// Authored and fictional: every host is on lab.example or corp.example and every address
// in 198.51.100.0/24. Version strings are the ones those systems ship, as a real scan of
// such a lab would show them. Missions change what is open by adding entries here.

const svc = (port, name, version = '') => Object.freeze({ port, name, version });

export const SERVICES = Object.freeze({
  // Winbows 11 workstation: file sharing and Remote Desktop.
  ws01: Object.freeze([
    svc(135, 'msrpc', 'Macrosoft Winbows RPC'),
    svc(139, 'netbios-ssn', 'Macrosoft Winbows netbios-ssn'),
    svc(445, 'macrosoft-ds', 'Macrosoft Winbows SMB'),
    svc(3389, 'ms-wbt-server', 'Macrosoft Terminal Services'),
  ]),
  // The attacker's box listens on nothing.
  parrot01: Object.freeze([]),
  'ubuntu-blue': Object.freeze([svc(22, 'ssh', 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)')]),
  'ubuntu-red': Object.freeze([svc(22, 'ssh', 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)')]),
  // A domain controller's usual ports.
  dc01: Object.freeze([
    svc(53, 'domain', 'Simple DNS Plus'),
    svc(88, 'kerberos-sec', 'Macrosoft Winbows Kerberos'),
    svc(135, 'msrpc', 'Macrosoft Winbows RPC'),
    svc(139, 'netbios-ssn', 'Macrosoft Winbows netbios-ssn'),
    svc(389, 'ldap', 'Macrosoft Winbows Active Directory LDAP (Domain: corp.example)'),
    svc(445, 'macrosoft-ds', 'Macrosoft Winbows SMB'),
    svc(464, 'kpasswd5', ''),
    svc(636, 'ldapssl', ''),
    svc(3268, 'ldap', 'Macrosoft Winbows Active Directory LDAP (Domain: corp.example)'),
    svc(3389, 'ms-wbt-server', 'Macrosoft Terminal Services'),
  ]),
  web01: Object.freeze([
    svc(22, 'ssh', 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5 (Ubuntu Linux; protocol 2.0)'),
    svc(80, 'http', 'Apache httpd 2.4.58 ((Ubuntu))'),
    svc(443, 'https', 'Apache httpd 2.4.58 ((Ubuntu))'),
  ]),
  router01: Object.freeze([
    svc(22, 'ssh', 'Dropbear sshd 2022.83 (protocol 2.0)'),
    svc(53, 'domain', 'dnsmasq 2.90'),
    svc(80, 'http', 'OpenWrt uHTTPd'),
    svc(443, 'https', 'OpenWrt uHTTPd'),
  ]),
  // An IP camera: its web viewer, RTSP video, and the telnet so many of them leave on.
  cam01: Object.freeze([
    svc(23, 'telnet', 'BusyBox telnetd'),
    svc(80, 'http', 'lighttpd 1.4.59'),
    svc(554, 'rtsp', ''),
  ]),
});

// What each machine's web server says it is (curl -I).
export const HTTP_SERVERS = Object.freeze({
  web01: 'Apache/2.4.58 (Ubuntu)',
  router01: 'uhttpd',
  cam01: 'lighttpd/1.4.59',
});

// How long each one takes to answer a ping, in ms (a small, steady lab).
export const LATENCY = Object.freeze({ default: 0.42, router01: 0.31, cam01: 1.8 });
