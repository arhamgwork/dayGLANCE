import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import AllDayTaskCard from './AllDayTaskCard.jsx';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { PEEK_TASK_EVENT } from '../utils/followUp.js';

// A task whose note is only a link to another task: the notes button shows
// that task in the peek on a tap, and a long press opens the note to edit,
// as a URL-only note's button does.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

let peeked;
beforeEach(() => {
  vi.useFakeTimers();
  peeked = [];
  globalThis.window = globalThis.window || {};
  window.dispatchEvent = (e) => { if (e.type === PEEK_TASK_EVENT) peeked.push(e.detail.id); return true; };
  window.open = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

const LINK = '[Roof repair](dayglance://task?id=r1)';

function mount(notes) {
  const task = { id: 't1', title: 'Call the roofer', date: '2026-10-23', isAllDay: true, notes };
  const setExpandedNotesTaskId = vi.fn();
  const planner = {
    darkMode: false, cardBg: '', borderClass: '', textPrimary: '', hoverBg: '',
    editingTaskId: null, editingTaskText: '', suggestions: [], expandedNotesTaskId: null,
    setExpandedNotesTaskId, expandedTaskMenu: null, setExpandedTaskMenu: vi.fn(),
    longPressTimerRef: { current: null }, longPressTriggeredRef: { current: false },
    taskWidths: {}, getTaskCalendarStyle: () => null, tasks: [], unscheduledTasks: [],
  };
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner}>
          <SyncContext.Provider value={{}}>
            <FeaturesContext.Provider value={{ projects: [], users: [] }}>
              <AllDayTaskCard task={task} fillWidth={false} />
            </FeaturesContext.Provider>
          </SyncContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  const button = () => root.root.find((n) => n.type === 'button' && typeof n.props.title === 'string'
    && (n.props.title.includes('hold to edit') || n.props.title === i18n.t('sched.notesSubtasks')));
  return { root, button, setExpandedNotesTaskId };
}

const click = (b) => act(() => { b.props.onClick({ stopPropagation: () => {} }); });

describe('AllDayTaskCard: a note that is only a task link', () => {
  it('shows the linked icon and names the task in its tooltip', () => {
    const { button } = mount(LINK);
    expect(button().props.title).toBe('Roof repair (hold to edit)');
    expect(button().findAll((n) => n.type === 'svg' && String(n.props.className).includes('lucide-file-symlink'))).toHaveLength(1);
  });

  it('a tap shows the linked task in the peek, not the notes', () => {
    const { button, setExpandedNotesTaskId } = mount(LINK);
    act(() => { button().props.onMouseDown(); });
    act(() => { button().props.onMouseUp(); });
    click(button());
    expect(peeked).toEqual(['r1']);
    expect(window.open).not.toHaveBeenCalled();
    expect(setExpandedNotesTaskId).not.toHaveBeenCalled();
  });

  it('a long press opens the note to edit, and the release does not peek', () => {
    const { button, setExpandedNotesTaskId } = mount(LINK);
    act(() => { button().props.onMouseDown(); });
    act(() => { vi.advanceTimersByTime(500); });
    click(button());
    expect(setExpandedNotesTaskId).toHaveBeenCalledTimes(1);
    expect(peeked).toEqual([]);
  });

  it('a link with words around it keeps the plain notes button', () => {
    const { button, setExpandedNotesTaskId } = mount(`Follow-up to ${LINK}`);
    click(button());
    expect(peeked).toEqual([]);
    expect(setExpandedNotesTaskId).toHaveBeenCalledTimes(1);
  });
});
