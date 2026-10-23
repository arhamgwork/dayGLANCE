import { beforeEach, describe, expect, it, vi } from 'vitest';

// A minimal hook runtime, as useCloudSyncAfterEdit.test.js does: refs and
// effects keep their slot by call order across renders, an effect re-runs
// (cleanup first) when a dependency changes, and unmount runs the cleanups.
const runtime = vi.hoisted(() => ({ slots: [], i: 0 }));
vi.mock('react', () => ({
  useRef: (initial) => {
    const n = runtime.i++;
    runtime.slots[n] ??= { current: initial };
    return runtime.slots[n];
  },
  useEffect: (effect, deps) => {
    const n = runtime.i++;
    const slot = runtime.slots[n] ??= {};
    if (!slot.deps || deps.some((d, k) => d !== slot.deps[k])) {
      slot.cleanup?.();
      slot.cleanup = effect();
      slot.deps = deps;
    }
  },
}));
const vault = vi.hoisted(() => ({ enabled: true, registered: [] }));
vi.mock('../sync/vaultConfig.js', () => ({ isVaultEnabled: () => vault.enabled }));
vi.mock('../sync/dirtyTracker.js', () => ({ registerDbEngine: (e) => { vault.registered.push(e); } }));

import { fileEngineData, useFileSyncEngine, useVaultSyncEngine, vaultEngineData } from './useSyncEngines.js';

const render = (hook, props) => { runtime.i = 0; return hook(props); };
const unmount = () => { for (const slot of runtime.slots) slot?.cleanup?.(); };

beforeEach(() => {
  runtime.slots = [];
  vault.enabled = true;
  vault.registered = [];
});

const callbacks = (over = {}) => ({
  current: {
    buildPayload: () => ({ data: { tasks: ['t1'] } }),
    buildBackupPayload: () => ({ data: { tasks: ['backup'] } }),
    applyPayload: vi.fn(),
    multiUserEnabled: false,
    syncRetentionDays: undefined,
    ...over,
  },
});

describe('the data wiring both roots share', () => {
  it('the file tier reads the latest callbacks at call time, retention defaulting to 90', () => {
    const ref = callbacks();
    const data = fileEngineData(ref);
    expect(data.buildPayload()).toEqual({ data: { tasks: ['t1'] } });
    expect(data.buildBackupPayload()).toEqual({ data: { tasks: ['backup'] } });
    expect(data.getSyncRetentionDays()).toBe(90);
    ref.current = { ...ref.current, buildPayload: () => ({ data: { tasks: ['t2'] } }), syncRetentionDays: 30 };
    expect(data.buildPayload()).toEqual({ data: { tasks: ['t2'] } });
    expect(data.getSyncRetentionDays()).toBe(30);
    data.applyPayload({ x: 1 }, { allowEmpty: false });
    expect(ref.current.applyPayload).toHaveBeenCalledWith({ x: 1 }, { allowEmpty: false });
  });

  it('the vault tier gets the payload data, an apply that allows empty, and the multi-user flag', () => {
    const ref = callbacks({ multiUserEnabled: true });
    const data = vaultEngineData(ref);
    expect(data.getData()).toEqual({ tasks: ['t1'] });
    data.commitData({ tasks: [] });
    expect(ref.current.applyPayload).toHaveBeenCalledWith({ tasks: [] }, { allowEmpty: true });
    expect(data.isMultiUserEnabled()).toBe(true);
    ref.current.multiUserEnabled = 'yes';
    expect(data.isMultiUserEnabled()).toBe(false);
  });
});

