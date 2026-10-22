import { describe, it, expect } from 'vitest';
import { dueThisWeek } from './dueThisWeek.js';

const TODAY = '2026-10-19';
const END = '2026-10-25';
const t = (id, projectId, completed) => ({ id, projectId, completed });

describe('dueThisWeek', () => {
  const goals = [
    { id: 'g1', title: 'Beta', status: 'active', targetDate: '2026-10-24' },
    { id: 'g2', title: 'Later goal', status: 'active', targetDate: '2026-11-30' },
  ];
  const projects = [
    { id: 'gp', title: 'Goal child', status: 'active', goalId: 'g1' },
    { id: 'p1', title: 'Roof', status: 'active', targetDate: '2026-10-20' },
    { id: 'p2', title: 'Empty', status: 'active', targetDate: TODAY },
    { id: 'p3', title: 'Done', status: 'completed', targetDate: '2026-10-21' },
    { id: 'p4', title: 'Theirs', status: 'active', targetDate: '2026-10-21', owner: 'other' },
    { id: 'p5', title: 'Overdue', status: 'active', targetDate: '2026-10-10' },
  ];
  const tasks = [t('a', 'p1', true), t('b', 'p1', false), t('c', 'gp', true)];
  const list = dueThisWeek({ goals, projects, tasks, todayStr: TODAY, endStr: END, isMine: (e) => e.owner !== 'other' });

  it('lists goals and projects due in the window, soonest first', () => {
    expect(list.map((x) => [x.kind, x.id, x.daysLeft])).toEqual([
      ['project', 'p2', 0], ['project', 'p1', 1], ['goal', 'g1', 5],
    ]);
  });

  it('leaves out what is outside the window, finished, or someone else\'s', () => {
    expect(list.map((x) => x.id)).not.toEqual(expect.arrayContaining(['g2', 'p3', 'p4', 'p5']));
  });

  it('carries progress and done/total, and null progress for a project with nothing to measure', () => {
    const roof = list.find((x) => x.id === 'p1');
    expect(roof).toMatchObject({ progressPct: 50, totalTasks: 2, completedTasks: 1 });
    expect(list.find((x) => x.id === 'p2').progressPct).toBeNull();
    expect(list.find((x) => x.id === 'g1')).toMatchObject({ totalTasks: 1, completedTasks: 1 });
  });
});
