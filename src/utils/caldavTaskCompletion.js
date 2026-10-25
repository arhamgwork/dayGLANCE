// The CalDAV completion writeback's rewrite of one VTODO resource, moved
// verbatim out of App.jsx's syncTaskCompletionToCalDAV so it can be tested.
// Pure: the caller GETs the resource, passes its text here, and PUTs the
// result back with If-Match. Nothing here touches the network or state.
//
// For a non-recurring task: STATUS/COMPLETED/PERCENT-COMPLETE change directly.
// For a recurring task: DUE/DTSTART advance to the next RRULE occurrence (and
// STATUS stays NEEDS-ACTION) so Nextcloud immediately shows the next instance
// as a fresh to-do; uncompleting moves them back to the instance's date.
// Nextcloud doesn't support RECURRENCE-ID overrides for VTODOs
// (https://github.com/nextcloud/tasks/issues/2276), so per-instance completion
// can't be represented: advancing the due date is the best compatible approach.
// A series whose next occurrence passes UNTIL is completed instead.

import { dayOfMonth, monthOccurrences } from './rruleDates.js';

// How many periods to look ahead for the next occurrence. Any rule that has
// occurrences at all has one well within this (a fifth weekday recurs within
// a year, February 29 within eight); past it, the series is treated as ended.
const SEARCH_PERIODS = 120;

/**
 * @param {string} icsContent  the resource as fetched
 * @param {object} options
 * @param {boolean} options.completed   the task's new state
 * @param {boolean} [options.isRecurring]
 * @param {string}  [options.date]      the instance date, 'YYYY-MM-DD'
 * @param {Date}    [options.now]       stamps COMPLETED and LAST-MODIFIED
 * @returns {string} the resource to PUT back
 */
