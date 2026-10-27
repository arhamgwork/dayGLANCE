import { describe, it, expect } from 'vitest';
import { buildSpotlightResults, searchDailyNotes, dailyNoteTitle, SPOTLIGHT_MAX_RESULTS } from './spotlightSearch.js';

// Fixed clock so grouping (today / this week / past / future) is deterministic.
const NOW = new Date(2026, 8, 16, 12, 0, 0); // 2026-09-16
const task = (over = {}) => ({ id: 'id', title: 'Untitled', ...over });

describe('buildSpotlightResults', () => {
  it('returns nothing for an empty or whitespace query', () => {
    expect(buildSpotlightResults({ query: '', tasks: [task({ title: 'x' })], now: NOW })).toEqual([]);
    expect(buildSpotlightResults({ query: '   ', tasks: [task({ title: 'x' })], now: NOW })).toEqual([]);
  });

  it('matches title, then tag, then task notes, then subtasks, in that order', () => {
    const tasks = [
      task({ id: 't', title: 'Plan the launch', date: '2026-09-16' }),
      task({ id: 'g', title: 'Errands #launch', date: '2026-09-16' }),
      task({ id: 'n', title: 'Sync', notes: 'discuss launch timing', date: '2026-09-16' }),
      task({ id: 's', title: 'Prep', subtasks: [{ title: 'launch checklist' }], date: '2026-09-16' }),
    ];
    const out = buildSpotlightResults({ query: 'launch', tasks, now: NOW });
    const byId = Object.fromEntries(out.map(r => [r.task.id, r.match.field]));
    expect(byId).toEqual({ t: 'title', g: 'title', n: 'notes', s: 'subtask' });
  });

  it('labels each source and skips native-merged scheduled tasks', () => {
    const out = buildSpotlightResults({
      query: 'q',
      tasks: [task({ id: 'sched', title: 'q', date: '2026-09-16' }), task({ id: 'nat', title: 'q', date: '2026-09-16', _native: true })],
      nativeTasks: [task({ id: 'ev', title: 'q', date: '2026-09-17' })],
      unscheduledTasks: [task({ id: 'in', title: 'q' }), task({ id: 'ar', title: 'q', archived: true })],
      recurringTasks: [task({ id: 'rec', title: 'q' })],
      recycleBin: [task({ id: 'del', title: 'q' })],
      now: NOW,
    });
    expect(out.map(r => [r.task.id, r.source, r.sourceLabel])).toEqual(expect.arrayContaining([
      ['sched', 'scheduled', 'Scheduled'],
      ['ev', 'event', 'Calendar'],
      ['in', 'inbox', 'Inbox'],
      ['ar', 'archived', 'Completed'],
      ['rec', 'recurring', 'Recurring'],
      ['del', 'deleted', 'Deleted'],
    ]));
    expect(out.find(r => r.task.id === 'nat')).toBeUndefined();
  });

  it('drops scheduled tasks older than two years and other users\' tasks', () => {
    const out = buildSpotlightResults({
      query: 'old',
      tasks: [task({ id: 'ancient', title: 'old', date: '2024-09-15' }), task({ id: 'recent', title: 'old', date: '2024-09-17' })],
      unscheduledTasks: [task({ id: 'theirs', title: 'old', assignedTo: 'other' })],
      isVisibleForUser: t => t.assignedTo !== 'other',
      now: NOW,
    });
    expect(out.map(r => r.task.id)).toEqual(['recent']);
  });

  it('groups by date and orders groups today → this week → future → no date → past → deleted → archived', () => {
    const out = buildSpotlightResults({
      query: 'x',
      tasks: [
        task({ id: 'past', title: 'x', date: '2026-09-01' }),
        task({ id: 'future', title: 'x', date: '2026-12-01' }),
        task({ id: 'week', title: 'x', date: '2026-09-20' }),
        task({ id: 'today', title: 'x', date: '2026-09-16' }),
      ],
      unscheduledTasks: [task({ id: 'nodate', title: 'x' }), task({ id: 'arch', title: 'x', archived: true })],
      recycleBin: [task({ id: 'del', title: 'x' })],
      now: NOW,
    });
    expect(out.map(r => r.group)).toEqual(['today', 'thisweek', 'future', 'nodate', 'past', 'deleted', 'archived']);
  });

  it('caps the list', () => {
    const tasks = Array.from({ length: SPOTLIGHT_MAX_RESULTS + 10 }, (_, i) => task({ id: `t${i}`, title: 'many', date: '2026-09-16' }));
    expect(buildSpotlightResults({ query: 'many', tasks, now: NOW })).toHaveLength(SPOTLIGHT_MAX_RESULTS);
  });

  describe('daily notes', () => {
    const dailyNotes = {
      '2026-09-10': { text: '## Quick Notes\n- Called the dentist about the crown\n## Thoughts\n', lastModified: 't' },
      '2026-09-16': { text: 'Crown fitting went fine', lastModified: 't' },
      '2026-09-12': { text: 'crown', lastModified: 't', deleted: true },
      '2026-09-13': { text: '', lastModified: 't' },
    };

    it('finds text in the body of a daily note and carries the matching line', () => {
      const out = buildSpotlightResults({ query: 'crown', dailyNotes, now: NOW });
      expect(out.map(r => [r.date, r.source, r.match.field])).toEqual([
        ['2026-09-16', 'dailynote', 'dailynote'],
        ['2026-09-10', 'dailynote', 'dailynote'],
      ]);
      const older = out.find(r => r.date === '2026-09-10');
      expect(older.match.text).toBe('Called the dentist about the crown');
      expect(older.task.title).toBe('Called the dentist about the crown');
      expect(older.task.id).toBe('dailynote-2026-09-10');
      expect(older.group).toBe('past');
    });

    it('never matches a deleted tombstone or an empty note', () => {
      expect(searchDailyNotes({ '2026-09-12': { text: 'crown', deleted: true } }, 'crown')).toEqual([]);
      expect(searchDailyNotes({ '2026-09-13': { text: '' } }, '')).toEqual([]);
      expect(searchDailyNotes({ '2026-09-13': { text: '' } }, 'crown')).toEqual([]);
    });

    it('is case-insensitive', () => {
      expect(searchDailyNotes({ '2026-09-16': { text: 'Crown fitting' } }, 'crown')).toHaveLength(1);
    });

    it('does not apply the scheduled-task lookback window to notes', () => {
      const out = buildSpotlightResults({ query: 'archive', dailyNotes: { '2019-01-01': { text: 'archive this' } }, now: NOW });
      expect(out.map(r => r.date)).toEqual(['2019-01-01']);
    });

    it('is skipped entirely when the caller passes no notes (Obsidian-enabled vaults)', () => {
      expect(buildSpotlightResults({ query: 'crown', dailyNotes: null, now: NOW })).toEqual([]);
      expect(buildSpotlightResults({ query: 'crown', now: NOW })).toEqual([]);
    });

    it('ranks a note below a task hit in the same group', () => {
      const out = buildSpotlightResults({
        query: 'crown',
        tasks: [task({ id: 't', title: 'Crown fitting', date: '2026-09-16' })],
        unscheduledTasks: [task({ id: 'n', title: 'Dentist', notes: 'crown', deadline: '2026-09-16' })],
        dailyNotes: { '2026-09-16': { text: 'crown' } },
        now: NOW,
      });
      expect(out.map(r => r.task.id)).toEqual(['t', 'n', 'dailynote-2026-09-16']);
    });
  });
});

