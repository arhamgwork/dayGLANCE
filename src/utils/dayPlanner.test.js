import { describe, it, expect } from 'vitest';
import { splitTranscript, estimateDuration, parseTranscriptToPlan, planDay, routineBusy } from './dayPlanner.js';
import { DEFAULT_DAY_ROUTINE, mealBlocks, normalizeDayRoutine, timeToMin } from './dayRoutine.js';

const at = (h, m = 0) => new Date(2026, 9, 28, h, m); // Wed 28 Oct 2026, local
const routine = DEFAULT_DAY_ROUTINE; // wake 06:00, sleep 21:00, meals 06:30/10:30/14:30/18:30 ×30m

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const iv = (t) => ({ start: timeToMin(t.time), end: timeToMin(t.time) + t.duration });

describe('routine', () => {
  it('makes four meals four hours apart from breakfast', () => {
    expect(mealBlocks(routine).map((m) => [m.name, m.start / 60])).toEqual([
      ['Breakfast', 6.5], ['Lunch', 10.5], ['Second lunch', 14.5], ['Dinner', 18.5],
    ]);
  });

  it('drops meals that would start after sleep', () => {
    expect(mealBlocks({ ...routine, firstMeal: '09:00' }).map((m) => m.name)).toEqual(['Breakfast', 'Lunch', 'Second lunch']);
  });

  it('repairs junk settings to defaults', () => {
    expect(normalizeDayRoutine({ wake: '25:00', mealCount: 'x' }).wake).toBe('06:00');
    expect(normalizeDayRoutine({ mealCount: 99 }).mealCount).toBe(8);
  });

  it('blocks the night', () => {
    const busy = routineBusy(routine);
    expect(busy).toContainEqual({ start: 0, end: 360, kind: 'sleep' });
    expect(busy).toContainEqual({ start: 21 * 60, end: 24 * 60, kind: 'sleep' });
  });
});

describe('splitTranscript', () => {
  it('splits a messy spoken list', () => {
    expect(splitTranscript('um I need to call mom and buy groceries, then clean the kitchen. also do laundry'))
      .toEqual(['call mom', 'buy groceries', 'clean the kitchen', 'do laundry']);
  });

  it('keeps "milk and eggs" as one errand', () => {
    expect(splitTranscript('buy milk and eggs and call the dentist')).toEqual(['buy milk and eggs', 'call the dentist']);
  });

  it('does not break dotted times', () => {
    expect(splitTranscript('dentist at 3.30 p.m. tomorrow')).toHaveLength(1);
  });
});

describe('estimateDuration', () => {
  it('guesses from keywords', () => {
    expect(estimateDuration('Call mom')).toBe(15);
    expect(estimateDuration('Go to the gym')).toBe(60);
    expect(estimateDuration('Buy groceries')).toBe(45);
    expect(estimateDuration('Something vague')).toBe(30);
  });
});

describe('parseTranscriptToPlan', () => {
  it('makes several tasks with guessed durations', () => {
    const tasks = parseTranscriptToPlan('call mom, go to the gym and buy groceries', { now: at(8) });
    expect(tasks.map((t) => [t.title.toLowerCase(), t.duration])).toEqual([
      ['call mom', 15], ['go to the gym', 60], ['buy groceries', 45],
    ]);
  });

  it('keeps a spoken duration', () => {
    const [t] = parseTranscriptToPlan('read for 90 minutes', { now: at(8) });
    expect(t.duration).toBe(90);
  });

  it('keeps a spoken time', () => {
    const [t] = parseTranscriptToPlan('dentist at 3pm', { now: at(8) });
    expect(t.time).toBe('15:00');
  });
});

describe('planDay', () => {
  const plan = (tasks, opts = {}) => planDay(tasks, { routine, now: at(7, 2), ...opts });

  it('never puts a task on a meal, before wake or after sleep', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ title: `t${i}`, duration: 50, priority: 0 }));
    const out = plan(tasks);
    const meals = mealBlocks(routine);
    for (const t of out.filter((x) => x.date === '2026-10-28')) {
      const span = iv(t);
      expect(span.start).toBeGreaterThanOrEqual(6 * 60);
      expect(span.end).toBeLessThanOrEqual(21 * 60);
      for (const m of meals) expect(overlaps(span, m), `${t.title} ${t.time}`).toBe(false);
    }
  });

  it('starts from now, rounded up to 5 minutes', () => {
    const [t] = plan([{ title: 'a', duration: 30 }]);
    expect(t).toMatchObject({ date: '2026-10-28', time: '07:05', planned: true });
  });

  it('routes around existing tasks and fixed-time tasks, with a buffer', () => {
    const out = plan(
      [{ title: 'fixed', time: '08:00', duration: 60 }, { title: 'float', duration: 60 }],
      { existingTasks: [{ date: '2026-10-28', startTime: '07:00', duration: 45 }] },
    );
    // 07:05 is taken until 07:45; 07:50 + 60 runs into the 08:00 fixed task → after it, +5.
    expect(out[1].time).toBe('09:05');
  });

  it('does not let tasks overlap each other', () => {
    const out = plan(Array.from({ length: 8 }, (_, i) => ({ title: `t${i}`, duration: 40 })));
    const spans = out.map(iv);
    for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
      expect(overlaps(spans[i], spans[j]) && out[i].date === out[j].date).toBe(false);
    }
  });

  it('schedules high priority first', () => {
    const out = plan([{ title: 'low', duration: 30 }, { title: 'high', duration: 30, priority: 3 }]);
    expect(out[1].time < out[0].time).toBe(true);
    expect(out.map((t) => t.title)).toEqual(['low', 'high']); // order kept
  });

  it('rolls a dateless task to tomorrow when today is full', () => {
    const [t] = plan([{ title: 'late', duration: 60 }], { now: at(20, 30) });
    // 06:00 + 60 would run into breakfast at 06:30, so it goes after.
    expect(t).toMatchObject({ date: '2026-10-29', time: '07:00', planned: true });
  });

  it('plans a spoken date from wake', () => {
    const [t] = plan([{ title: 'x', date: '2026-10-30', duration: 30 }]);
    expect(t).toMatchObject({ date: '2026-10-30', time: '06:00' });
  });

  it('leaves recurring tasks alone', () => {
    const task = { title: 'r', recurrence: { type: 'daily' }, date: '2026-10-28', time: null };
    expect(plan([task])[0]).toEqual(task);
  });
});