describe('useFileSyncEngine', () => {
  it('is built once, with the folder, and rebuilt only when the folder changes', () => {
    const createEngine = vi.fn((config, opts) => ({ config, opts }));
    const ref = callbacks();
    const props = { callbacksRef: ref, syncFolder: 'dayglance', createEngine, handlers: {} };
    const first = render(useFileSyncEngine, props).current;
    expect(render(useFileSyncEngine, props).current).toBe(first);
    expect(createEngine).toHaveBeenCalledOnce();
    expect(first.opts).toEqual({ appFolderName: 'dayglance' });
    const moved = render(useFileSyncEngine, { ...props, syncFolder: 'GLANCE/dayglance' }).current;
    expect(moved).not.toBe(first);
    expect(moved.opts).toEqual({ appFolderName: 'GLANCE/dayglance' });
  });

  it('builds nothing while disabled', () => {
    const createEngine = vi.fn();
    expect(render(useFileSyncEngine, { callbacksRef: callbacks(), syncFolder: 'x', enabled: false, createEngine }).current).toBeNull();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("calls the latest render's handlers, and a missing one is a no-op", () => {
    const createEngine = vi.fn((config) => ({ config }));
    const ref = callbacks();
    const first = vi.fn();
    const engine = render(useFileSyncEngine, { callbacksRef: ref, syncFolder: 'x', createEngine, handlers: { onError: first } }).current;
    const second = vi.fn();
    render(useFileSyncEngine, { callbacksRef: ref, syncFolder: 'x', createEngine, handlers: { onError: second } });
    engine.config.onError('boom', 'NETWORK_ERROR');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('boom', 'NETWORK_ERROR');
    expect(() => engine.config.onFirstSyncReload()).not.toThrow();
    expect(engine.config.getSyncRetentionDays()).toBe(90);
  });
});

describe('useVaultSyncEngine', () => {
  const engine = () => ({ dbSyncCycle: vi.fn(), dispose: vi.fn() });

  it('waits for the data, then builds once, registers it, and hands it to the root', () => {
    const made = engine();
    const createEngine = vi.fn(() => made);
    const onEngine = vi.fn();
    const props = { callbacksRef: callbacks(), dataLoaded: false, createEngine, onEngine, handlers: {} };
    expect(render(useVaultSyncEngine, props).current).toBeNull();
    expect(createEngine).not.toHaveBeenCalled();
    const ref = render(useVaultSyncEngine, { ...props, dataLoaded: true });
    expect(ref.current).toBe(made);
    expect(vault.registered).toEqual([made]);
    expect(onEngine).toHaveBeenCalledWith(made);
    // Its data wiring is the shared one.
    expect(createEngine.mock.calls[0][0].getData()).toEqual({ tasks: ['t1'] });
    render(useVaultSyncEngine, { ...props, dataLoaded: true, handlers: { onError: vi.fn() } });
    expect(createEngine).toHaveBeenCalledOnce();
  });

  it("retires the engine on unmount: the root's release first, then the tracker, then dispose", () => {
    const order = [];
    const made = { dispose: () => order.push('dispose') };
    vault.registered = { push: (e) => order.push(e ? 'register' : 'unregister') };
    const ref = render(useVaultSyncEngine, {
      callbacksRef: callbacks(), dataLoaded: true, createEngine: () => made,
      onEngine: () => () => order.push('release'),
    });
    unmount();
    expect(order).toEqual(['register', 'release', 'unregister', 'dispose']);
    expect(ref.current).toBeNull();
  });

  it('is inert with the vault off, in an inactive root, or when the factory declines', () => {
    const createEngine = vi.fn(() => null);
    vault.enabled = false;
    const off = vi.fn();
    render(useVaultSyncEngine, { callbacksRef: callbacks(), dataLoaded: true, createEngine: off });
    expect(off).not.toHaveBeenCalled();
    runtime.slots = [];
    vault.enabled = true;
    const inactive = vi.fn();
    render(useVaultSyncEngine, { callbacksRef: callbacks(), dataLoaded: true, active: false, createEngine: inactive });
    expect(inactive).not.toHaveBeenCalled();
    runtime.slots = [];
    const onEngine = vi.fn();
    expect(render(useVaultSyncEngine, { callbacksRef: callbacks(), dataLoaded: true, createEngine, onEngine }).current).toBeNull();
    expect(onEngine).not.toHaveBeenCalled();
    expect(vault.registered).toEqual([]);
  });

  it("writes into the root's own ref when it passes one", () => {
    const made = engine();
    const engineRef = { current: null };
    const returned = render(useVaultSyncEngine, { callbacksRef: callbacks(), dataLoaded: true, engineRef, createEngine: () => made });
    expect(returned).toBe(engineRef);
    expect(engineRef.current).toBe(made);
  });
});
