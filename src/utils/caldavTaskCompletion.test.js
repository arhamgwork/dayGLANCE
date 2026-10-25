import { describe, expect, it } from 'vitest';
import { applyTaskCompletionToIcs } from './caldavTaskCompletion.js';

// Characterization of the CalDAV completion writeback's VTODO rewrite, moved
// verbatim out of App.jsx. Each case pins what is PUT back to the server.
const now = new Date('2026-10-24T12:34:56.789Z');
const STAMP = '20261024T123456Z';
const vtodo = (lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VTODO', 'UID:task-1@example.com', ...lines, 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
const prop = (ics, name) => ics.match(new RegExp(`^${name}[^:]*:(.*?)\\r?$`, 'm'))?.[1] ?? null;
const complete = (ics, options = {}) => applyTaskCompletionToIcs(ics, { completed: true, now, ...options });
const reopen = (ics, options = {}) => applyTaskCompletionToIcs(ics, { completed: false, now, ...options });
// A recurring occurrence completed on `date`: where does DUE go?
const nextDue = (rrule, due, date) => prop(complete(vtodo([`DUE;VALUE=DATE:${due}`, `RRULE:${rrule}`, 'STATUS:NEEDS-ACTION']), { isRecurring: true, date }), 'DUE');

describe('a task without recurrence', () => {
  it('completes: STATUS, COMPLETED and PERCENT-COMPLETE, added where missing', () => {
    const out = complete(vtodo(['SUMMARY:Pay rent', 'LAST-MODIFIED:20260101T000000Z']));
    expect(prop(out, 'STATUS')).toBe('COMPLETED');
    expect(prop(out, 'COMPLETED')).toBe(STAMP);
    expect(prop(out, 'PERCENT-COMPLETE')).toBe('100');
    expect(prop(out, 'LAST-MODIFIED')).toBe(STAMP);
    expect(out).toMatch(/PERCENT-COMPLETE:100\r\nEND:VTODO/);
  });

  it('completes in place where the properties exist', () => {
    const out = complete(vtodo(['STATUS:NEEDS-ACTION', 'COMPLETED:20250101T000000Z', 'PERCENT-COMPLETE:40']));
    expect(out.match(/^STATUS/gm)).toHaveLength(1);
    expect(prop(out, 'STATUS')).toBe('COMPLETED');
    expect(prop(out, 'COMPLETED')).toBe(STAMP);
    expect(prop(out, 'PERCENT-COMPLETE')).toBe('100');
  });

  it('reopens: NEEDS-ACTION, no COMPLETED, PERCENT-COMPLETE 0', () => {
    const out = reopen(vtodo(['STATUS:COMPLETED', 'COMPLETED:20261001T090000Z', 'PERCENT-COMPLETE:100']));
    expect(prop(out, 'STATUS')).toBe('NEEDS-ACTION');
    expect(prop(out, 'COMPLETED')).toBeNull();
    expect(prop(out, 'PERCENT-COMPLETE')).toBe('0');
  });

  it('unfolds folded lines before rewriting', () => {
    const out = complete(vtodo(['SUMMARY:A very long', ' title', 'STATUS:NEEDS-', ' ACTION']));
    expect(prop(out, 'SUMMARY')).toBe('A very longtitle');
    expect(prop(out, 'STATUS')).toBe('COMPLETED');
  });

  it('treats a recurring task with no RRULE on the server as a plain task', () => {
    const out = complete(vtodo(['DUE;VALUE=DATE:20261024', 'STATUS:NEEDS-ACTION']), { isRecurring: true, date: '2026-10-24' });
    expect(prop(out, 'STATUS')).toBe('COMPLETED');
    expect(prop(out, 'DUE')).toBe('20261024');
  });
});

describe('a recurring task advances to its next occurrence', () => {
  it('keeps it open for the next occurrence: NEEDS-ACTION, no COMPLETED, PERCENT-COMPLETE 0', () => {
    const out = complete(vtodo(['DUE;VALUE=DATE:20261024', 'RRULE:FREQ=DAILY', 'STATUS:COMPLETED', 'COMPLETED:20261023T080000Z', 'PERCENT-COMPLETE:100']),
      { isRecurring: true, date: '2026-10-24' });
    expect(prop(out, 'DUE')).toBe('20261025');
    expect(prop(out, 'STATUS')).toBe('NEEDS-ACTION');
    expect(prop(out, 'COMPLETED')).toBeNull();
    expect(prop(out, 'PERCENT-COMPLETE')).toBe('0');
  });

  it.each([
    ['daily, every 2 days', 'FREQ=DAILY;INTERVAL=2', '20261024', '2026-10-24', '20261026'],
    // 2026-10-21 is a Wednesday.
    ['weekly, the next listed weekday', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', '20261021', '2026-10-21', '20261023'],
    ['weekly, wrapping to the next week (WKST Monday)', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', '20261023', '2026-10-23', '20261026'],
    ['weekly every 2 weeks, wrapping', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR', '20261023', '2026-10-23', '20261102'],
    ['weekly, no BYDAY: the same weekday', 'FREQ=WEEKLY', '20261021', '2026-10-21', '20261028'],
    ['monthly on a day of the month', 'FREQ=MONTHLY;BYMONTHDAY=15', '20261015', '2026-10-15', '20261115'],
    ['monthly, the first Monday', 'FREQ=MONTHLY;BYDAY=1MO', '20261005', '2026-10-05', '20261102'],
    ['monthly, the last Friday', 'FREQ=MONTHLY;BYDAY=-1FR', '20261030', '2026-10-30', '20261127'],
    ['monthly on several weekdays, later this week', 'FREQ=MONTHLY;BYDAY=TU,TH', '20261020', '2026-10-20', '20261022'],
    ['yearly', 'FREQ=YEARLY', '20261024', '2026-10-24', '20271024'],
  ])('%s', (_, rrule, due, date, expected) => {
    expect(nextDue(rrule, due, date)).toBe(expected);
  });

  // RFC 5545 §3.3.10: an occurrence on a date that does not exist (the 31st
  // of a 30-day month, a fifth Friday, February 29 in a common year) is
  // ignored, never moved to a nearby day. The next due date is always an
  // occurrence of the series.
  it.each([
    ['the 31st skips a 30-day month', 'FREQ=MONTHLY;BYMONTHDAY=31', '20261031', '2026-10-31', '20261231'],
    ['plain monthly from the 31st skips February', 'FREQ=MONTHLY', '20260131', '2026-01-31', '20260331'],
    ['every 2 months on the 31st stays in its own months', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31', '20261231', '2026-12-31', '20270831'],
    ['the last day of the month', 'FREQ=MONTHLY;BYMONTHDAY=-1', '20260131', '2026-01-31', '20260228'],
    ['several days of the month, later this month', 'FREQ=MONTHLY;BYMONTHDAY=1,15', '20261001', '2026-10-01', '20261015'],
    ['several days of the month, wrapping', 'FREQ=MONTHLY;BYMONTHDAY=1,15', '20261015', '2026-10-15', '20261101'],
    ['the last Friday late in January, then February', 'FREQ=MONTHLY;BYDAY=-1FR', '20260130', '2026-01-30', '20260227'],
    ['a fifth Friday waits for a month that has one', 'FREQ=MONTHLY;BYDAY=5FR', '20260130', '2026-01-30', '20260529'],
    ['every Tuesday and Thursday: the rest of the month first', 'FREQ=MONTHLY;BYDAY=TU,TH', '20261022', '2026-10-22', '20261027'],
    ['every Tuesday and Thursday: into the next month', 'FREQ=MONTHLY;BYDAY=TU,TH', '20261029', '2026-10-29', '20261103'],
    ['yearly on February 29 waits for a leap year', 'FREQ=YEARLY', '20280229', '2028-02-29', '20320229'],
    ['every 2 years on February 29', 'FREQ=YEARLY;INTERVAL=2', '20280229', '2028-02-29', '20320229'],
  ])('%s', (_, rrule, due, date, expected) => {
    expect(nextDue(rrule, due, date)).toBe(expected);
  });

  it('completes the series instead when the next occurrence passes UNTIL', () => {
    const out = complete(vtodo(['DUE;VALUE=DATE:20261024', 'RRULE:FREQ=WEEKLY;UNTIL=20261030T000000Z', 'STATUS:NEEDS-ACTION']),
      { isRecurring: true, date: '2026-10-24' });
    expect(prop(out, 'DUE')).toBe('20261024');
    expect(prop(out, 'STATUS')).toBe('COMPLETED');
    expect(prop(out, 'COMPLETED')).toBe(STAMP);
    expect(prop(out, 'PERCENT-COMPLETE')).toBe('100');
  });

  it('moves DTSTART inside the VTODO by the same days, never the VTIMEZONE one', () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin', 'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'END:STANDARD', 'END:VTIMEZONE',
      'BEGIN:VTODO', 'UID:t', 'DTSTART;TZID=Europe/Berlin:20261024T090000', 'DUE;TZID=Europe/Berlin:20261024T100000', 'RRULE:FREQ=DAILY',
      'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
    const out = complete(ics, { isRecurring: true, date: '2026-10-24' });
    expect(out).toContain('DTSTART:19701025T030000');
    expect(out).toContain('DTSTART;TZID=Europe/Berlin:20261025T090000');
    expect(out).toContain('DUE;TZID=Europe/Berlin:20261025T100000');
  });

  it('removes stale RECURRENCE-ID overrides left by older sync code', () => {
    const ics = vtodo(['DUE;VALUE=DATE:20261024', 'RRULE:FREQ=DAILY']).replace('END:VCALENDAR',
      'BEGIN:VTODO\r\nUID:task-1@example.com\r\nRECURRENCE-ID;VALUE=DATE:20261020\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nEND:VCALENDAR');
    const out = complete(ics, { isRecurring: true, date: '2026-10-24' });
    expect(out).not.toContain('RECURRENCE-ID');
    expect(out.match(/BEGIN:VTODO/g)).toHaveLength(1);
  });

  it('reopening moves DUE back to the occurrence, from wherever it was advanced to', () => {
    const out = reopen(vtodo(['DUE;VALUE=DATE:20261026', 'RRULE:FREQ=DAILY;INTERVAL=2', 'STATUS:NEEDS-ACTION']),
      { isRecurring: true, date: '2026-10-24' });
    expect(prop(out, 'DUE')).toBe('20261024');
    expect(prop(out, 'STATUS')).toBe('NEEDS-ACTION');
  });
});
