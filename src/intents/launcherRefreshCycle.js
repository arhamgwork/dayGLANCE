// The sync cycle behind the launcher's REFRESH (launcherWrites.js), with an
// answer to the one question the launcher asks: did a cycle actually complete?
//
// Both tiers return early, without a word, when a cycle is already in flight,
// and the vault returns early during a failure cooldown. REFRESH used to take
// any return for a completed cycle, so a cycle stuck in flight (a backgrounded
// app frozen mid-request) made every later REFRESH log `ran` in a millisecond
// while nothing synced for hours, and Android froze the app again the moment
// that answer came back (2026-10-22). Now a vault cycle in flight is JOINED for
// up to REFRESH_JOIN_MS, which also keeps the app awake while it finishes (the
// keep-awake job waits for this answer), and anything short of a completed
// cycle comes back as a reason the launcher can show.

/** How long a REFRESH waits for a vault cycle already in flight. */
export const REFRESH_JOIN_MS = 20_000;

/**
 * How long a whole REFRESH may take before it reports `failed`, with the step it
 * was on. Under the native keep-awake hold (60 s), so a cycle that hangs (a
 * request that never returns) is reported while the app is still awake to say so,
 * rather than read `unanswered`. The cycle itself is not cancelled.
 */
export const REFRESH_CAP_MS = 45_000;

const clockTime = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toTimeString().slice(0, 8) : 'an unknown time');

/** What a vault result means for the launcher: {} when it completed, { skipped } when not; throws when it failed. */
function vaultOutcome(r) {
  if (r == null) return { skipped: 'the vault sync is not running (engine not ready)' };
  if (r.error) throw new Error(r.error);
  if (r.throttled) return { skipped: `the vault sync is backing off after a failure (next try in ${Math.ceil((r.retryInMs ?? 0) / 1000)} s)` };
  if (r.suppressed) return { skipped: `the vault pull is held back: ${r.reason || 'suppressed'}` };
  return {};
}

/**
 * Runs every configured tier for a REFRESH, one after the other.
 *
 * @param {object}   p
 * @param {object}   [p.file]   the file-tier engine ({ sync, isSyncing }), or null when off
 * @param {object}   [p.vault]  the vault engine ({ dbSyncCycle, waitForCycle }), or null when off
 * @param {number}   [p.joinMs] how long to wait for a vault cycle in flight
 * @param {number}   [p.capMs]  how long the whole refresh may take before it fails with the step it was on
 * @returns {Promise<{ skipped?: string }>}  `skipped` says why no complete cycle ran; throws when a cycle failed or ran past the cap
 */
export async function runLauncherRefreshCycle({ file = null, vault = null, joinMs = REFRESH_JOIN_MS, capMs = REFRESH_CAP_MS } = {}) {
  const progress = { step: 'starting' };
  let timer;
  const cap = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(capMs / 1000)} s during ${progress.step}`)), capMs);
  });
  try {
    return await Promise.race([runTiers({ file, vault, joinMs }, progress), cap]);
  } finally {
    clearTimeout(timer);
  }
}

async function runTiers({ file, vault, joinMs }, progress) {
  const skipped = [];
  if (file?.sync) {
    // The file tier queues a follow-up and returns when one is in flight; it
    // cannot be joined, so the most this can do is say so.
    if (file.isSyncing?.()) skipped.push('a file sync was already running (it runs again when that one ends)');
    else {
      progress.step = 'the file sync';
      await file.sync();
    }
  }
  if (vault?.dbSyncCycle) {
    progress.step = 'the vault sync';
    let r = await vault.dbSyncCycle();
    if (r?.cycleSkipped === 'in-flight') {
      progress.step = 'the wait for a vault sync already running';
      const settled = typeof vault.waitForCycle === 'function' ? await vault.waitForCycle(joinMs) : false;
      if (!settled) {
        skipped.push(`a vault sync has been running since ${clockTime(r.since)}`);
        return { skipped: skipped.join('; ') };
      }
      // The joined cycle may have started long before this request: run one of ours.
      progress.step = 'the vault sync';
      r = await vault.dbSyncCycle();
      if (r?.cycleSkipped === 'in-flight') {
        skipped.push('another vault sync started while this one waited');
        return { skipped: skipped.join('; ') };
      }
    }
    const v = vaultOutcome(r);
    if (v.skipped) skipped.push(v.skipped);
  }
  return skipped.length ? { skipped: skipped.join('; ') } : {};
}
