import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { runLauncherRefreshCycle } from '../intents/launcherRefreshCycle.js';

// ─────────────────────────────────────────────────────────────────────────────
// A CYCLE IN FLIGHT IS NOT A COMPLETED CYCLE.
//
// The regression (2026-10-22): a backgrounded app frozen mid-cycle kept the
// in-flight guard set, every later dbSyncCycle returned at once, and the
// launcher's REFRESH logged each of those returns as `ran` in a millisecond
// while nothing synced for eight hours. Under test: the guard's return says
// it skipped and since when, waitForCycle joins the cycle in flight with a
// cap, and the REFRESH runner turns both into a completed cycle or a reason.
//
// Real engine and crypto over an in-memory vault (the dbSyncDeferredRetry
// harness), with the vault's list() held open to keep a cycle in flight.
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function createMemoryVault() {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      const rows = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows, hasMore: false };
    },
    async device() { return { updated: true }; },
  };
}

// Holds the next list() call open until release() is called: the cycle that
// made it stays in flight, as one frozen mid-request does.
function holdNextList(vault) {
  const real = vault.list;
  let release;
  const gate = new Promise((r) => { release = r; });
  vault.list = async (...args) => {
    vault.list = real;
    await gate;
    return real(...args);
  };
  return () => release();
}

const FIXTURE_NOW = new Date('2026-10-22T22:58:24.000Z');

let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));
const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};

function makeDevice(vault) {
  let data = clone({ ...EMPTY, tasks: [{ id: 't1', title: 'task', duration: 30, completed: false, notes: '', subtasks: [], lastModified: '2026-10-22T10:00:00.000Z' }] });
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: 'dev-phone',
    deviceId: 'device-phone',
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => clone(data),
    commitData: (d) => { data = d; },
  });
  return { engine };
}

// The cycle's own awaits (crypto, storage) need real ticks to reach list().
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('a vault cycle in flight', () => {
  it('a second call says it skipped and since when, instead of returning as if it had run', async () => {
    const vault = createMemoryVault();
    const { engine } = makeDevice(vault);
    await engine.dbSyncCycle();
    const release = holdNextList(vault);
    const first = engine.dbSyncCycle();
    await settle();
    expect(await engine.dbSyncCycle()).toEqual({ cycleSkipped: 'in-flight', since: FIXTURE_NOW.getTime() });
    release();
    const done = await first;
    expect(done.cycleSkipped).toBeUndefined();
    expect(done.error).toBeUndefined();
    // The guard released: the next cycle runs.
    expect((await engine.dbSyncCycle()).cycleSkipped).toBeUndefined();
  });

  it('waitForCycle joins the cycle in flight, and gives up after its cap', async () => {
    const vault = createMemoryVault();
    const { engine } = makeDevice(vault);
    expect(await engine.waitForCycle(0)).toBe(true); // nothing in flight
    await engine.dbSyncCycle();
    const release = holdNextList(vault);
    const first = engine.dbSyncCycle();
    await settle();
    expect(await engine.waitForCycle(10)).toBe(false);
    const joined = engine.waitForCycle(5000);
    release();
    expect(await joined).toBe(true);
    await first;
  });
});

describe("the launcher's REFRESH over a real engine", () => {
  it('joins a cycle that finishes inside the cap, then runs its own: a completed cycle', async () => {
    const vault = createMemoryVault();
    const { engine } = makeDevice(vault);
    await engine.dbSyncCycle();
    const release = holdNextList(vault);
    const first = engine.dbSyncCycle();
    await settle();
    const refresh = runLauncherRefreshCycle({ vault: engine, joinMs: 5000 });
    release();
    expect(await refresh).toEqual({});
    await first;
  });

  it('a cycle stuck past the cap is reported as skipped with its start, not as ran', async () => {
    const vault = createMemoryVault();
    const { engine } = makeDevice(vault);
    await engine.dbSyncCycle();
    const release = holdNextList(vault);
    const first = engine.dbSyncCycle();
    await settle();
    const r = await runLauncherRefreshCycle({ vault: engine, joinMs: 10 });
    expect(r.skipped).toMatch(/^a vault sync has been running since \d\d:\d\d:\d\d$/);
    release();
    await first;
  });
});
