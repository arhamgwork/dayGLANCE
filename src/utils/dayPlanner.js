// Voice dump → planned day. Pure, so the whole planning rule is tested without
// rendering anything.
//
// Two parts:
// - splitTranscript / parseTranscriptToPlan: the offline multi-task parse used
//   when no AI provider is reachable. Each chunk goes through the existing
//   deterministic voice parser (voiceQuickAdd.js), so dates, times and repeats
//   are understood exactly as in single-task voice input.
// - planDay: drops tasks without a time into the open slots of their day,
//   around wake, sleep, meals and what is already scheduled.

import { parseTranscriptTasks } from './voiceQuickAdd.js';
import { normalizeDayRoutine, mealBlocks, timeToMin, minToTime } from './dayRoutine.js';

const pad2 = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
};

// ── Offline splitting ─────────────────────────────────────────────────────────

// Verbs that start a new errand. " and " only splits when one of these follows,
// so "buy milk and eggs" stays one task but "buy milk and call mom" is two.
const TASK_VERBS = [
  'call', 'phone', 'ring', 'email', 'e-mail', 'text', 'message', 'reply', 'write', 'send', 'post',
  'buy', 'get', 'pick', 'grab', 'order', 'shop', 'return', 'drop', 'collect', 'pay',
  'go', 'drive', 'walk', 'run', 'visit', 'meet', 'see', 'take', 'bring',
  'clean', 'tidy', 'wash', 'vacuum', 'mop', 'sweep', 'dust', 'iron', 'fold', 'do', 'make', 'cook',
  'bake', 'prepare', 'prep', 'feed', 'water', 'mow', 'fix', 'repair', 'install', 'charge',
  'finish', 'start', 'work', 'study', 'read', 'review', 'practice', 'practise', 'learn', 'watch',
  'plan', 'book', 'schedule', 'check', 'update', 'file', 'print', 'sign', 'submit', 'renew',
  'organize', 'organise', 'sort', 'pack', 'unpack', 'exercise', 'stretch', 'meditate', 'shower',
  'nap', 'rest', 'play', 'help', 'ask', 'tell', 'remind', 'cancel', 'upload', 'download', 'back',
];
const VERB_ALT = TASK_VERBS.map((v) => v.replace('-', '\\-')).join('|');

