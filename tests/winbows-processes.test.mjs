// Layer 2: the Winbows VMs' process tools (features/guest-engine.js) and the blue screen
// easter egg they lead to. Fixed process table; unknown names are never repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { VMS } = await import('../site/assets/js/data/commands.js');
const { bootGuest, runGuest } = await import('../site/assets/js/features/guest-engine.js');

const ws = () => bootGuest(VMS.find((vm) => vm.id === 'ws01'));
const texts = (result) => result.lines.map((line) => line.text).join('\n');

test('tasklist and Get-Process list the same fixed processes', () => {
  const g = ws();
  const list = runGuest(g, 'tasklist');
  assert.match(texts(list), /Image Name\s+PID Session Name/);
  assert.match(texts(list), /csrss\.exe\s+612 Services/);
  for (const alias of ['get-process', 'ps', 'gps']) assert.match(texts(runGuest(g, alias)), /ProcessName[\s\S]*csrss/);
});

test('force-ending a critical process blue-screens the VM; others do not', () => {
  for (const line of ['taskkill /f /im csrss.exe', 'TASKKILL /IM lsass.exe /F', 'taskkill /pid 612 /f', 'Stop-Process -Name wininit -Force', 'kill -name svchost']) {
    assert.equal(runGuest(ws(), line).event, 'crash', line);
  }
  const gentle = runGuest(ws(), 'taskkill /im csrss.exe');
  assert.equal(gentle.event, undefined);
  assert.match(texts(gentle), /only be terminated forcefully/);
  assert.match(texts(runGuest(ws(), 'taskkill /f /pid 4')), /Access is denied/);
  assert.match(texts(runGuest(ws(), 'taskkill /pid 0')), /critical system process/);
  assert.match(texts(runGuest(ws(), 'taskkill /f /im msmpeng.exe')), /Access is denied/);
  assert.equal(runGuest(ws(), 'taskkill /f /im explorer.exe').event, undefined);
  assert.equal(runGuest(ws(), 'taskkill /f /im powershell.exe').event, 'close-console');
  // A ; line stops at the blue screen.
  const chained = runGuest(ws(), 'taskkill /f /im csrss.exe; tasklist');
  assert.equal(chained.event, 'crash');
  assert.doesNotMatch(texts(chained), /Image Name/);
});

test('unknown processes and switches are never repeated', () => {
  for (const line of ['taskkill /f /im hunter2x.exe', 'taskkill /hunter2x', 'stop-process -name hunter2x', 'tasklist /hunter2x']) {
    const result = runGuest(ws(), line);
    assert.equal(result.echo, null, line);
    assert.ok(!texts(result).includes('hunter2x'), line);
    assert.equal(result.event, undefined);
  }
  // Linux machines have none of it.
  assert.match(texts(runGuest(bootGuest(VMS.find((vm) => vm.id === 'web01')), 'taskkill /f /im csrss.exe')), /not found/);
});
