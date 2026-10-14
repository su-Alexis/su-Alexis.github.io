// Layer 2: guest desktops (owner requests, October 8 and 9, 2026). Used by
// layers/layer2.js for every VM: Winbows (ws01), ParrotOS (parrot01) and Ubuntu
// (ubuntu-blue, ubuntu-red).
//
// Each desktop powers on with its own boot, signs the VM's user in automatically with an
// animation, then shows the desktop with app windows that live inside the VM's screen.
//   - Ubuntu: the Ubuntu splash, the GDM login, then GNOME: the top bar with Activities,
//     the clock and the system menu, the Ubuntu Dock, the app grid. Apps: Terminal, Files,
//     Text Editor, Settings (About), Trash, and Tickets where the VM seats a mission.
//   - Winbows: boot logo and spinner, "Welcome" sign-in, desktop icons, a taskbar with a
//     start menu and a clock. Apps: PowerShell, File Explorer, Notepad, Recycle Bin, and the
//     browsers from ui/guest-browser.js: Firecat and Exploredge (the server has
//     Exploredge only, as Winbows Server 2022 does).
//   - ParrotOS: a GRUB menu that counts down, the Parrot splash, a login greeter typing
//     the password, then a MATE-style desktop: a top panel with Applications / Places /
//     System menus and a clock, a bottom window list, desktop icons. Apps: Terminal,
//     Files, Text Editor, Trash.
// The terminal app is the VM's console (features/guest-engine.js), the same one the
// session keeps, so its folder and lines carry on. The file apps browse the VM's file tree
// and make folders; text files open in each OS's editor (ui/guest-editor.js: Notepad,
// Text Editor, Pluma), which saves in the user's home. Saved files and folders last for
// the session (onFilesChanged, layers/layer2.js). Tool menus are labels until the lab
// network segment.
// A VM coming back from suspend skips the boot and sign-in. Reduced motion skips them too.
//
// Everything is text and fixed elements through utils/dom.js. App windows are placed and
// sized in percentages of the desktop (left/top/width/height only, clamped to 0-100,
// doctrine section 9), so resizing the VM window scales them with it instead of leaving
// them cut off (owner bug report, October 9, 2026). destroy() clears every timer and
// listener (doctrine section 6).

import { el } from '../utils/dom.js';
import { children, nameOf, nodeAt, showPath, makeDir, saveFile, taskList, endTask } from '../features/guest-engine.js';
import { createBrowser } from './guest-browser.js';
import { createEditor } from './guest-editor.js';
import { missionsFor, missionView, checkReport, askView, checkAsk } from '../features/mission-engine.js';
import { missionFlags, scenarioFlags, onProgress } from './lab-progress.js';

// ---------- Shared pieces ----------

// One Tickets app for Winbows, Parrot and Ubuntu. Report drafts contain authored choices
// only; lifecycle cleanup releases its progress subscription when the desktop is destroyed.
// A step with questions (objective.ask, Blue 1) shows them under the step once its action
// is done (seen): fixed choices from askView (worked out from the shared scenario trail),
// checked with checkAsk, and only then sent as an 'answer' result for that step.
export function ticketsApp({ vm, guest, windows, life, changed, onEvent }) {
  const hintLevel = new Map(); // objective id -> how many hints are showing (this visit)
  const answers = new Map(); // Fixed choices only; drafts stay in this desktop instance.
  const feedback = new Map();
  let controls = new Map();
  let body = null;
  let app = null;
  let picked = null;
  const control = (key, node) => { controls.set(key, node); return node; };
  const ready = (view) => view.open && !view.done && view.objectives.every((objective) => objective.done || objective.when.report === view.mission.id);

  // One question's fixed choices as toggle buttons. draft: { questionId: [values] }.
  function questionGroup(question, draft, { disabled, wrong, onChange }) {
    const options = [];
    for (const option of question.options) {
      const button = control('choice-' + question.key + '-' + option.value, el('button', {
        className: 'tk-choice', text: option.label,
        attrs: { 'aria-pressed': String((draft[question.id] || []).includes(option.value)) },
      }));
      button.disabled = disabled;
      button.addEventListener('click', () => {
        const selected = draft[question.id] || [];
        draft[question.id] = question.multiple
          ? (selected.includes(option.value) ? selected.filter((value) => value !== option.value) : [...selected, option.value])
          : [option.value];
        for (const [value, node] of options) node.setAttribute('aria-pressed', String(draft[question.id].includes(value)));
        onChange();
      });
      options.push([option.value, button]);
    }
    return el('div', { className: 'tk-question', attrs: { role: 'group', 'aria-label': question.prompt } }, [
      el('p', { className: 'tk-item-text', text: question.prompt }),
      el('p', { className: 'tk-report-help', text: question.multiple ? 'Choose all that apply.' : 'Choose one.' }),
      ...options.map(([, button]) => button),
      ...(wrong ? [el('p', { className: 'tk-report-error', text: 'Review this answer against your observations.' })] : []),
    ]);
  }

  // A step's questions (objective.ask), shown once its action is done.
  function askBody(mission, objective) {
    const key = mission.id + '/' + objective.id;
    if (!answers.has(key)) answers.set(key, Object.create(null));
    const draft = answers.get(key);
    const result = feedback.get(key);
    const status = control('ask-status-' + objective.id, el('p', { className: 'tk-report-status', text: result?.text || '', attrs: { role: 'status', tabindex: '-1' } }));
    const questions = askView(mission, objective, scenarioFlags()).map((question) => questionGroup({ ...question, key: objective.id + '-' + question.id }, draft, {
      disabled: false,
      wrong: result?.wrong?.includes(question.id),
      onChange: () => {
        feedback.delete(key);
        status.textContent = 'Answers changed. Check them when ready.';
      },
    }));
    const submit = control('ask-submit-' + objective.id, el('button', { className: 'fm-button tk-report-submit', text: 'Check answers' }));
    submit.addEventListener('click', () => {
      // Recheck live progress: a stale window cannot answer a closed or finished step.
      const live = missionView(missionFlags(), mission).objectives.find((entry) => entry.id === objective.id);
      if (!live || !live.seen || live.done) return;
      const checked = checkAsk(mission, objective, draft, scenarioFlags());
      if (!checked.ok) {
        feedback.set(key, { text: 'Not quite. Review the marked questions.', wrong: checked.wrong });
        redrawTickets('ask-status-' + objective.id);
        return;
      }
      // Say so right here as well as in the desktop's pop-up (owner report, October 12,
      // 2026: a right answer on Ubuntu gave no visible sign in the ticket itself).
      feedback.set(key, { text: 'Correct. Step complete.', ok: true });
      answers.delete(key);
      onEvent('answer', objective.id);
      redrawTickets();
    });
    return el('div', { className: 'tk-ask' }, [...questions, submit, status]);
  }

  function reportBody(mission, view) {
    if (!answers.has(mission.id)) answers.set(mission.id, Object.create(null));
    const draft = answers.get(mission.id);
    const result = feedback.get(mission.id);
    const status = control('report-status', el('p', { className: 'tk-report-status', text: result?.text || (view.done ? 'Report accepted.' : ''), attrs: { role: 'status', tabindex: '-1' } }));
    const questions = mission.report.questions.map((question) => questionGroup({ ...question, key: question.id }, draft, {
      disabled: !view.open || view.done,
      wrong: result?.wrong?.includes(question.id),
      onChange: () => {
        feedback.delete(mission.id);
        status.textContent = 'Answers changed. Check and save when ready.';
      },
    }));
    const submit = control('report-submit', el('button', { className: 'fm-button tk-report-submit', text: 'Check and save report' }));
    submit.disabled = !ready(view);
    submit.addEventListener('click', () => {
      // Recheck live progress: a stale window cannot submit a locked or finished ticket.
      if (!ready(missionView(missionFlags(), mission))) return;
      const checked = checkReport(mission, draft);
      if (!checked.ok) {
        feedback.set(mission.id, { text: 'Report not saved. Review the marked questions.', wrong: checked.wrong });
        redrawTickets('report-status');
        return;
      }
      // Save through the guest's bounded file API, then send the same events as the editor.
      // No report flag is granted if the file cannot be saved (for example, a full home).
      const text = [mission.report.title, '', ...mission.report.questions.flatMap((question) => [
        question.prompt,
        ...question.options.filter((option) => (draft[question.id] || []).includes(option.value)).map((option) => '- ' + option.label), '',
      ])].join('\n');
      const segments = mission.report.path.split('/');
      const saved = saveFile(guest, segments.slice(0, -1), segments.at(-1), text);
      if (!saved.ok) {
        feedback.set(mission.id, { text: 'Could not save /' + mission.report.path + ' (' + saved.error + '). Check the destination in Files and try again.' });
        redrawTickets('report-status');
        return;
      }
      feedback.set(mission.id, { text: 'Report accepted and saved to /' + mission.report.path + '.' });
      changed();
      onEvent('report', mission.id);
      redrawTickets('report-status');
    });
    return el('section', { className: 'tk-report', attrs: { 'aria-label': mission.report.title } }, [
      el('h3', { text: mission.report.title }),
      el('p', { className: 'tk-report-help', text: 'Saves to /' + mission.report.path + '. Checking and saving replaces any existing report at that path.' }),
      ...(view.done ? [] : questions),
      ...(!ready(view) && !view.done ? [el('p', { className: 'tk-report-help', text: 'Complete the preceding ticket steps before submitting.' })] : []),
      ...(view.done ? [] : [submit]), status,
    ]);
  }
  function ticketsBody() {
    controls = new Map();
    const flags = missionFlags();
    const missions = missionsFor(vm.id);
    if (!picked && missions.length) picked = missions[0].id;
    const list = el('div', { className: 'tk-list' }, missions.map((mission) => {
      const view = missionView(flags, mission);
      const row = el('button', { className: `tk-row${mission.id === picked ? ' is-picked' : ''}` }, [
        el('span', { className: 'tk-number', text: `#${mission.ticket}` }),
        el('span', { className: 'tk-title', text: mission.title }),
        el('span', { className: `tk-status${view.done ? ' is-done' : ''}`, text: view.done ? 'Resolved' : view.open ? 'Open' : 'Locked' }),
      ]);
      control(`ticket-${mission.id}`, row);
      row.setAttribute('aria-pressed', String(mission.id === picked));
      row.addEventListener('click', () => {
        if (picked === mission.id) return;
        picked = mission.id;
        body.scrollTop = 0;
        body.querySelector('.tk-detail').scrollTop = 0;
        redrawTickets();
      });
      return row;
    }));
    const mission = missions.find((entry) => entry.id === picked);
    const detail = el('div', { className: 'tk-detail', attrs: { tabindex: '-1' } });
    if (mission) {
      const view = missionView(flags, mission);
      detail.append(
        el('p', { className: 'tk-head', text: `Ticket #${mission.ticket}  ·  from ${mission.from}  ·  ${view.done ? 'Resolved' : view.open ? 'Open' : 'Locked'}` }),
        ...(!view.open ? [el('p', { className: 'tk-locked', text: 'Locked: complete the preceding ticket to unlock this one.' })] : []),
        el('h2', { className: 'tk-name', text: mission.title }),
        ...mission.briefing.map((text) => el('p', { className: 'tk-text', text })),
        el('ul', { className: 'tk-checklist' }, view.objectives.map((objective) => {
          const shown = hintLevel.get(objective.id) || 0;
          const hint = el('button', { className: 'fm-button tk-hint', text: shown >= objective.hints.length ? 'No more hints' : 'Hint' });
          control(`hint-${objective.id}`, hint);
          hint.disabled = objective.done || shown >= objective.hints.length;
          hint.addEventListener('click', () => {
            hintLevel.set(objective.id, shown + 1);
            redrawTickets();
          });
          return el('li', { className: `tk-item${objective.done ? ' is-done' : ''}` }, [
            el('span', { className: 'tk-box', text: objective.done ? '☑' : '☐', attrs: { 'aria-label': objective.done ? 'done' : 'to do' } }),
            el('div', { className: 'tk-item-body' }, [
              el('p', { className: 'tk-item-text', text: objective.text }),
              ...(objective.done ? [] : objective.hints.slice(0, shown).map((text, i) => el('p', { className: 'tk-hint-text', text: `Hint ${i + 1}: ${text}` }))),
              ...(objective.seen && !objective.done && view.open ? [askBody(mission, objective)] : []),
              ...(objective.done && feedback.get(`${mission.id}/${objective.id}`)?.ok ? [el('p', { className: 'tk-correct', text: feedback.get(`${mission.id}/${objective.id}`).text, attrs: { role: 'status' } })] : []),
            ]),
            ...(objective.done ? [] : [hint]),
          ]);
        })),
        ...(mission.report ? [reportBody(mission, view)] : []),
        ...(view.done ? [el('p', { className: 'tk-closing', text: mission.closing })] : []),
      );
    }
    return el('div', { className: 'tk' }, [list, detail]);
  }
  function redrawTickets(focusKey) {
    if (!windows.isOpen('tickets')) return;
    const focused = typeof focusKey === 'string' ? focusKey : [...controls].find(([, node]) => node === document.activeElement)?.[0];
    const scroll = body?.querySelector('.tk-detail')?.scrollTop || 0;
    const outerScroll = body?.scrollTop || 0;
    body = ticketsBody();
    // Updating a checklist must not raise or unminimize Tickets over the terminal.
    windows.retitle(app, 'Tickets', body);
    body.querySelector('.tk-detail').scrollTop = scroll;
    body.scrollTop = outerScroll;
    if (focused) {
      const next = controls.get(focused);
      (next && !next.disabled ? next : body.querySelector('.tk-detail')).focus({ preventScroll: typeof focusKey !== 'string' });
    }
  }
  function openTickets() {
    if (windows.isOpen('tickets')) {
      windows.open('tickets');
      return;
    }
    body = ticketsBody();
    // A comfortable first size (owner request, October 13, 2026: it used to fill the desktop).
    app = windows.open('tickets', 'Tickets', body, box(0.14, 0.06, 0.64, 0.8));
    controls.get(`ticket-${picked}`)?.focus();
  }
  life.onDestroy(onProgress(redrawTickets));
  return openTickets;
}

// Timers and listeners that destroy() clears.
// A notification in the corner of a Parrot or Ubuntu desktop (mission progress from
// layers/layer2.js, which calls the desktop's notify). Text only; it hides itself.
function desktopToast(desktop, life, className) {
  const toast = el('div', { className: `win-toast ${className}`, attrs: { role: 'status' } });
  toast.hidden = true;
  desktop.append(toast);
  let shown = 0;
  return (text) => {
    toast.textContent = text;
    toast.hidden = false;
    const mine = ++shown;
    life.later(() => {
      if (mine === shown) toast.hidden = true;
    }, 4000);
  };
}

