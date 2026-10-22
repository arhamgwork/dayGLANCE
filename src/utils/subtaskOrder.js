// Reordering a task's subtasks (#2176). Pure.
//
// The order is the array's: `task.subtasks` is rendered as stored, and both
// sync tiers carry it whole with the task, so a reorder is an ordinary edit
// of the task (stamped, synced, undone like any other) with no new field.

/**
 * `subtasks` with `subtaskId` moved to position `toIndex` (clamped to the
 * list), the rest keeping their order. The same array back when nothing
 * moves, so a no-op drop changes nothing and stamps nothing.
 */
export function moveSubtaskTo(subtasks, subtaskId, toIndex) {
  if (!Array.isArray(subtasks)) return subtasks;
  const from = subtasks.findIndex(st => st && st.id === subtaskId);
  if (from === -1) return subtasks;
  const to = Math.max(0, Math.min(subtasks.length - 1, Math.trunc(Number(toIndex) || 0)));
  if (to === from) return subtasks;
  const next = subtasks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Where a subtask dropped over row `overIndex` lands. Dropping on the top half
 * of a row puts it above that row, on the bottom half below it; positions are
 * in the list as it stands before the move.
 */
export function dropIndex(fromIndex, overIndex, lowerHalf) {
  const slot = overIndex + (lowerHalf ? 1 : 0);
  return slot > fromIndex ? slot - 1 : slot;
}
