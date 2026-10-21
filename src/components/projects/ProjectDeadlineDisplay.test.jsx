import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import ProjectCard from './ProjectCard.jsx';
import ProjectPlanner from './ProjectPlanner.jsx';

// Where a project's own deadline becomes visible: the Goals card's header
// badge and the Project Planner's header line (2026-10-21). Both read
// utils/projectDeadline.js, so the states are asserted once per surface:
// overdue red, due-soon amber, future neutral, and none/completed absent.
// Tasks keep their own deadlines; nothing here is about a task field.

const TODAY = '2026-10-21';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const noop = () => {};

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const planner = () => ({
  isMobile: false, isTablet: false, isLandscape: true, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  tasks: [], unscheduledTasks: [], recurringTasks: [],
  setTasks: noop, setUnscheduledTasks: noop, reorderUnscheduledTasks: noop,
  openMobileEditTask: noop, scheduleTaskAtNextSlot: noop, postponeTask: noop, toggleComplete: noop, formatTime: (v) => v,
  getTodayStr: () => TODAY, currentTimeMinutes: 600,
  expandedNotesTaskId: null, setExpandedNotesTaskId: noop,
  updateTaskNotes: noop, addSubtask: noop, toggleSubtask: noop, deleteSubtask: noop, updateSubtaskTitle: noop,
  longPressTriggeredRef: { current: false }, longPressTimerRef: { current: null },
  mobileActiveTab: '', showDeadlinePicker: null, setShowDeadlinePicker: noop,
  pushUndo: noop, setUndoToast: noop,
});

const features = (projects) => ({
  goals: [], projects, goalsProjectsEnabled: true,
  deleteProject: noop, updateProject: noop, moveProject: noop, setPlannerProjectId: noop,
  generateAISubtasks: noop, aiSubtasksLoadingForTask: null, aiConfig: null,
  showGoalsDashboard: false, enterHyperGlanceMode: noop, isVisibleForUser: () => true,
});

const sync = { loadWikiNote: null, saveWikiNote: null, openInObsidian: null, obsidianConfig: { enabled: false }, bridgeHeartbeatRef: { current: null } };

// Only the fields under test vary: the PROJECT is always standalone (no goal),
// active unless the case says completed, and carries the deadline under test.
const renderCard = async (project) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={planner()}>
      <FeaturesContext.Provider value={features([project])}>
        <SyncContext.Provider value={sync}>
          <ProjectCard project={project} onEditClick={noop} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const renderPlanner = async (project) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={planner()}>
      <FeaturesContext.Provider value={features([project])}>
        <SyncContext.Provider value={sync}>
          <ProjectPlanner project={project} onClose={noop} />
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const card = { id: 'p1', title: 'Roof', status: 'active', color: 'bg-blue-500' };

/** The badge's own class list, so unrelated hover: utilities cannot match. */
const badgeClass = (html) => /data-project-deadline="true"[^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';

describe('the project card\'s deadline badge', () => {
  it('shows an overdue deadline in red, naming the days overdue', async () => {
    const html = await renderCard({ ...card, deadline: '2026-10-05' });
    expect(html).toContain('data-project-deadline');
    expect(badgeClass(html)).toContain('text-red-500');
    expect(html).toMatch(/Oct\s*5/);
    expect(html).toMatch(/16d overdue/);
  });

  it('shows a due-soon deadline in amber and a far one neutrally', async () => {
    const soon = await renderCard({ ...card, deadline: '2026-10-25' });
    expect(soon).toContain('data-project-deadline');
    expect(badgeClass(soon)).toContain('text-amber-600');
    const far = await renderCard({ ...card, deadline: '2026-12-31' });
    expect(far).toContain('data-project-deadline');
    expect(badgeClass(far)).not.toContain('text-red-500');
    expect(badgeClass(far)).not.toContain('text-amber-600');
  });

  it('renders nothing without a deadline, and hides it on a completed project', async () => {
    expect(await renderCard(card)).not.toContain('data-project-deadline');
    expect(await renderCard({ ...card, status: 'completed', deadline: '2026-10-05' })).not.toContain('data-project-deadline');
  });
});

describe('the project planner\'s deadline line', () => {
  it('carries the date beside the goal/Planner subtitle, red when overdue', async () => {
    const html = await renderPlanner({ ...card, deadline: '2026-10-05' });
    expect(html).toContain('data-project-deadline');
    expect(badgeClass(html)).toContain('text-red-500');
    expect(html).toMatch(/Oct\s*5/);
    expect(html).toContain('Standalone project');
  });

  it('is absent without a deadline', async () => {
    expect(await renderPlanner(card)).not.toContain('data-project-deadline');
  });
});
