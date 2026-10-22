import React, { useEffect, useRef } from 'react';
import { Flag, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The Goals tab's "+" choice (#2133): add a project to the goal on screen, or
// add a goal. A bare "+" floating over a goal's project cards read as "add
// project" while it added a goal; the menu names both.
//
// It opens above the "+" and to its left (above it sits the Aspire button),
// with the project row at the bottom, nearest the "+": it is the common case,
// so it is under the thumb and takes the focus when the menu opens. Up/Down
// move between the rows, Enter picks, Escape or a tap outside closes. The
// menu stops the keys it handles, so the space's own shortcuts (Up/Down move
// the sidebar selection) never see them while it is open.
export default function GoalsAddMenu({ goalTitle, onAddProject, onAddGoal, onClose, darkMode, anchorRef }) {
  const { t } = useTranslation();
  const menuRef = useRef(null);
  const goalRef = useRef(null);
  const projectRef = useRef(null);

  // The latest onClose, so neither effect re-runs when the parent re-renders
  // with a new one: re-running the first would pull the focus back to the
  // project row from wherever the arrow keys had moved it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus the project row once, when the menu opens.
  useEffect(() => { projectRef.current?.focus(); }, []);

  useEffect(() => {
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [anchorRef]);

  const onKeyDown = (e) => {
    // Top to bottom, as drawn.
    const items = [goalRef.current, projectRef.current].filter(Boolean);
    const at = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchorRef?.current?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const step = e.key === 'ArrowUp' ? -1 : 1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'n') {
      // Enter and Space press the focused row natively; keep them (and a
      // second 'n') from reaching the space's shortcuts as well.
      e.stopPropagation();
    }
  };

  const row = `w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-lg transition-colors focus:outline-none ${
    darkMode ? 'text-gray-100 hover:bg-gray-700 focus:bg-gray-700' : 'text-stone-800 hover:bg-stone-100 focus:bg-stone-100'
  }`;

  return (
    <div
      ref={menuRef}
      role="menu"
      data-goals-add-menu
      onKeyDown={onKeyDown}
      className={`pointer-events-auto absolute bottom-0 right-16 w-64 max-w-[70vw] p-1 rounded-xl shadow-xl border ${
        darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'
      }`}
    >
      <button
        ref={goalRef}
        type="button"
        role="menuitem"
        data-add-choice="goal"
        className={row}
        onClick={() => { onClose(); onAddGoal(); }}
      >
        <Flag size={16} className="flex-shrink-0 text-amber-500" />
        <span className="truncate">{t('common.addGoal')}</span>
      </button>
      <button
        ref={projectRef}
        type="button"
        role="menuitem"
        data-add-choice="project"
        className={row}
        onClick={() => { onClose(); onAddProject(); }}
      >
        <FolderPlus size={16} className="flex-shrink-0 text-blue-500" />
        {/* A long goal name wraps to a second line rather than losing its end. */}
        <span className="line-clamp-2 break-words">{t('goals.addProjectToGoal', { goal: goalTitle })}</span>
      </button>
    </div>
  );
}
