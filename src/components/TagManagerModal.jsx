import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Hash, Pencil, Repeat, Search, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { collectTags, normalizeTagInput } from '../utils/tagManager.js';
import { PEEK_TASK_EVENT, plainTitle } from '../utils/followUp.js';
import { formatShortDate } from '../utils/taskUtils.js';
import useBackClose from '../hooks/useBackClose.js';

/**
 * The tag manager (#2136): every tag in use, how many tasks carry it, and
 * the tasks themselves; rename (merging into a tag already in use), or
 * remove, across all of them at once (hooks/useTagManager.js applies it,
 * one undo step). Tasks open in the task peek. Titles dayGLANCE does not own
 * (Todoist's) are counted apart and left as they are (utils/tagManager.js).
 */
export default function TagManagerModal({ tasks, unscheduledTasks, recurringTasks, onApply, onClose, darkMode }) {
  const { t } = useTranslation();
  const tags = useMemo(() => collectTags({ tasks, unscheduledTasks, recurringTasks }), [tasks, unscheduledTasks, recurringTasks]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);        // tag whose tasks are listed
  const [editing, setEditing] = useState(null);  // { tag, mode: 'rename' | 'remove', value }

  // Escape steps back out of an edit, then closes. Capture phase, so the
  // app's own Escape handlers never see it while this is up.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (editing) setEditing(null); else onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [editing, onClose]);
  useBackClose({ key: 'dgTagManager', onClose });

  const q = query.trim().replace(/^#/, '').toLowerCase();
  const shown = q ? tags.filter(entry => entry.tag.includes(q)) : tags;

  const panel = darkMode ? 'bg-gray-800 text-gray-100 border-gray-700' : 'bg-white text-stone-900 border-stone-200';
  const muted = darkMode ? 'text-gray-400' : 'text-stone-500';
  const field = `px-2.5 py-1.5 text-sm rounded-lg border outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-stone-300 text-stone-900'}`;
  const iconBtn = `p-1.5 rounded-lg transition-colors ${darkMode ? 'text-gray-400 hover:text-gray-100 hover:bg-gray-700' : 'text-stone-400 hover:text-stone-700 hover:bg-stone-100'}`;
  const where = ({ task, where: w }) => (w === 'recurring' ? t('tagManager.whereRecurring')
    : task.date ? formatShortDate(new Date(`${task.date}T12:00:00`)) : t('settings.inbox'));

  const commit = (entry) => {
    if (!editing) return;
    if (editing.mode === 'remove') { onApply(entry.tag, null); setEditing(null); return; }
    const to = normalizeTagInput(editing.value);
    if (!to || to === entry.tag) return;
    onApply(entry.tag, to);
    setEditing(null);
    setOpen(null);
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-black/40" onClick={onClose} data-tag-manager>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('tagManager.title')}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border shadow-2xl ${panel}`}
      >
        <div className="flex items-start gap-2 px-4 pt-4 pb-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold flex items-center gap-1.5"><Hash size={16} />{t('tagManager.title')}</h2>
            <p className={`text-xs mt-0.5 ${muted}`}>{t('tagManager.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className={iconBtn}><X size={16} /></button>
        </div>
        {tags.length > 0 && (
          <div className="px-4 pb-2">
            <div className="relative">
              <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${muted}`} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('tagManager.search')}
                aria-label={t('tagManager.search')} className={`${field} w-full pl-8`} data-tag-search />
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
          {tags.length === 0 ? (
            <p className={`px-2 py-6 text-sm text-center ${muted}`}>{t('tagManager.empty')}</p>
          ) : shown.length === 0 ? (
            <p className={`px-2 py-6 text-sm text-center ${muted}`}>{t('tagManager.noMatch')}</p>
          ) : shown.map((entry) => {
            const isOpen = open === entry.tag;
            const edit = editing?.tag === entry.tag ? editing : null;
            const target = edit?.mode === 'rename' ? normalizeTagInput(edit.value) : '';
            const merging = !!target && target !== entry.tag && tags.some(other => other.tag === target);
            const invalid = edit?.mode === 'rename' && edit.value.trim() !== '' && !target;
            return (
              <div key={entry.tag} data-tag-row={entry.tag} className={`rounded-lg ${isOpen || edit ? (darkMode ? 'bg-gray-700/40' : 'bg-stone-50') : ''}`}>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <button type="button" onClick={() => setOpen(isOpen ? null : entry.tag)} aria-expanded={isOpen}
                    aria-label={isOpen ? t('tagManager.hideTasks') : t('tagManager.showTasks')}
                    className={`flex-1 min-w-0 flex items-center gap-1.5 text-left text-sm`}>
                    {isOpen ? <ChevronDown size={14} className={muted} /> : <ChevronRight size={14} className={muted} />}
                    <span className="font-medium truncate">#{entry.tag}</span>
                    <span className={`text-xs tabular-nums ${muted}`}>{t('tagManager.taskCount', { count: entry.count + entry.locked })}</span>
                  </button>
                  {entry.count > 0 && (
                    <>
                      <button type="button" className={iconBtn} title={t('tagManager.rename')} aria-label={t('tagManager.rename')} data-tag-rename={entry.tag}
                        onClick={() => setEditing({ tag: entry.tag, mode: 'rename', value: entry.tag })}><Pencil size={14} /></button>
                      <button type="button" className={iconBtn} title={t('tagManager.remove')} aria-label={t('tagManager.remove')} data-tag-remove={entry.tag}
                        onClick={() => setEditing({ tag: entry.tag, mode: 'remove' })}><Trash2 size={14} /></button>
                    </>
                  )}
                </div>
                {edit?.mode === 'rename' && (
                  <form className="px-2 pb-2 flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); commit(entry); }}>
                    <div className="flex items-center gap-2">
                      <span className={muted}>#</span>
                      <input autoFocus value={edit.value} onChange={(e) => setEditing({ ...edit, value: e.target.value })}
                        aria-label={t('tagManager.newName')} className={`${field} flex-1 min-w-0`} data-tag-rename-input />
                      <button type="submit" disabled={!target || target === entry.tag} data-tag-rename-save
                        className="px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white disabled:opacity-40">
                        {merging ? t('tagManager.merge') : t('tagManager.rename')}
                      </button>
                      <button type="button" onClick={() => setEditing(null)} className={`px-2 py-1.5 text-sm rounded-lg ${muted}`}>{t('common.cancel')}</button>
                    </div>
                    {merging && <p className={`text-xs ${muted}`} data-tag-merge-hint>{t('tagManager.mergeHint', { to: target })}</p>}
                    {invalid && <p className="text-xs text-red-500">{t('tagManager.invalid')}</p>}
                  </form>
                )}
                {edit?.mode === 'remove' && (
                  <div className="px-2 pb-2 flex items-center gap-2 flex-wrap">
                    <span className="text-sm flex-1 min-w-0">{t('tagManager.removeConfirm', { tag: entry.tag, count: entry.count })}</span>
                    <button type="button" onClick={() => commit(entry)} data-tag-remove-confirm
                      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white">{t('tagManager.remove')}</button>
                    <button type="button" onClick={() => setEditing(null)} className={`px-2 py-1.5 text-sm rounded-lg ${muted}`}>{t('common.cancel')}</button>
                  </div>
                )}
                {entry.locked > 0 && (isOpen || edit) && (
                  <p className={`px-2 pb-1 text-xs ${muted}`} data-tag-locked>{t('tagManager.locked', { count: entry.locked })}</p>
                )}
                {isOpen && (
                  <ul className="px-2 pb-2 space-y-0.5" data-tag-tasks={entry.tag}>
                    {entry.tasks.map((item) => (
                      <li key={`${item.where}:${item.task.id}`} className="flex items-center gap-2 text-sm">
                        {item.where === 'recurring' ? (
                          // A series has no single task to peek: shown, not linked.
                          <span className="flex-1 min-w-0 truncate flex items-center gap-1"><Repeat size={12} className={muted} />{plainTitle(item.task.title)}</span>
                        ) : (
                          <button type="button" className="flex-1 min-w-0 truncate text-left text-blue-500 hover:text-blue-400"
                            onClick={() => window.dispatchEvent(new CustomEvent(PEEK_TASK_EVENT, { detail: { id: item.task.id } }))}>
                            <span className={item.task.completed ? 'line-through opacity-70' : ''}>{plainTitle(item.task.title)}</span>
                          </button>
                        )}
                        <span className={`text-xs flex-shrink-0 ${muted}`}>{where(item)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
