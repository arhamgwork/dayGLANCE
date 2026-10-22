import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PANE_KEY_STEP, clampPaneWidth, dragPaneWidth } from '../utils/paneWidth.js';

/**
 * The drag handle on a side pane's left edge (utils/paneWidth.js): drag it,
 * or focus it and press Left/Right, to resize; double-click it to go back to
 * the automatic width. `paneRef` is the pane, `rowRef` the row it shares.
 * `onResize(width)` fires as it moves, `onCommit(width | null)` when it stops.
 */
export default function PaneResizeHandle({ paneRef, rowRef, onResize, onCommit }) {
  const { t } = useTranslation();
  const dragRef = useRef(null);
  const rowWidth = () => rowRef.current?.getBoundingClientRect().width ?? Infinity;
  const paneWidth = () => paneRef.current?.getBoundingClientRect().width ?? 0;

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startWidth: paneWidth(), startX: e.clientX, width: null };
  };
  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.width = dragPaneWidth(drag, e.clientX, rowWidth());
    onResize(drag.width);
  };
  const onPointerUp = (e) => {
    const drag = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (drag?.width != null) onCommit(drag.width);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const next = clampPaneWidth(paneWidth() + (e.key === 'ArrowLeft' ? PANE_KEY_STEP : -PANE_KEY_STEP), rowWidth());
    onResize(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('planner.resizeNotes')}
      title={t('planner.resizeNotesHint')}
      tabIndex={0}
      data-pane-resize-handle
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => { onResize(null); onCommit(null); }}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -left-1.5 w-3 z-10 cursor-col-resize touch-none outline-none flex justify-center"
    >
      <div className="w-0.5 h-full transition-colors group-hover:bg-blue-500 group-focus-visible:bg-blue-500 group-active:bg-blue-500" />
    </div>
  );
}
