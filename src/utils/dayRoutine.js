// The fixed daily routine the voice day planner schedules around: wake, sleep
// and meals. Device-local settings (localStorage), not synced: the routine is
// how this person lives on this device, like the reminder settings.
//
// Change listeners go through a window event so the Settings form and the
// voice pipeline (which reads at call time) never hold stale copies.

export const DAY_ROUTINE_KEY = 'dg-day-routine';
const CHANGE_EVENT = 'dg-day-routine-change';

export const DEFAULT_DAY_ROUTINE = {
  // Voice dump → planned day. Off means the voice modal behaves as upstream.
  autoPlan: true,
  wake: '06:00',
  sleep: '21:00',
  firstMeal: '06:30',
  mealCount: 4,
  mealGapHours: 4,
  mealMinutes: 30,
  mealNames: ['Breakfast', 'Lunch', 'Second lunch', 'Dinner'],
  // Gap left between planned tasks so the day isn't wall-to-wall.
  bufferMinutes: 5,
  // Android: read the task title aloud when its alarm fires.
  speakAlarms: true,
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const timeToMin = (t) => {
  const m = TIME_RE.exec(t || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export const minToTime = (min) => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

const clampInt = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback;
};

/** Fill gaps and reject junk so every reader can trust the shape. */
export function normalizeDayRoutine(raw) {
  const d = DEFAULT_DAY_ROUTINE;
  const r = raw && typeof raw === 'object' ? raw : {};
  const time = (v, fb) => (timeToMin(v) !== null ? v : fb);
  const mealCount = clampInt(r.mealCount, 0, 8, d.mealCount);
  const names = Array.isArray(r.mealNames) ? r.mealNames.map(String) : d.mealNames;
  return {
    autoPlan: r.autoPlan !== undefined ? !!r.autoPlan : d.autoPlan,
    wake: time(r.wake, d.wake),
    sleep: time(r.sleep, d.sleep),
    firstMeal: time(r.firstMeal, d.firstMeal),
    mealCount,
    mealGapHours: clampInt(r.mealGapHours, 1, 12, d.mealGapHours),
    mealMinutes: clampInt(r.mealMinutes, 5, 120, d.mealMinutes),
    mealNames: names,
    bufferMinutes: clampInt(r.bufferMinutes, 0, 60, d.bufferMinutes),
    speakAlarms: r.speakAlarms !== undefined ? !!r.speakAlarms : d.speakAlarms,
  };
}

export function loadDayRoutine() {
  try {
    const saved = localStorage.getItem(DAY_ROUTINE_KEY);
    return normalizeDayRoutine(saved ? JSON.parse(saved) : null);
  } catch {
    return normalizeDayRoutine(null);
  }
}

export function saveDayRoutine(routine) {
  const next = normalizeDayRoutine(routine);
  try { localStorage.setItem(DAY_ROUTINE_KEY, JSON.stringify(next)); } catch { /* storage full or blocked */ }
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next })); } catch { /* no window (tests) */ }
  return next;
}

export function onDayRoutineChange(listener) {
  const handler = (e) => listener(e.detail ?? loadDayRoutine());
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/**
 * The meal blocks for one day: `mealCount` meals every `mealGapHours` from
 * `firstMeal`, dropping any that would start at or after sleep.
 * @returns {{ name: string, start: number, end: number }[]} minutes from midnight
 */
export function mealBlocks(routine) {
  const r = normalizeDayRoutine(routine);
  const first = timeToMin(r.firstMeal);
  const sleep = timeToMin(r.sleep);
  const blocks = [];
  for (let i = 0; i < r.mealCount; i++) {
    const start = first + i * r.mealGapHours * 60;
    if (start >= sleep || start >= 24 * 60) break;
    blocks.push({
      name: r.mealNames[i] || `Meal ${i + 1}`,
      start,
      end: Math.min(start + r.mealMinutes, sleep),
    });
  }
  return blocks;
}
