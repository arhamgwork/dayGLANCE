// Double-click a timeline card to open its editor (DAY and MULTI). The card
// also drags (native HTML5 drag), resizes from its bottom handle, and holds
// controls and, when expanded, its notes; a double-click on any of those is
// theirs, not the card's. A drag never ends in a double-click: the browser
// cancels the click once a drag starts, so the two gestures cannot collide.
//
// The title keeps its own double-click, an inline rename, which stops the
// event before it reaches the card.

/** What a double-click inside a card leaves alone. */
const OWN_GESTURE = 'button, a, input, textarea, select, label, [contenteditable="true"], [role="button"], [data-no-card-dblclick]';

/**
 * Whether a double-click on `target` inside `card` should open the editor:
 * not on a control, the resize handle, or the expanded notes (where a
 * double-click selects a word).
 */
export function opensEditorOnDoubleClick(target, card) {
  for (let el = target; el && el !== card; el = el.parentElement) {
    if (el.matches?.(OWN_GESTURE)) return false;
    if (el.classList?.contains('notes-panel-container')) return false;
  }
  return !!target && !!card;
}

/**
 * The card's onDoubleClick, or undefined where there is nothing to open: a
 * calendar event (read-only here, as the menu's Edit is) or a touch tablet,
 * where a double-tap is not this gesture.
 */
export function cardDoubleClickHandler({ task, isImported, isTablet, open }) {
  if (isTablet || isImported || !task) return undefined;
  return (e) => {
    if (!opensEditorOnDoubleClick(e.target, e.currentTarget)) return;
    e.stopPropagation();
    open(task);
  };
}
