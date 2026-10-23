import { describe, expect, it, vi } from 'vitest';
import useTaskActions from './useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';

// #2176: moveSubtask writes a task's subtasks in the new order, for a
// scheduled task, an Inbox task and a recurring series, as one undo step.
// A move that changes nothing writes nothing and pushes no step.

const subtasks = () => [{ id: 'a', title: 'Back up' }, { id: 'b', title: 'Migrate' }, { id: 'c', title: 'Verify' }];

function useActionsSetup({ tasks = [], unscheduledTasks = [], recurringTasks = [] } = {}) {
  const writes = { tasks: [], unscheduled: [], recurring: [], focus: [] };
  const undo = [];
  const lists = { tasks, unscheduled: unscheduledTasks, recurring: recurringTasks };
  const actions = useTaskActions({
    tasks, setTasks: (u) => writes.tasks.push(u),
    unscheduledTasks, setUnscheduledTasks: (u) => writes.unscheduled.push(u),
    recurringTasks, setRecurringTasks: (u) => writes.recurring.push(u),
    recycleBin: [], setRecycleBin: vi.fn(),
    completedTaskUids: new Set(), setCompletedTaskUids: vi.fn(),
    selectedDate: new Date(2026, 9, 22, 9),
    onboardingProgress: {}, setOnboardingProgress: vi.fn(),
    pushUndo: vi.fn((label) => { undo.push(label); return `said:${label.key}`; }),
    playUISound: vi.fn(), parseRecurringId,
    getAdjustedTimeForImportedConflicts: (id, t) => ({ conflicted: false, adjustedStartTime: t }),
    newTask: {}, setNewTask: vi.fn(), setShowAddTask: vi.fn(), setShowRecurrencePicker: vi.fn(),
    expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
    setSyncNotification: vi.fn(), setUndoToast: vi.fn(),
    setShowColorPicker: vi.fn(), setShowDeadlinePicker: vi.fn(),
    recurringDeleteConfirm: null, setRecurringDeleteConfirm: vi.fn(),
    hoverPreviewTime: null, hoverPreviewDate: null, setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
    swipeSchedulingInboxTaskId: { current: null },
    syncTaskCompletionToCalDAV: vi.fn(), computeAvailableSlots: vi.fn(() => []),
    activeFrameNudgeKey: null, setFrameNudgeDismissedKey: vi.fn(),
    frameScheduleModal: null, setFrameScheduleModal: vi.fn(),
    focusBlockTasks: [], setFocusBlockTasks: (u) => writes.focus.push(u),
    focusCompletedTasks: new Set(), setFocusCompletedTasks: vi.fn(),
    exitFocusModeRef: { current: null }, playFocusSound: vi.fn(),
  });
  const apply = (which) => writes[which].reduce((acc, u) => (typeof u === 'function' ? u(acc) : u), lists[which] ?? []);
  return { actions, writes, apply, undo };
}

const order = (task) => task.subtasks.map(s => s.id);

describe('moveSubtask', () => {
  it('reorders a scheduled task\'s subtasks, as one labelled undo step', () => {
    const { actions, apply, undo } = useActionsSetup({ tasks: [{ id: 't', title: 'Release', subtasks: subtasks() }] });
    actions.moveSubtask('t', 'c', 0, false);
    expect(order(apply('tasks')[0])).toEqual(['c', 'a', 'b']);
    expect(undo).toEqual([{ key: 'subtasksReordered', taskId: 't' }]);
  });

  it('reorders an Inbox task\'s subtasks on the Inbox list', () => {
    const { actions, apply, writes } = useActionsSetup({ unscheduledTasks: [{ id: 'u', title: 'Release', subtasks: subtasks() }] });
    actions.moveSubtask('u', 'a', 2, true);
    expect(order(apply('unscheduled')[0])).toEqual(['b', 'c', 'a']);
    expect(writes.tasks).toHaveLength(0);
  });

  it('reorders a recurring series from one of its occurrences, stamping the series', () => {
    const { actions, apply } = useActionsSetup({ recurringTasks: [{ id: 'tpl', title: 'Weekly release', subtasks: subtasks(), lastModified: '2026-01-01T00:00:00.000Z' }] });
    actions.moveSubtask('recurring-tpl-2026-10-22', 'b', 2, false);
    const series = apply('recurring')[0];
    expect(order(series)).toEqual(['a', 'c', 'b']);
    expect(series.lastModified).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('a move that changes nothing writes nothing and pushes no undo step', () => {
    const { actions, writes, undo } = useActionsSetup({ tasks: [{ id: 't', title: 'Release', subtasks: subtasks() }] });
    actions.moveSubtask('t', 'b', 1, false);
    actions.moveSubtask('t', 'missing', 0, false);
    expect(writes.tasks).toHaveLength(0);
    expect(undo).toHaveLength(0);
  });

  it('in Focus mode, also reorders the session\'s copy of the task', () => {
    const { actions, writes } = useActionsSetup({ tasks: [{ id: 't', title: 'Release', subtasks: subtasks() }] });
    actions.focusMoveSubtask('t', 'c', 0, false);
    const focus = writes.focus.reduce((acc, u) => u(acc), [{ id: 't', subtasks: subtasks() }]);
    expect(order(focus[0])).toEqual(['c', 'a', 'b']);
  });
});
