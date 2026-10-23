import { useMemo, useCallback } from 'react';
import { dateToString, extractTags } from '../utils/taskUtils.js';
import { filterableTagsOf, liveInboxProjectFilter as liveProjectFilterOf, liveInboxTagFilter as liveTagFilterOf, filterInboxTasks } from '../utils/inboxFilter.js';

export default function useComputedViews({
  tasks,
  unscheduledTasks,
  recurringTasks,
  selectedDate,
  selectedTags,
  inboxPriorityFilter,
  hideCompletedInbox,
  hideProjectTasksInbox,
  hideStandaloneTasksInbox,
  inboxTagFilter,
  inboxProjectFilter,
  projects,
  goalsProjectsEnabled,
  isVisibleForUser,
}) {
  // Tasks for the currently selected date
  const todayTasks = useMemo(
    () => tasks.filter(t => t.date === dateToString(selectedDate)),
    [tasks, selectedDate]
  );

  // All unique tags from all task sources (excludes imported events)
  const allTags = useMemo(() => {
    const tagSet = new Set();
    tasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    unscheduledTasks.filter(t => !t.imported).forEach(task => {
      extractTags(task.title).forEach(tag => tagSet.add(tag));
    });
    recurringTasks.forEach(template => {
      extractTags(template.title).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Tags offered by the GLANCE tag-filter UIs (utils/inboxFilter.js). allTags
  // stays complete for the #-autocomplete and AI context, where bucket
  // vocabulary is useful.
  const filterableTags = useMemo(
    () => filterableTagsOf({ tasks, unscheduledTasks, recurringTasks }),
    [tasks, unscheduledTasks, recurringTasks],
  );

  // Incomplete scheduled tasks from today (used by rescheduling feature)
  const incompleteTodayTasks = useMemo(() => {
    const todayStr = dateToString(new Date());
    return tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample);
  }, [tasks]);

  // Filter tasks by selected tags (OR logic - show tasks matching ANY selected tag)
  // Untagged tasks are always shown — the filter only scopes tagged tasks
  const filterByTags = useCallback((taskList) => {
    return taskList.filter(task => {
      const taskTags = extractTags(task.title);
      // Imported events and untagged tasks always shown
      if (task.imported || taskTags.length === 0) return true;
      // If no tags are selected, hide tagged tasks
      if (selectedTags.length === 0) return false;
      // Show tagged tasks only if they match a selected tag
      return selectedTags.some(tag => taskTags.includes(tag));
    });
  }, [selectedTags]);

  // Saved Inbox filters minus stale selections, and the Inbox itself: one
  // filter in utils/inboxFilter.js, shared with the launcher snapshot and the
  // headless refresh so every surface counts the same tasks. The live values
  // are what the filter UIs use for their "active" state; the setters still
  // own the saved preference.
  const liveInboxProjectFilter = useMemo(
    () => liveProjectFilterOf(inboxProjectFilter, projects),
    [inboxProjectFilter, projects],
  );
  const liveInboxTagFilter = useMemo(
    () => liveTagFilterOf(inboxTagFilter, filterableTags),
    [inboxTagFilter, filterableTags],
  );
  const filteredUnscheduledTasks = useMemo(
    () => filterInboxTasks(unscheduledTasks, {
      inboxPriorityFilter, hideCompletedInbox, hideProjectTasksInbox, hideStandaloneTasksInbox,
      liveProjectFilter: liveInboxProjectFilter, liveTagFilter: liveInboxTagFilter,
      goalsProjectsEnabled, isVisibleForUser,
    }),
    [unscheduledTasks, inboxPriorityFilter, hideCompletedInbox, hideProjectTasksInbox,
     hideStandaloneTasksInbox, liveInboxTagFilter, liveInboxProjectFilter, goalsProjectsEnabled,
     isVisibleForUser]
  );

  // Today's tasks filtered by tag selection
  const filteredTodayTasks = useMemo(
    () => filterByTags(todayTasks),
    [filterByTags, todayTasks]
  );

  return {
    todayTasks,
    allTags,
    filterableTags,
    incompleteTodayTasks,
    filterByTags,
    filteredUnscheduledTasks,
    filteredTodayTasks,
    // What an "a filter is active" indicator should use: a saved selection whose
    // target no longer exists matches nothing and must not light it up.
    liveInboxTagFilter,
    liveInboxProjectFilter,
  };
}
