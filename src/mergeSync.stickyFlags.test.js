import { describe, it, expect } from 'vitest';
import { mergeSyncData } from './mergeSync.js';

// The file-tier merge restores app-only fields the newer copy lacks
// (`archived`, `originalPlan`, `clientId`, `starredDate`, and the merged
// `deferrals`, `planTrail` and `createdAt`). Restoring one is half the job:
// the side whose copy lacked it must be FLAGGED, so it is written back.
//
// The upstream merge hands back the callers' own objects as merged items, and
// the carries used to write onto them before checking the side: the winning
// side then compared equal to the result, its flag was never raised, and the
// caller's own data was mutated. Each field is checked both ways round.

const OLD = '2026-10-01T00:00:00.000Z';
const NEW = '2026-10-02T00:00:00.000Z';
const base = { id: 't1', title: 'Report' };

// A field the stale side holds and the newer side lacks.
const FIELDS = {
  archived: { held: { archived: true }, expect: (t) => expect(t.archived).toBe(true) },
  originalPlan: { held: { originalPlan: { date: '2026-09-30', startTime: '09:00' } }, expect: (t) => expect(t.originalPlan).toEqual({ date: '2026-09-30', startTime: '09:00' }) },
  clientId: { held: { clientId: 'launcher-1' }, expect: (t) => expect(t.clientId).toBe('launcher-1') },
  starredDate: { held: { starredDate: '2026-10-01' }, expect: (t) => expect(t.starredDate).toBe('2026-10-01') },
  deferrals: { held: { deferrals: 2 }, expect: (t) => expect(t.deferrals).toBe(2) },
  planTrail: { held: { planTrail: [{ at: 1, date: '2026-09-30', startTime: '09:00' }] }, expect: (t) => expect(t.planTrail).toEqual([{ at: 1, date: '2026-09-30', startTime: '09:00' }]) },
  createdAt: { held: { createdAt: '2026-09-01T09:00:00-05:00' }, expect: (t) => expect(t.createdAt).toBe('2026-09-01T09:00:00-05:00') },
};

const freeze = (x) => JSON.parse(JSON.stringify(x));

describe.each(Object.entries(FIELDS))('the %s carry', (_, field) => {
  it('flags the REMOTE when the remote copy won without it, and leaves the input alone', () => {
    const local = { unscheduledTasks: [{ ...base, lastModified: OLD, ...field.held }] };
    const remote = { unscheduledTasks: [{ ...base, title: 'Report v2', lastModified: NEW }] };
    const remoteBefore = freeze(remote);
    const result = mergeSyncData(local, remote, 90);
    const [merged] = result.data.unscheduledTasks;
    expect(merged.title).toBe('Report v2'); // the newer copy did win
    field.expect(merged);
    expect(result.remoteChanged).toBe(true);
    expect(remote).toEqual(remoteBefore);
  });

  it('flags the LOCAL side when the local copy won without it, and leaves the input alone', () => {
    const local = { unscheduledTasks: [{ ...base, title: 'Report v2', lastModified: NEW }] };
    const remote = { unscheduledTasks: [{ ...base, lastModified: OLD, ...field.held }] };
    const localBefore = freeze(local);
    const result = mergeSyncData(local, remote, 90);
    const [merged] = result.data.unscheduledTasks;
    expect(merged.title).toBe('Report v2');
    field.expect(merged);
    expect(result.localChanged).toBe(true);
    expect(local).toEqual(localBefore);
  });
});

describe('a merge with nothing to carry', () => {
  it('raises no flag and copies nothing', () => {
    const row = { ...base, lastModified: OLD, archived: true, createdAt: '2026-09-01T09:00:00-05:00' };
    const local = { unscheduledTasks: [row] };
    const remote = { unscheduledTasks: [{ ...row }] };
    const result = mergeSyncData(local, remote, 90);
    expect(result.localChanged).toBe(false);
    expect(result.remoteChanged).toBe(false);
  });
});

describe('the writes the flags cause settle', () => {
  it('once both sides hold the merged copy, the next merge flags nothing', () => {
    const held = Object.assign({}, ...Object.values(FIELDS).map((f) => f.held));
    const local = { unscheduledTasks: [{ ...base, lastModified: OLD, ...held }] };
    const remote = { unscheduledTasks: [{ ...base, title: 'Report v2', lastModified: NEW }] };
    const first = mergeSyncData(local, remote, 90);
    expect(first.remoteChanged).toBe(true);
    // Each side now holds what the first merge wrote back to it.
    const settled = freeze(first.data.unscheduledTasks);
    const second = mergeSyncData({ unscheduledTasks: freeze(settled) }, { unscheduledTasks: freeze(settled) }, 90);
    expect(second.localChanged).toBe(false);
    expect(second.remoteChanged).toBe(false);
    for (const f of Object.values(FIELDS)) f.expect(second.data.unscheduledTasks[0]);
  });
});
