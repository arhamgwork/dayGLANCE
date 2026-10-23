// The weekly review's "Due this week" list: goals, and projects with their own
// target date (#2160), whose target falls between today and the end of the
// coming week, soonest first. Lifted out of WeeklyReviewModal so it can be
// tested; the goal rows are computed exactly as they were there.

import { calculateGoalProgress } from './goalProgress.js';
import { calculateProjectProgress } from './projectProgress.js';
import { projectTargetDateInfo } from './projectTargetDate.js';

/**
 * @param {object} args
 * @param {object[]} args.goals
 * @param {object[]} args.projects
 * @param {object[]} args.tasks     every task (scheduled and unscheduled)
 * @param {string} args.todayStr    local YYYY-MM-DD
 * @param {string} args.endStr      last day of the window, inclusive
 * @param {(entity: object) => boolean} args.isMine  the user's own (multi-user)
 * @returns {{ id, kind: 'goal'|'project', title, progressPct: number|null, daysLeft, totalTasks, completedTasks }[]}
 *   `progressPct` is null for a project with nothing to measure: no bar is
 *   drawn for it, rather than a 0% that reads as "no progress".
 */
export function dueThisWeek({ goals = [], projects = [], tasks = [], todayStr, endStr, isMine = () => true }) {
  const inWindow = (date) => !!date && date >= todayStr && date <= endStr;
  const dueGoals = goals
    .filter(g => g.status === 'active' && isMine(g) && inWindow(g.targetDate))
    .map(g => {
      const progress = calculateGoalProgress(g.id, projects, tasks);
      const target = new Date(g.targetDate + 'T00:00:00');
      const todayMidnight = new Date(todayStr + 'T00:00:00');
      const daysLeft = Math.ceil((target - todayMidnight) / (1000 * 60 * 60 * 24));
      const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
      const totalTasks = tasks.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived).length;
      const completedTasks = tasks.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived && t.completed).length;
      return { id: g.id, kind: 'goal', title: g.title, progressPct: Math.round(progress * 100), daysLeft, totalTasks, completedTasks };
    });
  const dueProjects = projects
    .filter(p => p.status === 'active' && isMine(p) && inWindow(p.targetDate))
    .map(p => {
      const progress = calculateProjectProgress(p.id, tasks);
      const pTasks = tasks.filter(t => t.projectId === p.id && !t.archived);
      return {
        id: p.id, kind: 'project', title: p.title,
        progressPct: progress === null ? null : Math.round(progress * 100),
        daysLeft: projectTargetDateInfo(p, todayStr).days,
        totalTasks: pTasks.length,
        completedTasks: pTasks.filter(t => t.completed).length,
      };
    });
  return [...dueGoals, ...dueProjects].sort((a, b) => a.daysLeft - b.daysLeft);
}
