import { useCallback } from 'react';
import { collectTags, renameInTagList, rewriteTagInList } from '../utils/tagManager.js';

/**
 * The tag manager's one write (#2136): rename tag `from` to `to`, merging it
 * when `to` is already in use, or remove it when `to` is null, across every
 * title the manager may rewrite (utils/tagManager.js). One undo step covers
 * it all, and the toast offers it.
 *
 * Besides titles it carries the tag's other homes along: each Frame's tag
 * affinity (stamped, so the change syncs), the GLANCE and Inbox tag filters,
 * and this device's follow-up tag, so none is left naming a tag that has gone.
 *
 * Deps object, as the app's other action hooks take one.
 */
export default function useTagManager({
  tasks, unscheduledTasks, recurringTasks,
  setTasks, setUnscheduledTasks, setRecurringTasks, setGtdFrames,
  setSelectedTags, setInboxTagFilter, followUpTag, setFollowUpTag,
  pushUndo, setUndoToast,
}) {
  const applyTagEdit = useCallback((from, to) => {
    if (!from || (to && to.toLowerCase() === from.toLowerCase())) return;
    const tags = collectTags({ tasks, unscheduledTasks, recurringTasks });
    const entry = tags.find(t => t.tag === from.toLowerCase());
    const merging = !!to && tags.some(t => t.tag === to.toLowerCase());
    const key = !to ? 'tagRemoved' : merging ? 'tagMerged' : 'tagRenamed';
    const said = pushUndo({ key, title: '', from, to: to || '', count: entry?.count ?? 0 });

    setTasks(prev => rewriteTagInList(prev, from, to));
    setUnscheduledTasks(prev => rewriteTagInList(prev, from, to));
    setRecurringTasks(prev => rewriteTagInList(prev, from, to, { recurring: true }));
    if (setGtdFrames) {
      const stamp = new Date().toISOString();
      setGtdFrames(prev => {
        if (!Array.isArray(prev)) return prev;
        let changed = false;
        const next = prev.map(frame => {
          const affinity = renameInTagList(frame.tagAffinity, from, to);
          if (!affinity) return frame;
          changed = true;
          return { ...frame, tagAffinity: affinity, lastModified: stamp };
        });
        return changed ? next : prev;
      });
    }
    setSelectedTags?.(prev => renameInTagList(prev, from, to) ?? prev);
    setInboxTagFilter?.(prev => renameInTagList(prev, from, to) ?? prev);
    if (followUpTag && followUpTag.toLowerCase() === from.toLowerCase()) setFollowUpTag?.(to || '');

    if (said) setUndoToast({ message: said, actionable: true });
  }, [tasks, unscheduledTasks, recurringTasks, setTasks, setUnscheduledTasks, setRecurringTasks, setGtdFrames,
    setSelectedTags, setInboxTagFilter, followUpTag, setFollowUpTag, pushUndo, setUndoToast]);

  return { applyTagEdit };
}
