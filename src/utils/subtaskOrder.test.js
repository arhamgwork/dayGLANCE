import { describe, expect, it } from 'vitest';
import { dropIndex, moveSubtaskTo } from './subtaskOrder.js';

// #2176: a task's subtasks are a checklist, and their order is the array's.

const list = () => [{ id: 'a', title: 'Back up' }, { id: 'b', title: 'Migrate' }, { id: 'c', title: 'Verify' }];

describe('moveSubtaskTo', () => {
  it('moves one subtask, the rest keeping their order', () => {
    expect(moveSubtaskTo(list(), 'c', 0).map(s => s.id)).toEqual(['c', 'a', 'b']);
    expect(moveSubtaskTo(list(), 'a', 2).map(s => s.id)).toEqual(['b', 'c', 'a']);
    expect(moveSubtaskTo(list(), 'b', 0).map(s => s.id)).toEqual(['b', 'a', 'c']);
  });

  it('clamps to the list', () => {
    expect(moveSubtaskTo(list(), 'a', 99).map(s => s.id)).toEqual(['b', 'c', 'a']);
    expect(moveSubtaskTo(list(), 'c', -4).map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('gives the same array back when nothing moves, so nothing is stamped', () => {
    const subtasks = list();
    expect(moveSubtaskTo(subtasks, 'b', 1)).toBe(subtasks);
    expect(moveSubtaskTo(subtasks, 'zzz', 0)).toBe(subtasks);
  });

  it('keeps each subtask whole', () => {
    const subtasks = [{ id: 'a', title: 'One', completed: true, duration: 15 }, { id: 'b', title: 'Two' }];
    expect(moveSubtaskTo(subtasks, 'a', 1)[1]).toBe(subtasks[0]);
  });
});

describe('dropIndex', () => {
  it('top half lands above the row, bottom half below, counted before the move', () => {
    // Dragging row 0 down: over row 2's bottom half is the end (index 2).
    expect(dropIndex(0, 2, true)).toBe(2);
    expect(dropIndex(0, 2, false)).toBe(1);
    // Dragging row 2 up: over row 0's top half is the start.
    expect(dropIndex(2, 0, false)).toBe(0);
    expect(dropIndex(2, 0, true)).toBe(1);
    // Over itself: stays.
    expect(dropIndex(1, 1, false)).toBe(1);
    expect(dropIndex(1, 1, true)).toBe(1);
  });
});
