// Layer 2 guest engine (features/guest-engine.js): image shells over authored file trees.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest, promptFor, restoreCwd, cwdKey, imageFor } = await import('../site/assets/js/features/guest-engine.js');

const vm = (id) => VMS.find((entry) => entry.id === id);
const texts = (result) => result.lines.map((line) => line.text).join('\n');

test('every VM boots from its image with its own user, host and address filled in', () => {
  for (const entry of VMS) {
    const guest = bootGuest(entry);
    assert.ok(guest, entry.id);
    assert.equal(imageFor(entry).id, entry.image);
    // Ubuntu's Terminal opens straight to a prompt (GNOME Terminal), so its boot text is empty.
    assert.equal(guest.boot.length > 0, entry.image !== 'ubuntu', entry.id);
    assert.ok(guest.boot.every((line) => !/\{(user|host|id|ip)\}/.test(line.text)), 'placeholders filled');
    for (const node of guest.tree.values()) {
      if (!node.dir) assert.ok(!/\{(user|host|id|ip)\}/.test(node.content), `${entry.id} file filled`);
    }
  }
  assert.equal(bootGuest({ id: 'x', image: '__proto__' }), null, 'unknown images do not boot');
  assert.equal(promptFor(bootGuest(vm('ubuntu-red'))), 'operator@ubuntu-red:~$');
  assert.equal(promptFor(bootGuest(vm('ws01'))), 'PS C:\\Users\\analyst>');
});

test('two VMs from one image are separate machines', () => {
  const blue = bootGuest(vm('ubuntu-blue'));
  const red = bootGuest(vm('ubuntu-red'));
  assert.match(texts(runGuest(blue, 'cat /etc/hostname')), /ubuntu-blue\.lab\.example/);
  assert.match(texts(runGuest(red, 'cat /etc/hostname')), /ubuntu-red\.lab\.example/);
  runGuest(blue, 'cd /etc');
  assert.equal(promptFor(red), 'operator@ubuntu-red:~$', 'one VM moving does not move the other');
  assert.match(texts(runGuest(red, 'ip a')), /198\.51\.100\.31\/24/);
});

