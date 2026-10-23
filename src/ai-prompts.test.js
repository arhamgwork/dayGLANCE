import { describe, it, expect } from 'vitest';
import { weeklySummaryUserPrompt } from './ai-prompts.js';

// The weekly summary is told about a project's own target date (#2160) in the
// same words as a goal's.
describe('weeklySummaryUserPrompt project target dates', () => {
  const base = {
    dateRange: '2026-10-12 to 2026-10-18', tasksCompleted: 5, tasksScheduled: 8, completionRate: 62,
    timeSpent: 300, timePlanned: 420, focusMinutes: 0,
  };

  it('names each project\'s target, overdue, today and ahead', () => {
    const prompt = weeklySummaryUserPrompt({
      ...base,
      projectStats: [
        { id: 'a', title: 'Roof', weekCompleted: 0, weekTotal: 0, overallProgressPct: null, stalled: false, daysToTarget: -2 },
        { id: 'b', title: 'Garden', weekCompleted: 1, weekTotal: 2, overallProgressPct: 50, stalled: false, daysToTarget: 0 },
        { id: 'c', title: 'Taxes', weekCompleted: 0, weekTotal: 0, overallProgressPct: null, stalled: true, daysToTarget: 5 },
      ],
    });
    expect(prompt).toContain('Project target dates: "Roof" (2 days overdue); "Garden" (target date: today); "Taxes" (5 days to target).');
  });

  it('says nothing about targets when no project has one', () => {
    const prompt = weeklySummaryUserPrompt({
      ...base,
      projectStats: [{ id: 'a', title: 'Roof', weekCompleted: 1, weekTotal: 1, overallProgressPct: 100, stalled: false, daysToTarget: null }],
    });
    expect(prompt).not.toContain('Project target dates');
  });
});