// Spoken filler that starts a chunk: "I need to", "I have to", "gotta", "then"…
const LEAD_RE = /^\s*(?:(?:and|also|then|plus|oh|um|uh|so|okay|ok)\b[,\s]*)*(?:(?:i\s+)?(?:need|have|want|got|must|should)\s+to\s+|i\s+(?:must|should)\s+|i\s+gotta\s+|gotta\s+|don'?t\s+forget\s+to\s+|remember\s+to\s+|remind\s+me\s+to\s+)?/i;

/** Split a rambling transcript into one string per task. */
export function splitTranscript(text) {
  const src = String(text || '')
    .replace(/\s+/g, ' ')
    // "3 p.m." → "3 pm" first, or its dots read as sentence ends.
    .replace(/\b([ap])\.m\.?/gi, (_, letter) => `${letter.toLowerCase()}m`)
    .trim();
  if (!src) return [];
  const verbSplit = new RegExp(
    `\\s+(?:and\\s+then|and\\s+also|and|then|also|plus|after\\s+that)\\s+(?=(?:(?:i\\s+)?(?:need|have|want|got|must|should)\\s+to\\s+|gotta\\s+)?(?:${VERB_ALT})\\b)`,
    'gi',
  );
  return src
    // Sentence and list punctuation always separates. Keep "3.30" and "p.m."
    // intact by only splitting on a period followed by a space or the end.
    .split(/[;\n]+|[.!?](?=\s|$)|,\s*/)
    .flatMap((part) => part.split(verbSplit))
    .flatMap((part) => part.split(/\s+(?:and\s+then|after\s+that|then)\s+/i))
    .map((part) => part.replace(LEAD_RE, '').trim())
    .filter((part) => part.length > 1);
}

// Rough durations by keyword, first match wins. Minutes.
const DURATION_GUESSES = [
  [/\b(?:gym|work ?out|exercise|training|run|jog|swim|yoga|hike)\b/i, 60],
  [/\b(?:grocer(?:y|ies)|shopping|supermarket|costco|walmart|target)\b/i, 45],
  [/\b(?:laundry|wash(?:ing)? (?:the )?clothes)\b/i, 45],
  [/\b(?:clean|vacuum|mop|tidy|dishes|chores)\b/i, 30],
  [/\b(?:cook|bake|meal ?prep|dinner prep)\b/i, 45],
  [/\b(?:study|homework|assignment|essay|report|presentation|project)\b/i, 60],
  [/\b(?:meeting|appointment|dentist|doctor|haircut|interview|class|lesson)\b/i, 60],
  [/\b(?:read|reading|practice|practise|learn)\b/i, 30],
  [/\b(?:walk|stretch|meditate|nap)\b/i, 20],
  [/\b(?:call|phone|ring|text|email|e-mail|message|reply|pay|bill|book|renew|order|schedule|remind)\b/i, 15],
  [/\b(?:pick up|drop off|post office|bank|pharmacy|errand)\b/i, 30],
  [/\b(?:water|feed|take out|trash|bins|charge)\b/i, 10],
];

/** A best-guess duration in minutes for a task title (30 when nothing matches). */
export function estimateDuration(title) {
  const s = String(title || '');
  for (const [re, minutes] of DURATION_GUESSES) if (re.test(s)) return minutes;
  return 30;
}

const SPOKEN_DURATION_RE = /\b(?:\d+(?:\.\d+)?\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?)\b|half an hour|an hour|a couple (?:of )?hours|quarter (?:of )?an hour)/i;

/**
 * Offline parse of a whole voice dump into many tasks (the AI-free path).
 * Same task shape as the AI parser: { title, tags, date, time, duration, … }.
 */
export function parseTranscriptToPlan(text, { now = new Date() } = {}) {
  return splitTranscript(text).flatMap((chunk) => {
    const [task] = parseTranscriptTasks(chunk, { now });
    if (!task || !task.title) return [];
    const duration = SPOKEN_DURATION_RE.test(chunk) ? task.duration : estimateDuration(task.title);
    return [{ ...task, duration }];
  });
}

// ── Scheduling ───────────────────────────────────────────────────────────────

/**
 * The fixed blocks of one day as busy intervals: before wake, after sleep, and
 * each meal. Minutes from midnight, end exclusive.
 */
export function routineBusy(routine) {
  const r = normalizeDayRoutine(routine);
  const wake = timeToMin(r.wake);
  const sleep = timeToMin(r.sleep);
  const busy = [];
  if (wake > 0) busy.push({ start: 0, end: wake, kind: 'sleep' });
  if (sleep < 24 * 60) busy.push({ start: sleep, end: 24 * 60, kind: 'sleep' });
  for (const meal of mealBlocks(r)) busy.push({ start: meal.start, end: meal.end, kind: 'meal', name: meal.name });
  return busy;
}

const taskInterval = (t) => {
  const start = timeToMin(t.startTime ?? t.time);
  if (start === null) return null;
  return { start, end: start + Math.max(5, Number(t.duration) || 30) };
};

/** First start ≥ `from` where [start, start+len) clears every busy interval (+buffer). */
function findSlot(busy, from, len, buffer) {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  let cursor = from;
  for (const b of sorted) {
    if (b.end <= cursor) continue;
    // Buffers sit between tasks, not against routine blocks.
    const gapBefore = b.kind === 'task' ? buffer : 0;
    if (cursor + len + gapBefore <= b.start) return cursor;
    const gapAfter = b.kind === 'task' ? buffer : 0;
    cursor = Math.max(cursor, b.end + gapAfter);
  }
  return cursor + len <= 24 * 60 ? cursor : null;
}