export function applyTaskCompletionToIcs(icsContent, { completed, isRecurring = false, date, now = new Date() } = {}) {
  // RFC 5545 §3.1 unfold: remove CRLF/LF followed by a whitespace continuation
  // so that line-folded properties match our single-line regexes reliably.
  icsContent = icsContent.replace(/\r?\n[ \t]/g, '');
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  if (isRecurring && date) {
    // --- Recurring task: advance (or revert) DUE/DTSTART ---
    // Clean up any stale RECURRENCE-ID overrides from previous sync code
    icsContent = icsContent.replace(
      /BEGIN:VTODO\r?\n(?:(?!END:VTODO)[\s\S])*?RECURRENCE-ID[\s\S]*?END:VTODO\r?\n?/gm,
      ''
    );

    // Parse RRULE from master VTODO
    const rruleMatch = icsContent.match(/^RRULE:(.+)$/m);
    if (!rruleMatch) {
      // No recurrence rule on this VTODO — nothing to expand.
    } else {
      const rruleStr = rruleMatch[1].trim();
      const datePart = date.replace(/-/g, ''); // "YYYYMMDD"
      const completedYear = parseInt(datePart.substring(0, 4));
      const completedMonth = parseInt(datePart.substring(4, 6)) - 1;
      const completedDay = parseInt(datePart.substring(6, 8));
      const completedDate = new Date(completedYear, completedMonth, completedDay);

      // Calculate the target date: next occurrence (completing) or the instance date (uncompleting)
      let targetDate;
      if (completed) {
        // Calculate next RRULE occurrence after the completed instance
        const rule = {};
        rruleStr.split(';').forEach(part => {
          const eq = part.indexOf('=');
          if (eq !== -1) rule[part.substring(0, eq).trim().toUpperCase()] = part.substring(eq + 1).trim().toUpperCase();
        });
        const interval = parseInt(rule.INTERVAL || '1');
        const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

        if (rule.FREQ === 'DAILY') {
          targetDate = new Date(completedDate);
          targetDate.setDate(targetDate.getDate() + interval);
        } else if (rule.FREQ === 'WEEKLY') {
          // M5: parse WKST — RFC 5545 default is MO (Monday=1), not SU.
          const wkst = rule.WKST ? (dayMap[rule.WKST] ?? 1) : 1;
          const byDays = rule.BYDAY
            ? rule.BYDAY.split(',').map(d => dayMap[d.trim().replace(/^-?\d+/, '')]).filter(d => d !== undefined).sort((a, b) => a - b)
            : [completedDate.getDay()];
          const currentDow = completedDate.getDay();
          const nextDow = byDays.find(d => d > currentDow);
          targetDate = new Date(completedDate);
          if (nextDow !== undefined) {
            targetDate.setDate(targetDate.getDate() + (nextDow - currentDow));
          } else {
            // Wrap to first BYDAY of the next occurrence-week, anchored to WKST.
            const daysToWeekStart = ((wkst - currentDow) % 7 + 7) % 7 || 7;
            targetDate.setDate(targetDate.getDate() + daysToWeekStart + (interval - 1) * 7 + (byDays[0] - wkst + 7) % 7);
          }
        } else if (rule.FREQ === 'MONTHLY') {
          // The series' occurrences in a month, by RFC 5545: a date that does
          // not exist there (the 31st of a 30-day month, a fifth Friday) is
          // ignored, never moved. The next is the first later in the
          // completed month, else the first in the next month the interval
          // reaches that has one.
          const inMonth = (year, month) => monthOccurrences(year, month,
            { byDay: rule.BYDAY, byMonthDay: rule.BYMONTHDAY, defaultDay: completedDay });
          targetDate = inMonth(completedYear, completedMonth).find(d => d > completedDate) ?? null;
          for (let k = 1; !targetDate && k <= SEARCH_PERIODS; k++) {
            const month = new Date(completedYear, completedMonth + interval * k, 1);
            targetDate = inMonth(month.getFullYear(), month.getMonth())[0] ?? null;
          }
        } else if (rule.FREQ === 'YEARLY') {
          // Same month and day, in the next year the interval reaches that
          // has it: February 29 waits for a leap year.
          targetDate = null;
          for (let k = 1; !targetDate && k <= SEARCH_PERIODS; k++) {
            targetDate = dayOfMonth(completedYear + interval * k, completedMonth, completedDay);
          }
        }

        // Check UNTIL — if next occurrence exceeds UNTIL, the series is done
        if (targetDate && rule.UNTIL) {
          const u = rule.UNTIL;
          const untilDate = new Date(parseInt(u.substring(0, 4)), parseInt(u.substring(4, 6)) - 1, parseInt(u.substring(6, 8)));
          if (targetDate > untilDate) targetDate = null;
        }
      } else {
        // Uncompleting: revert DUE/DTSTART back to the instance's date
        targetDate = completedDate;
      }

      if (targetDate) {
        // Calculate delta from the CURRENT DUE/DTSTART in the ICS to the target date.
        // Using the current anchor (not completedDate) is critical for uncomplete:
        // the DUE was previously advanced, so we need to shift it BACK.
        const fmtDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const vtodoBlock = icsContent.match(/BEGIN:VTODO[\s\S]*?END:VTODO/);
        const currentDueMatch = icsContent.match(/^DUE[^:]*:(\d{8})/m);
        const currentDtstartMatch = vtodoBlock && vtodoBlock[0].match(/^DTSTART[^:]*:(\d{8})/m);
        const anchorStr = (currentDueMatch || currentDtstartMatch || [])[1];
        let deltaDays = 0;
        if (anchorStr) {
          const anchorDate = new Date(parseInt(anchorStr.substring(0, 4)), parseInt(anchorStr.substring(4, 6)) - 1, parseInt(anchorStr.substring(6, 8)));
          deltaDays = Math.round((targetDate - anchorDate) / 86400000);
        }

        const advanceDateInLine = (line) => line.replace(/(\d{4})(\d{2})(\d{2})/, (_m, y, mo, d) => {
          const orig = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
          orig.setDate(orig.getDate() + deltaDays);
          return fmtDate(orig);
        });

        // Update DUE line
        const dueLineMatch = icsContent.match(/^DUE[^:]*:\d{8}.*$/m);
        if (dueLineMatch) {
          icsContent = icsContent.replace(dueLineMatch[0], advanceDateInLine(dueLineMatch[0]));
        }
        // Update DTSTART line (only inside VTODO, not VTIMEZONE)
        if (vtodoBlock) {
          const dtstartInVtodo = vtodoBlock[0].match(/^DTSTART[^:]*:\d{8}.*$/m);
          if (dtstartInVtodo) {
            icsContent = icsContent.replace(dtstartInVtodo[0], advanceDateInLine(dtstartInVtodo[0]));
          }
        }

        // Ensure STATUS is NEEDS-ACTION (the next instance is not yet completed)
        if (/^STATUS[^:]*:/m.test(icsContent)) {
          icsContent = icsContent.replace(/^STATUS[^:]*:.*$/m, 'STATUS:NEEDS-ACTION');
        }
        // Remove any COMPLETED timestamp
        icsContent = icsContent.replace(/^COMPLETED[^:]*:[^\r\n]*\r?\n?/m, '');
        // Reset PERCENT-COMPLETE
        if (/^PERCENT-COMPLETE[^:]*:/m.test(icsContent)) {
          icsContent = icsContent.replace(/^PERCENT-COMPLETE[^:]*:.*$/m, 'PERCENT-COMPLETE:0');
        }

      } else if (completed) {
        // Fall through to non-recurring completion below
      }

      // If targetDate was set, skip the non-recurring block
      if (targetDate) {
        // Already handled above — skip to LAST-MODIFIED/PUT
      } else if (!completed) {
        // Uncomplete with no targetDate shouldn't happen, but be safe
      } else {
        // completed && !targetDate => series ended, use non-recurring completion
        if (/^STATUS[^:]*:/m.test(icsContent)) {
          icsContent = icsContent.replace(/^STATUS[^:]*:.*$/m, 'STATUS:COMPLETED');
        } else {
          icsContent = icsContent.replace(/^(END:VTODO)/m, 'STATUS:COMPLETED\r\n$1');
        }
        if (/^COMPLETED[^:]*:/m.test(icsContent)) {
          icsContent = icsContent.replace(/^COMPLETED[^:]*:.*$/m, `COMPLETED:${timestamp}`);
        } else {
          icsContent = icsContent.replace(/^(END:VTODO)/m, `COMPLETED:${timestamp}\r\n$1`);
        }
        if (/^PERCENT-COMPLETE[^:]*:/m.test(icsContent)) {
          icsContent = icsContent.replace(/^PERCENT-COMPLETE[^:]*:.*$/m, 'PERCENT-COMPLETE:100');
        } else {
          icsContent = icsContent.replace(/^(END:VTODO)/m, 'PERCENT-COMPLETE:100\r\n$1');
        }
      }
    }
  }

  if (!isRecurring || !date || !icsContent.match(/^RRULE:/m)) {
    // --- Non-recurring (or recurring without RRULE fallback): update STATUS directly ---
    if (completed) {
      if (/^STATUS[^:]*:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^STATUS[^:]*:.*$/m, 'STATUS:COMPLETED');
      } else {
        icsContent = icsContent.replace(/^(END:VTODO)/m, 'STATUS:COMPLETED\r\n$1');
      }
      if (/^COMPLETED[^:]*:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^COMPLETED[^:]*:.*$/m, `COMPLETED:${timestamp}`);
      } else {
        icsContent = icsContent.replace(/^(END:VTODO)/m, `COMPLETED:${timestamp}\r\n$1`);
      }
      if (/^PERCENT-COMPLETE[^:]*:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^PERCENT-COMPLETE[^:]*:.*$/m, 'PERCENT-COMPLETE:100');
      } else {
        icsContent = icsContent.replace(/^(END:VTODO)/m, 'PERCENT-COMPLETE:100\r\n$1');
      }
    } else {
      if (/^STATUS[^:]*:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^STATUS[^:]*:.*$/m, 'STATUS:NEEDS-ACTION');
      }
      icsContent = icsContent.replace(/^COMPLETED[^:]*:[^\r\n]*\r?\n?/m, '');
      if (/^PERCENT-COMPLETE[^:]*:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^PERCENT-COMPLETE[^:]*:.*$/m, 'PERCENT-COMPLETE:0');
      }
    }
  }

  // Update LAST-MODIFIED on the master component
  if (/^LAST-MODIFIED[^:]*:/m.test(icsContent)) {
    icsContent = icsContent.replace(/^LAST-MODIFIED[^:]*:.*$/m, `LAST-MODIFIED:${timestamp}`);
  }

  return icsContent;
}
