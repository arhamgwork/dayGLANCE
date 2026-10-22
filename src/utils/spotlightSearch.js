// Spotlight search (Ctrl/Cmd+K): the pure result builder behind
// `spotlightResults` in App.jsx. Every source Spotlight searches, the field
// order it matches in, and the grouping/sort live here so a change to what
// Spotlight covers is a change to one tested module.
//
// Sources, in match order: scheduled tasks, device-calendar events, inbox
// tasks (archived ones labelled Completed), recurring templates, the recycle
// bin, and — when the caller supplies them — daily notes, then goals,
// projects and areas (#2131).
//
// Goals and projects match on their title, then their notes (`description`);
// areas on their title. Notes kept in a linked Obsidian note live in the
// vault, not the record, and are not searched (#1672). They match only those the Goals & Projects space draws a card or a filter for:
// not archived, visible to this user, and for a project, standalone or under
// a goal that is itself drawn. Selecting one opens the space on it, so a
// result with nowhere to go is left out rather than opening the space
// unfocused. They have their own group, first: they are few, and a title hit
// on a goal or project is usually what the search was for.
//
// Daily notes are opt-in via the `dailyNotes` argument on purpose. With the
// Obsidian integration enabled the app's copy of the notes is a mirror of the
// vault, bounded by the retention window, and Obsidian's own search is the
// authoritative tool for what lives there; the caller passes `null` in that
// case (issue #1672) so Spotlight never claims to search the vault.
import { dateToString, extractTags } from './taskUtils.js';
import { getProjectColor } from './colorUtils.js';

export const SPOTLIGHT_MAX_RESULTS = 50;
/** Scheduled tasks older than this many years are not searched. */
const SCHEDULED_LOOKBACK_YEARS = 2;

/** Leading markdown markers a note line may carry: headings, list bullets,
 *  quotes, and task checkboxes. Stripped for display, never for matching. */
const LEADING_MARKDOWN = /^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+\.\s+)?/;
const NOTE_TITLE_MAX = 80;

const stripLeadingMarkdown = (line) => line.replace(LEADING_MARKDOWN, '').trim();

/**
 * Title for a daily-note result: its first content line (not a heading, so a
 * note seeded from the default template reads as what the user wrote rather
 * than "Quick Notes"), falling back to the first heading, then the date.
 */
export function dailyNoteTitle(text, dateStr) {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean);
  const body = lines.find(l => !/^#{1,6}\s/.test(l));
  const raw = body ?? lines[0] ?? '';
  const title = stripLeadingMarkdown(raw);
  if (!title) return dateStr;
  return title.length > NOTE_TITLE_MAX ? title.slice(0, NOTE_TITLE_MAX - 1) + '…' : title;
}

/**
 * Search daily notes for `q` (already trimmed and lower-cased). A note that
 * matches yields one result carrying the matching line so the result row can
 * highlight the hit in context. Deleted tombstones and empty notes never match.
 *
 * @param {Record<string, {text?:string, deleted?:boolean}>|null|undefined} dailyNotes
 * @param {string} q
 * @returns {Array<object>} spotlight results with source 'dailynote'
 */
export function searchDailyNotes(dailyNotes, q) {
  const results = [];
  if (!dailyNotes || !q) return results;
  for (const [dateStr, note] of Object.entries(dailyNotes)) {
    if (!note || note.deleted) continue;
    const text = note.text || '';
    if (!text.toLowerCase().includes(q)) continue;
    const line = text.split('\n').find(l => l.toLowerCase().includes(q)) ?? '';
    results.push({
      task: { id: `dailynote-${dateStr}`, title: dailyNoteTitle(text, dateStr), color: 'bg-indigo-500', date: dateStr },
      source: 'dailynote',
      sourceLabel: 'Daily note',
      match: { field: 'dailynote', text: stripLeadingMarkdown(line) || line.trim() },
      date: dateStr,
    });
  }
  return results;
}

/**
 * Search goals, projects and areas by title (and notes) for `q` (already trimmed and
 * lower-cased). See the module comment for which ones are searchable.
 *
 * @returns {Array<object>} spotlight results with source 'goal' | 'project' | 'area'
 */
export function searchGoalsAndProjects({ goals = [], projects = [], areas = [], isVisibleForUser = () => true }, q) {
  const results = [];
  if (!q) return results;
  const drawnGoals = goals.filter(g => g.status !== 'archived' && isVisibleForUser(g));
  const goalById = new Map(drawnGoals.map(g => [g.id, g]));
  const push = (item, source, sourceLabel, color) => {
    let match = null;
    if ((item.title || '').toLowerCase().includes(q)) match = { field: 'title', text: item.title };
    else if (item.description && item.description.toLowerCase().includes(q)) match = { field: 'notes', text: item.description };
    if (!match) return;
    results.push({ task: { id: item.id, title: item.title, color }, source, sourceLabel, match, date: null });
  };
  for (const goal of drawnGoals) push(goal, 'goal', 'Goal', goal.color);
  for (const project of projects) {
    if (project.status === 'archived' || !isVisibleForUser(project)) continue;
    const goal = project.goalId ? goalById.get(project.goalId) : null;
    if (project.goalId && !goal) continue;
    push(project, 'project', 'Project', getProjectColor(project, goal));
  }
  for (const area of areas) push(area, 'area', 'Area', area.color);
  return results;
}