function lifecycle() {
  const timers = [];
  const intervals = [];
  const cleanups = [];
  return {
    later: (fn, ms) => timers.push(window.setTimeout(fn, ms)),
    every: (fn, ms) => intervals.push(window.setInterval(fn, ms)),
    listen(target, type, handler) {
      target.addEventListener(type, handler);
      cleanups.push(() => target.removeEventListener(type, handler));
    },
    // Any other cleanup (a progress subscription).
    onDestroy: (fn) => cleanups.push(fn),
    destroy() {
      for (const timer of timers) window.clearTimeout(timer);
      for (const interval of intervals) window.clearInterval(interval);
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}

// Shares of the desktop, as percentages.
const box = (left, upper, width, height) => ({ x: left * 100, y: upper * 100, w: width * 100, h: height * 100 });

// App windows inside a desktop area, with buttons in a task list. consoleId names the app
// that holds the VM's console: closing it keeps the console (it is the VM's, not the
// window's). onChange() runs whenever an app opens, closes or comes forward (the Ubuntu
// Dock's running dots).
function appWindows({ area, tasks, consoleNode, consoleId, onChange = () => {} }) {
  // Applies a placement in percent of the desktop. Every number is finite and clamped so a
  // window always stays on the desktop: its width and left together never pass 100.
  const pct = (value, max) => Math.round(Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0)) * 100) / 100;
  function place(win, { x, y, w, h }) {
    if (w !== undefined) win.style.width = `${pct(w, 100)}%`;
    if (h !== undefined) win.style.height = `${pct(h, 100)}%`;
    const width = parseFloat(win.style.width) || 0;
    if (x !== undefined) win.style.left = `${pct(x, 100 - width)}%`;
    if (y !== undefined) win.style.top = `${pct(y, 96)}%`;
  }
  const apps = new Map(); // app id -> { win, button }
  let top = null;
  const raise = (id) => {
    for (const [other, app] of apps) app.win.classList.toggle('is-top', other === id);
    for (const [other, app] of apps) app.button.classList.toggle('is-active', other === id && !app.win.hidden);
    top = id;
    onChange();
  };
  const close = (id) => {
    const app = apps.get(id);
    if (!app) return;
    if (id === consoleId) consoleNode.remove();
    app.win.remove();
    app.button.remove();
    apps.delete(id);
    if (top === id) top = null;
    onChange();
  };

  function open(id, title, body, placement) {
    if (apps.has(id)) {
      const app = apps.get(id);
      app.win.hidden = false;
      raise(id);
      return app;
    }
    const minimize = el('button', { className: 'win-app-button', text: '_', attrs: { 'aria-label': `Minimize ${title}` } });
    const maximize = el('button', { className: 'win-app-button win-app-max', text: '□', attrs: { 'aria-label': `Maximize ${title}` } });
    const shut = el('button', { className: 'win-app-button win-app-close', text: 'x', attrs: { 'aria-label': `Close ${title}` } });
    const bar = el('div', { className: 'win-app-bar' }, [el('span', { className: 'win-app-title', text: title }), minimize, maximize, shut]);
    // Resize grips on every edge and corner (owner bug reports, October 10 and 11, 2026).
    const EDGES = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
    const grips = EDGES.map((edge) => el('span', { className: `win-app-grip win-app-grip-${edge}`, attrs: { 'aria-hidden': 'true' } }));
    const win = el('section', { className: 'win-app', attrs: { 'aria-label': title } }, [bar, el('div', { className: 'win-app-body' }, [body]), ...grips]);
    const button = el('button', { className: 'win-task-app', text: title });
    place(win, placement);
    area.appendChild(win);
    tasks.appendChild(button);
    const app = { win, button };
    apps.set(id, app);
    minimize.addEventListener('click', () => {
      win.hidden = true;
      raise(null);
    });
    shut.addEventListener('click', () => close(id));
    button.addEventListener('click', () => {
      if (!win.hidden && top === id) {
        win.hidden = true;
        raise(null);
      } else {
        win.hidden = false;
        raise(id);
      }
    });
    win.addEventListener('pointerdown', () => raise(id));
    // Maximize fills the desktop and remembers the place to restore; the button or a
    // double-click on the title bar toggles it. A maximized window neither drags nor resizes.
    let restore = null;
    const toggleMax = () => {
      if (restore) {
        place(win, restore);
        restore = null;
      } else {
        restore = { x: parseFloat(win.style.left) || 0, y: parseFloat(win.style.top) || 0, w: parseFloat(win.style.width) || 50, h: parseFloat(win.style.height) || 50 };
        place(win, { x: 0, y: 0, w: 100, h: 100 });
      }
      const maxed = Boolean(restore);
      win.classList.toggle('is-maximized', maxed);
      maximize.textContent = maxed ? '❐' : '□';
      maximize.setAttribute('aria-label', `${maxed ? 'Restore' : 'Maximize'} ${title}`);
    };
    maximize.addEventListener('click', toggleMax);
    bar.addEventListener('dblclick', (event) => {
      if (!event.target.closest('button')) toggleMax();
    });
    // Resize from a grip: pixels while dragging, kept as shares of the desktop. A north or
    // west edge moves the window's top or left with it, so the opposite edge stays put;
    // every size is clamped to the desktop and a minimum of 220 x 140.
    grips.forEach((grip, n) => {
      const edge = EDGES[n];
      let size = null;
      grip.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || restore) return;
        size = { id: event.pointerId, x: event.clientX, y: event.clientY, l: win.offsetLeft, t: win.offsetTop, w: win.offsetWidth, h: win.offsetHeight };
        try {
          grip.setPointerCapture(event.pointerId);
        } catch {
          // Already released: the resize ends on the next pointerup.
        }
        event.preventDefault();
        event.stopPropagation();
      });
      grip.addEventListener('pointermove', (event) => {
        if (!size || event.pointerId !== size.id) return;
        const width = area.clientWidth || 1;
        const height = area.clientHeight || 1;
        const dx = event.clientX - size.x;
        const dy = event.clientY - size.y;
        let { l, t, w, h } = size;
        if (edge.includes('e')) w = Math.max(220, Math.min(width - l, size.w + dx));
        if (edge.includes('s')) h = Math.max(140, Math.min(height - t, size.h + dy));
        if (edge.includes('w')) {
          l = Math.max(0, Math.min(size.l + size.w - 220, size.l + dx));
          w = size.l + size.w - l;
        }
        if (edge.includes('n')) {
          t = Math.max(0, Math.min(size.t + size.h - 140, size.t + dy));
          h = size.t + size.h - t;
        }
        place(win, { x: (l / width) * 100, y: (t / height) * 100, w: (w / width) * 100, h: (h / height) * 100 });
      });
      const stop = () => {
        size = null;
      };
      grip.addEventListener('pointerup', stop);
      grip.addEventListener('pointercancel', stop);
    });
    // Drag by the title bar, kept inside the desktop.
    let drag = null;
    bar.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button') || restore) return;
      drag = { id: event.pointerId, dx: event.clientX - win.offsetLeft, dy: event.clientY - win.offsetTop };
      try {
        bar.setPointerCapture(event.pointerId);
      } catch {
        // Already released: the drag ends on the next pointerup.
      }
      event.preventDefault();
    });
    bar.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      // Pixels while dragging, kept as a share of the desktop so it still fits after a resize.
      const width = area.clientWidth || 1;
      const height = area.clientHeight || 1;
      const x = Math.min(width - win.offsetWidth, Math.max(0, event.clientX - drag.dx));
      const y = Math.min(height - 28, Math.max(0, event.clientY - drag.dy));
      place(win, { x: (x / width) * 100, y: (y / height) * 100 });
    });
    const end = () => {
      drag = null;
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    raise(id);
    return app;
  }

  // Renames an open app (a browser showing another page).
  function rename(app, title) {
    app.win.querySelector('.win-app-title').textContent = title;
    app.win.setAttribute('aria-label', title);
    app.button.textContent = title;
  }

  // Replaces an open app's title and body (one viewer showing another file).
  function retitle(app, title, body) {
    app.win.querySelector('.win-app-title').textContent = title;
    app.win.setAttribute('aria-label', title);
    app.button.textContent = title;
    app.win.querySelector('.win-app-body').replaceChildren(body);
  }

  return { open, retitle, rename, close, isOpen: (id) => apps.has(id) };
}


// New folder in the file managers (owner request, October 10, 2026): a name field under
// the toolbar; the engine checks the name and the place (makeDir), and onFilesChanged()
// keeps it for the session. Messages are fixed text, never the typed name.
const FOLDER_PROBLEMS = Object.freeze({
  name: 'That name is not valid.',
  exists: 'A folder or file with that name already exists.',
  denied: 'You do not have permission to make a folder here.',
  full: 'There is no room for more folders.',
  missing: 'This folder no longer exists.',
});

// ---------- File Explorer (Winbows 11 look; ws01 and dc01) ----------
// Owner request, October 11, 2026: Explorer should look like the real one. A tab strip, a
// row with back/forward/up/refresh, the breadcrumb address bar and a search box, the
// command bar, the navigation pane (Home, Gallery, the user's folders, This PC), and the
// Details view with Name, Date modified, Type and Size. Returns { node, show, refresh }.
// Everything is drawn as text and CSS shapes (css/layer2.css .wx-*), no images.
// Search only filters the names shown in this folder; what is typed is never kept, shown
// back or sent anywhere. Commands with no simulated effect (cut, copy, paste, rename,
// share, delete, sort, view) are shown disabled, as Explorer greys them with nothing
// selected that they apply to.
const WX_FOLDERS = Object.freeze([
  { name: 'Desktop', icon: 'desktop' }, { name: 'Downloads', icon: 'downloads' }, { name: 'Documents', icon: 'documents' },
  { name: 'Pictures', icon: 'pictures' }, { name: 'Music', icon: 'music' }, { name: 'Videos', icon: 'videos' },
]);
const WX_TYPES = Object.freeze({ txt: 'Text Document', png: 'PNG File', log: 'Text Document', ps1: 'Winbows PowerShell Script', md: 'Markdown Source File', js: 'JavaScript Source File' });
// Authored files carry the lab's install date; files made this session carry when the
// Explorer first saw them.
const WX_INSTALLED = '10/8/2026 9:14 AM';
const wxDate = (when) => {
  const hours = ((when.getHours() + 11) % 12) + 1;
  return `${when.getMonth() + 1}/${when.getDate()}/${when.getFullYear()} ${hours}:${String(when.getMinutes()).padStart(2, '0')} ${when.getHours() < 12 ? 'AM' : 'PM'}`;
};
function windowsExplorer(guest, start, openFile, { onFilesChanged = () => {} } = {}) {
  const seen = new WeakMap(); // node -> the date shown for a file made this session
  const dateOf = (node) => {
    if (!node.made) return WX_INSTALLED;
    if (!seen.has(node)) seen.set(node, wxDate(new Date()));
    return seen.get(node);
  };
  const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
  const typeOf = (node) => (node.dir ? 'File folder' : Object.hasOwn(WX_TYPES, extOf(nameOf(node))) ? WX_TYPES[extOf(nameOf(node))] : `${extOf(nameOf(node)).toUpperCase() || 'File'} File`.trim());
  const sizeOf = (node) => (node.dir ? '' : `${Math.max(1, Math.ceil((node.content || '').length / 1024))} KB`);
  const iconFor = (node) => el('span', { className: `wx-icon ${node.dir ? 'is-folder' : extOf(nameOf(node)) === 'png' ? 'is-image' : 'is-file'}`, attrs: { 'aria-hidden': 'true' } });
  const button = (label, className, glyph = '') => el('button', { className: `wx-button ${className}`, attrs: { 'aria-label': label, title: label } }, glyph ? [el('span', { className: 'wx-glyph', text: glyph, attrs: { 'aria-hidden': 'true' } })] : []);

  let current = [...start];
  const back = [];
  const forward = [];
  let filter = '';

  // ---- Tab strip ----
  const tabName = el('span', { className: 'wx-tab-name' });
  const tabs = el('div', { className: 'wx-tabs' }, [
    el('div', { className: 'wx-tab' }, [el('span', { className: 'wx-icon is-folder is-small', attrs: { 'aria-hidden': 'true' } }), tabName]),
    el('span', { className: 'wx-tab-add', text: '+', attrs: { 'aria-hidden': 'true' } }),
  ]);
  // ---- Navigation row ----
  const backButton = button('Back', 'wx-nav', '←');
  const forwardButton = button('Forward', 'wx-nav', '→');
  const upButton = button('Up to the parent folder', 'wx-nav', '↑');
  const refreshButton = button('Refresh', 'wx-nav', '⟳');
  const crumbs = el('div', { className: 'wx-crumbs', attrs: { role: 'navigation', 'aria-label': 'Address' } });
  const search = el('input', { className: 'wx-search-input', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64' } });
  const searchHint = el('span', { className: 'wx-search-hint', attrs: { 'aria-hidden': 'true' } });
  const nav = el('div', { className: 'wx-navrow' }, [
    backButton, forwardButton, upButton, refreshButton,
    el('div', { className: 'wx-address' }, [el('span', { className: 'wx-pc', attrs: { 'aria-hidden': 'true' } }), crumbs]),
    el('div', { className: 'wx-search' }, [searchHint, search, el('span', { className: 'wx-glyph', text: '⌕', attrs: { 'aria-hidden': 'true' } })]),
  ]);
  // ---- Command bar ----
  const newButton = el('button', { className: 'wx-button wx-new' }, [el('span', { className: 'wx-glyph', text: '⊕', attrs: { 'aria-hidden': 'true' } }), el('span', { text: 'New folder' })]);
  const off = (label, glyph) => {
    const node = button(label, 'wx-cmd', glyph);
    node.disabled = true;
    return node;
  };
  const textOff = (label, glyph) => {
    const node = el('button', { className: 'wx-button wx-cmd wx-cmd-text' }, [el('span', { className: 'wx-glyph', text: glyph, attrs: { 'aria-hidden': 'true' } }), el('span', { text: label })]);
    node.disabled = true;
    return node;
  };
  const commands = el('div', { className: 'wx-commands' }, [
    newButton, el('span', { className: 'wx-sep' }),
    off('Cut', '✂'), off('Copy', '⧉'), off('Paste', '⎘'), off('Rename', '✎'), off('Share', '⇪'), off('Delete', '🗑'),
    el('span', { className: 'wx-sep' }), textOff('Sort', '⇅'), textOff('View', '☰'), off('See more', '⋯'),
  ]);
  // ---- New folder (the engine checks the name and the place, as before) ----
  const field = el('input', { className: 'fm-name', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64', 'aria-label': 'Folder name' } });
  const create = el('button', { className: 'fm-button', text: 'Create' });
  const cancel = el('button', { className: 'fm-button', text: 'Cancel' });
  const problem = el('p', { className: 'fm-problem', attrs: { role: 'alert' } });
  const namer = el('div', { className: 'fm-new wx-namer' }, [field, create, cancel, problem]);
  namer.hidden = true;
  newButton.addEventListener('click', () => {
    namer.hidden = false;
    field.value = '';
    problem.textContent = '';
    field.focus({ preventScroll: true });
  });
  const make = () => {
    const made = makeDir(guest, current, field.value.trim());
    if (!made.ok) {
      problem.textContent = FOLDER_PROBLEMS[made.error] || FOLDER_PROBLEMS.name;
      return;
    }
    namer.hidden = true;
    onFilesChanged();
    render();
  };
  create.addEventListener('click', make);
  cancel.addEventListener('click', () => {
    namer.hidden = true;
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') make();
    else if (event.key === 'Escape') namer.hidden = true;
  });
  // ---- Navigation pane ----
  const pane = el('nav', { className: 'wx-pane', attrs: { 'aria-label': 'Navigation pane' } });
  const paths = new Map(); // pane item -> the folder it opens (its tree key)
  const paneItem = (label, icon, segments, pinned = false) => {
    const item = el('button', { className: 'wx-pane-item' }, [
      el('span', { className: `wx-pane-icon is-${icon}`, attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'wx-pane-label', text: label }),
      ...(pinned ? [el('span', { className: 'wx-pin', text: '📌', attrs: { 'aria-hidden': 'true' } })] : []),
    ]);
    paths.set(item, segments.join('/'));
    item.addEventListener('click', () => go(segments));
    return item;
  };
  const drawPane = () => {
    paths.clear();
    const folders = WX_FOLDERS.filter((folder) => nodeAt(guest, [...guest.home, folder.name]));
    pane.replaceChildren(
      paneItem('Home', 'home', guest.home),
      ...(nodeAt(guest, [...guest.home, 'Pictures']) ? [paneItem('Gallery', 'gallery', [...guest.home, 'Pictures'])] : []),
      el('span', { className: 'wx-pane-sep' }),
      ...folders.map((folder) => paneItem(folder.name, folder.icon, [...guest.home, folder.name], true)),
      el('span', { className: 'wx-pane-sep' }),
      paneItem('This PC', 'pc', []),
    );
    for (const [item, path] of paths) item.classList.toggle('is-current', path === current.join('/'));
  };
  // ---- Details view ----
  const header = el('div', { className: 'wx-row wx-head', attrs: { role: 'row' } }, ['Name', 'Date modified', 'Type', 'Size'].map((text) => el('span', { className: 'wx-col', text, attrs: { role: 'columnheader' } })));
  const rows = el('div', { className: 'wx-rows', attrs: { role: 'rowgroup' } });
  const empty = el('p', { className: 'wx-empty', text: 'This folder is empty.' });
  const status = el('p', { className: 'wx-status' });
  const details = el('div', { className: 'wx-details', attrs: { role: 'grid', 'aria-label': 'Items' } }, [header, rows, empty]);
  const label = (segments) => (segments.length ? segments[segments.length - 1] : 'Local Disk (C:)');
  function drawCrumbs() {
    const parts = [{ text: 'This PC', segments: null }, { text: 'Local Disk (C:)', segments: [] }, ...current.map((part, i) => ({ text: part, segments: current.slice(0, i + 1) }))];
    crumbs.replaceChildren(...parts.flatMap((part, i) => {
      const crumb = el('button', { className: 'wx-crumb', text: part.text });
      if (part.segments) crumb.addEventListener('click', () => go(part.segments));
      else crumb.disabled = true;
      return [...(i ? [el('span', { className: 'wx-chevron', text: '›', attrs: { 'aria-hidden': 'true' } })] : []), crumb];
    }), el('span', { className: 'wx-chevron', text: '›', attrs: { 'aria-hidden': 'true' } }));
  }
  function render() {
    const dir = nodeAt(guest, current);
    if (!dir || !dir.dir) return;
    tabName.textContent = current.length ? current[current.length - 1] : 'Local Disk (C:)';
    searchHint.textContent = `Search ${label(current)}`;
    searchHint.hidden = Boolean(search.value);
    search.setAttribute('aria-label', `Search ${label(current)}`);
    drawCrumbs();
    drawPane();
    backButton.disabled = !back.length;
    forwardButton.disabled = !forward.length;
    upButton.disabled = !current.length;
    const wanted = filter.toLowerCase();
    const kids = children(guest, dir)
      .sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1))
      .filter((node) => !wanted || nameOf(node).toLowerCase().includes(wanted));
    rows.replaceChildren(...kids.map((node) => {
      const row = el('button', { className: 'wx-row wx-item', attrs: { role: 'row', 'aria-label': `${nameOf(node)}, ${typeOf(node)}` } }, [
        el('span', { className: 'wx-col wx-name' }, [iconFor(node), el('span', { className: 'wx-name-text', text: nameOf(node) })]),
        el('span', { className: 'wx-col', text: dateOf(node) }),
        el('span', { className: 'wx-col', text: typeOf(node) }),
        el('span', { className: 'wx-col wx-size', text: sizeOf(node) }),
      ]);
      const activate = () => (node.dir ? go(node.path) : openFile(node));
      row.addEventListener('click', () => {
        for (const other of rows.children) other.classList.toggle('is-selected', other === row);
        status.textContent = `${kids.length} item${kids.length === 1 ? '' : 's'}    1 item selected${node.dir ? '' : `  ${sizeOf(node)}`}`;
      });
      row.addEventListener('dblclick', activate);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') activate();
      });
      return row;
    }));
    empty.hidden = kids.length > 0;
    empty.textContent = wanted ? 'No items match your search.' : 'This folder is empty.';
    status.textContent = `${kids.length} item${kids.length === 1 ? '' : 's'}`;
  }
  // Moves to a folder, keeping back/forward history as Explorer does.
  function go(segments, { record = true } = {}) {
    const dir = nodeAt(guest, segments);
    if (!dir || !dir.dir) return;
    if (record && segments.join('/') !== current.join('/')) {
      back.push(current);
      forward.length = 0;
    }
    current = [...segments];
    filter = '';
    search.value = '';
    namer.hidden = true;
    render();
  }
  backButton.addEventListener('click', () => {
    if (!back.length) return;
    forward.push(current);
    go(back.pop(), { record: false });
  });
  forwardButton.addEventListener('click', () => {
    if (!forward.length) return;
    back.push(current);
    go(forward.pop(), { record: false });
  });
  upButton.addEventListener('click', () => {
    if (current.length) go(current.slice(0, -1));
  });
  refreshButton.addEventListener('click', () => render());
  search.addEventListener('input', () => {
    filter = search.value.trim().slice(0, 64);
    searchHint.hidden = Boolean(search.value);
    render();
  });
  render();
  return {
    node: el('div', { className: 'wx' }, [tabs, nav, commands, namer, el('div', { className: 'wx-main' }, [pane, details]), status]),
    show: (segments) => go(segments),
    refresh: render,
  };
}

