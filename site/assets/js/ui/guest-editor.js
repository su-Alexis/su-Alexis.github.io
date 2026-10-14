// Layer 2: the text editors on the guest desktops (owner request, October 10, 2026):
// Notepad on Winbows (ws01, dc01), Text Editor on Ubuntu (GNOME Text Editor) and Pluma on
// ParrotOS. Used by ui/guest-desktop.js, which puts one in an app window.
//
// New, Open, Save and Save As, with each OS's own menus, title ("*notes.txt - Notepad")
// and status bar, plus a file dialog that browses the VM's tree and makes new folders.
// Saving goes through features/guest-engine.js (saveFile, makeDir): names are checked,
// the user may only write in their own home, text is capped and kept as text. The
// desktop's onFilesChanged() then stores the VM's files for the session
// (ui/vm-session.js, doctrine section 8). Nothing here parses or renders markup: the
// textarea's value is a string, and every message is fixed text that never repeats a
// typed name.

import { el } from '../utils/dom.js';
import { children, nameOf, nodeAt, showPath, saveFile, makeDir, canWrite } from '../features/guest-engine.js';
import { VM_FILES } from '../core/constants.js';

// Each editor's own words.
const FLAVORS = Object.freeze({
  notepad: Object.freeze({ app: 'Notepad', untitled: 'Untitled', dirty: '*', saveAs: 'Save as', open: 'Open', newFolder: 'New folder', fileName: 'File name:' }),
  gnome: Object.freeze({ app: 'Text Editor', untitled: 'New Document', dirty: '*', saveAs: 'Save As', open: 'Open File', newFolder: 'New Folder', fileName: 'Name' }),
  pluma: Object.freeze({ app: 'Pluma', untitled: 'Unsaved Document 1', dirty: '*', saveAs: 'Save As…', open: 'Open Files…', newFolder: 'Create Folder', fileName: 'Name:' }),
});

// What went wrong, in each family's words. Never the typed name.
const PROBLEMS = Object.freeze({
  winbows: Object.freeze({
    name: 'The file name is not valid.',
    denied: "You don't have permission to save in this location. Contact the administrator to obtain permission.",
    full: 'There is not enough space on the disk.',
    folder: 'That name is already used by a folder.',
    exists: 'A folder with that name already exists.',
    big: 'This file is too large to save.',
    missing: 'The folder no longer exists.',
    replace: 'A file with that name already exists. Do you want to replace it?',
    unsaved: 'Do you want to save your changes?',
  }),
  linux: Object.freeze({
    name: 'That name is not valid. Use letters, numbers, spaces, dots, dashes and underscores.',
    denied: 'You do not have the permissions necessary to save the file.',
    full: 'No space left on device.',
    folder: 'A folder with that name already exists.',
    exists: 'A folder with that name already exists.',
    big: 'The file is too large to save.',
    missing: 'The folder no longer exists.',
    replace: 'A file with that name already exists. Replacing it will overwrite its contents.',
    unsaved: 'Save changes to this document before closing it?',
  }),
});

const button = (className, text, label) => el('button', { className, text, attrs: label ? { 'aria-label': label } : {} });

