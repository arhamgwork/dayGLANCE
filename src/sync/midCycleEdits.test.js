import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// #2233: an edit made while a WebDAV/folder cycle is in flight (between the
// engine's read of local state and its apply) came back undone: a checked task
// unchecked itself, a note saved in that window was lost. Walked through
// dayGLANCE's own engine factory (adapter.js, the one App.jsx builds) and the
// real merge, so the wiring is under test and not just the guard.

const store = new Map();
const originalLocalStorage = globalThis.localStorage;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};
afterAll(() => { globalThis.localStorage = originalLocalStorage; });

const { createDayGlanceEngine } = await import('./adapter.js');
const { createMidCycleEditGuard } = await import('./midCycleEdits.js');
const { rescueUnsyncedTasks } = await import('../utils/rescueUnsyncedTasks.js');
const { preserveStickyFields } = await import('../utils/preserveStickyFields.js');

const T0 = '2026-10-27T10:00:00.000Z';
const T1 = '2026-10-27T10:01:00.000Z';
const T2 = '2026-10-27T10:02:00.000Z';
const task = (id, extra = {}) => ({
  id, title: id, date: '2026-10-27', startTime: '09:00', duration: 30,
  completed: false, notes: '', subtasks: [], lastModified: T0, ...extra,
});
const series = (id, extra = {}) => ({
  id, title: id, startTime: '08:00', duration: 15, notes: '', subtasks: [],
  recurrence: { type: 'daily', startDate: '2026-10-01' }, completedDates: [], exceptions: {},
  lastModified: T0, ...extra,
});

/**
 * One device on a fake WebDAV server. `live` is React state; the apply has
 * applyEngineData's list semantics (the merged list replaces state, sticky
 * fields and rescuable prev-only rows carried from prev). `during` names the
 * transfer to hold open, and `hold()` returns a promise that resolves once the
 * engine is inside it, with `release()` to let it finish.
 */
function device({ local, remote, during = 'upload' }) {
  const d = { live: structuredClone(local), applied: [] };
  let release;
  const gate = new Promise((r) => { release = r; });
  let entered;
  const inside = new Promise((r) => { entered = r; });
  let held = false;
  const holdIf = async (phase) => {
    if (phase !== during || held || !d.holding) return;
    held = true;
    entered();
    await gate;
  };
  d.remote = remote;
  d.etag = '"1"';
  const provider = {
    name: 'fake', configFields: [],
    download: async () => { await holdIf('download'); return { payload: d.remote, etag: d.etag }; },
    upload: async (_cfg, payload) => { await holdIf('upload'); d.uploaded = payload; return { etag: '"2"' }; },
    test: vi.fn(),
  };
  d.engine = createDayGlanceEngine({
    buildPayload: async () => ({ version: 2, lastModified: T0, data: structuredClone(d.live) }),
    buildBackupPayload: async () => ({}),
    applyPayload: async (data) => {
      d.applied.push(data);
      d.live = {
        ...d.live,
        ...data,
        tasks: rescueUnsyncedTasks(preserveStickyFields(data.tasks, d.live.tasks), d.live.tasks),
        unscheduledTasks: rescueUnsyncedTasks(preserveStickyFields(data.unscheduledTasks, d.live.unscheduledTasks), d.live.unscheduledTasks),
      };
    },
    onStatusChange: () => {}, onError: () => {}, onLastSyncedChange: () => {},
    onConflict: () => {}, onPassphraseRequired: () => {}, onFirstSyncReload: () => {},
    getSyncRetentionDays: () => 90,
  }, { providers: { fake: provider } });
  d.sync = () => d.engine.download();
  /** Runs one cycle and calls `edit` while the held transfer is in flight. */
  d.syncWithEditDuring = async (edit) => {
    d.holding = true;
    const cycle = d.sync();
    await inside;
    edit(d);
    release();
    await cycle;
    d.holding = false;
  };
  return d;
}

