import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';

// #2176: each subtask row has a grip. Up/Down on it moves the subtask; a drag
// from it reorders within the panel and never reaches the card around it.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
beforeEach(() => { globalThis.requestAnimationFrame = (fn) => { fn(); return 0; }; });
afterEach(() => { delete globalThis.requestAnimationFrame; });

const noop = () => {};
const task = (n = 3) => ({ id: 't1', title: 'Release', notes: 'n', subtasks: [{ id: 'a', title: 'Back up' }, { id: 'b', title: 'Migrate' }, { id: 'c', title: 'Verify' }].slice(0, n) });

function mount(t, { ctxMove = vi.fn(), propMove } = {}) {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={{ tasks: [], unscheduledTasks: [], moveSubtask: ctxMove }}>
          <NotesSubtasksPanel
            task={t} isInbox darkMode={false} noAutoFocus
            updateTaskNotes={noop} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop}
            {...(propMove ? { moveSubtask: propMove } : {})}
          />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: () => ({ style: {}, focus: vi.fn(), getBoundingClientRect: () => ({ top: 100, height: 20 }) }) },
    );
  });
  const grip = (id) => root.root.findByProps({ 'data-subtask-grip': id });
  const row = (idx) => root.root.find(n => n.type === 'div' && n.props['data-drag-idx'] === idx && n.props['data-subtask-of']);
  const ev = (extra = {}) => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { setData: vi.fn() }, ...extra });
  return { root, grip, row, ev, ctxMove };
}

describe('subtask grips', () => {
  it('Up and Down on a grip move that subtask one place, and stop there', () => {
    const { grip, ev, ctxMove } = mount(task());
    const down = ev({ key: 'ArrowDown' });
    act(() => { grip('a').props.onKeyDown(down); });
    expect(ctxMove).toHaveBeenCalledWith('t1', 'a', 1, true);
    expect(down.stopPropagation).toHaveBeenCalled();
    act(() => { grip('c').props.onKeyDown(ev({ key: 'ArrowUp' })); });
    expect(ctxMove).toHaveBeenLastCalledWith('t1', 'c', 1, true);
  });

  it('does not move past either end', () => {
    const { grip, ev, ctxMove } = mount(task());
    act(() => { grip('a').props.onKeyDown(ev({ key: 'ArrowUp' })); });
    act(() => { grip('c').props.onKeyDown(ev({ key: 'ArrowDown' })); });
    expect(ctxMove).not.toHaveBeenCalled();
  });

  it('a drag starts from the grip without reaching the card, and a drop lands where it points', () => {
    const { grip, row, ev, ctxMove } = mount(task());
    const start = ev();
    act(() => { grip('a').props.onDragStart(start); });
    expect(start.stopPropagation).toHaveBeenCalled();
    // Over the bottom half of the last row: to the end.
    const over = ev({ clientY: 115, currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 20 }) } });
    act(() => { row(2).props.onDragOver(over); });
    expect(over.preventDefault).toHaveBeenCalled();
    expect(over.stopPropagation).toHaveBeenCalled();
    const drop = ev();
    act(() => { row(2).props.onDrop(drop); });
    expect(drop.stopPropagation).toHaveBeenCalled();
    expect(ctxMove).toHaveBeenCalledWith('t1', 'a', 2, true);
  });

  it('rows take no drops when no subtask is being dragged, so a task drag passes over them', () => {
    const { row } = mount(task());
    expect(row(1).props.onDragOver).toBeUndefined();
    expect(row(1).props.onDrop).toBeUndefined();
  });

  it('a host\'s own move (Focus mode) is used over the planner\'s', () => {
    const propMove = vi.fn();
    const { grip, ev, ctxMove } = mount(task(), { propMove });
    act(() => { grip('a').props.onKeyDown(ev({ key: 'ArrowDown' })); });
    expect(propMove).toHaveBeenCalledWith('t1', 'a', 1, true);
    expect(ctxMove).not.toHaveBeenCalled();
  });

  it('no grip for a single subtask, or with nothing to move it', () => {
    expect(mount(task(1)).root.root.findAll(n => n.props['data-subtask-grip'])).toHaveLength(0);
    expect(mount(task(), { ctxMove: null }).root.root.findAll(n => n.props['data-subtask-grip'])).toHaveLength(0);
  });
});