const roundUp = (min, step) => Math.ceil(min / step) * step;

/**
 * Give every parsed task without a time a slot.
 *
 * - A task the person gave a time keeps it, and blocks that time for others.
 * - A recurring task is left alone (its own series owns its times).
 * - Others go into the first free gap of their day (today when no date was
 *   said), highest priority first, then in spoken order. Today starts from
 *   now, rounded up to 5 minutes. A dateless task that does not fit today
 *   rolls to the next day with room (up to a week out); a task whose day was
 *   spoken and is full stays unplaced and lands in the inbox, flagged.
 *
 * @param {object[]} parsed  Tasks in the voice-parser shape.
 * @param {object}   opts
 * @param {object}   opts.routine       Day routine (dayRoutine.js).
 * @param {object[]} opts.existingTasks Scheduled tasks ({ date, startTime, duration, isAllDay, completed }).
 * @param {Date}     opts.now
 * @returns {object[]} Same tasks, in the original order, with `date`/`time` filled
 *   and `planned: true` on those the planner placed (`unplaced: true` when it couldn't).
 */
export function planDay(parsed, { routine, existingTasks = [], now = new Date() } = {}) {
  const r = normalizeDayRoutine(routine);
  const today = toDateStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sleepMin = timeToMin(r.sleep);
  const wakeMin = timeToMin(r.wake);
  const busyByDate = new Map();

  const busyFor = (date) => {
    if (!busyByDate.has(date)) {
      const busy = routineBusy(r);
      for (const t of existingTasks) {
        if (t.date !== date || t.isAllDay || t.completed) continue;
        const iv = taskInterval(t);
        if (iv) busy.push({ ...iv, kind: 'task' });
      }
      busyByDate.set(date, busy);
    }
    return busyByDate.get(date);
  };

  const out = parsed.map((t) => ({ ...t }));

  // Fixed-time tasks first, so floating ones route around them.
  for (const t of out) {
    if (t.recurrence || !t.time) continue;
    if (!t.date) t.date = today;
    const iv = taskInterval(t);
    if (iv) busyFor(t.date).push({ ...iv, kind: 'task' });
  }

  const floating = out
    .map((t, idx) => ({ t, idx }))
    .filter(({ t }) => !t.recurrence && !t.time)
    .sort((a, b) => (Number(b.t.priority) || 0) - (Number(a.t.priority) || 0) || a.idx - b.idx);

  const maxLen = Math.max(5, sleepMin - wakeMin);
  for (const { t } of floating) {
    const len = Math.min(maxLen, Math.max(5, Number(t.duration) || 30));
    t.duration = len;
    const spokenDate = t.date || null;
    let date = spokenDate || today;
    let placed = null;
    for (let day = 0; day < 7 && placed === null; day++) {
      if (day > 0) {
        if (spokenDate) break;
        date = addDays(today, day);
      }
      if (date < today) break;
      const from = date === today ? Math.max(wakeMin, roundUp(nowMin, 5)) : wakeMin;
      const start = findSlot(busyFor(date), from, len, r.bufferMinutes);
      if (start !== null && start + len <= sleepMin) placed = { date, start };
    }
    if (placed) {
      t.date = placed.date;
      t.time = minToTime(placed.start);
      t.planned = true;
      busyFor(placed.date).push({ start: placed.start, end: placed.start + len, kind: 'task' });
    } else {
      t.date = null;
      t.unplaced = true;
    }
  }
  return out;
}

/** The routine blocks to show beside a plan for `date` (labels + HH:MM). */
export function routineSummary(routine) {
  const r = normalizeDayRoutine(routine);
  return [
    { kind: 'wake', name: 'Wake up', time: r.wake },
    ...mealBlocks(r).map((m) => ({ kind: 'meal', name: m.name, time: minToTime(m.start), end: minToTime(m.end) })),
    { kind: 'sleep', name: 'Sleep', time: r.sleep },
  ];
}
