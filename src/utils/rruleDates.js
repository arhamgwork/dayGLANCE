// Date arithmetic for iCalendar recurrence rules (RFC 5545 §3.3.10), shared by
// the feed parser (icsParser.js), which draws a series' occurrences on the
// timeline, and the CalDAV completion writeback (caldavTaskCompletion.js),
// which advances a task's DUE to its next occurrence. One rule for both, so
// the app never shows an occurrence the server does not have.
//
// The RFC's rule for a date that does not exist is load-bearing: it is
// IGNORED, never moved. A series on the 31st has no occurrence in a 30-day
// month; a fifth Friday none in a month with four; February 29 none in a
// common year. Dates are local, at midnight, built from parts, never parsed.

export const DAY_INDEX = Object.freeze({ SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 });

/** Day `day` of a month (negative counts from its end), or null if the month does not have it. */
export const dayOfMonth = (year, month, day) => {
  const length = new Date(year, month + 1, 0).getDate();
  const d = day > 0 ? day : length + day + 1;
  return d >= 1 && d <= length ? new Date(year, month, d) : null;
};

/**
 * The dates in a month that one BYDAY token names: '-1FR' (the last Friday),
 * '2MO' (the second Monday), or 'TU' (every Tuesday). An nth weekday the
 * month does not have gives none.
 */
export const weekdaysIn = (year, month, token, dayMap = DAY_INDEX) => {
  const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(token);
  if (!m || dayMap[m[2]] === undefined) return [];
  const dow = dayMap[m[2]];
  const length = new Date(year, month + 1, 0).getDate();
  const first = 1 + ((dow - new Date(year, month, 1).getDay() + 7) % 7);
  const all = [];
  for (let d = first; d <= length; d += 7) all.push(new Date(year, month, d));
  if (!m[1]) return all;
  const nth = parseInt(m[1]);
  const hit = nth > 0 ? all[nth - 1] : all[all.length + nth];
  return hit ? [hit] : [];
};

/**
 * A monthly rule's occurrences in one month, in order: every date its BYDAY
 * tokens name, else every day its BYMONTHDAY list names (negative from the
 * end), else `defaultDay` (the series' own day). Dates the month lacks are
 * left out. Duplicates (two tokens naming one date) appear once.
 */
export const monthOccurrences = (year, month, { byDay, byMonthDay, defaultDay }) => {
  const dates = byDay
    ? String(byDay).split(',').flatMap(token => weekdaysIn(year, month, token.trim()))
    : (byMonthDay ? String(byMonthDay).split(',').map(d => parseInt(d)).filter(d => Number.isInteger(d) && d !== 0) : [defaultDay])
      .map(d => dayOfMonth(year, month, d)).filter(Boolean);
  return [...new Map(dates.map(d => [d.getTime(), d])).values()].sort((a, b) => a - b);
};
