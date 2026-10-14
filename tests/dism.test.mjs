// DISM and sfc on the Winbows VMs (owner report, October 12, 2026): names typed as
// DISM.exe or in any case work, DISM's own /? help answers, and the component store can be
// analysed and cleaned. Switches are fixed words; anything else is never repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');

function boot(id = 'ws01') {
  const guest = bootGuest(VMS.find((vm) => vm.id === id));
  guest.running = () => true;
  guest.scenario = () => [];
  return guest;
}
const texts = (result) => result.lines.map((line) => line.text).join('\n');

test('DISM.exe, sfc.exe and ipconfig.exe run by file name, in any case', () => {
  const ws = boot();
  for (const [line, echo] of [
    ['DISM.exe /Online /Cleanup-Image /RestoreHealth', 'dism /online /cleanup-image /restorehealth'],
    ['dism.EXE /online /cleanup-image /checkhealth', 'dism /online /cleanup-image /checkhealth'],
    ['Dism /ONLINE /CLEANUP-IMAGE /SCANHEALTH', 'dism /online /cleanup-image /scanhealth'],
    ['SFC.EXE /SCANNOW', 'sfc /scannow'],
    ['ipconfig.exe', 'ipconfig'],
  ]) {
    const result = runGuest(ws, line);
    assert.equal(result.failed, false, line);
    assert.equal(result.echo, echo, line);
  }
  // Only the command word loses .exe, and only for commands this machine has.
  assert.equal(runGuest(ws, 'notepad.exe').failed, true);
  assert.equal(runGuest(ws, 'dism.exe.exe').failed, true);
});

test("DISM /? and /Cleanup-Image /? print DISM's own help", () => {
  const ws = boot();
  const help = runGuest(ws, 'DISM.exe /?');
  assert.equal(help.failed, false);
  assert.match(texts(help), /Deployment Image Servicing and Management tool/);
  assert.match(texts(help), /\/Cleanup-Image\s+- Performs cleanup/);
  // Every action is listed in the top-level help (owner report: /RestoreHealth was missing).
  for (const action of ['CheckHealth', 'ScanHealth', 'RestoreHealth', 'AnalyzeComponentStore', 'StartComponentCleanup']) assert.match(texts(help), new RegExp(`/${action}\\s+- `), action);
  const cleanup = runGuest(ws, 'dism /online /cleanup-image /?');
  assert.equal(cleanup.echo, 'dism /online /cleanup-image /?');
  assert.match(texts(cleanup), /\/AnalyzeComponentStore/);
  assert.match(texts(runGuest(ws, 'sfc /?')), /SFC \[\/SCANNOW\] \[\/VERIFYONLY\]/);
  assert.equal(runGuest(ws, 'sfc /?').failed, false);
  // The error still points at DISM.exe /?, which now answers.
  const bad = runGuest(ws, 'dism /online /cleanup-image /hunter2');
  assert.equal(bad.failed, true);
  assert.match(texts(bad), /Error: 87/);
  assert.ok(!texts(bad).includes('hunter2'));
  assert.match(texts(runGuest(ws, 'dism /online /cleanup-image')), /needs one of \/CheckHealth/);
});

test('the component store: analyse, clean up, analyse again', () => {
  const ws = boot();
  const before = texts(runGuest(ws, 'dism /online /cleanup-image /analyzecomponentstore'));
  assert.match(before, /Component Store Cleanup Recommended : Yes/);
  assert.match(texts(runGuest(ws, 'DISM /Online /Cleanup-Image /StartComponentCleanup')), /The operation completed successfully\./);
  const after = texts(runGuest(ws, 'dism /online /cleanup-image /analyzecomponentstore'));
  assert.match(after, /Number of Reclaimable Packages : 0/);
  assert.match(after, /Component Store Cleanup Recommended : No/);
  // Each machine keeps its own store.
  assert.match(texts(runGuest(boot('dc01'), 'dism /online /cleanup-image /analyzecomponentstore')), /Recommended : Yes/);
});