// ---------- Linux file managers: Caja (ParrotOS) and Thunar (Ubuntu) ----------
// Owner requests, October 11 and 12, 2026, from screenshots of each OS. One implementation,
// two looks (flavor), so navigation, folder making and safety rules cannot drift apart:
//   caja   (parrot01) the menu bar (File, Edit, View, Go, Bookmarks, Help), the toolbar
//          (Back, Forward, Up, Stop, Reload, Home, Computer, zoom, Icon View / List View,
//          Search), the location bar with path buttons, the Places sidebar (Computer,
//          Devices, Network), teal folder icons
//   thunar (ubuntu-blue, ubuntu-red) the menu bar (File, Edit, View, Go, Help), Back,
//          Forward, Up and Home beside the path entry with its reload button, the sidebar
//          (Devices, Places, Network), grey folders with Ubuntu's orange tab
// Both end in the status bar ("8 items, Free space: ..."). Returns { node, show, refresh }. Drawn as text and CSS shapes (css/layer2.css .cj-*, .cj.is-thunar),
// no artwork. Search only filters the names shown in this folder; what is typed is never
// kept, shown back or sent anywhere. Menu entries with no simulated effect are disabled,
// as both greys them.
const CJ_GLYPHS = Object.freeze({
  Desktop: '▭', Documents: '≡', Downloads: '↓', Music: '♫', Pictures: '▨', Public: '◍', Templates: 'A', Videos: '▶', notes: '✎', evidence: '⚑',
});
const CJ_ZOOM = Object.freeze([50, 75, 100, 150, 200]);
const CJ_FREE = Object.freeze({ caja: 'Free space: 13.1 GB', thunar: 'Free space: 83.5 GiB' });
const CJ_SIDEBAR = Object.freeze(['Desktop', 'File System', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'Trash']);
function linuxFileManager(guest, start, openFile, { flavor = 'caja', user, onFilesChanged = () => {}, openTrash = () => {}, setTitle = () => {} } = {}) {
  const thunar = flavor === 'thunar';
  let current = [...start];
  const back = [];
  const forward = [];
  let zoom = 2; // CJ_ZOOM index: 100%
  let view = 'icons';
  let filter = '';
  const label = (segments) => {
    if (!segments.length) return 'File System';
    if (segments.join('/') === guest.home.join('/')) return user;
    return segments[segments.length - 1];
  };
  const tool = (text, title, className = '') => el('button', { className: `cj-tool ${className}`.trim(), attrs: { title, 'aria-label': title } }, [el('span', { className: 'cj-tool-glyph', text, attrs: { 'aria-hidden': 'true' } })]);
  const textTool = (glyph, text, title) => el('button', { className: 'cj-tool cj-tool-text', attrs: { title } }, [
    el('span', { className: 'cj-tool-glyph', text: glyph, attrs: { 'aria-hidden': 'true' } }), el('span', { text }),
  ]);

  // ---- Menu bar: a few working entries, the rest greyed ----
  const menu = el('div', { className: 'cj-menu', attrs: { role: 'menu' } });
  menu.hidden = true;
  let openMenu = null;
  let menuButtons = [];
  const closeMenu = () => {
    menu.hidden = true;
    openMenu = null;
    for (const button of menuButtons) button.setAttribute('aria-expanded', 'false');
  };
  const entry = (text, action) => {
    const button = el('button', { className: 'cj-menu-item', text, attrs: { role: 'menuitem' } });
    if (!action) button.disabled = true;
    else {
      button.addEventListener('click', () => {
        closeMenu();
        action();
      });
    }
    return button;
  };
  const MENUS = {
    File: () => [entry('Create Folder', () => startFolder()), entry('Open in Terminal'), entry('Properties'), entry('Close')],
    Edit: () => [entry('Cut'), entry('Copy'), entry('Paste'), entry('Select All'), entry('Preferences')],
    View: () => [entry('Reload', () => render()), entry('Zoom In', () => setZoom(1)), entry('Zoom Out', () => setZoom(-1)), entry('Normal Size', () => setZoom(0)), entry('Icons', () => setView('icons')), entry('List', () => setView('list'))],
    Go: () => [entry('Open Parent', current.length ? () => go(current.slice(0, -1)) : null), entry('Back', back.length ? goBack : null), entry('Forward', forward.length ? goForward : null), entry('Home Folder', () => go(guest.home)), entry('Computer', () => go([])), entry('Trash', openTrash)],
    Bookmarks: () => [entry('Add Bookmark'), entry('Edit Bookmarks')],
    Help: () => [entry('Contents'), entry('About')],
  };
  if (thunar) delete MENUS.Bookmarks; // Thunar keeps bookmarks in the sidebar
  menuButtons = Object.keys(MENUS).map((name) => {
    const button = el('button', { className: 'cj-menubar-item', text: name, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    button.addEventListener('click', () => {
      if (openMenu === name) {
        closeMenu();
        return;
      }
      closeMenu();
      menu.replaceChildren(...MENUS[name]());
      menu.style.left = `${Math.round(button.offsetLeft)}px`;
      menu.hidden = false;
      openMenu = name;
      button.setAttribute('aria-expanded', 'true');
    });
    return button;
  });
  const menubar = el('div', { className: 'cj-menubar' }, menuButtons);

  // ---- Toolbar ----
  const backButton = thunar ? tool('‹', 'Back') : textTool('◀', 'Back', 'Go to the previous visited location');
  const forwardButton = thunar ? tool('›', 'Forward') : textTool('▶', 'Forward', 'Go to the next visited location');
  const upButton = tool(thunar ? '︿' : '↑', 'Open the parent folder');
  const stopButton = tool('✕', 'Stop loading the current location', 'cj-stop');
  stopButton.disabled = true;
  const reloadButton = tool('⟳', 'Reload the current location');
  const homeButton = tool('⌂', 'Go to the home folder', 'cj-home');
  const computerButton = tool('▣', 'Go to the computer location', 'cj-computer');
  const zoomOut = tool('−', 'Decrease the view size');
  const zoomIn = tool('+', 'Increase the view size');
  const zoomLabel = el('button', { className: 'cj-zoom', attrs: { title: 'Use the normal view size' } });
  // Caja's view chooser (a drop-down there; a toggle here, since the page builds only
  // allowlisted elements, utils/dom.js).
  const viewButton = el('button', { className: 'cj-view', attrs: { title: 'Switch between Icon View and List View' } });
  const searchButton = tool('⌕', 'Search for files', 'cj-search-toggle');
  // Thunar's path entry: the folder's full path as text, with the reload button inside.
  const pathText = el('span', { className: 'cj-path-text' });
  const toolbar = thunar
    ? el('div', { className: 'cj-toolbar' }, [
      backButton, forwardButton, upButton, homeButton,
      el('div', { className: 'cj-path', attrs: { role: 'group', 'aria-label': 'Location' } }, [el('span', { className: 'cj-path-icon', attrs: { 'aria-hidden': 'true' } }), pathText, reloadButton]),
    ])
    : el('div', { className: 'cj-toolbar' }, [
      backButton, forwardButton, upButton, stopButton, reloadButton, el('span', { className: 'cj-sep' }),
      homeButton, computerButton, el('span', { className: 'cj-sep' }),
      zoomOut, zoomLabel, zoomIn, viewButton, searchButton,
    ]);
  const search = el('input', { className: 'cj-search', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64', 'aria-label': 'Search this folder' } });
  const searchRow = el('div', { className: 'cj-searchrow' }, [search]);
  searchRow.hidden = true;

  // ---- Location bar: the sidebar's title and the path buttons ----
  const crumbs = el('div', { className: 'cj-crumbs', attrs: { role: 'navigation', 'aria-label': 'Location' } });
  const locationBar = el('div', { className: 'cj-locbar' }, [
    el('span', { className: 'cj-places-title', text: 'Places ▾' }),
    el('span', { className: 'cj-pencil', text: '✎', attrs: { 'aria-hidden': 'true' } }),
    crumbs,
  ]);

  // ---- Create Folder (the engine checks the name and the place) ----
  const field = el('input', { className: 'fm-name', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64', 'aria-label': 'Folder name' } });
  const create = el('button', { className: 'fm-button', text: 'Create' });
  const cancel = el('button', { className: 'fm-button', text: 'Cancel' });
  const problem = el('p', { className: 'fm-problem', attrs: { role: 'alert' } });
  const namer = el('div', { className: 'fm-new cj-namer' }, [field, create, cancel, problem]);
  namer.hidden = true;
  function startFolder() {
    namer.hidden = false;
    field.value = '';
    problem.textContent = '';
    field.focus({ preventScroll: true });
  }
  const make = () => {
    const made = makeDir(guest, current, field.value.trim());
    if (!made.ok) {
      problem.textContent = FOLDER_PROBLEMS[made.error] || FOLDER_PROBLEMS.name;
      return;
    }
    namer.hidden = true;
    onFilesChanged();
    render();
  };
  create.addEventListener('click', make);
  cancel.addEventListener('click', () => {
    namer.hidden = true;
  });
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') make();
    else if (event.key === 'Escape') namer.hidden = true;
  });

  // ---- Places sidebar ----
  const sidebar = el('nav', { className: 'cj-side', attrs: { 'aria-label': 'Places' } });
  const sideItem = (text, icon, action, key = null) => {
    const item = el('button', { className: `cj-side-item is-${icon}` }, [
      el('span', { className: 'cj-side-icon', attrs: { 'aria-hidden': 'true' } }), el('span', { className: 'cj-side-label', text }),
    ]);
    if (!action) item.disabled = true;
    else item.addEventListener('click', action);
    if (key !== null && key === current.join('/')) item.classList.add('is-current');
    return item;
  };
  const drawSidebar = () => {
    const folder = (name) => [...guest.home, name];
    const homeFolder = (name) => (nodeAt(guest, folder(name)) ? [sideItem(name, name.toLowerCase(), () => go(folder(name)), folder(name).join('/'))] : []);
    if (thunar) {
      sidebar.replaceChildren(
        el('p', { className: 'cj-side-head', text: 'DEVICES' }),
        sideItem('File System', 'disk', () => go([]), ''),
        el('p', { className: 'cj-side-head', text: 'PLACES' }),
        sideItem(user, 'home', () => go(guest.home), guest.home.join('/')),
        ...homeFolder('Desktop'),
        sideItem('Trash', 'trash', openTrash),
        ...['Documents', 'Music', 'Pictures', 'Videos', 'Downloads'].flatMap(homeFolder),
        el('p', { className: 'cj-side-head', text: 'NETWORK' }),
        sideItem('Browse Network', 'network', null),
      );
      return;
    }
    sidebar.replaceChildren(
      el('p', { className: 'cj-side-head', text: 'Computer' }),
      sideItem(user, 'home', () => go(guest.home), guest.home.join('/')),
      ...CJ_SIDEBAR.flatMap((name) => {
        if (name === 'File System') return [sideItem(name, 'disk', () => go([]), '')];
        if (name === 'Trash') return [sideItem(name, 'trash', openTrash)];
        return nodeAt(guest, folder(name)) ? [sideItem(name, name.toLowerCase(), () => go(folder(name)), folder(name).join('/'))] : [];
      }),
      el('p', { className: 'cj-side-head', text: 'Devices' }),
      sideItem('Parrot home disk', 'drive', () => go(['home']), 'home'),
      el('p', { className: 'cj-side-head', text: 'Network' }),
      sideItem('Browse Network', 'network', null),
    );
  };

  // ---- The folder view and the status bar ----
  const grid = el('div', { className: 'cj-grid', attrs: { role: 'listbox', 'aria-label': 'Files' } });
  const empty = el('p', { className: 'cj-empty' });
  const status = el('p', { className: 'cj-status' });
  const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
  const typeOf = (node) => (node.dir ? 'folder' : ['txt', 'log', 'md', 'conf', 'license', ''].includes(extOf(nameOf(node))) ? 'plain text document' : `${extOf(nameOf(node)).toUpperCase()} file`);
  const sizeOf = (node, kids) => (node.dir ? `${kids} item${kids === 1 ? '' : 's'}` : `${(node.content || '').length} bytes`);
  // Caja's path buttons: one per folder from the home (or the root) down.
  function drawCrumbs() {
    const home = guest.home.join('/');
    const inHome = current.join('/') === home || current.join('/').startsWith(`${home}/`);
    const parts = inHome
      ? [{ text: user, segments: guest.home, home: true }, ...current.slice(guest.home.length).map((part, i) => ({ text: part, segments: current.slice(0, guest.home.length + i + 1) }))]
      : [{ text: '/', segments: [], disk: true }, ...current.map((part, i) => ({ text: part, segments: current.slice(0, i + 1) }))];
    crumbs.replaceChildren(
      el('span', { className: 'cj-crumb-arrow', text: '◂', attrs: { 'aria-hidden': 'true' } }),
      ...parts.map((part, i) => {
        const crumb = el('button', { className: `cj-crumb${part.home ? ' is-home' : ''}${part.disk ? ' is-disk' : ''}${i === parts.length - 1 ? ' is-current' : ''}`, text: part.text });
        crumb.addEventListener('click', () => go(part.segments));
        return crumb;
      }),
      el('span', { className: 'cj-crumb-arrow', text: '▸', attrs: { 'aria-hidden': 'true' } }),
    );
  }
  function render() {
    const dir = nodeAt(guest, current);
    if (!dir || !dir.dir) return;
    setTitle(thunar ? `${label(current)} - File Manager` : label(current));
    pathText.textContent = current.length ? `/${current.join('/')}/` : '/';
    drawCrumbs();
    drawSidebar();
    backButton.disabled = !back.length;
    forwardButton.disabled = !forward.length;
    upButton.disabled = !current.length;
    zoomLabel.textContent = `${CJ_ZOOM[zoom]}%`;
    viewButton.textContent = view === 'list' ? 'List View ▾' : 'Icon View ▾';
    zoomOut.disabled = zoom === 0;
    zoomIn.disabled = zoom === CJ_ZOOM.length - 1;
    grid.className = `cj-grid is-${view} is-zoom-${CJ_ZOOM[zoom]}`;
    const wanted = filter.toLowerCase();
    const kids = children(guest, dir)
      .sort((a, b) => (a.dir === b.dir ? 0 : a.dir ? -1 : 1))
      .filter((node) => !wanted || nameOf(node).toLowerCase().includes(wanted));
    grid.replaceChildren(...kids.map((node) => {
      const name = nameOf(node);
      const inside = node.dir ? children(guest, node).length : 0;
      const known = node.dir && Object.hasOwn(CJ_GLYPHS, name) && node.path.join('/') === [...guest.home, name].join('/');
      const glyph = known && !(thunar && name === 'Desktop') ? CJ_GLYPHS[name] : '';
      const item = el('button', { className: `cj-item ${node.dir ? 'is-folder' : 'is-file'}${known ? ` is-${name.toLowerCase()}` : ''}`, attrs: { role: 'option', 'aria-selected': 'false', 'aria-label': `${name}, ${typeOf(node)}` } }, [
        el('span', { className: 'cj-icon', attrs: { 'aria-hidden': 'true' } }, [el('span', { className: 'cj-icon-glyph', text: glyph })]),
        el('span', { className: 'cj-name', text: name }),
        el('span', { className: 'cj-size', text: sizeOf(node, inside) }),
        el('span', { className: 'cj-type', text: typeOf(node) }),
      ]);
      const activate = () => (node.dir ? go(node.path) : openFile(node));
      item.addEventListener('click', () => {
        for (const other of grid.children) {
          other.classList.toggle('is-selected', other === item);
          other.setAttribute('aria-selected', String(other === item));
        }
        status.textContent = node.dir ? `“${name}” selected (containing ${sizeOf(node, inside)})` : `“${name}” selected (${sizeOf(node)})`;
      });
      item.addEventListener('dblclick', activate);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') activate();
      });
      return item;
    }));
    empty.hidden = kids.length > 0;
    empty.textContent = wanted ? 'No files match your search.' : 'This folder is empty.';
    status.textContent = `${kids.length} item${kids.length === 1 ? '' : 's'}, ${CJ_FREE[thunar ? 'thunar' : 'caja']}`;
  }
  // Moves to a folder, keeping back/forward history as Caja does.
  function go(segments, { record = true } = {}) {
    const dir = nodeAt(guest, segments);
    if (!dir || !dir.dir) return;
    if (record && segments.join('/') !== current.join('/')) {
      back.push(current);
      forward.length = 0;
    }
    current = [...segments];
    filter = '';
    search.value = '';
    namer.hidden = true;
    render();
  }
  function goBack() {
    if (!back.length) return;
    forward.push(current);
    go(back.pop(), { record: false });
  }
  function goForward() {
    if (!forward.length) return;
    back.push(current);
    go(forward.pop(), { record: false });
  }
  function setZoom(step) {
    zoom = step === 0 ? 2 : Math.min(CJ_ZOOM.length - 1, Math.max(0, zoom + step));
    render();
  }
  function setView(next) {
    view = next === 'list' ? 'list' : 'icons';
    render();
  }
  backButton.addEventListener('click', goBack);
  forwardButton.addEventListener('click', goForward);
  upButton.addEventListener('click', () => {
    if (current.length) go(current.slice(0, -1));
  });
  reloadButton.addEventListener('click', () => render());
  homeButton.addEventListener('click', () => go(guest.home));
  computerButton.addEventListener('click', () => go([]));
  zoomOut.addEventListener('click', () => setZoom(-1));
  zoomIn.addEventListener('click', () => setZoom(1));
  zoomLabel.addEventListener('click', () => setZoom(0));
  viewButton.addEventListener('click', () => setView(view === 'list' ? 'icons' : 'list'));
  searchButton.addEventListener('click', () => {
    searchRow.hidden = !searchRow.hidden;
    if (searchRow.hidden) {
      filter = '';
      search.value = '';
      render();
    } else search.focus({ preventScroll: true });
  });
  search.addEventListener('input', () => {
    filter = search.value.trim().slice(0, 64);
    render();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') searchButton.click();
  });
  render();
  const root = el('div', { className: `cj${thunar ? ' is-thunar' : ''}` }, [
    menubar, menu, toolbar, ...(thunar ? [] : [locationBar, searchRow]), namer,
    el('div', { className: 'cj-main' }, [sidebar, el('div', { className: 'cj-view-pane' }, [grid, empty])]),
    status,
  ]);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openMenu) closeMenu();
  });
  root.addEventListener('pointerdown', (event) => {
    if (openMenu && !menu.contains(event.target) && !menuButtons.includes(event.target)) closeMenu();
  });
  return { node: root, show: (segments) => go(segments), refresh: render };
}

