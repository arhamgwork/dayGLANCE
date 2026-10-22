import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { taskMoments, formatStamp } from '../utils/taskMetadata.js';

// When the task being edited was created and completed (#2135), in one quiet
// line under the editor's fields: "Created Oct 19, 9:14 AM · Completed Oct 21,
// 4:02 PM".
//
// A part that is not known is left out rather than shown as "Unknown": tasks
// from before `createdAt` existed have none (it is never backfilled, see
// utils/createdAt.js), and an "Unknown" on most of a user's tasks would be noise.
// With neither known, the line is not rendered at all.
export default function TaskMetadataLine({ task }) {
  const { t, i18n } = useTranslation();
  const { recurringTasks = [], formatTime, textSecondary = '' } = useDayPlannerCtx() || {};
  if (!task) return null;
  const { createdAt, completedAt } = taskMoments(task, { recurringTasks });
  const language = i18n.resolvedLanguage || i18n.language;
  const created = formatStamp(createdAt, { formatTime, language });
  const completed = formatStamp(completedAt, { formatTime, language });
  if (!created && !completed) return null;
  return (
    <div data-task-metadata className={`text-xs ${textSecondary} flex flex-wrap gap-x-2 gap-y-0.5`}>
      {created && <span>{t('task.createdOn', { when: created })}</span>}
      {created && completed && <span aria-hidden="true" className="opacity-50">·</span>}
      {completed && <span>{t('task.completedOn', { when: completed })}</span>}
    </div>
  );
}
