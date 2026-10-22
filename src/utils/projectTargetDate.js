// Project-level target date (2026-10-21). A project carries its own due date,
// independent of its tasks' deadlines: the tasks keep theirs, and nothing here
// propagates one onto the other. The wording follows goals, whose date is a
// `targetDate`; "deadline" means the inbox task field (#2116).
//
// The value is a LOCAL CALENDAR DATE string (`YYYY-MM-DD`), the shape
// task.deadline and goal.targetDate already use; it is stored on the project
// record itself, so it rides the record through both sync tiers like colour or
// status. Unset means the key is absent (or empty), never a sentinel date.
//
// The day math lives here so the card badge, the planner header, the GLANCE
// "due today" card and any future "due this week" surface read one number.
// Pure: callers pass the device's today string, as the rest of the app does
// (getTodayStr in the contexts).

/**
 * Within how many days a target date reads as "due soon" (amber rather than
 * neutral). Exported so a test pins the boundary and callers can tooltip it.
 */
export const PROJECT_TARGET_DATE_SOON_DAYS = 7;

/**
 * Derived target-date state for a project, or null when it has none (or the
 * record/today string is unusable).
 *
 * @param {{ targetDate?: string|null, status?: string }|null|undefined} project
 * @param {string} todayStr local YYYY-MM-DD
 * @returns {{ days: number, overdue: boolean, dueToday: boolean, soon: boolean } | null}
 *   `days` is positive in the future, 0 today, negative in the past. A
 *   completed project still reports its target date; hiding or dimming it is
 *   the surface's decision, not this helper's.
 */
export function projectTargetDateInfo(project, todayStr) {
  const targetDate = project?.targetDate;
  if (!targetDate || !todayStr) return null;
  const due = Date.parse(`${targetDate}T00:00:00`);
  const today = Date.parse(`${todayStr}T00:00:00`);
  if (Number.isNaN(due) || Number.isNaN(today)) return null;
  const days = Math.round((due - today) / 86400000);
  return {
    days,
    overdue: days < 0,
    dueToday: days === 0,
    soon: days > 0 && days <= PROJECT_TARGET_DATE_SOON_DAYS,
  };
}