describe('dailyNoteTitle', () => {
  it('prefers the first body line over a template heading', () => {
    expect(dailyNoteTitle('## Quick Notes\n- [ ] buy milk\n## Thoughts', '2026-09-16')).toBe('buy milk');
  });
  it('falls back to the first heading, then the date', () => {
    expect(dailyNoteTitle('## Only a heading', '2026-09-16')).toBe('Only a heading');
    expect(dailyNoteTitle('  \n\n', '2026-09-16')).toBe('2026-09-16');
    expect(dailyNoteTitle(undefined, '2026-09-16')).toBe('2026-09-16');
  });
  it('strips quote and numbered-list markers and truncates long lines', () => {
    expect(dailyNoteTitle('> quoted', 'd')).toBe('quoted');
    expect(dailyNoteTitle('1. first', 'd')).toBe('first');
    const long = 'a'.repeat(120);
    expect(dailyNoteTitle(long, 'd')).toHaveLength(80);
    expect(dailyNoteTitle(long, 'd').endsWith('…')).toBe(true);
  });
});

// #2131: goals, projects and areas, by title, in their own group first.
describe('goals, projects and areas', () => {
  const goals = [
    { id: 'g1', title: 'Ship the launcher', status: 'active', color: 'bg-red-500' },
    { id: 'g2', title: 'Old launcher plans', status: 'archived', color: 'bg-red-500' },
    { id: 'g3', title: 'Launcher for the family', status: 'active', assignedTo: 'other' },
  ];
  const projects = [
    { id: 'p1', title: 'Launcher widgets', goalId: 'g1', status: 'active' },
    { id: 'p2', title: 'GLANCElauncher', status: 'active', color: 'bg-amber-500' },
    { id: 'p3', title: 'Launcher icons', goalId: 'g2', status: 'active' },
    { id: 'p4', title: 'Launcher done', status: 'completed' },
    { id: 'p5', title: 'Launcher shelved', status: 'archived' },
    { id: 'p6', title: 'Launcher orphan', goalId: 'gone', status: 'active' },
  ];
  const areas = [{ id: 'a1', title: 'Launcher work', color: 'bg-teal-500' }];
  const isVisibleForUser = (item) => item.assignedTo !== 'other';
  const run = (over = {}) => buildSpotlightResults({ query: 'launcher', goals, projects, areas, isVisibleForUser, now: NOW, ...over });

  it('finds the ones the space draws, by title, and nothing it does not', () => {
    const out = run();
    expect(out.map(r => [r.task.id, r.source])).toEqual([
      ['g1', 'goal'], ['p1', 'project'], ['p2', 'project'], ['p4', 'project'], ['a1', 'area'],
    ]);
    // A project takes its goal's colour when it has none of its own.
    expect(out.find(r => r.task.id === 'p1').task.color).toBe('bg-red-500');
    expect(out.find(r => r.task.id === 'p2').task.color).toBe('bg-amber-500');
  });

  it('come first, in their own group, ahead of tasks dated today', () => {
    const out = run({ tasks: [task({ id: 't', title: 'Launcher bug', date: '2026-09-16' })] });
    expect(out.map(r => r.group)).toEqual(['goals', 'goals', 'goals', 'goals', 'goals', 'today']);
  });

  it('match a goal or project on its notes when the title misses, title first', () => {
    const out = buildSpotlightResults({
      query: 'tempo',
      goals: [{ id: 'g', title: 'Run a half marathon', status: 'active', description: 'Two tempo runs a week' }],
      projects: [{ id: 'p', title: 'Tempo blocks', status: 'active' }],
      now: NOW,
    });
    expect(out.map(r => [r.task.id, r.match.field])).toEqual([['p', 'title'], ['g', 'notes']]);
    expect(out[1].match.text).toBe('Two tempo runs a week');
  });

  it('are left out when the caller passes none (Goals & Projects off)', () => {
    expect(buildSpotlightResults({ query: 'launcher', now: NOW })).toEqual([]);
  });
});


