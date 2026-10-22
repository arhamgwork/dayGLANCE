import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { renderTitleWithoutTags } from '../utils/textFormatting.jsx';
import { extractWikilinks } from '../utils/taskUtils.js';

// One task's notes and subtasks in a side pane: its title in its colour,
// then the app's own notes panel, saving through the app's own actions and
// opening a linked vault note where the title has one. JOBO's notes sidebar
// and the Project Planner's both show a selected task this way.
// `autoFocus` false keeps the keyboard where it is (the planner moves its
// selection with the arrow keys); JOBO's sidebar focuses an empty note.
// Bumping `focusNoteRequest` puts the cursor in the note (the planner's E);
// `onNoteSaved` hears Shift+Enter save it (the planner takes the keyboard back).
//
// The title renames in place (#2132): a click turns it into a field, Enter or
// leaving it saves, Escape cancels. It goes through the app's own inline
// rename (startEditingTask / saveTaskTitle), the one a timeline card's title
// uses, so undo, the title clean-up and a recurring occurrence's series all
// behave the same. A calendar event, or a recurring template (the planner's
// Scheduled column), shows its title read-only.
export default function TaskNotesPane({ task, autoFocus = true, focusNoteRequest = 0, onNoteSaved }) {
  const {
    darkMode, textPrimary, unscheduledTasks, recurringTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    editingTaskId, editingTaskText, setEditingTaskText, startEditingTask, saveTaskTitle, cancelEditingTask,
  } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const wikilinks = extractWikilinks(task.title);
  const hasWiki = wikilinks.length > 0;
  const isInbox = (unscheduledTasks || []).some((candidate) => candidate.id === task.id);
  const isTemplate = (recurringTasks || []).some((r) => r.id === task.id);
  const canRename = !!startEditingTask && !task.imported && !isTemplate;
  const renaming = canRename && editingTaskId === task.id;
  // Enter saves and Escape cancels; the blur that follows as the field goes
  // must not save again (a second undo step) or save what was cancelled.
  const settledRef = useRef(false);
  return (
    <div data-task-notes-pane={task.id}>
      <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${textPrimary} min-w-0`}>
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} aria-hidden="true" />
        {renaming ? (
          <input
            autoFocus
            data-pane-title-input
            data-owns-escape
            aria-label={t('task.renameTask')}
            value={editingTaskText}
            onChange={(e) => setEditingTaskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); settledRef.current = true; saveTaskTitle(isInbox); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); settledRef.current = true; cancelEditingTask(); }
            }}
            onBlur={() => { if (!settledRef.current) saveTaskTitle(isInbox); }}
            className={`flex-1 min-w-0 px-1.5 py-0.5 -my-0.5 rounded border font-semibold outline-none ${
              darkMode ? 'bg-gray-700 border-gray-600 text-gray-100' : 'bg-white border-stone-300 text-stone-900'
            } focus:ring-2 focus:ring-blue-500`}
          />
        ) : canRename ? (
          <button
            type="button"
            data-pane-title
            onClick={() => { settledRef.current = false; startEditingTask(task, isInbox); }}
            title={t('task.clickToRename')}
            className="truncate text-left cursor-text min-w-0 hover:underline decoration-dotted underline-offset-2"
          >
            {renderTitleWithoutTags(task.title)}
          </button>
        ) : (
          <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
        )}
      </div>
      <div className={`${task.color || 'bg-blue-500'} rounded-lg`}>
        <NotesSubtasksPanel
          key={task.id}
          task={task}
          isInbox={isInbox}
          darkMode={darkMode}
          updateTaskNotes={updateTaskNotes}
          addSubtask={addSubtask}
          toggleSubtask={toggleSubtask}
          deleteSubtask={deleteSubtask}
          updateSubtaskTitle={updateSubtaskTitle}
          compact={false}
          noAutoFocus={!autoFocus}
          focusNoteRequest={focusNoteRequest}
          onNoteSaved={onNoteSaved}
          aiConfig={aiConfig}
          aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
          onGenerateSubtasks={generateAISubtasks}
          wikilinks={hasWiki ? wikilinks : undefined}
          onLoadWikiNote={hasWiki ? loadWikiNote : undefined}
          onSaveWikiNote={hasWiki ? saveWikiNote : undefined}
          onOpenInObsidian={hasWiki ? openInObsidian : undefined}
        />
      </div>
    </div>
  );
}
