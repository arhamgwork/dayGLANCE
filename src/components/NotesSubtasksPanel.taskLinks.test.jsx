import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import TaskPeek from './TaskPeek.jsx';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { PEEK_TASK_EVENT, findTaskLinks, taskLink } from '../utils/followUp.js';

// The peek renders through a portal; with no DOM it renders in place.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

// #2145: `@@` in a task's note opens a picker that inserts a link to another
// task, and a task lists the tasks whose notes link to it.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

// No DOM: the note's node is a mock that remembers its value and caret.
beforeEach(() => {
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.window = globalThis.window || {};
});
afterEach(() => { delete globalThis.requestAnimationFrame; });

const ROOF = { id: 'r1', title: 'Roof repair', date: '2026-10-20' };
const QUOTE = { id: 'q1', title: 'Roofing quote', date: '2026-10-22' };
const noop = () => {};

function mount(task, { tasks = [ROOF, QUOTE], unscheduledTasks = [], updateTaskNotes = vi.fn() } = {}) {
  const field = { value: '', selectionStart: 0, selectionEnd: 0, style: {}, focus: vi.fn(), setSelectionRange: vi.fn() };
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{ tasks, unscheduledTasks }}>
          <NotesSubtasksPanel
            task={task} isInbox darkMode={false} noAutoFocus
            updateTaskNotes={updateTaskNotes} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop}
          />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: (el) => (el.type === 'textarea' ? field : { style: {} }) },
    );
  });
  const note = () => root.root.findByProps({ 'aria-label': 'Notes' });
  const type = (value) => {
    field.value = value; field.selectionStart = field.selectionEnd = value.length;
    act(() => { note().props.onChange({ target: field }); });
  };
  const key = (k, extra = {}) => {
    const e = { key: k, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    act(() => { note().props.onKeyDown(e); });
    return e;
  };
  const options = () => root.root.findAll(n => n.props['data-task-link-option'] !== undefined && n.type === 'div').map(n => n.props['data-task-link-option']);
  const picker = () => root.root.findAll(n => n.props['data-task-link-picker'] && n.type === 'div');
  return { root, note, type, key, options, picker, field, updateTaskNotes };
}

describe('the @@ task picker in a note', () => {
  it('opens on @@, narrows as you type, and leaves out the task being edited', () => {
    const { type, options, picker } = mount({ id: 'me', title: 'Roof meeting', notes: '' }, { tasks: [ROOF, QUOTE, { id: 'me', title: 'Roof meeting' }] });
    type('Waiting on ');
    expect(picker()).toHaveLength(0);
    type('Waiting on @@');
    expect(options()).toEqual(['q1', 'r1']);
    type('Waiting on @@roof r');
    expect(options()).toEqual(['r1']);
  });

  it('Enter inserts a link to the highlighted task, which renders and resolves, and closes the picker', () => {
    const { type, key, note, picker, field } = mount({ id: 'me', title: 'Call roofer', notes: '' });
    type('See @@roo');
    key('ArrowDown');
    const enter = key('Enter');
    expect(enter.preventDefault).toHaveBeenCalled();
    const text = note().props.value;
    expect(text).toBe(`See ${taskLink(ROOF)} `);
    expect(findTaskLinks(text).map(l => l.id)).toEqual(['r1']);
    expect(picker()).toHaveLength(0);
    expect(field.setSelectionRange).toHaveBeenCalledWith(text.length, text.length);
  });

  it('a click on an option inserts it too; Escape closes without inserting and stops there', () => {
    const { type, key, note, root, picker } = mount({ id: 'me', title: 'x', notes: '' });
    type('@@quote');
    const option = root.root.find(n => n.props['data-task-link-option'] === 'q1' && n.type === 'div');
    act(() => { option.props.onMouseDown({ preventDefault: noop }); });
    expect(note().props.value).toBe(`${taskLink(QUOTE)} `);

    type(`${taskLink(QUOTE)} more @@ro`);
    const esc = key('Escape');
    expect(esc.stopPropagation).toHaveBeenCalled();
    expect(picker()).toHaveLength(0);
    expect(note().props.value).toBe(`${taskLink(QUOTE)} more @@ro`);
  });

  it('with the picker closed, Enter is an ordinary new line and Shift+Enter still saves', () => {
    const { type, key, updateTaskNotes } = mount({ id: 'me', title: 'x', notes: '' });
    type('plain text');
    expect(key('Enter').preventDefault).not.toHaveBeenCalled();
    key('Enter', { shiftKey: true });
    expect(updateTaskNotes).toHaveBeenCalledWith('me', 'plain text', true);
  });
});

describe('Linked from', () => {
  it('lists the tasks whose notes link here, and each opens in the task peek', () => {
    const linker = { id: 'a', title: 'Call the roofer', notes: `About ${taskLink(ROOF)}` };
    const { root } = mount(ROOF, { tasks: [ROOF, linker] });
    const backlink = root.root.find(n => n.props['data-task-backlink'] === 'a');
    const events = [];
    globalThis.window.dispatchEvent = (e) => events.push(e);
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
    act(() => { backlink.props.onClick({ stopPropagation: noop }); });
    expect(events.map(e => [e.type, e.detail.id])).toEqual([[PEEK_TASK_EVENT, 'a']]);
  });

  it('is absent when nothing links here', () => {
    const { root } = mount(ROOF);
    expect(root.root.findAll(n => n.props['data-task-backlinks'])).toHaveLength(0);
  });
});

describe('the task peek', () => {
  it('names a linked task generically and lists its backlinks', () => {
    globalThis.document = { body: {} };
    globalThis.window.addEventListener = noop;
    globalThis.window.removeEventListener = noop;
    let root;
    act(() => {
      root = create(
        <I18nextProvider i18n={i18n}>
          <TaskPeek found={{ task: ROOF, where: 'calendar' }} backlinks={[{ task: { id: 'a' }, title: 'Call the roofer' }]} onClose={noop} darkMode={false} />
        </I18nextProvider>,
        { createNodeMock: () => ({ focus: noop }) },
      );
    });
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Linked task');
    expect(text).toContain('Linked from');
    expect(text).toContain('Call the roofer');
    delete globalThis.document;
  });
});
