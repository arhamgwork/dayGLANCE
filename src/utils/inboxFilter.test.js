import { describe, it, expect, vi } from 'vitest';
import {
  readInboxFilterPrefs, filterInboxTasks, inboxCountOf, inboxFromStorage,
  liveInboxProjectFilter, liveInboxTagFilter,
} from './inboxFilter.js';

// The one Inbox filter (utils/inboxFilter.js). The last block holds the
// launcher's count to the app's own Inbox: the stored-state chain the headless
// refresh runs must give exactly the list useComputedViews gives the app.

vi.mock('react', () => ({ useMemo: (fn) => fn(), useCallback: (fn) => fn }));
const { default: useComputedViews } = await import('../hooks/useComputedViews.js');

function memStorage(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const task = (id, extra = {}) => ({ id, title: id, notes: '', subtasks: [], completed: false, ...extra });
const ids = (list) => list.map((t) => t.id);

describe('readInboxFilterPrefs', () => {
  it('defaults: no priority floor, completed shown, project tasks hidden, no tag or project filter', () => {
    expect(readInboxFilterPrefs(memStorage())).toEqual({
      inboxPriorityFilter: 0, hideCompletedInbox: false, hideProjectTasksInbox: true,
      hideStandaloneTasksInbox: false, inboxTagFilter: [], inboxProjectFilter: [],
    });
  });

  it('reads what useLocalStoragePersist writes', () => {
    expect(readInboxFilterPrefs(memStorage({
      inboxPriorityFilter: '2', hideCompletedInbox: 'true', hideProjectTasksInbox: 'false',
      hideStandaloneTasksInbox: 'true', inboxTagFilter: '["work"]', inboxProjectFilter: '["p1"]',
    }))).toEqual({
      inboxPriorityFilter: 2, hideCompletedInbox: true, hideProjectTasksInbox: false,
      hideStandaloneTasksInbox: true, inboxTagFilter: ['work'], inboxProjectFilter: ['p1'],
    });
  });

  it('a malformed value falls back to its default rather than throwing', () => {
    const prefs = readInboxFilterPrefs(memStorage({ inboxPriorityFilter: '{', inboxTagFilter: 'not json' }));
    expect(prefs.inboxPriorityFilter).toBe(0);
    expect(prefs.inboxTagFilter).toEqual([]);
  });
});

describe('filterInboxTasks', () => {
  it('drops bucket, archived and other users\' tasks, and project tasks by default', () => {
    const list = [
      task('mine'), task('bucket', { bucketId: 'b1' }), task('archived', { archived: true }),
      task('theirs', { assignedTo: 'them' }), task('project', { projectId: 'p1' }),
    ];
    const out = filterInboxTasks(list, { goalsProjectsEnabled: true, isVisibleForUser: (t) => t.assignedTo !== 'them' });
    expect(ids(out)).toEqual(['mine']);
  });

  it('applies the priority floor, the completed toggle, the tag filter, and sorts open tasks first', () => {
    const list = [
      task('done', { completed: true, priority: 3 }), task('low #work', { priority: 1 }),
      task('high #work', { priority: 3 }), task('home', { priority: 3 }),
    ];
    expect(ids(filterInboxTasks(list, { inboxPriorityFilter: 2 }))).toEqual(['high #work', 'home', 'done']);
    expect(ids(filterInboxTasks(list, { inboxPriorityFilter: 2, hideCompletedInbox: true }))).toEqual(['high #work', 'home']);
    expect(ids(filterInboxTasks(list, { liveTagFilter: ['work'] }))).toEqual(['high #work', 'low #work']);
  });

  it('a completed task with a deadline never counts', () => {
    expect(filterInboxTasks([task('d', { completed: true, deadline: '2026-10-30' })])).toEqual([]);
  });
});

describe('the live filters ignore stale selections', () => {
  it('a deleted project or a vanished tag is dropped; nothing stale keeps the same array', () => {
    const saved = ['p1', 'gone'];
    expect(liveInboxProjectFilter(saved, [{ id: 'p1' }])).toEqual(['p1']);
    const intact = ['p1'];
    expect(liveInboxProjectFilter(intact, [{ id: 'p1' }])).toBe(intact);
    expect(liveInboxTagFilter(['gone'], ['work'])).toEqual([]);
  });
});

describe('inboxCountOf', () => {
  it('counts the filtered Inbox without example tasks', () => {
    expect(inboxCountOf([task('a'), task('b', { isExample: true }), task('c', { completed: true })])).toBe(2);
  });
});

describe("the launcher's count is the app's Inbox", () => {
  const unscheduledTasks = [
    task('open #work', { priority: 2 }), task('open #home', { priority: 0 }),
    task('done', { completed: true }), task('done with deadline', { completed: true, deadline: '2026-10-01' }),
    task('project #work', { projectId: 'p1', priority: 3 }), task('bucket', { bucketId: 'b1' }),
    task('archived', { archived: true }), task('theirs', { assignedTo: 'them' }), task('example', { isExample: true }),
  ];
  const tasks = [task('scheduled #errand', { date: '2026-10-23' })];
  const projects = [{ id: 'p1' }];
  const isVisibleForUser = (t) => t.assignedTo !== 'them';

  const cases = {
    defaults: {},
    'priority 2 and completed hidden': { inboxPriorityFilter: '2', hideCompletedInbox: 'true' },
    'project tasks shown': { hideProjectTasksInbox: 'false' },
    'one project selected': { inboxProjectFilter: '["p1"]' },
    'a tag selected, plus a stale one': { inboxTagFilter: '["work","gone"]' },
    'standalone hidden': { hideStandaloneTasksInbox: 'true', hideProjectTasksInbox: 'false' },
    // Only stale selections: no filter at all, not an empty Inbox (#2137 review).
    'only a stale tag': { inboxTagFilter: '["gone"]' },
    'only a deleted project': { inboxProjectFilter: '["deleted"]' },
  };

  for (const [name, stored] of Object.entries(cases)) {
    it(name, () => {
      const storage = memStorage(stored);
      const prefs = readInboxFilterPrefs(storage);
      const app = useComputedViews({
        tasks, unscheduledTasks, recurringTasks: [], selectedDate: new Date('2026-10-23T12:00:00'), selectedTags: [],
        ...prefs, projects, goalsProjectsEnabled: true, isVisibleForUser,
      }).filteredUnscheduledTasks;
      const headless = inboxFromStorage({ tasks, unscheduledTasks, recurringTasks: [], projects, goalsProjectsEnabled: true, isVisibleForUser, storage });
      expect(ids(headless)).toEqual(ids(app));
      if (name.startsWith('a tag')) expect(ids(headless)).toEqual(['open #work']);
      if (name.startsWith('only')) expect(inboxCountOf(headless)).toBe(3);
      expect(inboxCountOf(headless)).toBe(app.filter((t) => !t.isExample).length);
    });
  }

  it('with defaults, the count leaves out everything the Inbox hides', () => {
    const headless = inboxFromStorage({ tasks, unscheduledTasks, recurringTasks: [], projects, goalsProjectsEnabled: true, isVisibleForUser, storage: memStorage() });
    // open #work, open #home and done: not the project, bucket, archived, other user's, example or completed-with-deadline tasks.
    expect(inboxCountOf(headless)).toBe(3);
  });
});
