import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PANE_MAX, PANE_MIN, PANE_OTHER_MIN, clampPaneWidth, dragPaneWidth, readPaneWidth, writePaneWidth } from './paneWidth.js';

// The planner's notes sidebar, dragged wider or narrower (#2132).

describe('clampPaneWidth', () => {
  it('holds the pane between its bounds', () => {
    expect(clampPaneWidth(100)).toBe(PANE_MIN);
    expect(clampPaneWidth(5000)).toBe(PANE_MAX);
    expect(clampPaneWidth(480.4)).toBe(480);
  });

  it('leaves the task lists their room in the row, but never goes under its minimum', () => {
    expect(clampPaneWidth(900, 1100)).toBe(1100 - PANE_OTHER_MIN);
    expect(clampPaneWidth(900, 500)).toBe(PANE_MIN);
  });

  it('is null for a width that is not a number', () => {
    expect(clampPaneWidth(NaN)).toBeNull();
    expect(clampPaneWidth(undefined)).toBeNull();
  });
});

describe('dragPaneWidth', () => {
  it('dragging the left edge left widens the pane, right narrows it', () => {
    const start = { startWidth: 500, startX: 800 };
    expect(dragPaneWidth(start, 700, 2000)).toBe(600);
    expect(dragPaneWidth(start, 900, 2000)).toBe(400);
    expect(dragPaneWidth(start, 0, 1200)).toBe(1200 - PANE_OTHER_MIN);
  });
});

describe('readPaneWidth / writePaneWidth', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('round-trips a width, and null clears it back to automatic', () => {
    expect(readPaneWidth('w')).toBeNull();
    writePaneWidth('w', 512.6);
    expect(readPaneWidth('w')).toBe(513);
    writePaneWidth('w', null);
    expect(readPaneWidth('w')).toBeNull();
  });

  it('reads junk or an out-of-range value safely', () => {
    store.set('w', 'wide');
    expect(readPaneWidth('w')).toBeNull();
    store.set('w', '99999');
    expect(readPaneWidth('w')).toBe(PANE_MAX);
  });
});