// The text editor (ui/guest-editor.js) in an app window: one per desktop, kept while its
// window is open; opening a file loads it (asking first about unsaved changes). Its title
// follows the document ("*notes.txt - Notepad"). changed() runs after it saves.
// opened(path): a file was opened (mission events, layers/layer2.js).
function editorApp({ windows, guest, id, flavor, placement, changed, opened = () => {} }) {
  let editor = null;
  let app = null;
  let title = '';
  return (target = null) => {
    if (!editor || !windows.isOpen(id)) {
      editor = createEditor({
        guest, flavor,
        onTitle: (text) => {
          title = text;
          if (app && windows.isOpen(id)) windows.rename(app, text);
        },
        onFilesChanged: changed,
      });
      app = windows.open(id, title, editor.node, placement);
      windows.rename(app, title);
    } else {
      windows.open(id);
    }
    if (target && !target.dir) {
      editor.open(target);
      opened(target.path.join('/'));
    }
    editor.focus();
  };
}

// A browser (ui/guest-browser.js) in an app window, for every desktop that has one:
// Firecat on Winbows, ParrotOS (Firecat ESR, dark) and Ubuntu (the snap, light), Exploredge
// on Winbows. A new browser each time it is opened, kept while its window is open; the
// window's title follows the page ("Page — Firecat"). Firecat and Exploredge are the lab's
// own browsers (owner requests, October 13 and 14, 2026); their ids, 'firecat' and
// 'exploredge', name their windows, styles and icon hooks.
function openBrowser({ windows, life, id, platform, home, running, reducedMotion, placement }) {
  if (windows.isOpen(id)) {
    windows.open(id);
    return;
  }
  let app = null;
  let title = '';
  const browser = createBrowser({
    flavor: id, platform, home, running, reducedMotion,
    later: life.later, every: life.every,
    onTitle: (text) => {
      title = text;
      if (app && windows.isOpen(id)) windows.rename(app, text);
    },
    onLastTabClosed: () => windows.close(id),
  });
  app = windows.open(id, title || (id === 'exploredge' ? 'Exploredge' : 'Firecat'), browser.node, placement);
  if (title) windows.rename(app, title);
}

// Desktop icons: open with a double-click or Enter (one click selects, as on both OSes).
function desktopIcons(icons, className) {
  return el('div', { className }, icons.map((icon) => {
    const button = el('button', { className: `win-icon win-icon-${icon.id}`, attrs: { 'aria-label': `Open ${icon.label}` } }, [
      el('span', { className: 'win-icon-glyph', text: icon.glyph, attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'win-icon-label', text: icon.label }),
    ]);
    button.addEventListener('dblclick', icon.open);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        icon.open();
      }
    });
    return button;
  }));
}

const twoDigits = (n) => String(n).padStart(2, '0');

// Focuses the console's input once its window is open.
const focusConsole = (consoleNode) => {
  const input = consoleNode.querySelector('.vm-input');
  if (input) input.focus({ preventScroll: true });
};

// Phases: shows one child of root at a time by name; 'off' shows none.
function phases(root, screens) {
  return (name) => {
    root.dataset.phase = name;
    for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  };
}

// The GRUB menu: entries in a box, the first highlighted, and a countdown that phases
// can update (the ParrotOS boot; Ubuntu desktops hide GRUB, as a single-OS install does).
function grubScreen(entries, seconds) {
  const countdown = el('span', { text: String(seconds) });
  const node = el('div', { className: 'grub' }, [
    el('p', { className: 'grub-title', text: 'GNU GRUB  version 2.12 (simulated)' }),
    el('div', { className: 'grub-box' }, entries.map((entry, i) => el('p', { className: `grub-entry${i === 0 ? ' is-selected' : ''}`, text: `${i === 0 ? '*' : ' '}${entry}` }))),
    el('p', { className: 'grub-help', text: 'Use the arrow keys to select which entry is highlighted. Press enter to boot the selected OS.' }),
    el('p', { className: 'grub-help' }, ['The highlighted entry will be executed automatically in ', countdown, 's.']),
  ]);
  return { node, countdown };
}

// ---------- Winbows ----------

const WIN_BOOT_MS = 3200; // the spinning dots under the logo
const WIN_SIGNIN_MS = 2200; // "Welcome" under the user's picture
const WIN_LOCK_MS = 1800; // the server's lock screen before sign-in

