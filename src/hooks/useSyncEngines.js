// The two sync engines and their wiring to the app's data, shared by both
// roots: App and the headless refresh (src/headless/HeadlessRefresh.jsx).
// What each engine sends and applies is useSyncEngineData's; this module is
// how the engines reach it, and the lifecycle around them. A root keeps only
// what is its own: App its status UI, cadence and console hooks; the headless
// root its error reports.
//
// Both engines call through `callbacksRef` at call time, so they see the
// render's latest closures while being constructed once. Its `current` is
// { buildPayload, buildBackupPayload, applyPayload, multiUserEnabled,
// syncRetentionDays }; a root refreshes it every render. The handlers are read
// the same way, so a handler that closes over `t` or state never needs the
// engine rebuilt.

import { useEffect, useRef } from 'react';
import { createDayGlanceEngine } from '../sync/adapter.js';
import { createDbEngine } from '../sync/dbEngine.js';
import { registerDbEngine } from '../sync/dirtyTracker.js';
import { isVaultEnabled } from '../sync/vaultConfig.js';

const DEFAULT_RETENTION_DAYS = 90;

/** The file tier's data callbacks: the payload, the backup payload, the apply, the retention. */
export const fileEngineData = (callbacksRef) => ({
  buildPayload:         () => callbacksRef.current.buildPayload?.(),
  buildBackupPayload:   () => callbacksRef.current.buildBackupPayload?.(),
  applyPayload:         (data, opts) => callbacksRef.current.applyPayload?.(data, opts),
  getSyncRetentionDays: () => callbacksRef.current.syncRetentionDays ?? DEFAULT_RETENTION_DAYS,
});

/**
 * The vault tier's data callbacks. `isMultiUserEnabled` lets its snapshot-delete
 * classifier apply the same imported-task exclusion buildSyncPayload uses
 * (payloadExclusions.js): a baseline row of an excluded class is neither a
 * delete nor a glitch. Every vault engine gets it, the settings bootstrap's
 * one-shot engine included.
 */
export const vaultEngineData = (callbacksRef) => ({
  getData:            () => callbacksRef.current.buildPayload?.()?.data,
  commitData:         (data) => callbacksRef.current.applyPayload?.(data, { allowEmpty: true }),
  isMultiUserEnabled: () => callbacksRef.current.multiUserEnabled === true,
});

const FILE_HANDLERS = ['onStatusChange', 'onError', 'onLastSyncedChange', 'onConflict', 'onPassphraseRequired', 'onFirstSyncReload'];
const VAULT_HANDLERS = ['onStatusChange', 'onError', 'onRowsSkipped'];

const throughRef = (handlersRef, names) =>
  Object.fromEntries(names.map(name => [name, (...args) => handlersRef.current?.[name]?.(...args)]));

/**
 * The file-tier (WebDAV) engine, built during render so it exists before any
 * effect reads it, and rebuilt when the sync folder changes (the folder is part
 * of every URL it builds).
 *
 * @param {object} p
 * @param {{current: object}} p.callbacksRef  see the module comment
 * @param {string} p.syncFolder   normalised (utils/syncFolder.js)
 * @param {boolean} [p.enabled=true]  false: no engine (the headless root builds one only for a configured tier)
 * @param {object} [p.handlers]   onStatusChange, onError, onLastSyncedChange, onConflict, onPassphraseRequired, onFirstSyncReload
 * @param {{current: object|null}} [p.engineRef]  the root's own ref for the engine
 *   (a ref declared in the component, which its effects may read without
 *   listing it); one of the hook's own otherwise
 * @param {Function} [p.createEngine]  test seam for sync/adapter.js
 * @returns {{current: object|null}} the engine ref
 */
export function useFileSyncEngine({ callbacksRef, syncFolder, enabled = true, handlers, engineRef: givenRef, createEngine = createDayGlanceEngine }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ownRef = useRef(null);
  const engineRef = givenRef ?? ownRef;
  const folderRef = useRef(null);
  if (enabled && (!engineRef.current || folderRef.current !== syncFolder)) {
    folderRef.current = syncFolder;
    engineRef.current = createEngine({
      ...fileEngineData(callbacksRef),
      ...throughRef(handlersRef, FILE_HANDLERS),
    }, { appFolderName: syncFolder });
  }
  return engineRef;
}

/**
 * The GLANCEvault engine, built once the data has loaded and the vault is on,
 * and registered with the dirty tracker so local writes push. Inert when the
 * vault is disabled: createDbEngine returns null and nothing else runs.
 *
 * @param {object} p
 * @param {{current: object}} p.callbacksRef  see the module comment
 * @param {boolean} p.dataLoaded
 * @param {boolean} [p.active=true]  false: no engine (App's tray window)
 * @param {object} [p.handlers]   onStatusChange, onError, onRowsSkipped
 * @param {(engine: object) => (void|(() => void))} [p.onEngine]
 *   the root's own use of a new engine (App: the cadence and console hooks);
 *   what it returns runs before the engine is retired
 * @param {{current: object|null}} [p.engineRef]  the root's own ref for the
 *   engine, as for useFileSyncEngine (App also reads it in callbacks set up
 *   above this hook); one of the hook's own otherwise
 * @param {Function} [p.createEngine]  test seam for sync/dbEngine.js
 * @returns {{current: object|null}} the engine ref
 */
export function useVaultSyncEngine({ callbacksRef, dataLoaded, active = true, handlers, onEngine, engineRef: givenRef, createEngine = createDbEngine }) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const onEngineRef = useRef(onEngine);
  onEngineRef.current = onEngine;
  const ownRef = useRef(null);
  const engineRef = givenRef ?? ownRef;
  useEffect(() => {
    if (!active || !dataLoaded || !isVaultEnabled()) return;
    const engine = createEngine({
      ...vaultEngineData(callbacksRef),
      ...throughRef(handlersRef, VAULT_HANDLERS),
    });
    if (!engine) return;
    engineRef.current = engine;
    registerDbEngine(engine);
    const release = onEngineRef.current?.(engine);
    return () => {
      release?.();
      registerDbEngine(null);
      // Cancels any pending deferred cooldown-retry and makes stray timer
      // firings no-ops: a timer must never run a cycle against a dead engine.
      engine.dispose?.();
      engineRef.current = null;
    };
    // Built once per load: the handlers and onEngine are read through refs, so
    // a changed closure (a language change re-binding `t`) never tears it down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dataLoaded, createEngine]);
  return engineRef;
}
