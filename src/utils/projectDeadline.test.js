import { describe, it, expect } from 'vitest';
import { projectDeadlineInfo, PROJECT_DEADLINE_SOON_DAYS } from './projectDeadline.js';

// The project deadline's day math: one helper feeds the card badge and the
// planner header, so its boundaries (today, the soon window, overdue) are
// pinned here rather than in each component's render test.

const TODAY = '2026-10-21';

describe('projectDeadlineInfo', () => {
  it('is null without a deadline, a project, or a usable today string', () => {
    expect(projectDeadlineInfo({ id: 'p1' }, TODAY)).toBeNull();
    expect(projectDeadlineInfo({ deadline: null }, TODAY)).toBeNull();
    expect(projectDeadlineInfo(null, TODAY)).toBeNull();
    expect(projectDeadlineInfo({ deadline: TODAY }, '')).toBeNull();
    expect(projectDeadlineInfo({ deadline: TODAY }, 'not-a-date')).toBeNull();
    expect(projectDeadlineInfo({ deadline: 'nonsense' }, TODAY)).toBeNull();
  });

  it('counts whole days ahead, today, and days overdue', () => {
    expect(projectDeadlineInfo({ deadline: '2026-10-31' }, TODAY)).toEqual({ days: 10, overdue: false, dueToday: false, soon: false });
    expect(projectDeadlineInfo({ deadline: TODAY }, TODAY)).toEqual({ days: 0, overdue: false, dueToday: true, soon: false });
    expect(projectDeadlineInfo({ deadline: '2026-10-20' }, TODAY)).toEqual({ days: -1, overdue: true, dueToday: false, soon: false });
  });

  it('soon starts the day after today and ends at the window boundary', () => {
    expect(projectDeadlineInfo({ deadline: '2026-10-22' }, TODAY)).toMatchObject({ days: 1, soon: true });
    expect(projectDeadlineInfo({ deadline: '2026-10-28' }, TODAY)).toMatchObject({ days: PROJECT_DEADLINE_SOON_DAYS, soon: true });
    expect(projectDeadlineInfo({ deadline: '2026-10-29' }, TODAY)).toMatchObject({ soon: false });
  });

  it('still reports a completed project\'s deadline: hiding it is the surface\'s call', () => {
    expect(projectDeadlineInfo({ deadline: '2026-10-20', status: 'completed' }, TODAY)).toMatchObject({ days: -1, overdue: true });
  });
});
