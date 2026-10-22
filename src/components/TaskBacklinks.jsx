import React from 'react';
import { CornerUpLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PEEK_TASK_EVENT } from '../utils/followUp.js';

/**
 * "Linked from" (#2145): the tasks whose notes link to this one
 * (utils/taskLinks.js findBacklinks). Each opens in the task peek, the same
 * way a link in a note does. Nothing renders without any.
 */
export default function TaskBacklinks({ backlinks, darkMode, className = '' }) {
  const { t } = useTranslation();
  if (!backlinks?.length) return null;
  const muted = darkMode ? 'text-gray-400' : 'text-stone-500';
  return (
    <div className={className} data-task-backlinks>
      <div className={`text-xs font-semibold mb-1 ${muted}`}>{t('task.backlinks')}</div>
      <ul className="space-y-0.5">
        {backlinks.map(({ task, title }) => (
          <li key={task.id}>
            <button
              type="button"
              data-task-backlink={task.id}
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent(PEEK_TASK_EVENT, { detail: { id: task.id } }));
              }}
              className={`flex items-center gap-1.5 text-sm text-left max-w-full ${darkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-700'}`}
            >
              <CornerUpLeft size={12} className="flex-shrink-0" />
              <span className={`truncate ${task.completed ? 'line-through opacity-70' : ''}`}>{title || '…'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
