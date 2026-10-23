import { describe, it, expect } from 'vitest';
import { projectTargetDateInfo, PROJECT_TARGET_DATE_SOON_DAYS } from './projectTargetDate.js';

// The project target date's day math: one helper feeds the card badge, the
// planner header and the GLANCE "due today" card, so its boundaries (today,
// the soon window, overdue) are pinned here rather than in each component's
// render test.

const TODAY = '2026-10-21';

describe('projectTargetDateInfo', () => {
  it('is null without a target date, a project, or a usable today string', () => {
    expect(projectTargetDateInfo({ id: 'p1' }, TODAY)).toBeNull();
    expect(projectTargetDateInfo({ targetDate: null }, TODAY)).toBeNull();
    expect(projectTargetDateInfo(null, TODAY)).toBeNull();
    expect(projectTargetDateInfo({ targetDate: TODAY }, '')).toBeNull();
    expect(projectTargetDateInfo({ targetDate: TODAY }, 'not-a-date')).toBeNull();
    expect(projectTargetDateInfo({ targetDate: 'nonsense' }, TODAY)).toBeNull();
  });

  it('counts whole days ahead, today, and days overdue', () => {
    expect(projectTargetDateInfo({ targetDate: '2026-10-31' }, TODAY)).toEqual({ days: 10, overdue: false, dueToday: false, soon: false });
    expect(projectTargetDateInfo({ targetDate: TODAY }, TODAY)).toEqual({ days: 0, overdue: false, dueToday: true, soon: false });
    expect(projectTargetDateInfo({ targetDate: '2026-10-20' }, TODAY)).toEqual({ days: -1, overdue: true, dueToday: false, soon: false });
  });

  it('soon starts the day after today and ends at the window boundary', () => {
    expect(projectTargetDateInfo({ targetDate: '2026-10-22' }, TODAY)).toMatchObject({ days: 1, soon: true });
    expect(projectTargetDateInfo({ targetDate: '2026-10-28' }, TODAY)).toMatchObject({ days: PROJECT_TARGET_DATE_SOON_DAYS, soon: true });
    expect(projectTargetDateInfo({ targetDate: '2026-10-29' }, TODAY)).toMatchObject({ soon: false });
  });

  it('still reports a completed project\'s target date: hiding it is the surface\'s call', () => {
    expect(projectTargetDateInfo({ targetDate: '2026-10-20', status: 'completed' }, TODAY)).toMatchObject({ days: -1, overdue: true });
  });
});