test('the bash shell walks its tree and never repeats unknown input', () => {
  const guest = bootGuest(vm('parrot01'));
  assert.match(texts(runGuest(guest, 'ls')), /notes\//);
  assert.equal(runGuest(guest, 'cd notes').echo, 'cd ~/notes');
  assert.match(texts(runGuest(guest, 'cat rules.txt')), /198\.51\.100\.0\/24/);
  assert.equal(runGuest(guest, 'cat rules.txt').echo, 'cat ~/notes/rules.txt');
  runGuest(guest, 'cd ../..');
  assert.equal(promptFor(guest), 'operator@parrot01:/home$');
  runGuest(guest, 'cd');
  assert.equal(promptFor(guest), 'operator@parrot01:~$');
  assert.equal(texts(runGuest(guest, 'pwd')), '/home/operator');
  assert.equal(texts(runGuest(guest, 'whoami')), 'operator');
  const secret = 'hunter2' + 'guest';
  for (const raw of [secret, `cd ${secret}`, `cat ${secret}`, `ls ${secret}`, `cat /etc/${secret}`, `whoami ${secret}`]) {
    const result = runGuest(guest, raw);
    assert.equal(result.echo, null, raw);
    assert.ok(!texts(result).includes(secret), raw);
  }
  assert.match(texts(runGuest(guest, 'cat /etc')), /Is a directory/);
  assert.equal(runGuest(guest, 'clear').clear, true);
  assert.equal(runGuest(guest, '   ').echo, '');
  assert.equal(runGuest(guest, 'ls\u0007').echo, null, 'control characters are refused');
  assert.equal(runGuest(guest, 'constructor').echo, null, 'inherited names are not commands');
});

test('the PowerShell shell takes cmdlets, aliases and case-insensitive paths', () => {
  const guest = bootGuest(vm('ws01'));
  assert.match(texts(runGuest(guest, 'Get-ChildItem')), /Desktop/);
  assert.equal(runGuest(guest, 'cd desktop').echo, 'cd C:\\Users\\analyst\\Desktop');
  assert.match(texts(runGuest(guest, 'type README.TXT')), /Welcome to ws01/);
  assert.match(texts(runGuest(guest, 'gc C:\\Users\\analyst\\Documents\\baseline.txt')), /hardening baseline/);
  assert.equal(texts(runGuest(guest, 'whoami')), 'ws01\\analyst');
  assert.match(texts(runGuest(guest, 'ipconfig')), /198\.51\.100\.20/);
  assert.match(texts(runGuest(guest, 'ls /etc')), /Cannot find path/);
  assert.match(texts(runGuest(guest, 'uname')), /not recognized/);
});

test('a stored working folder is only restored when it exists', () => {
  const guest = bootGuest(vm('ubuntu-blue'));
  runGuest(guest, 'cd /var/log');
  const stored = cwdKey(guest);
  const again = bootGuest(vm('ubuntu-blue'));
  restoreCwd(again, stored);
  assert.equal(promptFor(again), 'admin@ubuntu-blue:/var/log$');
  for (const bad of ['../../etc', 'nope', 42, 'x'.repeat(300), '__proto__']) {
    const fresh = bootGuest(vm('ubuntu-blue'));
    restoreCwd(fresh, bad);
    assert.equal(promptFor(fresh), 'admin@ubuntu-blue:~$', String(bad).slice(0, 20));
  }
});

test('the servers and devices answer as their own machines', async () => {
  const { isSecretPrompt, finishLogin, autoLogin } = await import('../site/assets/js/features/guest-engine.js');
  const dc = bootGuest(vm('dc01'));
  assert.equal(texts(runGuest(dc, 'whoami')), 'corp\\administrator');
  assert.match(texts(runGuest(dc, 'ipconfig')), /corp\.example/);
  const web = bootGuest(vm('web01'));
  assert.match(web.boot[0].text, /Ubuntu 24\.04/);
  assert.equal(promptFor(web), 'admin@web01:~$');
  const router = bootGuest(vm('router01'));
  assert.equal(promptFor(router), 'root@router01:~#');
  assert.match(texts(runGuest(router, 'id')), /uid=0\(root\)/);
  assert.match(texts(runGuest(router, 'cat /etc/config/system')), /hostname 'router01'/);
  assert.match(texts(runGuest(router, 'nope')), /-ash: not found/);
  // The camera's console is a login prompt: nothing typed is shown or kept.
  const cam = bootGuest(vm('cam01'));
  assert.equal(promptFor(cam), 'cam01 login:');
  const secret = 'hunter2' + 'cam';
  const first = runGuest(cam, secret);
  assert.equal(first.echo, '');
  assert.equal(isSecretPrompt(cam), true);
  // The password is handed to the caller to check against its digest (verify).
  const second = runGuest(cam, secret);
  assert.equal(second.verify, true);
  assert.ok(!texts(first).includes(secret) && !texts(second).includes(secret));
  assert.match(finishLogin(cam, false).map((l) => l.text).join('\n'), /Login incorrect/);
  assert.equal(promptFor(cam), 'cam01 login:');
  // A wrong user name fails even with the right password.
  runGuest(cam, 'admin');
  runGuest(cam, 'x');
  assert.match(finishLogin(cam, true).map((l) => l.text).join('\n'), /Login incorrect/);
  // root with the right password signs in to a root shell; exit logs out.
  runGuest(cam, 'root');
  runGuest(cam, 'x');
  finishLogin(cam, true);
  assert.equal(promptFor(cam), 'root@cam01:~#');
  assert.match(texts(runGuest(cam, 'id')), /uid=0\(root\)/);
  runGuest(cam, 'exit');
  assert.equal(promptFor(cam), 'cam01 login:');
  // The test auto-login signs root in and shows the console's login lines.
  const auto = bootGuest(vm('cam01'));
  assert.match(autoLogin(auto).map((l) => l.text).join('\n'), /cam01 login: root/);
  assert.equal(promptFor(auto), 'root@cam01:~#');
  // Only the digest of the test password is stored.
  const { PUZZLES } = await import('../site/assets/js/data/puzzles.js');
  assert.match(PUZZLES.deviceLogins.cam01.sha256[0], /^[0-9a-f]{64}$/);
});

test('every shell has its own help, and every command answers ?', () => {
  const linux = bootGuest(vm('parrot01'));
  const list = texts(runGuest(linux, '?'));
  assert.match(list, /ParrotOS/);
  for (const name of ['ls', 'cd', 'pwd', 'cat', 'whoami', 'id', 'hostname', 'uname', 'ip', 'clear']) {
    assert.ok(list.includes(`  ${name}`), name);
    assert.match(texts(runGuest(linux, `${name} ?`)), /^Usage: /, `${name} ?`);
    assert.match(texts(runGuest(linux, `${name} --help`)), /^Usage: /, `${name} --help`);
  }
  assert.equal(texts(runGuest(linux, 'help')), list);
  assert.match(texts(runGuest(linux, 'help cat')), /Usage: cat <file>/);
  const unknown = runGuest(linux, 'help hunter2x');
  assert.ok(!texts(unknown).includes('hunter2x'));
  const windows = bootGuest(vm('ws01'));
  assert.match(texts(runGuest(windows, 'help')), /PowerShell/);
  for (const raw of ['dir -?', 'Get-ChildItem /?', 'ls ?', 'help gci']) {
    assert.match(texts(runGuest(windows, raw)), /SYNTAX\n {4}dir \[path\]/, raw);
  }
  // Each machine names itself at the top of its list.
  assert.match(texts(runGuest(bootGuest(vm('router01')), '?')), /OpenWrt/);
  assert.match(texts(runGuest(bootGuest(vm('dc01')), 'help')), /Winbows Server/);
});

test('apt on Ubuntu and ParrotOS: sudo, &&, the Y/n question and parrot-upgrade', () => {
  const ubuntu = bootGuest(vm('ubuntu-blue'));
  // Without sudo apt cannot take its lock, as on a real system.
  assert.match(texts(runGuest(ubuntu, 'apt update')), /Permission denied/);
  const chained = runGuest(ubuntu, 'sudo apt update && sudo apt upgrade -y');
  assert.equal(chained.echo, 'sudo apt update && sudo apt upgrade -y');
  assert.match(texts(chained), /5 packages can be upgraded/);
  assert.match(texts(chained), /Setting up openssl/);
  assert.match(texts(runGuest(ubuntu, 'sudo apt upgrade')), /0 upgraded, 0 newly installed/);
  assert.match(texts(runGuest(ubuntu, 'sudo apt update')), /All packages are up to date/);
  assert.equal(texts(runGuest(ubuntu, 'sudo whoami')), 'root');
  assert.equal(texts(runGuest(ubuntu, 'whoami')), 'admin', 'sudo lasts one command');
  // A failing command stops the chain.
  const stopped = runGuest(ubuntu, 'nope && ls');
  assert.equal(stopped.lines.length, 1);
  assert.equal(stopped.echo, null);
  // ParrotOS: apt full-upgrade asks first; Enter or y goes ahead, anything else aborts.
  const parrot = bootGuest(vm('parrot01'));
  runGuest(parrot, 'sudo apt update');
  runGuest(parrot, 'sudo apt full-upgrade');
  assert.equal(promptFor(parrot), 'Do you want to continue? [Y/n]');
  assert.match(texts(runGuest(parrot, 'n')), /Abort\./);
  assert.equal(promptFor(parrot), 'operator@parrot01:~$');
  runGuest(parrot, 'sudo apt full-upgrade');
  assert.match(texts(runGuest(parrot, '')), /Setting up parrot-core/);
  assert.match(texts(runGuest(parrot, 'sudo parrot-upgrade')), /Parrot Upgrade/);
  assert.match(texts(runGuest(parrot, 'parrot-upgrade')), /must be run as root/);
  // Machines without apt have no sudo, and only Parrot has parrot-upgrade.
  assert.match(texts(runGuest(bootGuest(vm('router01')), 'sudo apt update')), /not found/);
  assert.match(texts(runGuest(ubuntu, 'sudo parrot-upgrade')), /not found/);
  assert.ok(!texts(runGuest(bootGuest(vm('router01')), '?')).includes('apt <command>'));
  // Unknown apt operations and free words are never repeated.
  const odd = runGuest(ubuntu, 'sudo apt hunter2x');
  assert.ok(!texts(odd).includes('hunter2x') && !String(odd.echo).includes('hunter2x'));
});

test('sfc and DISM on the Winbows VMs: progress in place, && as 5.1 refuses it, ; to chain', () => {
  for (const id of ['ws01', 'dc01']) {
    const win = bootGuest(vm(id));
    const scan = runGuest(win, 'sfc /scannow');
    assert.equal(scan.echo, 'sfc /scannow');
    assert.match(texts(scan), /did not find any integrity violations/);
    // Progress redraws one line: every replace line follows a line of the same kind.
    assert.ok(scan.lines.some((line) => line.replace) && scan.lines.every((line) => line.ms > 0));
    const repair = runGuest(win, 'DISM /Online /Cleanup-Image /RestoreHealth');
    assert.equal(repair.echo, 'dism /online /cleanup-image /restorehealth');
    assert.match(texts(repair), /100\.0%=+\] The restore operation completed successfully\./);
    assert.match(texts(repair), new RegExp(`Image Version: ${imageFor(vm(id)).servicing.image.replace(/\./g, '\.')}`));
    // Every bar is DISM's width.
    for (const line of repair.lines.filter((entry) => entry.text.startsWith('['))) assert.equal(line.text.split(']')[0].length + 1, 60);
    assert.match(texts(runGuest(win, 'dism /online /cleanup-image /checkhealth')), /No component store corruption detected/);
  }
  const ws = bootGuest(vm('ws01'));
  // Winbows PowerShell 5.1 has no &&: the parse error, nothing runs, the line is not kept.
  const chained = runGuest(ws, 'sfc /scannow && dism /online /cleanup-image /restorehealth');
  assert.match(texts(chained), /not a valid statement separator/);
  assert.equal(chained.echo, null);
  const both = runGuest(ws, 'sfc /scannow; dism /online /cleanup-image /restorehealth');
  assert.equal(both.echo, 'sfc /scannow; dism /online /cleanup-image /restorehealth');
  assert.match(texts(both), /integrity violations[\s\S]*restore operation completed/);
  // Unknown switches are never repeated; Linux machines have neither tool.
  for (const odd of [runGuest(ws, 'sfc /hunter2x'), runGuest(ws, 'dism /online /hunter2x')]) {
    assert.ok(odd.echo === null && !texts(odd).includes('hunter2x'));
  }
  assert.match(texts(runGuest(bootGuest(vm('ubuntu-blue')), 'sfc /scannow')), /command not found/);
  // help is a Name / Synopsis table; each command's -? has its switches.
  assert.match(texts(runGuest(ws, 'help')), /^sfc +Scan the system files/m);
  // DISM and sfc answer -? with their own help (tests/dism.test.mjs has more).
  assert.match(texts(runGuest(ws, 'dism -?')), /DISM\.exe \/Online \/Cleanup-Image \/\?/);
});
