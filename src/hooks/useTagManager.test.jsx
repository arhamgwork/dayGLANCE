import React, { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act, create } from 'react-test-renderer';
import useTagManager from './useTagManager.js';
import useUndo from './useUndo.js';

// #2136: one tag change rewrites every title that carries the tag, carries
// the tag's other homes along (Frames, the filters, the follow-up tag), and
// is a single undo step. Real state and the real undo hook, no DOM.

const t = (key, params = {}) => `${key}:${JSON.stringify(params)}`;

function mount(initial) {
  const api = {};
  function Harness() {
    const [tasks, setTasks] = useState(initial.tasks);
    const [unscheduledTasks, setUnscheduledTasks] = useState(initial.unscheduledTasks);
    const [recurringTasks, setRecurringTasks] = useState(initial.recurringTasks);
    const [recycleBin, setRecycleBin] = useState([]);
    const [gtdFrames, setGtdFrames] = useState(initial.gtdFrames);
    const [selectedTags, setSelectedTags] = useState(initial.selectedTags);
    const [inboxTagFilter, setInboxTagFilter] = useState(initial.inboxTagFilter);
    const [followUpTag, setFollowUpTag] = useState(initial.followUpTag);
    const undo = useUndo({ tasks, unscheduledTasks, recycleBin, recurringTasks, gtdFrames, setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks, setGtdFrames, playUISound: () => {}, t });
    const { applyTagEdit } = useTagManager({
      tasks, unscheduledTasks, recurringTasks,
      setTasks, setUnscheduledTasks, setRecurringTasks, setGtdFrames,
      setSelectedTags, setInboxTagFilter, followUpTag, setFollowUpTag,
      pushUndo: undo.pushUndo, setUndoToast: undo.setUndoToast,
    });
    Object.assign(api, { tasks, unscheduledTasks, recurringTasks, gtdFrames, selectedTags, inboxTagFilter, followUpTag, toast: undo.undoToast, applyTagEdit, performUndo: undo.performUndo });
    return null;
  }
  act(() => { create(<Harness />); });
  return api;
}

const initial = () => ({
  tasks: [{ id: 'a', title: 'Fix gutter #home', date: '2026-10-22' }, { id: 'e', title: 'Dentist #home', imported: true }],
  unscheduledTasks: [{ id: 'b', title: 'Paint fence #Home #house' }, { id: 'td', title: 'Pay rent #home', todoist: { id: '7' } }],
  recurringTasks: [{ id: 'r', title: 'Water plants #home', exceptions: {} }],
  gtdFrames: [{ id: 'f', label: 'Chores', tagAffinity: ['home', 'errands'], lastModified: '2026-01-01T00:00:00.000Z' }, { id: 'g', label: 'Work', tagAffinity: ['work'], lastModified: '2026-01-01T00:00:00.000Z' }],
  selectedTags: ['home', 'errands'],
  inboxTagFilter: ['home'],
  followUpTag: 'home',
});

describe('useTagManager', () => {
  it('renames across every list, the Frames, both filters and the follow-up tag, and says so', () => {
    const api = mount(initial());
    act(() => { api.applyTagEdit('home', 'household'); });
    expect(api.tasks.map(x => x.title)).toEqual(['Fix gutter #household', 'Dentist #home']);
    expect(api.unscheduledTasks.map(x => x.title)).toEqual(['Paint fence #household #house', 'Pay rent #home']);
    expect(api.recurringTasks[0].title).toBe('Water plants #household');
    expect(api.gtdFrames[0].tagAffinity).toEqual(['household', 'errands']);
    expect(api.gtdFrames[0].lastModified).not.toBe('2026-01-01T00:00:00.000Z');
    expect(api.gtdFrames[1].lastModified).toBe('2026-01-01T00:00:00.000Z');
    expect(api.selectedTags).toEqual(['household', 'errands']);
    expect(api.inboxTagFilter).toEqual(['household']);
    expect(api.followUpTag).toBe('household');
    expect(api.toast).toMatchObject({ actionable: true });
    expect(api.toast.message).toContain('undo.action.tagRenamed');
  });

  it('merges into a tag already in use, keeping one of the two on a title that had both', () => {
    const api = mount(initial());
    act(() => { api.applyTagEdit('home', 'house'); });
    expect(api.unscheduledTasks[0].title).toBe('Paint fence #house');
    expect(api.toast.message).toContain('undo.action.tagMerged');
  });

  it('removes a tag everywhere it may, and one undo puts every title and Frame back', () => {
    const before = initial();
    const api = mount(before);
    act(() => { api.applyTagEdit('home', null); });
    expect(api.tasks[0].title).toBe('Fix gutter');
    expect(api.gtdFrames[0].tagAffinity).toEqual(['errands']);
    expect(api.selectedTags).toEqual(['errands']);
    expect(api.followUpTag).toBe('');
    act(() => { api.performUndo(); });
    expect(api.tasks.map(x => x.title)).toEqual(before.tasks.map(x => x.title));
    expect(api.unscheduledTasks.map(x => x.title)).toEqual(before.unscheduledTasks.map(x => x.title));
    expect(api.recurringTasks[0].title).toBe('Water plants #home');
    expect(api.gtdFrames[0].tagAffinity).toEqual(['home', 'errands']);
  });

  it('does nothing for a rename to the same tag', () => {
    const api = mount(initial());
    const tasks = api.tasks;
    act(() => { api.applyTagEdit('home', 'HOME'); });
    expect(api.tasks).toBe(tasks);
    expect(api.toast).toBeNull();
  });
});