/**
 * Build the ranked Spotlight result list for a query.
 *
 * @param {object} args
 * @param {string} args.query                 raw input text
 * @param {Array}  args.tasks                 scheduled tasks (native-merged ones are skipped)
 * @param {Array}  [args.nativeTasks]         device-calendar events over the wide spotlight window
 * @param {Array}  [args.unscheduledTasks]    inbox tasks; `archived` ones are labelled Completed
 * @param {Array}  [args.recurringTasks]      recurring templates
 * @param {Array}  [args.recycleBin]          deleted tasks
 * @param {Record<string, object>|null} [args.dailyNotes]  date → note; null/undefined to skip notes
 * @param {Array}  [args.goals]               goals; omit (or pass []) with Goals & Projects off
 * @param {Array}  [args.projects]            projects
 * @param {Array}  [args.areas]               goal areas
 * @param {(task:object)=>boolean} [args.isVisibleForUser]  multi-user visibility gate
 * @param {Date}   [args.now]
 * @returns {Array<object>} at most SPOTLIGHT_MAX_RESULTS results
 */
export function buildSpotlightResults({
  query,
  tasks = [],
  nativeTasks = [],
  unscheduledTasks = [],
  recurringTasks = [],
  recycleBin = [],
  dailyNotes = null,
  goals = [],
  projects = [],
  areas = [],
  isVisibleForUser = () => true,
  now = new Date(),
}) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const results = [];
  const cutoff = new Date(now.getFullYear() - SCHEDULED_LOOKBACK_YEARS, now.getMonth(), now.getDate());
  const cutoffStr = dateToString(cutoff);

  const matchTask = (task, source, sourceLabel, date) => {
    // Respect multi-user visibility — don't surface other users' tasks.
    // (Native calendar events carry no assignment, so they stay visible.)
    if (!isVisibleForUser(task)) return;
    // Skip scheduled tasks older than the lookback window
    if (date && date < cutoffStr) return;
    // Check title
    if (task.title.toLowerCase().includes(q)) {
      results.push({ task, source, sourceLabel, match: { field: 'title', text: task.title }, date });
      return;
    }
    // Check tags
    const tags = extractTags(task.title);
    const matchedTag = tags.find(t => t.toLowerCase().includes(q));
    if (matchedTag) {
      results.push({ task, source, sourceLabel, match: { field: 'tag', text: '#' + matchedTag }, date });
      return;
    }
    // Check notes
    if (task.notes && task.notes.toLowerCase().includes(q)) {
      results.push({ task, source, sourceLabel, match: { field: 'notes', text: task.notes }, date });
      return;
    }
    // Check subtasks
    const matchedSub = (task.subtasks || []).find(s => s.title.toLowerCase().includes(q));
    if (matchedSub) {
      results.push({ task, source, sourceLabel, match: { field: 'subtask', text: matchedSub.title }, date });
    }
  };

  // Scheduled tasks. Native (device-calendar) events that the timeline merged into
  // `tasks` for the current ±2-day window are skipped here — they're searched via
  // the wider nativeTasks set below so they aren't listed twice.
  for (const task of tasks) {
    if (task._native) continue;
    matchTask(task, 'scheduled', 'Scheduled', task.date);
  }
  // Native calendar events fetched over the wider spotlight window
  for (const task of nativeTasks) {
    matchTask(task, 'event', 'Calendar', task.date);
  }
  // Inbox tasks (archived get their own source/label)
  for (const task of unscheduledTasks) {
    if (task.archived) {
      matchTask(task, 'archived', 'Completed', task.deadline || null);
    } else {
      matchTask(task, 'inbox', 'Inbox', task.deadline || null);
    }
  }
  // Recurring templates
  for (const template of recurringTasks) {
    matchTask(template, 'recurring', 'Recurring', template.startDate || null);
  }
  // Recycle bin
  for (const task of recycleBin) {
    matchTask(task, 'deleted', 'Deleted', task.date || null);
  }
  // Daily notes (only when the caller opted in — see module comment)
  results.push(...searchDailyNotes(dailyNotes, q));
  // Goals, projects and areas (their own group, first)
  results.push(...searchGoalsAndProjects({ goals, projects, areas, isVisibleForUser }, q));

  // Assign a time-based group to each result
  const todayStr = dateToString(now);
  const weekEndDate = new Date(now);
  weekEndDate.setDate(weekEndDate.getDate() + 7);
  const weekEndStr = dateToString(weekEndDate);
  const groupOrder = { goals: -1, today: 0, thisweek: 1, future: 2, nodate: 3, past: 4, deleted: 5, archived: 6 };
  const getGroup = (r) => {
    if (r.source === 'goal' || r.source === 'project' || r.source === 'area') return 'goals';
    if (r.source === 'deleted') return 'deleted';
    if (r.source === 'archived') return 'archived';
    const d = r.date;
    if (!d) return 'nodate';
    if (d < todayStr) return 'past';
    if (d === todayStr) return 'today';
    if (d <= weekEndStr) return 'thisweek';
    return 'future';
  };
  results.forEach(r => { r.group = getGroup(r); });

  // Sort: by group, then title match, then source priority, then date
  const sourcePriority = { goal: 0, project: 1, area: 2, scheduled: 0, event: 1, inbox: 2, recurring: 3, deleted: 4, archived: 5, dailynote: 6 };
  results.sort((a, b) => {
    const gA = groupOrder[a.group] ?? 6;
    const gB = groupOrder[b.group] ?? 6;
    if (gA !== gB) return gA - gB;
    const aTitle = a.match.field === 'title' ? 0 : 1;
    const bTitle = b.match.field === 'title' ? 0 : 1;
    if (aTitle !== bTitle) return aTitle - bTitle;
    const aPri = sourcePriority[a.source] ?? 4;
    const bPri = sourcePriority[b.source] ?? 4;
    if (aPri !== bPri) return aPri - bPri;
    // Past: most recent first; everything else: soonest first
    if (a.group === 'past') return (b.date || '').localeCompare(a.date || '');
    return (a.date || '').localeCompare(b.date || '');
  });

  return results.slice(0, SPOTLIGHT_MAX_RESULTS);
}
