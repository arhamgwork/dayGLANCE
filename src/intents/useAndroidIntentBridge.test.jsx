import React, { useState } from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Android bridge's launcher queue (intents/useAndroidIntentBridge.js): nothing
// drains before the data has loaded, writes go before refreshes, and a write
// leaves the native queue only once it is handled and saved.

const native = vi.hoisted(() => ({ queue: [], acked: [], taken: 0 }));
vi.mock('../native.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isNativeAndroid: () => true,
  nativeGetPendingLauncherIntents: () => { native.taken++; const q = native.queue; native.queue = []; return q; },
  nativeAckLauncherIntents: (ids) => { native.acked.push(...ids); },
  nativeGetPendingIntent: () => null,
  nativeReportIntentResult: () => {},
  nativeRecordLauncherRefresh: () => {},
}));
vi.mock('./intentDrainGate.js', () => ({ intentDrainAllowed: () => true, INTENT_DRAIN_RETRY_MS: 15000 }));

const { drainLauncherQueue, durableContext, useAndroidIntentBridge } = await import('./useAndroidIntentBridge.js');

const COMPLETE = 'com.dayglance.app.launcher.COMPLETE';
const CREATE = 'com.dayglance.app.launcher.CREATE';
const REFRESH = 'com.dayglance.app.launcher.REFRESH';
const task = (id, extra = {}) => ({ id, title: id, date: '2026-10-26', startTime: '09:00', duration: 30, completed: false, ...extra });

beforeEach(() => {
  native.queue = []; native.acked = []; native.taken = 0;
  globalThis.window ??= globalThis;
  globalThis.document ??= { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { delete window.__dayglanceCheckPendingIntent; delete window.__dayglanceRetireCheck; });

describe('drainLauncherQueue', () => {
  function state(tasks) {
    const s = { tasks, events: [] };
    const ctx = () => ({
      tasks: s.tasks, unscheduledTasks: [], recurringTasks: [],
      setTasks: (f) => { s.tasks = typeof f === 'function' ? f(s.tasks) : f; s.events.push('set'); },
      // A REFRESH that never comes back, as in a page stalled in the background.
      runSyncCycle: () => new Promise(() => {}),
    });
    return { s, ctx };
  }
  const flushInto = (s) => (fn) => { fn(); s.events.push('saved'); };

  // MUTATION: handle the entries in queue order and the write never runs (it waits behind the refresh).
  it('handles writes before a refresh that stalls, and acknowledges each only after its change is saved', async () => {
    const { s, ctx } = state([task('t1')]);
    const ack = (ids) => s.events.push(`ack:${ids.join(',')}`);
    const queue = [{ action: REFRESH, clientId: 'r1' }, { action: COMPLETE, clientId: 'w1', payload: { task_id: 't1' } }];
    drainLauncherQueue({ entries: queue, context: ctx, ack, flush: flushInto(s) });
    await vi.waitFor(() => expect(s.events).toContain('ack:w1'));
    expect(s.tasks[0].completed).toBe(true);
    expect(s.events).toEqual(['set', 'saved', 'ack:w1']);
  });

  it('a write another drain is already handling is skipped, and one whose handler throws still leaves the queue', async () => {
    const { s, ctx } = state([task('t1')]);
    const acked = [];
    await drainLauncherQueue({ entries: [{ action: COMPLETE, clientId: 'w1', payload: { task_id: 't1' } }], context: ctx, ack: ids => acked.push(...ids), flush: f => f(), inFlight: new Set(['w1']) });
    expect(s.tasks[0].completed).toBe(false);
    expect(acked).toEqual([]);
    const throwing = () => ({ ...ctx(), get tasks() { throw new Error('boom'); } });
    await drainLauncherQueue({ entries: [{ action: COMPLETE, clientId: 'w2', payload: { task_id: 't1' } }], context: throwing, ack: ids => acked.push(...ids), flush: f => f() });
    expect(acked).toEqual(['w2']);
  });

  it('durableContext runs each setter inside the flush and returns its result', () => {
    const calls = [];
    const ctx = durableContext({ setTasks: (v) => { calls.push(`set:${v}`); return 'r'; }, tasks: [] }, (fn) => { calls.push('flush>'); fn(); calls.push('<flush'); });
    expect(ctx.setTasks(1)).toBe('r');
    expect(calls).toEqual(['flush>', 'set:1', '<flush']);
    expect(ctx.tasks).toEqual([]);
  });
});

describe('useAndroidIntentBridge', () => {
  // The app's cold start: the bridge mounts with the initial empty lists and
  // the data arrives a moment later (useAppInit's loadData, then dataLoaded).
  function App({ api }) {
    const [tasks, setTasks] = useState([]);
    const [unscheduledTasks, setUnscheduledTasks] = useState([]);
    const [ready, setReady] = useState(false);
    api.load = (loaded) => { setTasks(loaded); setReady(true); };
    api.tasks = tasks;
    api.all = [...tasks, ...unscheduledTasks];
    useAndroidIntentBridge({ ready, tasks, unscheduledTasks, recurringTasks: [], setTasks, setUnscheduledTasks, setRecurringTasks: () => {} });
    return null;
  }

  // MUTATION: drop the `ready` gate and this fails: the complete runs against
  // the empty list, finds no such task, and is taken off the queue.
  it('waits for the data before draining, then completes the task and acknowledges the write', async () => {
    native.queue = [{ action: COMPLETE, clientId: 'w1', payload: { task_id: 't1' } }];
    const api = {};
    let renderer;
    await act(async () => { renderer = create(<App api={api} />); });
    expect(native.taken).toBe(0);
    expect(native.acked).toEqual([]);
    await act(async () => { api.load([task('t1')]); });
    await act(async () => {});
    expect(native.taken).toBe(1);
    expect(api.tasks.find(t => t.id === 't1').completed).toBe(true);
    expect(native.acked).toEqual(['w1']);
    act(() => renderer.unmount());
  });

  it('a task created from the queue after the data loaded is kept', async () => {
    native.queue = [{ action: CREATE, clientId: 'w2', payload: { title: 'Dentist' } }];
    const api = {};
    let renderer;
    await act(async () => { renderer = create(<App api={api} />); });
    await act(async () => { api.load([task('t1')]); });
    await act(async () => {});
    expect(api.all.map(t => t.title)).toEqual(expect.arrayContaining(['t1', 'Dentist']));
    expect(api.all.find(t => t.title === 'Dentist').clientId).toBe('w2');
    expect(native.acked).toEqual(['w2']);
    act(() => renderer.unmount());
  });
});
