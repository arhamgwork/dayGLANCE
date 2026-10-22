// A side pane the user can drag wider or narrower (the Project Planner's notes
// sidebar, #2132), remembered on this device. Pure: the planner owns the drag.
//
// The width is the pane's, in CSS pixels. Null means the automatic width the
// layout gives it (the planner's flex share); a stored width replaces that
// until the handle's double-click resets it.

export const PANE_MIN = 320;
export const PANE_MAX = 1024;
/** What the pane must leave the rest of the row (the planner's task lists). */
export const PANE_OTHER_MIN = 360;
/** One arrow-key press on the handle. */
export const PANE_KEY_STEP = 32;

/**
 * `width` held to the pane's bounds and, given the row's width, to what
 * leaves the other side PANE_OTHER_MIN. The minimum wins a row too narrow
 * for both.
 */
export function clampPaneWidth(width, rowWidth = Infinity) {
  if (!Number.isFinite(width)) return null;
  const roomy = Number.isFinite(rowWidth) ? rowWidth - PANE_OTHER_MIN : PANE_MAX;
  return Math.round(Math.max(PANE_MIN, Math.min(width, PANE_MAX, roomy)));
}

/** The stored width under `key`, or null for automatic (or unreadable). */
export function readPaneWidth(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? clampPaneWidth(n) : null;
  } catch { return null; }
}

/** Store `width` under `key`; null clears it (back to automatic). */
export function writePaneWidth(key, width) {
  try {
    if (width == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(Math.round(width)));
  } catch { /* not remembered */ }
}

/**
 * The pane's new width while its LEFT edge is dragged: moving the pointer
 * left widens it. `start` is the width and pointer x when the drag began.
 */
export function dragPaneWidth({ startWidth, startX }, clientX, rowWidth) {
  return clampPaneWidth(startWidth + (startX - clientX), rowWidth);
}