// onPowerOff(): the start menu's Shut down (layer2 runs "vm stop" for this VM in tty1).
// autoStart: false waits for start() (layer2 calls it once the VM's firmware is done).
// running(id): whether another VM is powered on (layers/layer2.js), for the browsers.
// onRestart(): restarts the VM in its window after a blue screen (layers/layer2.js).
// onFilesChanged(): the VM's files changed (layers/layer2.js keeps them for the session).
// onEvent(type, value): something a mission may count (an app or a file opened).
export function mountWinbowsDesktop({ vm, guest, consoleNode, resumed = false, reducedMotion = false, onPowerOff = () => {}, autoStart = true, running = () => true, onRestart = () => {}, onFilesChanged = () => {}, onEvent = () => {} }) {
  const life = lifecycle();
  // Winbows Server (dc01): a lock screen before sign-in, Server Manager on the desktop.
  const server = vm.image === 'winserver';

  // ---------- Boot and sign-in ----------
  const lockTime = el('p', { className: 'win-lock-time' });
  const lockDate = el('p', { className: 'win-lock-date' });
  const lock = el('div', { className: 'win-lock' }, [
    el('div', { className: 'win-lock-clock' }, [lockTime, lockDate]),
    el('p', { className: 'win-lock-hint', text: 'Press Ctrl+Alt+Delete to unlock.' }),
  ]);
  const logo = el('span', { className: 'win-logo', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span'), el('span')]);
  const dots = () => el('span', { className: 'win-dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span'), el('span'), el('span')]);
  const boot = el('div', { className: 'win-boot' }, [logo, dots(), el('p', { className: 'win-boot-text', text: server ? '' : 'Starting Winbows (simulated)' })]);
  const signin = el('div', { className: 'win-signin' }, [
    el('span', { className: 'win-avatar', text: vm.user.charAt(0).toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
    el('p', { className: 'win-signin-user', text: vm.user }),
    el('p', { className: 'win-signin-text', text: 'Welcome' }),
    dots(),
  ]);

  // ---------- Desktop ----------
  const area = el('div', { className: 'win-area' });
  const taskApps = el('span', { className: 'win-task-apps' });
  const clock = el('span', { className: 'win-clock' });
  const start = el('button', { className: 'win-start', attrs: { 'aria-label': 'Start', 'aria-expanded': 'false' } }, [logo.cloneNode(true)]);
  const taskbar = el('div', { className: 'win-taskbar' }, [start, taskApps, clock]);
  const menu = el('div', { className: 'win-menu', attrs: { role: 'menu', 'aria-label': 'Start' } });
  menu.hidden = true;
  const desktop = el('div', { className: 'win-desktop', attrs: { role: 'region', 'aria-label': `${vm.id} desktop` } }, [area, menu, taskbar]);
  const root = el('div', { className: `win-root${server ? ' is-server' : ''}` }, [boot, lock, signin, desktop]);
  const phase = phases(root, { boot, lock, signin, desktop });

  // ---------- Apps ----------
  const windows = appWindows({ area, tasks: taskApps, consoleNode, consoleId: 'powershell' });
  const openPowerShell = () => {
    // Both Winbows images open PowerShell as administrator, which sfc and DISM need.
    windows.open('powershell', 'Administrator: Winbows PowerShell', consoleNode, box(0.18, 0.06, 0.62, 0.7));
    focusConsole(consoleNode);
  };
  // Files saved or folders made: keep them (layers/layer2.js) and show them in Explorer.
  let explorer = null;
  const changed = () => {
    onFilesChanged();
    if (explorer) explorer.refresh();
    drawIcons();
  };
  const openNotepad = editorApp({ windows, guest, id: 'notepad', flavor: 'notepad', placement: box(0.26, 0.1, 0.5, 0.58), changed, opened: (path) => onEvent('opened', path) });
  const isPicture = (node) => /\.png$/i.test(nameOf(node));
  const openFile = (node) => (isPicture(node) ? openPhotos(node) : openNotepad(node));
  // segments: the folder to show (a folder on the desktop opens there).
  const openExplorer = (segments = guest.home) => {
    if (!explorer || !windows.isOpen('explorer')) explorer = windowsExplorer(guest, segments, openFile, { onFilesChanged: changed });
    else explorer.show(segments);
    windows.open('explorer', 'File Explorer', explorer.node, box(0.05, 0.06, 0.74, 0.74));
  };
  // A browser window: a new one each time it is opened, kept while it is open. Its title
  // follows the page ("Page — Firecat").
  const openFirecat = () => openBrowser({ windows, life, id: 'firecat', platform: 'winbows', running, reducedMotion, placement: box(0.1, 0.04, 0.74, 0.84) });
  const openExploredge = () => openBrowser({ windows, life, id: 'exploredge', platform: 'winbows', home: server ? 'about:esc' : undefined, running, reducedMotion, placement: box(0.14, 0.07, 0.72, 0.8) });
  // The Recycle Bin (easter egg, owner request, October 11, 2026): on the workstation it
  // holds a deleted passwords.txt. Restore puts it back on the Desktop (saveFile, so it
  // follows the same rules as any save); once it is there the bin is empty. The server's
  // bin is empty.
  const binFile = { name: 'passwords.txt', from: showPath(guest, [...guest.home, 'Desktop']), deleted: '9/28/2026 11:52 PM', size: '1 KB' };
  const binText = 'nice try :)\n\nreal passwords do not live in text files on the desktop.\n(and if yours do, security would like a word.)\n\np.s. the old ~waffles homepage on web01 is still up. nobody ever checks it.';
  const recycleBody = () => {
    if (server || nodeAt(guest, [...guest.home, 'Desktop', binFile.name])) return el('p', { className: 'win-empty', text: 'This folder is empty.' });
    const restore = el('button', { className: 'fm-button', text: 'Restore the selected items' });
    restore.disabled = true;
    const item = el('button', { className: 'bin-item', attrs: { 'aria-label': `${binFile.name}, deleted from Desktop` } }, [
      el('span', { className: 'bin-name', text: binFile.name }),
      el('span', { text: binFile.from }),
      el('span', { text: binFile.deleted }),
      el('span', { text: binFile.size }),
    ]);
    const problem = el('p', { className: 'fm-problem', attrs: { role: 'alert' } });
    item.addEventListener('click', () => {
      item.classList.add('is-picked');
      restore.disabled = false;
    });
    restore.addEventListener('click', () => {
      const result = saveFile(guest, [...guest.home, 'Desktop'], binFile.name, binText);
      if (!result.ok) {
        problem.textContent = FOLDER_PROBLEMS[result.error] || FOLDER_PROBLEMS.full;
        return;
      }
      changed();
      windows.retitle(windows.open('recycle'), 'Recycle Bin', recycleBody());
    });
    return el('div', { className: 'bin' }, [
      el('div', { className: 'fm-bar' }, [restore]),
      el('div', { className: 'bin-head' }, ['Name', 'Original Location', 'Date Deleted', 'Size'].map((text) => el('span', { text }))),
      item,
      problem,
    ]);
  };
  const openRecycle = () => windows.open('recycle', 'Recycle Bin', recycleBody(), box(0.3, 0.26, 0.48, 0.34));

  // Server Manager (dc01): the dashboard a server opens on sign-in. Its text comes from
  // the image's data (data/images/winserver.js).
  const openServerManager = () => {
    const data = guest.image.serverManager;
    if (!data) return;
    const nav = el('div', { className: 'sm-nav' }, ['Dashboard', 'Local Server', 'All Servers', ...data.tiles.slice(0, 3)].map((label, i) => el('p', { className: `sm-nav-item${i === 0 ? ' is-current' : ''}`, text: label })));
    const welcome = el('div', { className: 'sm-welcome' }, [
      el('p', { className: 'sm-heading', text: 'WELCOME TO SERVER MANAGER' }),
      ...data.steps.map((step, i) => el('p', { className: 'sm-step' }, [el('span', { className: 'sm-step-number', text: String(i + 1) }), step])),
    ]);
    const tiles = el('div', { className: 'sm-tiles' }, data.tiles.map((name) => el('div', { className: 'sm-tile' }, [
      el('p', { className: 'sm-tile-name' }, [name, el('span', { className: 'sm-count', text: '1' })]),
      ...data.rows.map((row) => el('p', { className: 'sm-tile-row', text: row })),
    ])));
    const main = el('div', { className: 'sm-main' }, [
      welcome,
      el('p', { className: 'sm-heading', text: `ROLES AND SERVER GROUPS  Roles: 3 | Server groups: 1 | Servers total: 1` }),
      tiles,
    ]);
    const body = el('div', { className: 'sm' }, [
      el('p', { className: 'sm-title', text: 'Server Manager ▸ Dashboard' }),
      el('div', { className: 'sm-body' }, [nav, main]),
    ]);
    windows.open('servermanager', 'Server Manager', body, box(0.04, 0.03, 0.9, 0.86));
  };

  const ICONS = [
    ...(server ? [{ id: 'servermanager', label: 'Server Manager', glyph: 'SM', open: openServerManager }] : []),
    { id: 'powershell', label: 'PowerShell', glyph: '>_', open: openPowerShell },
    { id: 'explorer', label: 'File Explorer', glyph: '[=]', open: () => openExplorer() },
    { id: 'notepad', label: 'Notepad', glyph: '', open: () => openNotepad() },
    ...(missionsFor(vm.id).length ? [{ id: 'tickets', label: 'Tickets', glyph: '#', open: () => openTickets() }] : []),
    // In the Start menu only, as on Winbows.
    { id: 'snipping', label: 'Snipping Tool', glyph: '', open: () => openSnipping(), startOnly: true },
    ...(server ? [] : [{ id: 'firecat', label: 'Firecat', glyph: '', open: openFirecat }]),
    { id: 'exploredge', label: 'Exploredge', glyph: 'e', open: openExploredge },
    { id: 'recycle', label: 'Recycle Bin', glyph: '', open: openRecycle },
  ];
  // The desktop: the apps, then whatever is in the user's Desktop folder (text files open
  // in Notepad, folders in File Explorer), then the Recycle Bin. Redrawn whenever the VM's
  // files change (owner request, October 10, 2026: save text files to the desktop). The
  // server shows only its Recycle Bin and its Desktop folder, as Winbows Server does.
  const desktopDir = [...guest.home, 'Desktop'];
  let icons = null;
  let iconSize = 'medium'; // View: large, medium or small icons
  let sortBy = 'name'; // Sort by: name or type
  const typeOf = (node) => (node.dir ? '' : nameOf(node).split('.').pop().toLowerCase());
  function drawIcons() {
    const apps = server ? [] : ICONS.filter((icon) => icon.id !== 'recycle' && !icon.startOnly);
    const dir = nodeAt(guest, desktopDir);
    const nodes = dir && dir.dir ? [...children(guest, dir)] : [];
    if (sortBy === 'type') nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || typeOf(a).localeCompare(typeOf(b)) || nameOf(a).localeCompare(nameOf(b)));
    const items = nodes.map((node) => (node.dir
      ? { id: 'folder', label: nameOf(node), glyph: '', open: () => openExplorer(node.path) }
      : { id: isPicture(node) ? 'picture' : 'textfile', label: nameOf(node), glyph: isPicture(node) ? '' : 'txt', open: () => openFile(node) }));
    const next = desktopIcons([...apps, ...items, ...ICONS.filter((icon) => icon.id === 'recycle')], `win-icons is-${iconSize}`);
    if (icons) icons.replaceWith(next);
    else area.appendChild(next);
    icons = next;
  }
  drawIcons();

  // Right-click on the desktop: New folder and New Text Document, then a name box. The
  // engine checks the name and the place; messages are fixed text. A new text document
  // opens in Notepad.
  const context = el('div', { className: 'win-context', attrs: { role: 'menu' } });
  context.hidden = true;
  const namer = el('div', { className: 'win-namer', attrs: { role: 'dialog', 'aria-label': 'Name' } });
  namer.hidden = true;
  area.append(context, namer);
  const closeContext = () => {
    context.hidden = true;
  };
  function askName(kind) {
    const field = el('input', { className: 'fm-name', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '64', 'aria-label': kind === 'folder' ? 'Folder name' : 'File name' } });
    field.value = kind === 'folder' ? 'New folder' : 'New Text Document.txt';
    const problem = el('p', { className: 'fm-problem', attrs: { role: 'alert' } });
    const ok = el('button', { className: 'fm-button', text: 'OK' });
    const cancel = el('button', { className: 'fm-button', text: 'Cancel' });
    const finish = () => {
      let name = field.value.trim();
      if (kind === 'text' && name && !name.includes('.')) name = `${name}.txt`;
      const made = kind === 'folder' ? makeDir(guest, desktopDir, name) : nodeAt(guest, [...desktopDir, name]) ? { ok: false, error: 'exists' } : saveFile(guest, desktopDir, name, '');
      if (!made.ok) {
        problem.textContent = FOLDER_PROBLEMS[made.error] || FOLDER_PROBLEMS.name;
        return;
      }
      namer.hidden = true;
      changed();
      if (kind === 'text') openNotepad(made.node);
    };
    ok.addEventListener('click', finish);
    cancel.addEventListener('click', () => {
      namer.hidden = true;
    });
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') finish();
      else if (event.key === 'Escape') namer.hidden = true;
    });
    namer.replaceChildren(el('p', { className: 'win-namer-title', text: kind === 'folder' ? 'New folder' : 'New Text Document' }), field, el('div', { className: 'win-namer-buttons' }, [ok, cancel]), problem);
    namer.hidden = false;
    field.focus({ preventScroll: true });
    field.setSelectionRange(0, kind === 'text' ? field.value.lastIndexOf('.') : field.value.length);
  }
  // The desktop's right-click menu, after Winbows 11's classic one (owner request,
  // October 11, 2026): View and Sort by change the icons, New makes a folder or a text
  // document, Open in Terminal opens PowerShell, and Display settings, Personalize and
  // Task Manager open their windows. Paste stays grey, as with nothing copied.
  const contextItem = (label, run, { disabled = false, checked = false } = {}) => {
    const item = el('button', { className: `win-context-item${checked ? ' is-checked' : ''}`, text: label, attrs: { role: checked ? 'menuitemradio' : 'menuitem' } });
    if (checked) item.setAttribute('aria-checked', 'true');
    if (disabled) item.disabled = true;
    item.addEventListener('click', () => {
      closeContext();
      run();
    });
    return item;
  };
  // An item with a flyout to its right; hovering or clicking opens it.
  const flyout = (label, items) => {
    const sub = el('div', { className: 'win-context win-context-sub', attrs: { role: 'menu' } }, items);
    sub.hidden = true;
    const opener = el('button', { className: 'win-context-item win-context-more', text: label, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } });
    const wrap = el('div', { className: 'win-context-wrap' }, [opener, sub]);
    const show = (open) => {
      for (const other of context.querySelectorAll('.win-context-sub')) if (other !== sub) other.hidden = true;
      sub.hidden = !open;
      opener.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    opener.addEventListener('click', () => show(sub.hidden));
    opener.addEventListener('pointerenter', () => show(true));
    return wrap;
  };
  const sep = () => el('span', { className: 'win-context-sep' });
  const buildContext = () => context.replaceChildren(
    flyout('View', [
      contextItem('Large icons', () => { iconSize = 'large'; drawIcons(); }, { checked: iconSize === 'large' }),
      contextItem('Medium icons', () => { iconSize = 'medium'; drawIcons(); }, { checked: iconSize === 'medium' }),
      contextItem('Small icons', () => { iconSize = 'small'; drawIcons(); }, { checked: iconSize === 'small' }),
    ]),
    flyout('Sort by', [
      contextItem('Name', () => { sortBy = 'name'; drawIcons(); }, { checked: sortBy === 'name' }),
      contextItem('Item type', () => { sortBy = 'type'; drawIcons(); }, { checked: sortBy === 'type' }),
    ]),
    contextItem('Refresh', drawIcons),
    sep(),
    contextItem('Paste', () => {}, { disabled: true }),
    sep(),
    contextItem('Open in Terminal', openPowerShell),
    sep(),
    flyout('New', [
      contextItem('Folder', () => askName('folder')),
      contextItem('Text Document', () => askName('text')),
    ]),
    sep(),
    contextItem('Display settings', openDisplay),
    contextItem('Personalize', openPersonalize),
    contextItem('Task Manager', openTaskManager),
  );

  // Display settings: what this "monitor" really is, the VM's screen.
  function openDisplay() {
    const width = Math.round(area.clientWidth);
    const height = Math.round(area.clientHeight + 48);
    windows.open('display', 'Settings', el('div', { className: 'win-settings' }, [
      el('p', { className: 'win-settings-path', text: 'System  >  Display' }),
      ...[['Scale', '100%'], ['Display resolution', `${width} x ${height}`], ['Display orientation', 'Landscape'], ['Refresh rate', '60 Hz'], ['Display', 'wafflesOS Virtual Display']]
        .map(([name, value]) => el('div', { className: 'win-settings-row' }, [el('span', { text: name }), el('span', { className: 'win-settings-value', text: value })])),
    ]), box(0.22, 0.12, 0.5, 0.5));
  }
  // Personalize: the background, picture or a solid colour.
  let background = 'picture';
  function openPersonalize() {
    const choice = (id, label) => {
      const button = el('button', { className: `win-swatch win-swatch-${id}${background === id ? ' is-picked' : ''}`, attrs: { 'aria-label': label, 'aria-pressed': background === id ? 'true' : 'false' } }, [el('span', { text: label })]);
      button.addEventListener('click', () => {
        background = id;
        desktop.classList.remove('bg-picture', 'bg-blue', 'bg-dark');
        desktop.classList.add(`bg-${id}`);
        windows.retitle(windows.open('personalize'), 'Settings', personalizeBody());
      });
      return button;
    };
    const personalizeBody = () => el('div', { className: 'win-settings' }, [
      el('p', { className: 'win-settings-path', text: 'Personalization  >  Background' }),
      el('p', { text: 'Personalize your background' }),
      el('div', { className: 'win-swatches' }, [choice('picture', 'Default'), choice('blue', 'Solid color: blue'), choice('dark', 'Solid color: dark')]),
    ]);
    windows.open('personalize', 'Settings', personalizeBody(), box(0.24, 0.14, 0.5, 0.5));
  }
  // Task Manager: the PowerShell process table with End task. Ending a critical process
  // asks first, as Winbows does, then blue-screens (guestEvent); ending PowerShell closes it.
  function openTaskManager() {
    onEvent('app', 'taskmgr');
    let picked = null;
    const message = el('p', { className: 'fm-problem', attrs: { role: 'alert' } });
    const endButton = el('button', { className: 'fm-button', text: 'End task' });
    endButton.disabled = true;
    const rows = taskList().map((task) => {
      const row = el('button', { className: 'tm-row' }, [
        el('span', { text: task.name }),
        el('span', { text: String(task.pid) }),
        el('span', { text: `${(task.mem / 1024).toFixed(1)} MB` }),
      ]);
      row.addEventListener('click', () => {
        for (const other of list.querySelectorAll('.tm-row')) other.classList.toggle('is-picked', other === row);
        picked = task;
        endButton.disabled = false;
        message.textContent = '';
      });
      return row;
    });
    const list = el('div', { className: 'tm-list' }, rows);
    const confirmRow = el('div', { className: 'fm-new' });
    confirmRow.hidden = true;
    const finish = () => {
      const result = endTask(picked.pid);
      confirmRow.hidden = true;
      if (!result.ok) {
        message.textContent = 'Access is denied.';
        return;
      }
      if (result.event) guestEvent(result.event);
      else message.textContent = 'The task was ended.';
    };
    endButton.addEventListener('click', () => {
      if (!picked) return;
      if (picked.critical) {
        const yes = el('button', { className: 'fm-button', text: 'Shut down' });
        const no = el('button', { className: 'fm-button', text: 'Cancel' });
        yes.addEventListener('click', finish);
        no.addEventListener('click', () => {
          confirmRow.hidden = true;
        });
        confirmRow.replaceChildren(el('p', { className: 'tm-warn', text: 'Do you want to end this system process? Ending it will cause Winbows to become unusable or shut down, causing you to lose any unsaved data.' }), yes, no);
        confirmRow.hidden = false;
        return;
      }
      finish();
    });
    windows.open('taskmgr', 'Task Manager', el('div', { className: 'tm' }, [
      el('div', { className: 'tm-head' }, ['Name', 'PID', 'Memory'].map((text) => el('span', { text }))),
      list,
      confirmRow,
      el('div', { className: 'fm-bar' }, [message, endButton]),
    ]), box(0.18, 0.08, 0.5, 0.72));
  }
  life.listen(area, 'contextmenu', (event) => {
    if (event.target.closest('.win-app, .win-icon, .win-namer')) return;
    event.preventDefault();
    buildContext();
    const rect = area.getBoundingClientRect();
    // Reviewed code: two finite pixel numbers, clamped inside the desktop.
    context.style.left = `${Math.round(Math.min(Math.max(0, event.clientX - rect.left), Math.max(0, rect.width - 200)))}px`;
    context.style.top = `${Math.round(Math.min(Math.max(0, event.clientY - rect.top), Math.max(0, rect.height - 360)))}px`;
    context.hidden = false;
    const first = context.querySelector('button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  });
  life.listen(area, 'pointerdown', (event) => {
    if (!event.target.closest('.win-context')) closeContext();
  });
  life.listen(context, 'keydown', (event) => {
    if (event.key === 'Escape') closeContext();
  });

  // ---------- Start menu ----------
  // Pinned apps above, the signed-in user and Shut down below, like Winbows 11. It closes
  // on a choice, a click elsewhere on the desktop, or Escape.
  const toggleMenu = (open) => {
    menu.hidden = !open;
    start.setAttribute('aria-expanded', open ? 'true' : 'false');
    start.classList.toggle('is-active', open);
    if (open) {
      const first = menu.querySelector('button');
      if (first) first.focus({ preventScroll: true });
    }
  };
  const pinned = ICONS.map((icon) => {
    const item = el('button', { className: `win-menu-app win-icon-${icon.id}`, attrs: { role: 'menuitem' } }, [
      el('span', { className: 'win-icon-glyph', text: icon.glyph, attrs: { 'aria-hidden': 'true' } }),
      el('span', { text: icon.label }),
    ]);
    item.addEventListener('click', () => {
      toggleMenu(false);
      icon.open();
    });
    return item;
  });
  const shutDown = el('button', { className: 'win-menu-power', attrs: { role: 'menuitem', 'aria-label': `Shut down ${vm.id}`, title: 'Shut down' } }, [
    el('span', { className: 'win-power-glyph', attrs: { 'aria-hidden': 'true' } }),
  ]);
  shutDown.addEventListener('click', () => {
    toggleMenu(false);
    onPowerOff();
  });
  menu.append(
    el('p', { className: 'win-menu-heading', text: 'Pinned' }),
    el('div', { className: 'win-menu-grid' }, pinned),
    el('div', { className: 'win-menu-footer' }, [
      el('span', { className: 'win-menu-user' }, [
        el('span', { className: 'win-avatar win-avatar-small', text: vm.user.charAt(0).toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: vm.user }),
      ]),
      shutDown,
    ]),
  );
  life.listen(start, 'click', () => toggleMenu(menu.hidden));
  life.listen(area, 'pointerdown', () => toggleMenu(false));
  life.listen(menu, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      toggleMenu(false);
      start.focus({ preventScroll: true });
    }
  });

  // ---------- Clock ----------
  const tick = () => {
    const now = new Date();
    clock.textContent = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
    lockTime.textContent = clock.textContent;
    lockDate.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  };
  tick();
  life.every(tick, 20000);

  // ---------- Power on ----------
  let started = false;
  const powerOn = () => {
    if (started) return;
    started = true;
    const ready = () => {
      phase('desktop');
      if (server && !resumed) life.later(openServerManager, 300);
    };
    if (resumed || reducedMotion) {
      ready();
    } else {
      const lockMs = server ? WIN_LOCK_MS : 0;
      phase('boot');
      if (server) life.later(() => phase('lock'), WIN_BOOT_MS);
      life.later(() => phase('signin'), WIN_BOOT_MS + lockMs);
      life.later(ready, WIN_BOOT_MS + lockMs + WIN_SIGNIN_MS);
    }
  };
  // ---------- Blue screen (owner request, October 10, 2026) ----------
  // A critical process ended in PowerShell (features/guest-engine.js): the screen freezes
  // for a moment, then Winbows' stop screen counts its "collecting error info" to 100%
  // and the VM restarts through its BIOS (onRestart). Reduced motion skips the count.
  let crashed = false;
  const blueScreen = () => {
    if (crashed) return;
    crashed = true;
    if (root.contains(document.activeElement)) document.activeElement.blur();
    const percent = el('p', { className: 'bsod-percent', text: '0% complete' });
    root.appendChild(el('div', { className: 'bsod', attrs: { role: 'alert', 'aria-label': `${vm.id} stopped: CRITICAL_PROCESS_DIED` } }, [
      el('p', { className: 'bsod-face', text: ':(' }),
      el('p', { className: 'bsod-text', text: "Your PC ran into a problem and needs to restart. We're just collecting some error info, and then we'll restart for you." }),
      percent,
      el('div', { className: 'bsod-more' }, [
        el('span', { className: 'bsod-qr', attrs: { 'aria-hidden': 'true' } }),
        el('div', { className: 'bsod-info' }, [
          el('p', { text: 'For more information about this issue and possible fixes, search for the stop code.' }),
          el('p', { text: 'If you call a support person, give them this info:' }),
          el('p', { text: 'Stop code: CRITICAL_PROCESS_DIED' }),
        ]),
      ]),
    ]));
    const steps = reducedMotion ? [100] : [0, 0, 9, 21, 21, 45, 67, 82, 100];
    steps.forEach((n, i) => life.later(() => {
      percent.textContent = `${n}% complete`;
    }, 600 + i * 650));
    life.later(onRestart, 600 + steps.length * 650 + 1400);
  };

  // What the console asks of the desktop (layers/layer2.js passes the engine's events on).
  const guestEvent = (event) => {
    if (event === 'crash') life.later(blueScreen, reducedMotion ? 0 : 800);
    else if (event === 'close-console' && windows.isOpen('powershell')) windows.close('powershell');
  };

  // ---------- Screenshots (owner request, October 11, 2026) ----------
  // Print Screen (when the host lets the key through) or Snipping Tool's New screenshot:
  // the screen flashes, a toast says where it went, and Pictures\Screenshots gets a .png.
  // The picture itself is a frozen, inert copy of this desktop kept in memory for the page
  // (a copy of our own elements, never pixels or anything from outside); the file entry
  // is text like any other saved file, so it follows the same names, places and limits.
  // A screenshot from an earlier visit opens as "no longer available".
  const shots = new Map(); // file key -> the frozen copy
  const toast = el('div', { className: 'win-toast', attrs: { role: 'status' } });
  toast.hidden = true;
  const flash = el('div', { className: 'win-flash', attrs: { 'aria-hidden': 'true' } });
  flash.hidden = true;
  desktop.append(flash, toast);
  const two = (n) => String(n).padStart(2, '0');
  function takeScreenshot() {
    if (crashed) return;
    const pictures = [...guest.home, 'Pictures'];
    const folder = [...pictures, 'Screenshots'];
    if (!nodeAt(guest, pictures)) makeDir(guest, guest.home, 'Pictures');
    if (!nodeAt(guest, folder)) makeDir(guest, pictures, 'Screenshots');
    const now = new Date();
    const name = `Screenshot ${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}.png`;
    // The frozen copy: our own desktop, inert, without its menus and notices; text boxes
    // keep what they showed.
    const copy = desktop.cloneNode(true);
    for (const extra of copy.querySelectorAll('.win-context, .win-namer, .win-toast, .win-flash')) extra.remove();
    const before = [...desktop.querySelectorAll('textarea')];
    [...copy.querySelectorAll('textarea')].forEach((box, i) => {
      box.textContent = before[i] ? before[i].value : '';
    });
    copy.inert = true;
    copy.setAttribute('aria-hidden', 'true');
    const saved = saveFile(guest, folder, name, 'PNG image (simulated screenshot)');
    flash.hidden = false;
    life.later(() => {
      flash.hidden = true;
    }, reducedMotion ? 0 : 450);
    if (!saved.ok) {
      toast.textContent = "Couldn't save the screenshot: there is no room for more files.";
    } else {
      shots.set(guest.key(saved.node.path), copy);
      changed();
      toast.textContent = 'Screenshot saved. Find it in Pictures > Screenshots.';
    }
    toast.hidden = false;
    life.later(() => {
      toast.hidden = true;
    }, 3500);
  }
  function openPhotos(node) {
    const copy = shots.get(guest.key(node.path));
    const title = `${nameOf(node)} - Photos`;
    const body = el('div', { className: 'photos' }, [copy
      ? el('div', { className: 'photos-frame' }, [copy.cloneNode(true)])
      : el('p', { className: 'win-empty', text: 'This picture was taken in an earlier session and is no longer available.' })]);
    windows.retitle(windows.open('photos', title, body, box(0.12, 0.08, 0.66, 0.74)), title, body);
  }
  function openSnipping() {
    const take = el('button', { className: 'fm-button snip-new', text: '+ New screenshot' });
    take.addEventListener('click', () => {
      // The tool steps aside so it is not in its own picture.
      const app = windows.open('snipping');
      app.win.hidden = true;
      life.later(() => {
        takeScreenshot();
        app.win.hidden = false;
      }, 250);
    });
    windows.open('snipping', 'Snipping Tool', el('div', { className: 'snip' }, [
      take,
      el('p', { className: 'win-empty', text: 'Press Print Screen, or select New, to take a screenshot. It is saved to Pictures > Screenshots.' }),
    ]), box(0.3, 0.06, 0.4, 0.26));
  }
  life.listen(document, 'keyup', (event) => {
    if (event.key !== 'PrintScreen' || desktop.hidden || !root.isConnected) return;
    const frame = root.closest('.vm-window');
    if (frame && !frame.classList.contains('is-front')) return;
    takeScreenshot();
  });

  const openTickets = ticketsApp({ vm, guest, windows, life, changed, onEvent });
  // A notification in the corner (mission progress from layers/layer2.js).
  const notify = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    life.later(() => {
      toast.hidden = true;
    }, 4000);
  };

  if (autoStart) powerOn();
  else phase('off');

  return { node: root, start: powerOn, destroy: life.destroy, guestEvent, notify };
}

