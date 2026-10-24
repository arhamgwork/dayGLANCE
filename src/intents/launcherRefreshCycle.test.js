import { describe, it, expect } from 'vitest';
import { runLauncherRefreshCycle } from './launcherRefreshCycle.js';

// The REFRESH runner's verdicts over fake engines; dbSyncInFlight.test.js runs
// the in-flight cases over the real vault engine.

const completed = { applied: 0, skipped: 0, skippedEntityIds: [] };

function fakeVault(results, { settles = true } = {}) {
  const calls = { cycles: 0, waits: [] };
  return {
    calls,
    dbSyncCycle: async () => results[Math.min(calls.cycles++, results.length - 1)],
    waitForCycle: async (ms) => { calls.waits.push(ms); return settles; },
  };
}

describe('runLauncherRefreshCycle', () => {
  it('a completed cycle on every tier is a plain success', async () => {
    let fileRuns = 0;
    const file = { sync: async () => { fileRuns++; }, isSyncing: () => false };
    const vault = fakeVault([completed]);
    expect(await runLauncherRefreshCycle({ file, vault })).toEqual({});
    expect(fileRuns).toBe(1);
    // A completed result counts rows in `skipped`; that is not a skipped cycle.
    expect(await runLauncherRefreshCycle({ vault: fakeVault([{ ...completed, skipped: 3 }]) })).toEqual({});
  });

  it('joins a vault cycle in flight, then runs one of its own', async () => {
    const vault = fakeVault([{ cycleSkipped: 'in-flight', since: 1 }, completed]);
    expect(await runLauncherRefreshCycle({ vault, joinMs: 1234 })).toEqual({});
    expect(vault.calls.waits).toEqual([1234]);
    expect(vault.calls.cycles).toBe(2);
  });

  it('a vault cycle still in flight after the cap is skipped, with when it started', async () => {
    const since = new Date(2026, 9, 22, 22, 58, 24).getTime();
    const vault = fakeVault([{ cycleSkipped: 'in-flight', since }], { settles: false });
    expect(await runLauncherRefreshCycle({ vault })).toEqual({ skipped: 'a vault sync has been running since 22:58:24' });
    expect(vault.calls.cycles).toBe(1);
  });

  it('another cycle grabbing the guard while it waited is skipped too', async () => {
    const vault = fakeVault([{ cycleSkipped: 'in-flight', since: 1 }, { cycleSkipped: 'in-flight', since: 2 }]);
    expect((await runLauncherRefreshCycle({ vault })).skipped).toMatch(/another vault sync started/);
  });

  it('a failure cooldown, a held-back pull and an engine not ready are skipped with their reason', async () => {
    expect((await runLauncherRefreshCycle({ vault: fakeVault([{ ...completed, throttled: true, retryInMs: 7400 }]) })).skipped)
      .toBe('the vault sync is backing off after a failure (next try in 8 s)');
    expect((await runLauncherRefreshCycle({ vault: fakeVault([{ suppressed: true, reason: 'glitch heal' }]) })).skipped)
      .toBe('the vault pull is held back: glitch heal');
    expect((await runLauncherRefreshCycle({ vault: fakeVault([undefined]) })).skipped)
      .toMatch(/not running/);
  });

  it('a failed vault cycle throws its error, so REFRESH records failed rather than ran', async () => {
    await expect(runLauncherRefreshCycle({ vault: fakeVault([{ ...completed, error: 'list failed: 503' }]) }))
      .rejects.toThrow('list failed: 503');
  });

  it('a file sync already running is reported, and the vault still runs', async () => {
    let fileRuns = 0;
    const file = { sync: async () => { fileRuns++; }, isSyncing: () => true };
    const vault = fakeVault([completed]);
    expect((await runLauncherRefreshCycle({ file, vault })).skipped).toMatch(/a file sync was already running/);
    expect(fileRuns).toBe(0);
    expect(vault.calls.cycles).toBe(1);
  });

  it('no tier configured is nothing to skip', async () => {
    expect(await runLauncherRefreshCycle({})).toEqual({});
  });
});
