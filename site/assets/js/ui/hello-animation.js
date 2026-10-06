// "hello world" easter egg: an ASCII animation played inside a shell window.
// Typewriter compile lines, a sliding banner, then a steaming cup of coffee. Everything is
// authored text from data/hello.js, rendered with textContent. When it finishes, the
// final frame is printed into the shell's history (so it persists like any output)
// and the prompt comes back. Reduced motion prints the final result at once.

import { LANGUAGES, BANNER, STEAM, CUP, OUTRO } from '../data/hello.js';

const SPINNER = ['|', '/', '-', '\\'];

function languageLine([name, code]) {
  return `  [${name}]`.padEnd(15) + code;
}

// The static result kept in the shell history.
export function finalLines() {
  return [
    { kind: 'ok', text: '[ ok ] compiled hello_world in 7 languages' },
    ...LANGUAGES.map((lang) => ({ kind: 'out', text: languageLine(lang) })),
    { kind: 'out', text: '' },
    ...BANNER.map((text) => ({ kind: 'art', text })),
    ...STEAM[0].map((text) => ({ kind: 'out', text })),
    ...CUP.map((text) => ({ kind: 'art', text })),
    { kind: 'out', text: '' },
    ...OUTRO.map(([kind, text]) => ({ kind, text })),
  ];
}

const wait = (ms) => new Promise((resolve) => { window.setTimeout(resolve, ms); });

export async function playHello(shell, { reducedMotion = false } = {}) {
  if (reducedMotion) {
    shell.print(finalLines());
    return;
  }
  shell.setBusy(true);
  const alive = () => shell.alive();

  // 1. Compile spinner.
  const head = shell.live('ok');
  for (let i = 0; i < 10 && alive(); i += 1) {
    head.set(`[ ${SPINNER[i % SPINNER.length]} ] compiling hello_world across 7 languages`);
    await wait(70);
  }

  // 2. Each language types itself out.
  for (const lang of LANGUAGES) {
    if (!alive()) return;
    const text = languageLine(lang);
    const line = shell.live('out');
    for (let end = 0; end <= text.length && alive(); end += 3) {
      line.set(text.slice(0, end));
      await wait(14);
    }
    line.set(`${text}   ok`);
  }
  head.set('[ ok ] compiled hello_world in 7 languages');
  shell.live('out').set('');

  // 3. Banner slides in from the right.
  const banner = shell.block('art');
  for (let offset = 48; offset >= 0 && alive(); offset -= 4) {
    banner.set(BANNER.map((text) => (' '.repeat(offset) + text).slice(0, 64)));
    await wait(40);
  }
  banner.set(BANNER);
  await wait(250);

  // 4. A hot cup of coffee, steaming.
  const cup = shell.block('art');
  for (let i = 0; i < 16 && alive(); i += 1) {
    cup.set([...STEAM[i % STEAM.length], ...CUP]);
    await wait(180);
  }

  // 5. Outro types out.
  shell.live('out').set('');
  for (const [kind, text] of OUTRO) {
    if (!alive()) return;
    const line = shell.live(kind);
    for (let end = 0; end <= text.length && alive(); end += 2) {
      line.set(text.slice(0, end));
      await wait(16);
    }
    line.set(text);
  }

  if (!alive()) return;
  await wait(300);
  shell.clearLive();
  shell.print(finalLines());
  shell.setBusy(false);
  shell.focus();
}