// ---------- ParrotOS ----------

const GRUB_SECONDS = 3; // the GRUB menu's countdown
const PARROT_SPLASH_MS = 2400; // the splash logo and its progress bar
const PARROT_LOGIN_MS = 2600; // the greeter typing the password, then "Logging in..."
const DAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);

// The Parrot menus' tool categories: labels only until the lab network segment brings the
// tools (fictional and answered from the lab map, doctrine section 7).
const PARROT_CATEGORIES = Object.freeze([
  'Information Gathering', 'Vulnerability Analysis', 'Web Application Analysis',
  'Password Attacks', 'Wireless Testing', 'Forensics', 'Reporting Tools',
]);

export function mountParrotDesktop({ vm, guest, consoleNode, resumed = false, reducedMotion = false, onPowerOff = () => {}, autoStart = true, running = () => true, onFilesChanged = () => {}, onEvent = () => {} }) {
  const life = lifecycle();

  // ---------- GRUB ----------
  const { node: grub, countdown } = grubScreen(['ParrotOS GNU/Linux', 'Advanced options for ParrotOS GNU/Linux', 'Memory test (memtest86+)'], GRUB_SECONDS);

  // ---------- Splash ----------
  const parrotMark = () => el('span', { className: 'parrot-mark', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span')]);
  const splash = el('div', { className: 'parrot-splash' }, [
    parrotMark(),
    el('p', { className: 'parrot-splash-name', text: 'parrot' }),
    el('span', { className: 'parrot-progress', attrs: { 'aria-hidden': 'true' } }, [el('span')]),
  ]);

  // ---------- Greeter ----------
  const dotsField = el('span', { className: 'parrot-password' });
  const loginState = el('p', { className: 'parrot-login-state', text: 'Password' });
  const greeter = el('div', { className: 'parrot-greeter' }, [
    el('div', { className: 'parrot-greeter-card' }, [
      el('span', { className: 'parrot-avatar', text: vm.user.charAt(0).toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'parrot-greeter-user', text: vm.user }),
      loginState,
      dotsField,
      el('p', { className: 'parrot-greeter-host', text: vm.host }),
    ]),
  ]);

  // ---------- Desktop ----------
  const area = el('div', { className: 'parrot-area' });
  const windowList = el('span', { className: 'parrot-window-list' });
  const clock = el('span', { className: 'parrot-clock' });
  const menuButton = (label) => el('button', { className: 'parrot-panel-menu', text: label, attrs: { 'aria-expanded': 'false', 'aria-haspopup': 'menu' } });
  const appsButton = menuButton('Applications');
  const placesButton = menuButton('Places');
  const systemButton = menuButton('System');
  const terminalLauncher = el('button', { className: 'parrot-launcher', text: '>_', attrs: { 'aria-label': 'Open Terminal', title: 'Terminal' } });
  // Parrot's panel has a browser launcher beside the terminal's.
  const firecatLauncher = el('button', { className: 'parrot-launcher parrot-launcher-firecat', attrs: { 'aria-label': 'Open Firecat ESR', title: 'Firecat ESR' } }, [
    el('span', { className: 'win-icon-glyph', attrs: { 'aria-hidden': 'true' } }),
  ]);
  const topPanel = el('div', { className: 'parrot-panel parrot-panel-top' }, [
    parrotMark(), appsButton, placesButton, systemButton, terminalLauncher, firecatLauncher,
    el('span', { className: 'parrot-panel-fill' }),
    el('span', { className: 'parrot-net', text: `eth0 ${vm.ip}`, attrs: { title: 'Wired connection (lab.example)' } }),
    clock,
  ]);
  const bottomPanel = el('div', { className: 'parrot-panel parrot-panel-bottom' }, [windowList]);
  const dropdown = el('div', { className: 'parrot-dropdown', attrs: { role: 'menu' } });
  dropdown.hidden = true;
  const desktop = el('div', { className: 'parrot-desktop', attrs: { role: 'region', 'aria-label': `${vm.id} desktop` } }, [topPanel, area, dropdown, bottomPanel]);
  const root = el('div', { className: 'win-root parrot-root' }, [grub, splash, greeter, desktop]);
  const phase = phases(root, { grub, splash, greeter, desktop });

  // ---------- Apps ----------
  const windows = appWindows({ area, tasks: windowList, consoleNode, consoleId: 'terminal' });
  const openTerminal = () => {
    windows.open('terminal', `${vm.user}@${vm.id}: ~`, consoleNode, box(0.16, 0.08, 0.64, 0.68));
    focusConsole(consoleNode);
  };
  let browser = null;
  const changed = () => {
    onFilesChanged();
    if (browser) browser.refresh();
  };
  const openEditor = editorApp({ windows, guest, id: 'editor', flavor: 'pluma', placement: box(0.28, 0.1, 0.52, 0.6), changed, opened: (path) => onEvent('opened', path) });
  const openTickets = ticketsApp({ vm, guest, windows, life, changed, onEvent });
  const openTrash = () => windows.open('trash', 'Trash', el('p', { className: 'win-empty', text: 'Trash is empty.' }), box(0.4, 0.3, 0.32, 0.3));
  // Caja, titled with the folder it shows, as MATE does.
  let filesApp = null;
  let filesTitle = vm.user;
  const openFiles = (segments = guest.home) => {
    if (!browser) {
      browser = linuxFileManager(guest, segments, openEditor, {
        flavor: 'caja',
        user: vm.user, onFilesChanged: changed, openTrash,
        setTitle: (title) => {
          filesTitle = title;
          if (filesApp && windows.isOpen('files')) windows.rename(filesApp, title);
        },
      });
    } else browser.show(segments);
    filesApp = windows.open('files', filesTitle, browser.node, box(0.06, 0.04, 0.78, 0.82));
  };
  const openFirecat = () => openBrowser({ windows, life, id: 'firecat', platform: 'parrot', running, reducedMotion, placement: box(0.08, 0.05, 0.76, 0.84) });
  const openAbout = () => windows.open('about', 'About this machine', el('div', { className: 'parrot-about' }, [
    parrotMark(),
    el('p', { className: 'parrot-about-name', text: 'ParrotOS 7.4 (simulated)' }),
    el('p', { text: `${vm.id} · ${vm.role}` }),
    el('p', { text: `${vm.host} · ${vm.ip}` }),
    el('p', { className: 'win-empty', text: 'Part of the wafflesOS lab. Everything here is simulated.' }),
  ]), box(0.34, 0.2, 0.34, 0.42));

  // Desktop icons as ParrotOS lays them out (owner screenshot, October 11, 2026): the
  // computer, the home folder, the README on the Desktop, then the lab's own shortcuts.
  const readme = [...guest.home, 'Desktop', 'README.license'];
  area.appendChild(desktopIcons([
    { id: 'computer', label: 'Parrot', glyph: '', open: () => openFiles([]) },
    { id: 'home', label: `${vm.user}'s Home`, glyph: '', open: () => openFiles(guest.home) },
    ...(nodeAt(guest, readme) ? [{ id: 'readme', label: 'README.license', glyph: '', open: () => openEditor(nodeAt(guest, readme)) }] : []),
    { id: 'terminal', label: 'Terminal', glyph: '>_', open: openTerminal },
    ...(missionsFor(vm.id).length ? [{ id: 'tickets', label: 'Tickets', glyph: '#', open: openTickets }] : []),
    { id: 'rules', label: 'rules.txt', glyph: 'txt', open: () => openEditor(nodeAt(guest, [...guest.home, 'notes', 'rules.txt'])) },
    { id: 'trash', label: 'Trash', glyph: '', open: openTrash },
  ], 'win-icons parrot-icons'));

  // ---------- Panel menus ----------
  let openMenu = null;
  const closeMenu = () => {
    dropdown.hidden = true;
    for (const button of [appsButton, placesButton, systemButton]) {
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('is-active');
    }
    openMenu = null;
  };
  const item = (label, action, disabled = false) => {
    const button = el('button', { className: 'parrot-menu-item', text: label, attrs: { role: 'menuitem' } });
    if (disabled) button.disabled = true;
    else {
      button.addEventListener('click', () => {
        closeMenu();
        action();
      });
    }
    return button;
  };
  const heading = (text) => el('p', { className: 'parrot-menu-heading', text });
  const MENUS = {
    apps: () => [
      heading('Accessories'), item('Pluma Text Editor', () => openEditor()),
      ...(missionsFor(vm.id).length ? [item('Tickets', openTickets)] : []),
      heading('Internet'), item('Firecat ESR', openFirecat),
      heading('System Tools'), item('MATE Terminal', openTerminal), item('Files', () => openFiles()),
      heading('Pentesting (tools arrive with the lab network)'),
      ...PARROT_CATEGORIES.map((name) => item(name, () => {}, true)),
    ],
    places: () => [
      item('Home Folder', () => openFiles(guest.home)),
      ...['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos', 'notes']
        .filter((name) => nodeAt(guest, [...guest.home, name]))
        .map((name) => item(name, () => openFiles([...guest.home, name]))),
      item('Computer', () => openFiles([])),
      item('Trash', openTrash),
    ],
    system: () => [
      item('About this machine', openAbout),
      item('Shut Down...', onPowerOff),
    ],
  };
  const toggle = (name, button) => {
    if (openMenu === name) {
      closeMenu();
      return;
    }
    closeMenu();
    dropdown.replaceChildren(...MENUS[name]());
    // Under its panel button.
    dropdown.style.left = `${Math.round(button.offsetLeft)}px`;
    dropdown.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    button.classList.add('is-active');
    openMenu = name;
    const first = dropdown.querySelector('button:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
  };
  life.listen(appsButton, 'click', () => toggle('apps', appsButton));
  life.listen(placesButton, 'click', () => toggle('places', placesButton));
  life.listen(systemButton, 'click', () => toggle('system', systemButton));
  life.listen(firecatLauncher, 'click', openFirecat);
  life.listen(terminalLauncher, 'click', openTerminal);
  life.listen(area, 'pointerdown', closeMenu);
  life.listen(dropdown, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  });

  // ---------- Clock: "Thu Oct 9, 03:21" ----------
  const tick = () => {
    const now = new Date();
    clock.textContent = `${DAYS[now.getDay()]} ${MONTHS[now.getMonth()]} ${now.getDate()}, ${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
  };
  tick();
  life.every(tick, 20000);

  // ---------- Power on: GRUB, splash, greeter, desktop ----------
  let started = false;
  const powerOn = () => {
    if (started) return;
    started = true;
    if (resumed || reducedMotion) {
      phase('desktop');
      return;
    }
    phase('grub');
    for (let s = 1; s <= GRUB_SECONDS; s += 1) life.later(() => { countdown.textContent = String(GRUB_SECONDS - s); }, s * 1000);
    const splashAt = GRUB_SECONDS * 1000 + 200;
    life.later(() => phase('splash'), splashAt);
    const loginAt = splashAt + PARROT_SPLASH_MS;
    life.later(() => phase('greeter'), loginAt);
    // The greeter types an 8-character password, then logs in.
    for (let i = 1; i <= 8; i += 1) life.later(() => { dotsField.textContent = '•'.repeat(i); }, loginAt + 500 + i * 110);
    life.later(() => { loginState.textContent = 'Logging in...'; }, loginAt + 1600);
    life.later(() => phase('desktop'), loginAt + PARROT_LOGIN_MS);
  };
  if (autoStart) powerOn();
  else phase('off');

  const notify = desktopToast(desktop, life, 'parrot-toast');
  return { node: root, start: powerOn, destroy: life.destroy, notify };
}

// ---------- Ubuntu (owner request, October 9, 2026: "a functioning desktop like the real thing") ----------
// Ubuntu 24.04 LTS with GNOME: the BIOS hands over to the Ubuntu splash, GDM signs the
// user in (the password types itself), then the desktop: the top bar (Activities, the
// clock in the middle, the system menu on the right), the Ubuntu Dock on the left with
// running-app dots, desktop icons, and the Activities overview's app grid. Apps:
// Terminal, Files, Text Editor, Settings (About), Trash, Tickets. The Ubuntu name and look are
// drawn in CSS; no logo artwork is copied.

const UBUNTU_SPLASH_MS = 2600; // the wordmark and the spinner under it
const UBUNTU_GDM_MS = 2800; // the user picked, the password typed, the screen fading
const UBUNTU_SPECS = Object.freeze({ memory: '4.0 GiB', cores: 2, disk: '25.0 GB' });

export function mountUbuntuDesktop({ vm, guest, consoleNode, resumed = false, reducedMotion = false, onPowerOff = () => {}, autoStart = true, running = () => true, onFilesChanged = () => {}, onEvent = () => {} }) {
  const life = lifecycle();

  // ---------- Splash and GDM ----------
  const splash = el('div', { className: 'ub-splash' }, [
    el('p', { className: 'ub-wordmark', text: 'ubuntu' }),
    el('span', { className: 'ub-spinner', attrs: { 'aria-hidden': 'true' } }),
    el('p', { className: 'ub-vendor', text: 'wafflesOS Virtual Platform' }),
  ]);
  const gdmClock = el('p', { className: 'ub-gdm-clock' });
  const gdmPassword = el('span', { className: 'ub-gdm-password' });
  const gdmField = el('div', { className: 'ub-gdm-field' }, [gdmPassword]);
  gdmField.hidden = true;
  const gdm = el('div', { className: 'ub-gdm' }, [
    gdmClock,
    el('div', { className: 'ub-gdm-card' }, [
      el('span', { className: 'ub-avatar', text: vm.user.charAt(0).toUpperCase(), attrs: { 'aria-hidden': 'true' } }),
      el('p', { className: 'ub-gdm-user', text: vm.user }),
      gdmField,
    ]),
  ]);

  // ---------- Desktop ----------
  const clock = el('button', { className: 'ub-clock' });
  const activities = el('button', { className: 'ub-activities', attrs: { 'aria-label': 'Activities', 'aria-pressed': 'false' } }, [
    el('span', { className: 'ub-pill' }), el('span', { className: 'ub-dot' }), el('span', { className: 'ub-dot' }),
  ]);
  const systemButton = el('button', { className: 'ub-system', attrs: { 'aria-label': 'System menu', 'aria-expanded': 'false' } }, [
    el('span', { className: 'ub-tray-net', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'ub-tray-vol', attrs: { 'aria-hidden': 'true' } }),
    el('span', { className: 'ub-tray-power', attrs: { 'aria-hidden': 'true' } }),
  ]);
  const topBar = el('div', { className: 'ub-topbar' }, [activities, el('span', { className: 'ub-topbar-fill' }), clock, el('span', { className: 'ub-topbar-fill' }), systemButton]);
  const dock = el('nav', { className: 'ub-dock', attrs: { 'aria-label': 'Dock' } });
  const area = el('div', { className: 'ub-area' });
  const grid = el('div', { className: 'ub-overview', attrs: { role: 'dialog', 'aria-label': 'Applications' } });
  grid.hidden = true;
  const systemMenu = el('div', { className: 'ub-system-menu', attrs: { role: 'menu' } });
  systemMenu.hidden = true;
  const hiddenTasks = el('span', { className: 'ub-tasks', attrs: { 'aria-hidden': 'true' } });
  const desktop = el('div', { className: 'ub-desktop', attrs: { role: 'region', 'aria-label': `${vm.id} desktop` } }, [
    topBar, el('div', { className: 'ub-body' }, [dock, area]), grid, systemMenu, hiddenTasks,
  ]);
  const root = el('div', { className: 'win-root ub-root' }, [splash, gdm, desktop]);
  const phase = phases(root, { splash, gdm, desktop });

  // ---------- Apps ----------
  const windows = appWindows({ area, tasks: hiddenTasks, consoleNode, consoleId: 'terminal', onChange: () => refreshDock() });
  const openTerminal = () => {
    windows.open('terminal', `${vm.user}@${vm.id}: ~`, consoleNode, box(0.14, 0.06, 0.62, 0.7));
    focusConsole(consoleNode);
  };
  let browser = null;
  const changed = () => {
    onFilesChanged();
    if (browser) browser.refresh();
  };
  const openEditor = editorApp({ windows, guest, id: 'editor', flavor: 'gnome', placement: box(0.26, 0.08, 0.52, 0.62), changed, opened: (path) => onEvent('opened', path) });
  // Tickets (Blue 1 on ubuntu-blue): only on a machine that seats a mission.
  const openTickets = ticketsApp({ vm, guest, windows, life, changed, onEvent });
  const openTrash = () => windows.open('trash', 'Trash', el('p', { className: 'win-empty', text: 'Trash is Empty' }), box(0.4, 0.28, 0.34, 0.32));
  // Files is Thunar (owner screenshot, October 12, 2026), titled "<folder> - File Manager".
  let filesApp = null;
  let filesTitle = `${vm.user} - File Manager`;
  const openFiles = (segments = guest.home) => {
    if (!browser) {
      browser = linuxFileManager(guest, segments, openEditor, {
        flavor: 'thunar', user: vm.user, onFilesChanged: changed, openTrash,
        setTitle: (title) => {
          filesTitle = title;
          if (filesApp && windows.isOpen('files')) windows.rename(filesApp, title);
        },
      });
    } else browser.show(segments);
    filesApp = windows.open('files', filesTitle, browser.node, box(0.12, 0.08, 0.66, 0.74));
  };
  const field = (label, value) => el('div', { className: 'ub-about-row' }, [el('span', { className: 'ub-about-label', text: label }), el('span', { text: value })]);
  const openSettings = () => windows.open('settings', 'Settings', el('div', { className: 'ub-about' }, [
    el('p', { className: 'ub-wordmark ub-wordmark-small', text: 'ubuntu' }),
    el('p', { className: 'ub-about-heading', text: 'About' }),
    field('Device Name', vm.id),
    field('Hardware Model', 'wafflesOS Virtual Platform'),
    field('Memory', UBUNTU_SPECS.memory),
    field('Processor', `Virtual CPU × ${UBUNTU_SPECS.cores}`),
    field('Disk Capacity', UBUNTU_SPECS.disk),
    field('OS Name', 'Ubuntu 24.04.1 LTS (simulated)'),
    field('OS Type', '64-bit'),
    field('GNOME Version', '46'),
    field('Windowing System', 'Wayland'),
    field('Network', `${vm.ip} · lab.example`),
  ]), box(0.26, 0.08, 0.46, 0.74));

  const openFirecat = () => openBrowser({ windows, life, id: 'firecat', platform: 'ubuntu', running, reducedMotion, placement: box(0.06, 0.03, 0.8, 0.88) });
  const APPS = [
    { id: 'firecat', label: 'Firecat', glyph: '', open: openFirecat },
    { id: 'files', label: 'Files', glyph: '', open: () => openFiles() },
    { id: 'terminal', label: 'Terminal', glyph: '>_', open: openTerminal },
    { id: 'editor', label: 'Text Editor', glyph: '', open: () => openEditor() },
    ...(missionsFor(vm.id).length ? [{ id: 'tickets', label: 'Tickets', glyph: '#', open: openTickets }] : []),
    { id: 'settings', label: 'Settings', glyph: '', open: openSettings },
  ];

  // The dock: favourites with a dot under each running app, Trash, and Show Apps last.
  const dockButtons = new Map();
  const dockItem = (app) => {
    const button = el('button', { className: `ub-dock-item ub-app-${app.id}`, attrs: { 'aria-label': app.label, title: app.label } }, [
      el('span', { className: 'ub-app-icon', text: app.glyph, attrs: { 'aria-hidden': 'true' } }),
      el('span', { className: 'ub-running', attrs: { 'aria-hidden': 'true' } }),
    ]);
    button.addEventListener('click', () => {
      closeOverlays();
      app.open();
    });
    dockButtons.set(app.id, button);
    return button;
  };
  const showApps = el('button', { className: 'ub-dock-item ub-show-apps', attrs: { 'aria-label': 'Show Apps', title: 'Show Apps' } }, [
    el('span', { className: 'ub-grid-glyph', attrs: { 'aria-hidden': 'true' } }, Array.from({ length: 9 }, () => el('span'))),
  ]);
  dock.append(...APPS.map(dockItem), el('span', { className: 'ub-dock-sep' }), dockItem({ id: 'trash', label: 'Trash', glyph: '', open: openTrash }), el('span', { className: 'ub-dock-fill' }), showApps);
  function refreshDock() {
    for (const [id, button] of dockButtons) button.classList.toggle('is-running', windows.isOpen(id));
  }

  // Desktop icons: the Home folder and Trash, as Ubuntu shows them.
  area.appendChild(desktopIcons([
    { id: 'home', label: vm.user, glyph: '', open: () => openFiles(guest.home) },
    { id: 'trash', label: 'Trash', glyph: '', open: openTrash },
  ], 'win-icons ub-icons'));

  // ---------- Overview (Activities / Show Apps) and the system menu ----------
  grid.append(
    el('p', { className: 'ub-overview-search', text: 'Type to search' }),
    el('div', { className: 'ub-overview-grid' }, [...APPS, { id: 'trash', label: 'Trash', glyph: '', open: openTrash }].map((app) => {
      const tile = el('button', { className: `ub-tile ub-app-${app.id}` }, [
        el('span', { className: 'ub-app-icon', text: app.glyph, attrs: { 'aria-hidden': 'true' } }),
        el('span', { text: app.label }),
      ]);
      tile.addEventListener('click', () => {
        closeOverlays();
        app.open();
      });
      return tile;
    })),
  );
  const powerOff = el('button', { className: 'ub-menu-row', text: 'Power Off...' });
  powerOff.addEventListener('click', () => {
    closeOverlays();
    onPowerOff();
  });
  const settingsRow = el('button', { className: 'ub-menu-row', text: 'Settings' });
  settingsRow.addEventListener('click', () => {
    closeOverlays();
    openSettings();
  });
  systemMenu.append(
    el('div', { className: 'ub-menu-tiles' }, [
      el('span', { className: 'ub-menu-tile is-on', text: 'Wired' }),
      el('span', { className: 'ub-menu-tile', text: 'Bluetooth' }),
      el('span', { className: 'ub-menu-tile', text: 'Night Light' }),
      el('span', { className: 'ub-menu-tile', text: 'Dark Style' }),
    ]),
    el('p', { className: 'ub-menu-note', text: `eth0 · ${vm.ip}` }),
    settingsRow,
    powerOff,
  );
  function closeOverlays() {
    grid.hidden = true;
    systemMenu.hidden = true;
    activities.setAttribute('aria-pressed', 'false');
    systemButton.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-overview');
  }
  const toggleOverview = () => {
    const open = grid.hidden;
    closeOverlays();
    grid.hidden = !open;
    activities.setAttribute('aria-pressed', open ? 'true' : 'false');
    root.classList.toggle('is-overview', open);
  };
  life.listen(activities, 'click', toggleOverview);
  life.listen(showApps, 'click', toggleOverview);
  life.listen(systemButton, 'click', () => {
    const open = systemMenu.hidden;
    closeOverlays();
    systemMenu.hidden = !open;
    systemButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  life.listen(area, 'pointerdown', closeOverlays);
  life.listen(desktop, 'keydown', (event) => {
    if (event.key === 'Escape') closeOverlays();
  });

  // ---------- Clock: "Oct 9  03:41" in the top bar, "03:41" on the login screen ----------
  const tick = () => {
    const now = new Date();
    const time = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
    clock.textContent = `${MONTHS[now.getMonth()]} ${now.getDate()}  ${time}`;
    gdmClock.textContent = time;
  };
  tick();
  life.every(tick, 20000);

  // ---------- Power on: splash, GDM, desktop ----------
  let started = false;
  const powerOn = () => {
    if (started) return;
    started = true;
    if (resumed || reducedMotion) {
      phase('desktop');
      return;
    }
    phase('splash');
    life.later(() => phase('gdm'), UBUNTU_SPLASH_MS);
    const gdmAt = UBUNTU_SPLASH_MS;
    life.later(() => { gdmField.hidden = false; }, gdmAt + 700);
    for (let i = 1; i <= 8; i += 1) life.later(() => { gdmPassword.textContent = '•'.repeat(i); }, gdmAt + 900 + i * 110);
    life.later(() => root.classList.add('is-signing-in'), gdmAt + UBUNTU_GDM_MS - 400);
    life.later(() => {
      root.classList.remove('is-signing-in');
      phase('desktop');
    }, gdmAt + UBUNTU_GDM_MS);
  };
  if (autoStart) powerOn();
  else phase('off');

  const notify = desktopToast(desktop, life, 'ub-toast');
  return { node: root, start: powerOn, destroy: life.destroy, notify };
}

// ---------- Ubuntu Server (web01) ----------
// A server has no desktop: GRUB, the systemd boot log and the tty1 login, then the console
// with the message of the day (data/images/ubuntuserver.js).

// The systemd boot log, as Ubuntu Server prints it on tty1. Authored; the times are fixed.
const UBUNTU_BOOT_LOG = Object.freeze([
  ['', '[    0.000000] Linux version 6.8.0-45-generic (buildd@lab.example) (simulated)'],
  ['', '[    0.412871] PCI: Using configuration type 1 for base access'],
  ['', '[    1.093310] virtio_net virtio1 eth0: renamed from ens3'],
  ['', '[    1.584022] EXT4-fs (vda2): mounted filesystem with ordered data mode.'],
  ['ok', 'Created slice system-modprobe.slice - Slice /system/modprobe.'],
  ['ok', 'Started systemd-journald.service - Journal Service.'],
  ['ok', 'Finished systemd-modules-load.service - Load Kernel Modules.'],
  ['ok', 'Mounted sys-fs-fuse-connections.mount - FUSE Control File System.'],
  ['ok', 'Finished systemd-fsck-root.service - File System Check on Root Device.'],
  ['ok', 'Reached target local-fs.target - Local File Systems.'],
  ['ok', 'Started systemd-networkd.service - Network Configuration.'],
  ['ok', 'Reached target network.target - Network.'],
  ['ok', 'Started systemd-resolved.service - Network Name Resolution.'],
  ['ok', 'Finished cloud-init.service - Cloud-init: Network Stage.'],
  ['ok', 'Started rsyslog.service - System Logging Service.'],
  ['ok', 'Started cron.service - Regular background program processing daemon.'],
  ['ok', 'Started ssh.service - OpenBSD Secure Shell server.'],
  ['ok', 'Started systemd-logind.service - User Login Management.'],
  ['ok', 'Started getty@tty1.service - Getty on tty1.'],
  ['ok', 'Reached target multi-user.target - Multi-User System.'],
]);
const UBUNTU_GRUB_SECONDS = 3;
const UBUNTU_LOG_STEP_MS = 140; // between boot log lines

export function mountUbuntuServer({ vm, consoleNode, resumed = false, reducedMotion = false, autoStart = true }) {
  const life = lifecycle();
  const { node: grub, countdown } = grubScreen(['Ubuntu', 'Advanced options for Ubuntu', 'Memory test (memtest86+x64.efi)'], UBUNTU_GRUB_SECONDS);

  // The boot log: lines appear one at a time, the newest at the bottom.
  const log = el('div', { className: 'ubuntu-log' }, UBUNTU_BOOT_LOG.map(([tone, text]) => (tone === 'ok'
    ? el('p', { className: 'ubuntu-log-line' }, [el('span', { className: 'ubuntu-ok', text: '[  OK  ]' }), ` ${text}`])
    : el('p', { className: 'ubuntu-log-line ubuntu-kernel', text }))));

  // tty1: the login prompt types the user name; the password does not echo, as on Linux.
  const typedUser = el('span');
  const passwordLine = el('p', { className: 'ubuntu-login-line', text: 'Password: ' });
  passwordLine.hidden = true;
  const login = el('div', { className: 'ubuntu-login' }, [
    el('p', { className: 'ubuntu-login-line', text: `Ubuntu 24.04.1 LTS ${vm.id} tty1` }),
    el('p', { className: 'ubuntu-login-line', text: ' ' }),
    el('p', { className: 'ubuntu-login-line' }, [`${vm.id} login: `, typedUser]),
    passwordLine,
  ]);

  const shell = el('div', { className: 'ubuntu-shell' }, [consoleNode]);
  const root = el('div', { className: 'ubuntu-root' }, [grub, log, login, shell]);
  const phase = phases(root, { grub, log, login, shell });

  let started = false;
  const powerOn = () => {
    if (started) return;
    started = true;
    if (resumed || reducedMotion) {
      phase('shell');
      return;
    }
    phase('grub');
    for (let s = 1; s <= UBUNTU_GRUB_SECONDS; s += 1) life.later(() => { countdown.textContent = String(UBUNTU_GRUB_SECONDS - s); }, s * 1000);
    const logAt = UBUNTU_GRUB_SECONDS * 1000 + 200;
    life.later(() => phase('log'), logAt);
    [...log.children].forEach((line, i) => life.later(() => line.classList.add('is-shown'), logAt + 150 + i * UBUNTU_LOG_STEP_MS));
    const loginAt = logAt + 300 + UBUNTU_BOOT_LOG.length * UBUNTU_LOG_STEP_MS;
    life.later(() => phase('login'), loginAt);
    [...vm.user].forEach((ch, i) => life.later(() => { typedUser.textContent += ch; }, loginAt + 600 + i * 120));
    const passwordAt = loginAt + 900 + vm.user.length * 120;
    life.later(() => { passwordLine.hidden = false; }, passwordAt);
    life.later(() => {
      phase('shell');
      focusConsole(consoleNode);
    }, passwordAt + 1100);
  };
  if (autoStart) powerOn();
  else phase('off');

  return { node: root, start: powerOn, destroy: life.destroy };
}

// ---------- Serial consoles (router01, cam01) ----------
// A network appliance in a hypervisor shows its serial console, not a desktop. The image's
// `serial` list (data/images/openwrt.js, ipcam.js) is the boot text: lines print one after
// another, a line with `countdown` counts down in place, and `grub` adds a GRUB menu first.
// Then the console takes over (the router's shell, the camera's login prompt).
const SERIAL_STEP_MS = 110;

export function mountSerialConsole({ vm, guest, consoleNode, resumed = false, reducedMotion = false, autoStart = true }) {
  const life = lifecycle();
  const script = guest.image.serial || { lines: [] };
  const grub = script.grub ? grubScreen(script.grub, 3) : null;
  let countdownNode = null;
  const lines = script.lines.map((line) => {
    const text = line.text.replace(/\{(id|ip|host)\}/g, (match, field) => vm[field]);
    if (line.countdown) {
      countdownNode = el('span', { text: String(line.countdown) });
      return el('p', { className: 'serial-line' }, [text, countdownNode]);
    }
    return el('p', { className: `serial-line${line.tone ? ` serial-${line.tone}` : ''}`, text });
  });
  const log = el('div', { className: 'serial-log' }, lines);
  const shell = el('div', { className: 'serial-shell' }, [consoleNode]);
  const screens = grub ? { grub: grub.node, log, shell } : { log, shell };
  const root = el('div', { className: 'serial-root' }, Object.values(screens));
  const phase = phases(root, screens);

  let started = false;
  const powerOn = () => {
    if (started) return;
    started = true;
    if (resumed || reducedMotion) {
      phase('shell');
      return;
    }
    let at = 0;
    if (grub) {
      phase('grub');
      for (let s = 1; s <= 3; s += 1) life.later(() => { grub.countdown.textContent = String(3 - s); }, s * 1000);
      at = 3200;
    }
    life.later(() => phase('log'), at);
    lines.forEach((line, i) => {
      const step = script.lines[i];
      at += step.pause || SERIAL_STEP_MS;
      life.later(() => {
        line.classList.add('is-shown');
        log.scrollTop = log.scrollHeight;
      }, at);
      if (step.countdown) {
        for (let n = step.countdown - 1; n >= 0; n -= 1) {
          at += 1000;
          life.later(() => { countdownNode.textContent = String(n); }, at);
        }
      }
    });
    life.later(() => {
      phase('shell');
      focusConsole(consoleNode);
    }, at + 900);
  };
  if (autoStart) powerOn();
  else phase('off');

  return { node: root, start: powerOn, destroy: life.destroy };
}

// ---------- Shutting down (owner request, October 10, 2026) ----------
// Each image powers off in its own OS's way (data/images/*.js, shutdown):
//   - winbows: the dark screen with the spinning dots and "Shutting down"
//   - splash: Ubuntu's splash, the wordmark and spinner, as Plymouth shows on the way down
//   - log: systemd or BusyBox lines, the way a console prints its shutdown
// layers/layer2.js shows it in the VM, then switches the window off. Returns the node and
// how long it runs (ms); destroy() clears its timers.
const SHUTDOWN_LINE_MS = 230;

export function shutdownScreen(vm, image) {
  const life = lifecycle();
  const plan = image.shutdown || { style: 'log', lines: ['reboot: Power down'] };
  if (plan.style === 'winbows') {
    const dots = el('span', { className: 'win-dots', attrs: { 'aria-hidden': 'true' } }, [el('span'), el('span'), el('span'), el('span'), el('span')]);
    const node = el('div', { className: 'sd sd-winbows', attrs: { role: 'status' } }, [dots, el('p', { text: 'Shutting down' })]);
    return { node, ms: 2600, destroy: life.destroy };
  }
  if (plan.style === 'splash') {
    const node = el('div', { className: 'sd sd-splash', attrs: { role: 'status', 'aria-label': 'Shutting down' } }, [
      el('p', { className: 'ub-wordmark', text: 'ubuntu' }),
      el('span', { className: 'ub-spinner', attrs: { 'aria-hidden': 'true' } }),
    ]);
    return { node, ms: 2400, destroy: life.destroy };
  }
  // A console log: lines print one after another; [  OK  ] marks are green.
  const lines = plan.lines.map((text) => {
    const line = text.startsWith('[  OK  ]')
      ? el('p', { className: 'sd-line' }, [el('span', { className: 'ubuntu-ok', text: '[  OK  ]' }), text.slice(8)])
      : el('p', { className: 'sd-line', text });
    return line;
  });
  const node = el('div', { className: 'sd sd-log', attrs: { role: 'status', 'aria-label': `${vm.id} shutting down` } }, lines);
  lines.forEach((line, i) => life.later(() => {
    line.classList.add('is-shown');
    node.scrollTop = node.scrollHeight;
  }, 150 + i * SHUTDOWN_LINE_MS));
  return { node, ms: 150 + lines.length * SHUTDOWN_LINE_MS + 700, destroy: life.destroy };
}
