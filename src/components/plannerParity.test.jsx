import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import TaskNotesPane from './TaskNotesPane.jsx';
import SchedTaskCard from './sched/SchedTaskCard.jsx';

// The card's notes panel renders through a portal; with no DOM, in place.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

// #2132: the Project Planner's task pane renames in place, and its rows (and
// every SchedTaskCard) open the app's task menu on right-click.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const noop = () => {};
const base = {
  darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
  formatTime: (t) => t, toggleComplete: noop, openMobileEditTask: vi.fn(), currentTime: new Date(), postponeTask: noop,
  updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
  tasks: [], unscheduledTasks: [], recurringTasks: [],
};
const features = { projects: [], goalsProjectsEnabled: false, generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null };

function render(el, planner) {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{ ...base, ...planner }}>
          <FeaturesContext.Provider value={features}>
            <SyncContext.Provider value={{}}>{el}</SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: () => ({ style: {}, focus: noop }) },
    );
  });
  return root;
}

describe('the planner pane\'s title renames in place', () => {
  const task = { id: 't1', title: 'Roof repair #home', color: 'bg-blue-500', notes: '', subtasks: [] };
  const editing = (over = {}) => ({
    editingTaskId: null, editingTaskText: '', setEditingTaskText: vi.fn(),
    startEditingTask: vi.fn(), saveTaskTitle: vi.fn(), cancelEditingTask: vi.fn(), ...over,
  });

  it('a click starts the app\'s own rename, with the Inbox flag the pane knows', () => {
    const ctx = editing({ unscheduledTasks: [task] });
    const root = render(<TaskNotesPane task={task} />, ctx);
    act(() => { root.root.findByProps({ 'data-pane-title': true }).props.onClick(); });
    expect(ctx.startEditingTask).toHaveBeenCalledWith(task, true);
  });

  it('Enter saves once: the blur as the field goes does not save again', () => {
    const ctx = editing({ editingTaskId: 't1', editingTaskText: 'Roof repair (urgent)' });
    const root = render(<TaskNotesPane task={task} />, ctx);
    const input = root.root.findByProps({ 'data-pane-title-input': true });
    expect(input.props['data-owns-escape']).toBe(true);
    act(() => { input.props.onKeyDown({ key: 'Enter', preventDefault: noop }); });
    act(() => { input.props.onBlur(); });
    expect(ctx.saveTaskTitle).toHaveBeenCalledTimes(1);
    expect(ctx.saveTaskTitle).toHaveBeenCalledWith(false);
  });

  it('Escape cancels and stops there; the blur does not save what was cancelled', () => {
    const ctx = editing({ editingTaskId: 't1', editingTaskText: 'typo' });
    const root = render(<TaskNotesPane task={task} />, ctx);
    const input = root.root.findByProps({ 'data-pane-title-input': true });
    const e = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => { input.props.onKeyDown(e); });
    act(() => { input.props.onBlur(); });
    expect(ctx.cancelEditingTask).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(ctx.saveTaskTitle).not.toHaveBeenCalled();
  });

  it('a calendar event or a recurring template shows its title read-only', () => {
    const event = render(<TaskNotesPane task={{ ...task, imported: true }} />, editing());
    expect(event.root.findAll(n => n.props['data-pane-title'])).toHaveLength(0);
    const template = render(<TaskNotesPane task={task} />, editing({ recurringTasks: [{ id: 't1' }] }));
    expect(template.root.findAll(n => n.props['data-pane-title'])).toHaveLength(0);
  });
});

describe('right-click on a SchedTaskCard', () => {
  const task = { id: 'a1', title: 'Call the roofer', date: '2026-10-22', color: 'bg-blue-500', notes: '' };
  const card = (root) => root.root.findByProps({ 'data-sched-task': task.id });

  it('opens the app\'s task menu at the pointer, handing over this list\'s editor and this card\'s notes', () => {
    const setTaskContextMenu = vi.fn();
    const onOpen = vi.fn();
    const root = render(<SchedTaskCard task={task} onEdit={noop} onOpen={onOpen} />, { setTaskContextMenu });
    const e = { clientX: 40, clientY: 60, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => { card(root).props.onContextMenu(e); });
    expect(e.preventDefault).toHaveBeenCalled();
    const menu = setTaskContextMenu.mock.calls[0][0];
    expect(menu).toMatchObject({ x: 40, y: 60, taskId: 'a1', isRecurring: false, isImported: false, dateStr: '2026-10-22' });
    menu.onEdit();
    expect(onOpen).toHaveBeenCalledWith(task);
    globalThis.document = { body: {}, addEventListener: noop, removeEventListener: noop, querySelector: () => null };
    try {
      act(() => { menu.onNotes(); });
      expect(root.root.findAll(n => typeof n.props.className === 'string' && n.props.className.includes('sched-notes-panel')).length).toBeGreaterThan(0);
    } finally { delete globalThis.document; }
  });

  it('without a list editor, Edit opens the app\'s editor as a tap does', () => {
    const setTaskContextMenu = vi.fn();
    const openMobileEditTask = vi.fn();
    const root = render(<SchedTaskCard task={task} isInbox />, { setTaskContextMenu, openMobileEditTask });
    act(() => { card(root).props.onContextMenu({ clientX: 0, clientY: 0, preventDefault: noop, stopPropagation: noop }); });
    setTaskContextMenu.mock.calls[0][0].onEdit();
    expect(openMobileEditTask).toHaveBeenCalledWith(task, true);
  });

  it('none on a phone or tablet (a long-press drags), or on a recurring template', () => {
    const setTaskContextMenu = vi.fn();
    expect(card(render(<SchedTaskCard task={task} />, { setTaskContextMenu, isMobile: true })).props.onContextMenu).toBeUndefined();
    expect(card(render(<SchedTaskCard task={task} />, { setTaskContextMenu, isTablet: true })).props.onContextMenu).toBeUndefined();
    expect(card(render(<SchedTaskCard task={task} />, { setTaskContextMenu, recurringTasks: [{ id: 'a1' }] })).props.onContextMenu).toBeUndefined();
  });
});
