// The save pass reuses the rows the last pass stamped (#2140, rowCache in
// useDataPersistence.js). That is only correct if it never changes what is
// stored or what is written back to state. This drives two harnesses through
// the same random edit sequences: one keeps a single module instance (so the
// cache is warm), the other loads a fresh one every pass (so every pass takes
// the full path, as before the change). After every step both must hold the
// same storage and the same state.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

const fresh = async () => {
  vi.resetModules();
  globalThis.window = { location: { search: '' } };
  return (await import('./useDataPersistence.js')).default;
};

// A tiny seeded PRNG, so a failure names a reproducible seed.
const rng = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

function harness() {
  const map = new Map();
  const state = { tasks: [], unscheduledTasks: [], recycleBin: [] };
  return {
    map,
    state,
    storage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    },
    setTasks: (updater) => { state.tasks = typeof updater === 'function' ? updater(state.tasks) : updater; },
  };
}

const props = (h, suppressed) => ({
  setTasks: h.setTasks, setUndoToast: () => {}, t: (k) => k,
  suppressTimestampRef: { current: suppressed }, cloudSyncInitialDoneRef: { current: false }, cloudSyncConfig: null,
  tasks: h.state.tasks, unscheduledTasks: h.state.unscheduledTasks, recycleBin: h.state.recycleBin,
  recurringTasks: [], todayRoutines: [],
  darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0, completedTaskUids: new Set(),
  routineDefinitions: {}, routinesDate: '2026-10-21', removedTodayRoutineIds: {}, habits: [], habitLogs: {},
  habitsEnabled: false, routinesEnabled: false, gtdFrames: [], goals: [], projects: [], areas: [],
  goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
});

const day = (n) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);

// One random edit, applied identically to both harnesses' state (by building
// the next state once and giving each harness its own structurally equal copy
// is NOT what the app does: React hands the save pass the same objects it had,
// so each harness edits its own state the same way).
function edit(h, r, step) {
  const pick = () => h.state.tasks[Math.floor(r() * h.state.tasks.length)];
  const replace = (task, patch) => { h.state.tasks = h.state.tasks.map(t => (t === task ? { ...t, ...patch } : t)); };
  const roll = r();
  if (h.state.tasks.length === 0 || roll < 0.2) {
    h.state.tasks = [...h.state.tasks, { id: `n${step}`, title: `New ${step}`, date: day(step % 20), startTime: '09:00', duration: 30, notes: '', subtasks: [] }];
  } else if (roll < 0.4) {
    replace(pick(), { completed: true, completedAt: `${day(step % 20)}T10:00:00.000Z` });
  } else if (roll < 0.6) {
    // A move: some of these are slips (the old date has come due), which stamp deferrals and the trail.
    replace(pick(), { date: day(5 + (step % 25)), startTime: r() < 0.5 ? '14:00' : '09:00' });
  } else if (roll < 0.7) {
    replace(pick(), { notes: `note ${step}` });
  } else if (roll < 0.8) {
    const gone = pick();
    h.state.tasks = h.state.tasks.filter(t => t !== gone);
  } else if (roll < 0.9) {
    // A sync apply: storage and state replaced together with fresh objects.
    h.state.tasks = h.state.tasks.map(t => ({ ...t }));
    h.storage.setItem('day-planner-tasks', JSON.stringify(h.state.tasks));
  } else {
    h.state.unscheduledTasks = [...h.state.unscheduledTasks, { id: `u${step}`, title: `Inbox ${step}`, notes: '', subtasks: [] }];
  }
}

describe('the save pass reuses stamped rows without changing the result (#2140)', () => {
  afterEach(() => { vi.useRealTimers(); delete globalThis.localStorage; delete globalThis.window; });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('matches the full path step for step (seed %i)', async (seed) => {
    vi.useFakeTimers();
    const incrementalHook = await fresh();
    const warm = harness();
    const cold = harness();
    const rWarm = rng(seed);
    const rCold = rng(seed);
    const rSuppress = rng(seed + 1000);
    for (let step = 0; step < 60; step++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 12, step)));
      edit(warm, rWarm, step);
      edit(cold, rCold, step);
      const suppressed = rSuppress() < 0.1;

      globalThis.localStorage = warm.storage;
      incrementalHook(props(warm, suppressed)).saveData();

      const coldHook = await fresh();
      globalThis.localStorage = cold.storage;
      coldHook(props(cold, suppressed)).saveData();

      for (const key of ['day-planner-tasks', 'day-planner-unscheduled', 'day-planner-recycle-bin']) {
        expect(warm.map.get(key), `seed ${seed} step ${step} ${key}`).toBe(cold.map.get(key));
      }
      expect(JSON.stringify(warm.state.tasks), `seed ${seed} step ${step} state`).toBe(JSON.stringify(cold.state.tasks));
    }
  });

  it('runs the steps only on the rows that changed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 12)));
    const hook = await fresh();
    const h = harness();
    globalThis.localStorage = h.storage;
    h.state.tasks = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, date: day(i % 20), startTime: '09:00', duration: 30, notes: '', subtasks: [], lastModified: '2026-10-01T00:00:00.000Z' }));
    hook(props(h, false)).saveData();

    const parse = vi.spyOn(JSON, 'parse');
    h.state.tasks = h.state.tasks.map((t, i) => (i === 7 ? { ...t, completed: true } : t));
    hook(props(h, false)).saveData();
    // No re-read of the stored copy: the last pass's output stands in for it.
    expect(parse.mock.calls.filter(([raw]) => typeof raw === 'string' && raw.length > 10000)).toEqual([]);
    const stored = JSON.parse(h.map.get('day-planner-tasks'));
    expect(stored[7].lastModified).toBe('2026-10-10T12:00:00.000Z');
    expect(stored[8].lastModified).toBe('2026-10-01T00:00:00.000Z');
  });

  it('takes the full path when storage was changed behind the pass', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 10, 12)));
    const hook = await fresh();
    const h = harness();
    globalThis.localStorage = h.storage;
    const task = { id: 't1', title: 'T', date: day(1), notes: '', subtasks: [], lastModified: '2026-10-01T00:00:00.000Z' };
    h.state.tasks = [task];
    hook(props(h, false)).saveData();
    // Another writer leaves a newer stamp in storage; the task object is unchanged.
    h.storage.setItem('day-planner-tasks', JSON.stringify([{ ...task, lastModified: '2026-10-09T00:00:00.000Z' }]));
    h.state.tasks = [task, { id: 't2', title: 'New', notes: '', subtasks: [] }];
    hook(props(h, false)).saveData();
    // The unchanged task keeps the stamp storage holds, as the full path would.
    expect(JSON.parse(h.map.get('day-planner-tasks'))[0].lastModified).toBe('2026-10-09T00:00:00.000Z');
  });
});