const envelope = (data, lastModified = T1) => ({ version: 2, lastModified, data });
const byId = (list, id) => list.find((t) => t.id === id);
// A save stamps the edited row (stampTaskTimestamps), so a mid-cycle edit is newer.
const editTask = (id, change) => (d) => {
  d.live.tasks = d.live.tasks.map((t) => (t.id === id ? { ...t, ...change, lastModified: T2 } : t));
};

describe('#2233: an edit made while a WebDAV/folder cycle is in flight', () => {
  beforeEach(() => {
    store.clear();
    localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'fake' }));
    // Synced before: a first sync asks instead of merging.
    localStorage.setItem('day-planner-cloud-sync-last-synced', T0);
  });

  it('a task checked off during the upload stays checked, and the remote edit still lands', async () => {
    const local = { tasks: [task('a'), task('b')], unscheduledTasks: [] };
    // Another device renamed A: the merge has something to apply here.
    const d = device({ local, remote: envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 }), task('b')], unscheduledTasks: [] }) });
    await d.syncWithEditDuring(editTask('b', { completed: true }));
    expect(byId(d.live.tasks, 'a').title).toBe('a renamed');
    expect(byId(d.live.tasks, 'b').completed).toBe(true);
  });

  it('a note saved during the upload is kept', async () => {
    const local = { tasks: [task('a'), task('b')], unscheduledTasks: [] };
    const d = device({ local, remote: envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 }), task('b')], unscheduledTasks: [] }) });
    await d.syncWithEditDuring(editTask('b', { notes: 'call the supplier first' }));
    expect(byId(d.live.tasks, 'b').notes).toBe('call the supplier first');
    expect(byId(d.live.tasks, 'a').title).toBe('a renamed');
  });

  it('an edit to the very row the remote changed: the newer copy wins', async () => {
    const local = { tasks: [task('a')], unscheduledTasks: [] };
    const d = device({ local, remote: envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 })], unscheduledTasks: [] }) });
    await d.syncWithEditDuring(editTask('a', { completed: true }));
    // The local edit is the later one (T2 > T1): its whole copy stands, as
    // last-writer-wins resolves any two copies of one row.
    expect(byId(d.live.tasks, 'a')).toMatchObject({ completed: true, lastModified: T2 });
  });

  // The reporter's other case (2026-10-28): "schedule to next free slot" in the
  // Planner undone. A move between lists: the task leaves the Inbox and joins
  // the scheduled list with the stamp it had (stampTimestamps leaves a row new
  // to a list as it is), so the re-merge meets one id in both lists at an
  // equal stamp, which the merge's cross-list rule settles on the scheduled one.
  it('a task scheduled out of the Inbox during the upload stays scheduled, once', async () => {
    const inboxB = { ...task('b'), date: undefined, startTime: undefined };
    const local = { tasks: [task('a')], unscheduledTasks: [inboxB] };
    const d = device({ local, remote: envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 })], unscheduledTasks: [inboxB] }) });
    await d.syncWithEditDuring((dev) => {
      const moving = dev.live.unscheduledTasks.find((t) => t.id === 'b');
      dev.live.unscheduledTasks = dev.live.unscheduledTasks.filter((t) => t.id !== 'b');
      dev.live.tasks = [...dev.live.tasks, { ...moving, date: '2026-10-27', startTime: '14:00' }];
    });
    expect(byId(d.live.tasks, 'a').title).toBe('a renamed');
    expect(byId(d.live.tasks, 'b')).toMatchObject({ date: '2026-10-27', startTime: '14:00' });
    expect(byId(d.live.unscheduledTasks, 'b')).toBeUndefined();
  });

  it('a deletion from the remote still lands when another task was edited mid-cycle', async () => {
    const local = { tasks: [task('a'), task('b')], unscheduledTasks: [], deletedTaskIds: {} };
    const d = device({ local, remote: envelope({ tasks: [task('b')], unscheduledTasks: [], deletedTaskIds: { a: T1 } }) });
    await d.syncWithEditDuring(editTask('b', { completed: true }));
    expect(byId(d.live.tasks, 'a')).toBeUndefined();
    expect(byId(d.live.tasks, 'b').completed).toBe(true);
  });

  it('a recurring completion made mid-cycle joins the one the remote brought', async () => {
    const local = { tasks: [], unscheduledTasks: [], recurringTasks: [series('r')] };
    const remote = envelope({
      tasks: [], unscheduledTasks: [],
      recurringTasks: [series('r', { completedDates: ['2026-10-26'], completedDatesTimestamps: { '2026-10-26': T1 }, lastModified: T1 })],
    });
    const d = device({ local, remote });
    await d.syncWithEditDuring((dev) => {
      dev.live.recurringTasks = dev.live.recurringTasks.map((t) => ({
        ...t, completedDates: ['2026-10-27'], completedDatesTimestamps: { '2026-10-27': T2 }, lastModified: T2,
      }));
    });
    expect([...d.live.recurringTasks[0].completedDates].sort()).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('the idle gate reads before the download: an edit made during the download is kept too', async () => {
    const local = { tasks: [task('a'), task('b')], unscheduledTasks: [] };
    const d = device({ local, remote: envelope({ tasks: [task('a'), task('b')], unscheduledTasks: [] }), during: 'download' });
    // A cycle that finds nothing on either side settles, arming the gate.
    await d.sync();
    expect(d.applied).toEqual([]);
    // Another device renames A; the next poll builds the payload, then downloads.
    d.remote = envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 }), task('b')], unscheduledTasks: [] });
    d.etag = '"3"';
    await d.syncWithEditDuring(editTask('b', { completed: true }));
    expect(byId(d.live.tasks, 'a').title).toBe('a renamed');
    expect(byId(d.live.tasks, 'b').completed).toBe(true);
  });

  it('with no edit mid-cycle, the merged result applies exactly as before', async () => {
    const local = { tasks: [task('a'), task('b')], unscheduledTasks: [] };
    const d = device({ local, remote: envelope({ tasks: [task('a', { title: 'a renamed', lastModified: T1 }), task('b')], unscheduledTasks: [] }) });
    await d.sync();
    expect(d.applied).toHaveLength(1);
    // What was applied is what was uploaded: the engine's merged data, untouched.
    expect(d.applied[0]).toEqual(d.uploaded.data);
  });
});