// guest: the VM (features/guest-engine.js bootGuest). flavor: notepad, gnome or pluma.
// onTitle(text): the window title changed. onFilesChanged(): the VM's files changed.
export function createEditor({ guest, flavor = 'notepad', onTitle = () => {}, onFilesChanged = () => {} }) {
  const words = FLAVORS[flavor] || FLAVORS.notepad;
  const problems = guest.winbows ? PROBLEMS.winbows : PROBLEMS.linux;
  const documents = nodeAt(guest, [...guest.home, 'Documents']);
  const defaultDir = () => (documents && documents.dir ? [...documents.path] : [...guest.home]);
  let file = null; // the node being edited, or null for a new document
  let saved = '';
  let dirty = false;

  // ---------- The page ----------
  const text = el('textarea', { className: 'ed-text', attrs: { 'aria-label': `${words.app} document` } });
  text.spellcheck = false;
  text.maxLength = VM_FILES.content;
  const status = el('div', { className: 'ed-status', attrs: { 'aria-live': 'off' } });
  const dialog = el('div', { className: 'ed-dialog', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  dialog.hidden = true;

  const ACTIONS = [
    ['New', () => guard(newDocument), 'Ctrl+N'],
    [words.open, () => guard(() => fileDialog('open')), 'Ctrl+O'],
    ['Save', () => save(), 'Ctrl+S'],
    [words.saveAs, () => fileDialog('save'), 'Ctrl+Shift+S'],
  ];

  // A menu bar with a working File menu (Notepad, Pluma); the other menus are labels.
  function menuBar(names) {
    const drop = el('div', { className: 'ed-drop', attrs: { role: 'menu' } });
    drop.hidden = true;
    const file = button('ed-menu ed-menu-file', 'File');
    file.setAttribute('aria-haspopup', 'menu');
    drop.append(...ACTIONS.map(([label, run, keys]) => {
      const item = el('button', { className: 'ed-drop-item', attrs: { role: 'menuitem' } }, [el('span', { text: label }), el('span', { className: 'ed-keys', text: keys })]);
      item.addEventListener('click', () => {
        drop.hidden = true;
        run();
      });
      return item;
    }));
    file.addEventListener('click', () => {
      drop.hidden = !drop.hidden;
    });
    text.addEventListener('focus', () => {
      drop.hidden = true;
    });
    return el('div', { className: 'ed-menubar' }, [file, ...names.map((name) => el('span', { className: 'ed-menu', text: name })), drop]);
  }

  let chrome;
  if (flavor === 'gnome') {
    // GNOME Text Editor's header bar: Open, New, the title, Save, the main menu.
    const [newAction, openAction, saveAction, saveAsAction] = ACTIONS;
    const open = button('ed-hb ed-hb-open', 'Open', 'Open a file');
    const plus = button('ed-hb ed-hb-new', '+', 'New document');
    const save = button('ed-hb ed-hb-save', 'Save', 'Save');
    const more = button('ed-hb ed-hb-menu', 'Save As…', 'Save as');
    open.addEventListener('click', openAction[1]);
    plus.addEventListener('click', newAction[1]);
    save.addEventListener('click', saveAction[1]);
    more.addEventListener('click', saveAsAction[1]);
    chrome = el('div', { className: 'ed-headerbar' }, [open, plus, el('span', { className: 'ed-hb-fill' }), save, more]);
  } else if (flavor === 'pluma') {
    const tools = el('div', { className: 'ed-toolbar' }, ACTIONS.slice(0, 3).map(([label, run]) => {
      const item = button('ed-tool', label);
      item.addEventListener('click', run);
      return item;
    }));
    chrome = el('div', {}, [menuBar(['Edit', 'View', 'Search', 'Tools', 'Documents', 'Help']), tools]);
  } else {
    chrome = menuBar(['Edit', 'View']);
  }
  const node = el('div', { className: `ed ed-${flavor}` }, [chrome, text, status, dialog]);

  // ---------- State ----------
  const name = () => (file ? nameOf(file) : words.untitled);
  function refresh() {
    dirty = text.value !== saved;
    onTitle(`${dirty ? words.dirty : ''}${name()} - ${words.app}`);
    const before = text.value.slice(0, text.selectionStart || 0).split('\n');
    const line = before.length;
    const col = before[before.length - 1].length + 1;
    status.textContent = flavor === 'notepad'
      ? `Ln ${line}, Col ${col}    ${text.value.length} characters    100%    Winbows (CRLF)    UTF-8`
      : flavor === 'pluma' ? `Plain Text    Tab Width: 8    Ln ${line}, Col ${col}    INS` : `Ln ${line}, Col ${col}`;
  }
  for (const type of ['input', 'keyup', 'click']) text.addEventListener(type, refresh);

  function load(target) {
    file = target && !target.dir ? target : null;
    saved = file ? file.content : '';
    text.value = saved;
    text.setSelectionRange(0, 0);
    refresh();
  }
  function newDocument() {
    load(null);
    text.focus({ preventScroll: true });
  }

  // Saves to the current file, or asks where when it has none.
  function save() {
    if (!file) {
      fileDialog('save');
      return;
    }
    write(file.path.slice(0, -1), nameOf(file));
  }
  // Returns the problem key, or null when it saved.
  function write(parent, fileName) {
    const result = saveFile(guest, parent, fileName, text.value);
    if (!result.ok) return result.error;
    file = result.node;
    saved = file.content;
    if (text.value !== saved) text.value = saved;
    refresh();
    onFilesChanged();
    return null;
  }

  // Unsaved changes ask first: save, don't save, or cancel.
  function guard(next) {
    if (!dirty) {
      next();
      return;
    }
    ask(problems.unsaved, [
      ['Save', () => {
        if (file) {
          const problem = write(file.path.slice(0, -1), nameOf(file));
          if (problem) ask(problems[problem], [['OK', () => {}]]);
          else next();
        } else fileDialog('save', next);
      }],
      ["Don't save", next],
      ['Cancel', () => {}],
    ]);
  }

  // A small question box over the editor.
  function ask(message, choices) {
    dialog.replaceChildren(el('div', { className: 'ed-box ed-ask' }, [
      el('p', { className: 'ed-ask-text', text: message }),
      el('div', { className: 'ed-buttons' }, choices.map(([label, run], i) => {
        const choice = button(`ed-button${i === 0 ? ' is-default' : ''}`, label);
        choice.addEventListener('click', () => {
          close();
          run();
        });
        return choice;
      })),
    ]));
    dialog.hidden = false;
    const first = dialog.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    dialog.hidden = true;
    dialog.replaceChildren();
    text.focus({ preventScroll: true });
  }

  // ---------- The file dialog (Open, Save As) ----------
  // Browses the VM's tree from a folder; makes folders; the name field (Save As) is
  // checked by the engine. after(): what to do once it has saved (New or Open waiting).
  function fileDialog(mode, after = () => {}) {
    let at = file ? file.path.slice(0, -1) : defaultDir();
    let picked = null;
    let replace = false;
    const where = el('p', { className: 'ed-where' });
    const list = el('ul', { className: 'ed-list', attrs: { role: 'listbox' } });
    const message = el('p', { className: 'ed-message', attrs: { role: 'alert' } });
    const field = el('input', { className: 'ed-name', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(VM_FILES.name), 'aria-label': 'File name' } });
    const folderField = el('input', { className: 'ed-name', attrs: { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(VM_FILES.name), 'aria-label': 'Folder name' } });
    const folderRow = el('div', { className: 'ed-row ed-folder-row' }, [folderField, button('ed-button', 'Create'), button('ed-button', 'Cancel')]);
    folderRow.hidden = true;
    const say = (key) => {
      message.textContent = key ? problems[key] : '';
    };

    function show(segments) {
      const dir = nodeAt(guest, segments);
      if (!dir || !dir.dir) return;
      at = [...segments];
      picked = null;
      replace = false;
      where.textContent = showPath(guest, at);
      const entries = [...children(guest, dir)].sort((a, b) => Number(b.dir) - Number(a.dir));
      const up = at.length ? [{ up: true }] : [];
      list.replaceChildren(...[...up, ...entries].map((entry) => {
        const label = entry.up ? '..' : nameOf(entry);
        const item = el('button', { className: `ed-item${entry.up || entry.dir ? ' is-folder' : ''}`, text: label, attrs: { role: 'option' } });
        item.addEventListener('click', () => {
          if (entry.up) show(at.slice(0, -1));
          else if (entry.dir) show(entry.path);
          else {
            picked = entry;
            for (const other of list.querySelectorAll('.ed-item')) other.classList.toggle('is-picked', other === item);
            if (mode === 'save') field.value = nameOf(entry);
          }
        });
        item.addEventListener('dblclick', () => {
          if (!entry.up && !entry.dir) confirm();
        });
        return el('li', {}, [item]);
      }));
      say(mode === 'save' && !canWrite(guest, at) ? 'denied' : null);
    }

    function confirm() {
      if (mode === 'open') {
        if (!picked) return;
        const target = picked;
        close();
        load(target);
        return;
      }
      const wanted = field.value.trim();
      const existing = nodeAt(guest, [...at, wanted]);
      if (existing && !existing.dir && !replace && !(file && existing === file)) {
        replace = true;
        message.textContent = problems.replace;
        primary.textContent = 'Replace';
        return;
      }
      const problem = write([...at], wanted);
      if (problem) {
        replace = false;
        primary.textContent = 'Save';
        say(problem);
        return;
      }
      close();
      after();
    }

    const newFolder = button('ed-button ed-new-folder', words.newFolder);
    newFolder.addEventListener('click', () => {
      folderRow.hidden = false;
      folderField.value = '';
      folderField.focus({ preventScroll: true });
    });
    const makeFolder = () => {
      const made = makeDir(guest, at, folderField.value.trim());
      if (!made.ok) {
        say(made.error);
        return;
      }
      folderRow.hidden = true;
      onFilesChanged();
      show(made.node.path);
    };
    folderRow.children[1].addEventListener('click', makeFolder);
    folderRow.children[2].addEventListener('click', () => {
      folderRow.hidden = true;
    });
    folderField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') makeFolder();
    });
    const primary = button('ed-button is-default', mode === 'open' ? 'Open' : 'Save');
    primary.addEventListener('click', confirm);
    const cancel = button('ed-button', 'Cancel');
    cancel.addEventListener('click', close);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') confirm();
    });
    field.addEventListener('input', () => {
      replace = false;
      primary.textContent = 'Save';
    });
    dialog.replaceChildren(el('div', { className: 'ed-box ed-files' }, [
      el('p', { className: 'ed-box-title', text: mode === 'open' ? words.open : words.saveAs }),
      el('div', { className: 'ed-row' }, [where, newFolder]),
      folderRow,
      list,
      ...(mode === 'save' ? [el('div', { className: 'ed-row' }, [el('span', { className: 'ed-label', text: words.fileName }), field])] : []),
      message,
      el('div', { className: 'ed-buttons' }, [primary, cancel]),
    ]));
    dialog.hidden = false;
    if (mode === 'save') field.value = file ? nameOf(file) : guest.winbows ? 'Untitled.txt' : 'untitled.txt';
    show(at);
    (mode === 'save' ? field : primary).focus({ preventScroll: true });
    if (mode === 'save') field.select();
  }
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  // Ctrl+S, Ctrl+Shift+S, Ctrl+N, Ctrl+O, as in all three editors.
  text.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const run = key === 's' ? (event.shiftKey ? ACTIONS[3][1] : ACTIONS[2][1]) : key === 'n' ? ACTIONS[0][1] : key === 'o' ? ACTIONS[1][1] : null;
    if (run) {
      event.preventDefault();
      run();
    }
  });

  load(null);
  return {
    node,
    // Opens a file (from a file manager or a desktop icon), asking about unsaved changes.
    open: (target) => guard(() => load(target)),
    focus: () => text.focus({ preventScroll: true }),
  };
}
