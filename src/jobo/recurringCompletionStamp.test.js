// A recurring occurrence's completion is stamped on its own clock, with an
// offset, like an ordinary task's completedAt. Walked from the checkbox the
// app calls (useTaskActions.toggleComplete) through the JOBO detector to the
// day model, in a zone where the UTC date differs from the local one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTaskActions from '../hooks/useTaskActions.js';
import { parseRecurringId } from '../utils/recurringId.js';
import { recurringTaskInstance } from '../utils/expandRecurringTasks.js';
import { mergeCompletedDates } from '../mergeSync.js';
import { buildJoboRecords, findJoboEdges, snapshotJoboState } from './detector.js';
import { buildJoboDayModel } from './viewModel.js';
import { createDoRecord, DO_PROGRESS, DO_TIMING } from './core.js';
vi.mock('../native.js', () => ({ triggerHaptic: vi.fn() }));

const day = '2026-10-09';
const template = { id: 'r1', title: 'Write', startTime: '19:00', duration: 60, recurrence: { type: 'daily', startDate: '2026-10-01' },
  completedDates: [], completedDatesTimestamps: {}, exceptions: {} };
let state;
const useActions = () => useTaskActions({
  ...state,
  setTasks: fn => { state.tasks = fn(state.tasks); },
  setUnscheduledTasks: fn => { state.unscheduledTasks = fn(state.unscheduledTasks); },
  setRecurringTasks: fn => { state.recurringTasks = fn(state.recurringTasks); },
  onboardingProgress: { hasCompletedTask: true }, pushUndo: vi.fn(), playUISound: vi.fn(), setUndoToast: vi.fn(),
  parseRecurringId,
});

let savedTz;
beforeEach(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'America/Denver';
  vi.useFakeTimers();
  // 19:56 in Denver is 01:56 UTC the next day.
  vi.setSystemTime(new Date('2026-10-10T01:56:00Z'));
  state = { tasks: [], unscheduledTasks: [], recurringTasks: [structuredClone(template)], recycleBin: [] };
});
afterEach(() => {
  vi.useRealTimers();
  if (savedTz === undefined) delete process.env.TZ; else process.env.TZ = savedTz;
});

describe('a recurring completion is stamped on its own clock', () => {
  it('names the local date and time, with the offset', () => {
    useActions().toggleComplete(`recurring-r1-${day}`);
    expect(state.recurringTasks[0].completedDates).toEqual([day]);
    expect(state.recurringTasks[0].completedDatesTimestamps[day]).toBe('2026-10-09T19:56:00-06:00');
  });

  it('closes the Focus session it ends, as an ordinary completion does (#2059)', () => {
    const prev = snapshotJoboState([], [], state.recurringTasks);
    useActions().toggleComplete(`recurring-r1-${day}`);
    const edges = findJoboEdges(prev, snapshotJoboState([], [], state.recurringTasks), { recurringTasks: state.recurringTasks });
    const [completion] = buildJoboRecords(edges, [], { observedAt: '2026-10-10T01:56:00.000Z' });
    expect(completion).toMatchObject({ source: 'completion', progress: DO_PROGRESS.COMPLETED, date: day, createdAt: '2026-10-09T19:56:00-06:00' });

    const plan = { date: day, startTime: '19:00', duration: 60 };
    const session = createDoRecord({
      id: 'focus:s:0:0:task:r1', taskId: 'r1', title: 'Write', source: 'focus', progress: DO_PROGRESS.PARTIAL,
      timing: DO_TIMING.TIMED, date: day, startTime: '19:00', endDate: day, endTime: '19:55', planSnapshot: plan,
      createdAt: '2026-10-09T19:55:00-06:00', updatedAt: '2026-10-09T19:55:00-06:00', observedAt: '2026-10-09T19:55:00-06:00', deleted: false,
    });
    const occurrence = recurringTaskInstance(state.recurringTasks[0], day);
    const model = buildJoboDayModel({ date: day, tasks: [occurrence], taskLookup: [occurrence], recurringTasks: state.recurringTasks,
      records: [session, completion], now: { date: day, time: '21:00' } });
    const item = model.timedRecords.find(entry => entry.id === session.id);
    expect(item.comparison.comparable).toBe(true);
    expect(item.comparison.metrics.closingCompletionCount).toBe(1);
  });

  it('still resolves against a legacy UTC stamp by instant, whichever is later', () => {
    useActions().toggleComplete(`recurring-r1-${day}`);
    const local = state.recurringTasks[0];
    // Another device unchecked the occurrence a minute later, in the old form.
    const remote = { ...template, completedDates: [], completedDatesTimestamps: { [day]: '2026-10-10T01:57:00.000Z' } };
    expect(mergeCompletedDates(local.completedDates, remote.completedDates, local.completedDatesTimestamps, remote.completedDatesTimestamps))
      .toEqual({ completedDates: [], completedDatesTimestamps: { [day]: '2026-10-10T01:57:00.000Z' } });
    // And a minute earlier, the local completion wins.
    const earlier = { ...remote, completedDatesTimestamps: { [day]: '2026-10-10T01:55:00.000Z' } };
    expect(mergeCompletedDates(local.completedDates, earlier.completedDates, local.completedDatesTimestamps, earlier.completedDatesTimestamps).completedDates)
      .toEqual([day]);
  });
});