// #2235: several words, wildcards, phrases and exclusions (utils/searchQuery.js).
describe('the query language', () => {
  const tasks = [
    task({ id: 'quote', title: 'Roofing quote', date: '2026-09-16' }),
    task({ id: 'call', title: 'Call the roofer', notes: 'ask for a quote', date: '2026-09-16' }),
    task({ id: 'sub', title: 'House', subtasks: [{ title: 'roof check' }, { title: 'get a quote' }], date: '2026-09-16' }),
    task({ id: 'other', title: 'Quote for the fence', date: '2026-09-16' }),
  ];
  const ids = (query, extra = {}) => buildSpotlightResults({ query, tasks, now: NOW, ...extra }).map(r => r.task.id).sort();

  it('several words find tasks holding all of them, across title, notes and subtasks', () => {
    expect(ids('roof quote')).toEqual(['call', 'quote', 'sub']);
  });

  it('shows the title when it holds every word, else the field holding the rest', () => {
    const both = buildSpotlightResults({ query: 'roof quote', tasks, now: NOW });
    expect(both.find(r => r.task.id === 'quote').match).toEqual({ field: 'title', text: 'Roofing quote' });
    // "roof" is in the title, "quote" only in the notes: the notes say why it matched.
    expect(both.find(r => r.task.id === 'call').match).toEqual({ field: 'notes', text: 'ask for a quote' });
    const out = buildSpotlightResults({ query: 'quote ask', tasks, now: NOW });
    expect(out.find(r => r.task.id === 'call').match).toEqual({ field: 'notes', text: 'ask for a quote' });
    expect(out.find(r => r.task.id === 'sub')).toBeUndefined();
    const sub = buildSpotlightResults({ query: 'roof quote', tasks, now: NOW }).find(r => r.task.id === 'sub');
    expect(sub.match).toEqual({ field: 'subtask', text: 'roof check' });
  });

  it('a phrase, a wildcard and an exclusion', () => {
    expect(ids('"the roofer"')).toEqual(['call']);
    expect(ids('roof*quote')).toEqual(['quote']);
    expect(ids('quote -roof')).toEqual(['other']);
  });

  it('a query of exclusions alone finds nothing', () => {
    expect(ids('-fence')).toEqual([]);
  });

  it('daily notes: every word in the note, shown by the line holding the most of them', () => {
    const notes = { '2026-09-15': { text: '# Log\nroof leak in the attic\ncalled the roofer about the leak' } };
    const out = buildSpotlightResults({ query: 'roofer leak', dailyNotes: notes, now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0].match.text).toBe('called the roofer about the leak');
    expect(buildSpotlightResults({ query: 'roofer plumber', dailyNotes: notes, now: NOW })).toEqual([]);
  });

  it('goals and projects: every word across the title and the notes', () => {
    const projects = [{ id: 'p', title: 'Roof', description: 'replace the tiles', status: 'active' }];
    expect(buildSpotlightResults({ query: 'roof tiles', projects, now: NOW }).map(r => r.task.id)).toEqual(['p']);
    expect(buildSpotlightResults({ query: 'roof -tiles', projects, now: NOW })).toEqual([]);
  });
});

