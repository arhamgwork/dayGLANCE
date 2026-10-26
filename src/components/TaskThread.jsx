import React from 'react';
import { Check, Circle, CircleDot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PEEK_TASK_EVENT } from '../utils/followUp.js';
import { formatShortDate } from '../utils/taskUtils.js';
import TaskBacklinks from './TaskBacklinks.jsx';

const civil = (date) => new Date(`${date}T12:00:00`);

/** The fewest tasks a thread lists; below it the link and "Linked from" say it all. */
export const THREAD_MIN = 3;

/**
 * The tasks linked to this one, directly or through each other
 * (utils/taskLinks.js taskThread), as one dated list. Each opens in the task
 * peek, the same way a link in a note does. A thread of two is only a link
 * and its backlink, so then this is the "Linked from" list as before.
 */
export default function TaskThread({ thread, backlinks, darkMode, className = '' }) {
  const { t } = useTranslation();
  if (!thread || thread.items.length < THREAD_MIN) {
    return <TaskBacklinks backlinks={backlinks} darkMode={darkMode} className={className} />;
  }
  const muted = darkMode ? 'text-gray-400' : 'text-stone-500';
  const link = darkMode ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-700';
  const when = (item) => (!item.task ? t('task.threadGone')
    : item.where === 'deleted' ? t('task.threadDeleted')
      : item.date ? formatShortDate(civil(item.date)) : t('task.threadInbox'));
  return (
    <div className={className} data-task-thread>
      <div className={`text-xs font-semibold mb-1 ${muted}`}>
        {t('task.thread')}
        {thread.open > 0 && <span className="font-normal"> · {t('task.threadOpen', { count: thread.open })}</span>}
      </div>
      <ul className="space-y-0.5">
        {thread.items.map((item) => {
          const done = !!item.task?.completed;
          const faded = !item.task || item.where === 'deleted';
          const Glyph = item.isSelf ? CircleDot : done ? Check : Circle;
          const body = (
            <>
              <Glyph size={12} className="flex-shrink-0" />
              <span className={`flex-1 min-w-0 truncate ${done ? 'line-through opacity-70' : ''}`}>{item.title || '…'}</span>
              <span className={`flex-shrink-0 text-xs ${muted}`}>{when(item)}</span>
            </>
          );
          const row = 'flex items-center gap-1.5 text-sm text-left w-full';
          return (
            <li key={item.id} className={faded ? 'opacity-60' : ''}>
              {item.isSelf || !item.task ? (
                <div data-task-thread-item={item.id} aria-current={item.isSelf ? 'true' : undefined}
                  className={`${row} ${item.isSelf ? 'font-semibold' : muted}`}>
                  {body}
                </div>
              ) : (
                <button
                  type="button"
                  data-task-thread-item={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    window.dispatchEvent(new CustomEvent(PEEK_TASK_EVENT, { detail: { id: item.id } }));
                  }}
                  className={`${row} ${link}`}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {thread.more > 0 && <div className={`text-xs mt-1 ${muted}`}>{t('task.threadMore', { count: thread.more })}</div>}
    </div>
  );
}