describe('createMidCycleEditGuard', () => {
  const merge = vi.fn((local, remote) => ({ data: { ...remote, mergedWith: local } }));
  beforeEach(() => merge.mockClear());

  it('returns the merged result itself while local state is what the cycle read', () => {
    const guard = createMidCycleEditGuard(merge);
    guard.noteBuilt({ data: { tasks: [task('a')] } });
    const merged = { tasks: [task('a', { title: 'x' })] };
    expect(guard.reconcile(merged, { data: { tasks: [task('a')] } })).toBe(merged);
    expect(merge).not.toHaveBeenCalled();
  });

  it('merges the live state over the result when it moved', () => {
    const guard = createMidCycleEditGuard(merge);
    guard.noteBuilt({ data: { tasks: [task('a')] } });
    const merged = { tasks: [task('a', { title: 'x' })] };
    const live = { tasks: [task('a', { completed: true, lastModified: T2 })] };
    expect(guard.reconcile(merged, { data: live })).toEqual({ ...merged, mergedWith: live });
    expect(merge).toHaveBeenCalledWith(live, merged);
  });

  it('the last build before the apply is the one compared', () => {
    const guard = createMidCycleEditGuard(merge);
    guard.noteBuilt({ data: { tasks: [] } });
    guard.noteBuilt({ data: { tasks: [task('a')] } });
    const merged = { tasks: [task('a')] };
    expect(guard.reconcile(merged, { data: { tasks: [task('a')] } })).toBe(merged);
  });

  it('with nothing recorded or nothing live, applies the merged result unchanged', () => {
    const merged = { tasks: [] };
    expect(createMidCycleEditGuard(merge).reconcile(merged, { data: { tasks: [task('a')] } })).toBe(merged);
    const guard = createMidCycleEditGuard(merge);
    guard.noteBuilt({ data: { tasks: [] } });
    expect(guard.reconcile(merged, null)).toBe(merged);
    expect(merge).not.toHaveBeenCalled();
  });
});