// A note is searched as it reads: a task link is its label. Its address,
// dayglance://task?id=…, is the same in every link, so "task" used to find
// every note holding one.
describe('notes holding links to other tasks', () => {
  const link = '[Roofing quote](dayglance://task?id=task-a)';
  const tasks = [task({ id: 'call', title: 'Call the roofer', notes: `Ask about ${link}`, date: '2026-09-16' })];

  it('the link\'s address is not searched', () => {
    for (const query of ['task', 'dayglance', 'id=']) {
      expect(buildSpotlightResults({ query, tasks, now: NOW })).toEqual([]);
    }
  });

  it('its label is, and the row shows the note as it reads', () => {
    const [hit] = buildSpotlightResults({ query: 'quote', tasks, now: NOW });
    expect(hit.match).toEqual({ field: 'notes', text: 'Ask about Roofing quote' });
  });

  it('the same in daily notes and in a project\'s notes', () => {
    const dailyNotes = { '2026-09-15': { text: `Called them.\nFollow up on ${link}` } };
    expect(buildSpotlightResults({ query: 'task', dailyNotes, now: NOW })).toEqual([]);
    expect(buildSpotlightResults({ query: 'quote', dailyNotes, now: NOW })[0].match.text).toBe('Follow up on Roofing quote');
    const projects = [{ id: 'p', title: 'Roof', description: `Blocked on ${link}`, status: 'active' }];
    expect(buildSpotlightResults({ query: 'task', projects, now: NOW })).toEqual([]);
    expect(buildSpotlightResults({ query: 'roof quote', projects, now: NOW })[0].match).toEqual({ field: 'notes', text: 'Blocked on Roofing quote' });
  });
});
