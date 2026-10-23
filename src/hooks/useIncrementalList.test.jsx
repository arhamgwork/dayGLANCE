import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import useIncrementalList, { revealTask } from './useIncrementalList.js';
import { incrementalLimit } from '../utils/incrementalList.js';

// #2143, step 2: the Inbox renders a part at a time, more as the end comes
// near, and always the rows being worked on or asked for by search.

const items = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}` }));

describe('incrementalLimit', () => {
  it('is the limit, capped at the list', () => {
    expect(incrementalLimit(items, 60, [])).toBe(60);
    expect(incrementalLimit(items.slice(0, 10), 60, [])).toBe(10);
  });

  it('takes in a kept row past the limit, with `step` rows after it', () => {
    expect(incrementalLimit(items, 60, ['t200'], { step: 20 })).toBe(221);
    expect(incrementalLimit(items, 60, ['t499'], { step: 20 })).toBe(500);
    expect(incrementalLimit(items, 60, ['t10', null, 'missing'], { step: 20 })).toBe(60);
  });
});

// A stand-in IntersectionObserver the test can fire.
let observers;
beforeEach(() => {
  observers = [];
  globalThis.window = globalThis.window || {};
  const listeners = {};
  globalThis.window.addEventListener = (type, fn) => { (listeners[type] ||= new Set()).add(fn); };
  globalThis.window.removeEventListener = (type, fn) => { listeners[type]?.delete(fn); };
  globalThis.window.dispatchEvent = (e) => { listeners[e.type]?.forEach(fn => fn(e)); };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
  globalThis.getComputedStyle = () => ({ overflowY: 'visible' });
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; observers.push(this); }
    observe() {} disconnect() { this.gone = true; }
    fire() { this.cb([{ isIntersecting: true }]); }
  };
});
afterEach(() => { delete globalThis.IntersectionObserver; delete globalThis.getComputedStyle; });

function mount(list, opts) {
  const api = {};
  function Harness({ list: l, opts: o }) {
    const r = useIncrementalList(l, o);
    Object.assign(api, r);
    return r.hasMore ? <div ref={r.sentinelRef} /> : null;
  }
  let root;
  act(() => { root = create(<Harness list={list} opts={opts} />, { createNodeMock: () => ({ parentElement: null }) }); });
  return { api, rerender: (o) => act(() => { root.update(<Harness list={list} opts={o} />); }) };
}

describe('useIncrementalList', () => {
  it('renders the first rows, and more when the end comes near', () => {
    const { api } = mount(items, { initial: 60, step: 120 });
    expect(api.visible).toHaveLength(60);
    expect(api.hasMore).toBe(true);
    act(() => { observers.at(-1).fire(); });
    expect(api.visible).toHaveLength(180);
  });

  it('renders a row being worked on even past the limit, and keeps it after', () => {
    const { api, rerender } = mount(items, { initial: 60, step: 20, keep: ['t300'] });
    expect(api.visible.map(t => t.id)).toContain('t300');
    rerender({ initial: 60, step: 20, keep: [] });
    expect(api.visible.map(t => t.id)).toContain('t300');
  });

  it('renders a row search asks for', () => {
    const { api } = mount(items, { initial: 60, step: 20 });
    expect(api.visible.map(t => t.id)).not.toContain('t400');
    act(() => { revealTask('t400'); });
    expect(api.visible.map(t => t.id)).toContain('t400');
  });

  it('a short list renders whole, with no sentinel', () => {
    const { api } = mount(items.slice(0, 30), { initial: 60 });
    expect(api.visible).toHaveLength(30);
    expect(api.hasMore).toBe(false);
  });
});
