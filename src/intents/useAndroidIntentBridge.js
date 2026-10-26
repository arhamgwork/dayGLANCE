import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { ACTIONS } from '@glance-apps/intents';
import { isNativeAndroid, nativeAckLauncherIntents, nativeGetPendingIntent, nativeGetPendingLauncherIntents, nativeReportIntentResult } from '../native';
import { handleIntent } from './handleIntent.js';
import { handleLauncherIntent, LAUNCHER_ACTIONS, LAUNCHER_ONLY } from './launcherWrites.js';
import { intentDrainAllowed, INTENT_DRAIN_RETRY_MS } from './intentDrainGate.js';
import { retireCheck } from './retireCheck.js';

/**
 * The native transport delivers the fully-qualified Android action string
 * (e.g. "app.dayglance.OPEN") — that's what IntentReceiver / onNewIntent store.
 * handleIntent, however, switches on the short ACTIONS constants ("open"), so
 * the raw broadcast action never matches and every intent falls through to
 * "Unknown action". Map the broadcast action to the intents action here.
 */
const BROADCAST_ACTION_MAP = {
  'app.dayglance.CREATE': ACTIONS.CREATE,
  'app.dayglance.COMPLETE': ACTIONS.COMPLETE,
  'app.dayglance.OPEN': ACTIONS.OPEN,
  'app.dayglance.QUERY': ACTIONS.QUERY,
};

export const isRefresh = (entry) => LAUNCHER_ACTIONS[entry?.action] === LAUNCHER_ONLY.REFRESH;

// Setters a launcher write calls. Each runs inside a synchronous flush, so the
// change is committed and saved (useSaveOnChange's effect flushes with a sync
// commit) before the write is recorded in the ledger and taken off the native
// queue. Nothing then waits on a timer or a frame, which a page in the
// background may never get.
const DURABLE_SETTERS = ['setTasks', 'setUnscheduledTasks', 'setRecurringTasks', 'toggleRoutineCompletion'];

/** The context with its setters flushed synchronously ([flush] is react-dom's flushSync in the app). */
export function durableContext(context, flush = flushSync) {
  const out = { ...context };
  for (const key of DURABLE_SETTERS) {
    const fn = context[key];
    if (typeof fn !== 'function') continue;
    out[key] = (...args) => {
      let result;
      flush(() => { result = fn(...args); });
      return result;
    };
  }
  return out;
}

/**
 * Handle the launcher's queued entries (docs/launcher-integration.md): writes
 * first, each acknowledged to the native queue only once it is handled and
 * saved, then refreshes. A REFRESH awaits a whole sync cycle, which a page in
 * the background can stall on for hours; a write queued behind it must not
 * wait on it, nor be lost with the page.
 *
 * @param {object} io { entries, context(), ack(ids), flush, inFlight, log }
 * @returns {Promise<Array<{clientId?: string, action: string, result: object}>>} each write's result, in order
 */
export async function drainLauncherQueue({ entries, context, ack = nativeAckLauncherIntents, flush = flushSync, inFlight = new Set(), log = () => {} }) {
  const writes = entries.filter(e => !isRefresh(e));
  const refreshes = entries.filter(isRefresh);
  const results = [];
  for (const write of writes) {
    const id = write?.clientId;
    // A second drain while this one awaits (a wake and a visibility change
    // together) sees the write still queued: it is this drain's.
    if (id && inFlight.has(id)) continue;
    if (id) inFlight.add(id);
    try {
      const result = await handleLauncherIntent(write, durableContext(context(), flush));
      results.push({ clientId: id, action: write.action, result });
      log(write.action, result);
    } catch (err) {
      results.push({ clientId: id, action: write.action, result: { success: false, error: err?.message ?? String(err) } });
      log(write.action, err);
    } finally {
      if (id) inFlight.delete(id);
    }
    // Handled (or refused, which the ledger records) and saved: off the queue.
    // A handler that threw is taken off too, or it would throw on every start.
    if (id) ack([id]);
  }
  for (const refresh of refreshes) {
    try {
      log(refresh.action, await handleLauncherIntent(refresh, context()));
    } catch (err) {
      log(refresh.action, err);
    }
  }
  return results;
}

