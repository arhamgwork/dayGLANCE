import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseICS } from './icsParser.js';

// Recurrence expansion against RFC 5545 §3.3.10: the timeline shows exactly
// the occurrences the server has. A date the rule names that the calendar
// does not have is ignored, never moved; COUNT counts before EXDATE.
const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`;
const days = (dtstart, rrule, extra = []) => parseICS(wrap(['BEGIN:VEVENT', 'UID:s', 'SUMMARY:Series',
  `DTSTART:${dtstart}T090000`, `DTEND:${dtstart}T100000`, `RRULE:${rrule}`, ...extra, 'END:VEVENT'].join('\r\n')))
  .map(e => e.dtstart.slice(0, 8));

// The expansion window is a year either side of now.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 15, 12)); });
afterEach(() => vi.useRealTimers());

describe('monthly', () => {
  it('skips a month without the day, never clamping to its last day', () => {
    expect(days('20260131', 'FREQ=MONTHLY;COUNT=4')).toEqual(['20260131', '20260331', '20260531', '20260731']);
    expect(days('20261031', 'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=2')).toEqual(['20261031', '20261231']);
  });

  it('keeps an interval in its own months, skipping those without the day', () => {
    expect(days('20261231', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31;COUNT=2')).toEqual(['20261231', '20270831']);
  });

  it('takes several and negative days of the month', () => {
    expect(days('20261101', 'FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=4')).toEqual(['20261101', '20261115', '20261201', '20261215']);
    expect(days('20261130', 'FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=4')).toEqual(['20261130', '20261231', '20270131', '20270228']);
  });

  it('skips a month without the nth weekday, never spilling into the next', () => {
    // Fifth Fridays from January 2026: January, May, July, October.
    expect(days('20260130', 'FREQ=MONTHLY;BYDAY=5FR;COUNT=4')).toEqual(['20260130', '20260529', '20260731', '20261030']);
    expect(days('20260130', 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=3')).toEqual(['20260130', '20260227', '20260327']);
  });

  it('reads a bare weekday as every one in the month, and several weekdays', () => {
    expect(days('20261102', 'FREQ=MONTHLY;BYDAY=MO;COUNT=6')).toEqual(['20261102', '20261109', '20261116', '20261123', '20261130', '20261207']);
    expect(days('20261027', 'FREQ=MONTHLY;BYDAY=TU,TH;COUNT=4')).toEqual(['20261027', '20261029', '20261103', '20261105']);
  });

  it('starts at DTSTART, not earlier in its month', () => {
    expect(days('20261015', 'FREQ=MONTHLY;BYMONTHDAY=1,15;COUNT=2')).toEqual(['20261015', '20261101']);
  });
});

describe('yearly', () => {
  it('occurs on February 29 only in leap years', () => {
    expect(days('20240229', 'FREQ=YEARLY;UNTIL=20290101')).toEqual(['20280229']);
  });

  it('takes an nth weekday of BYMONTH, and several months', () => {
    // US Thanksgiving: the fourth Thursday of November.
    expect(days('20251127', 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3')).toEqual(['20251127', '20261126', '20271125']);
    expect(days('20260115', 'FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=15;COUNT=3')).toEqual(['20260115', '20260715', '20270115']);
    // Starting in July: January 2026 is before DTSTART, so not an occurrence.
    expect(days('20260715', 'FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=15;COUNT=2')).toEqual(['20260715', '20270115']);
  });
});

describe('weekly', () => {
  it('counts a week from WKST, Monday by default, under an interval', () => {
    // Sunday 2026-10-18 then every other week on Sunday and Monday. With weeks
    // from Monday, Sunday the 18th ends its week and the next pair is Mon 26 /
    // Sun Nov 1 two weeks on; Sunday-start weeks would give a different set.
    expect(days('20261018', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=3')).toEqual(['20261018', '20261026', '20261101']);
    expect(days('20261018', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU;COUNT=3')).toEqual(['20261018', '20261019', '20261101']);
  });

  it('applies COUNT in date order whatever the BYDAY order', () => {
    expect(days('20261019', 'FREQ=WEEKLY;BYDAY=WE,MO;COUNT=3')).toEqual(['20261019', '20261021', '20261026']);
  });
});

describe('COUNT before EXDATE', () => {
  it('lets an excluded date use up its place, in every frequency', () => {
    expect(days('20261019', 'FREQ=DAILY;COUNT=3', ['EXDATE:20261020T090000'])).toEqual(['20261019', '20261021']);
    expect(days('20261019', 'FREQ=MONTHLY;COUNT=3', ['EXDATE:20261119T090000'])).toEqual(['20261019', '20261219']);
  });
});