/**
 * Android intent transport bridge.
 *
 * On mount and on every visibilitychange (when the document becomes visible),
 * checks for a pending intent stored by IntentReceiver or MainActivity.onNewIntent,
 * dispatches it through handleIntent, and reports the result back to native via
 * NativeBridge.reportIntentResult so Tasker/other apps can receive it as a
 * app.dayglance.RESULT broadcast.
 *
 * Nothing is drained until the context says the data has loaded (`ready`) and,
 * with vault sync on, the first pull has committed (intentDrainGate.js). A
 * drain that ran earlier handled every write against empty task lists: a
 * complete found no such task and recorded the failure, and a created task was
 * replaced a moment later by the stored list. That was every write the
 * launcher sent while the app was closed.
 *
 * No-ops on non-Android platforms.
 *
 * @param {object} context  The handleIntent context (same shape as useIntentPoller's context), plus `ready`.
 */
export function useAndroidIntentBridge(context) {
  // Keep a ref so the visibilitychange handler always sees the latest context
  // without needing to be re-registered every render.
  const contextRef = useRef(context);
  contextRef.current = context;
  const checkRef = useRef(null);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    const inFlight = new Set();
    let retry = null;

    const checkPending = async () => {
      if (!contextRef.current.ready) return; // the effect below runs it once the data is in
      if (!intentDrainAllowed()) {
        if (!retry) retry = setTimeout(() => { retry = null; checkPending(); }, INTENT_DRAIN_RETRY_MS);
        return;
      }
      // The launcher's queue first: its own slot, several deep, handled in
      // order; no RESULT broadcast, the launcher reads the outcome from the
      // next snapshot.
      await drainLauncherQueue({
        entries: nativeGetPendingLauncherIntents(),
        context: () => contextRef.current,
        inFlight,
        log: (action, result) => { if (import.meta.env.DEV) console.log('[launcher-bridge]', action, result); },
      });

      const intent = nativeGetPendingIntent();
      if (!intent) return;

      const { action, payload = {} } = intent;
      // action is the Android broadcast action (e.g. "app.dayglance.OPEN");
      // translate it to the short ACTIONS constant handleIntent expects.
      const mappedAction = BROADCAST_ACTION_MAP[action] ?? action;
      let result;
      try {
        result = await handleIntent(mappedAction, payload, contextRef.current);
      } catch (err) {
        result = { success: false, error: err?.message ?? String(err) };
      }

      // Report back under the ORIGINAL broadcast action so Tasker's RESULT
      // listener sees %action = "app.dayglance.OPEN" as documented.
      if (import.meta.env.DEV) console.log('[intent-bridge]', action, '→', mappedAction, result);
      nativeReportIntentResult(action, JSON.stringify(result));
    };

    checkRef.current = checkPending;

    // Expose an unconditional entry point for the native side to invoke directly
    // (from MainActivity's INTENT_RECEIVED forward receiver and onResume). This
    // must NOT be gated on document.visibilityState: the WebView is never paused
    // (webView.onPause() is intentionally skipped so the GPU surface stays live),
    // so its visibilityState stays 'visible' even while the app is backgrounded —
    // but we don't want to depend on that invariant to process background intents.
    window.__dayglanceCheckPendingIntent = checkPending;
    // Asked by the native side before it closes this page after it stopped
    // answering the launcher in the background (intents/retireCheck.js).
    window.__dayglanceRetireCheck = retireCheck;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPending();
      }
    };

    // Check on mount (the app may have been opened via intent). Off the effect
    // phase, so a write's synchronous flush is not inside React's commit.
    Promise.resolve().then(checkPending);

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (retry) clearTimeout(retry);
      checkRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (window.__dayglanceCheckPendingIntent === checkPending) {
        delete window.__dayglanceCheckPendingIntent;
      }
      if (window.__dayglanceRetireCheck === retireCheck) delete window.__dayglanceRetireCheck;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The queue waited for the data: drain it the moment it has loaded.
  const ready = !!context.ready;
  useEffect(() => {
    if (ready) Promise.resolve().then(() => checkRef.current?.());
  }, [ready]);
}
