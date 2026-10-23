import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { loaders } from '../locales.js';
import GlanceSidebar from './GlanceSidebar.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';

// The GLANCE "due today" card, desktop and mobile (2026-10-21): a project's
// own target date sits beside the goals whose target date is today, with the
// same row — progress plus done/total project tasks. Active and visible-to-
// this-user projects only, exactly like the goal carousel's own filter
// (#2160 review): a project shared with another user, or one due tomorrow,
// does not belong on this card.

const TODAY = '2026-09-08';
const NOOP = () => {};

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const task = (id, projectId, completed) => ({
  id, title: id, projectId, completed, duration: 30,
  date: TODAY, _agendaType: 'scheduled', startTime: '09:00',
});

const goal = { id: 'g1', title: 'Ship the beta', status: 'active', targetDate: TODAY, color: 'bg-blue-500' };
const project = {
  id: 'p1', title: 'Roof', status: 'active', targetDate: TODAY, color: 'bg-blue-500',
};
const hiddenProject = { ...project, id: 'p-hidden', title: 'Someone else\'s project', assignedUserSyncIds: ['other'] };
const tomorrowProject = { ...project, id: 'p-tomorrow', title: 'Next week project', targetDate: '2026-09-09' };
const doneProject = { ...project, id: 'p-done', title: 'Finished project', status: 'completed' };
const archivedProject = { ...project, id: 'p-archived', title: 'Archived project', status: 'archived' };

const goalTasks = [
  { ...task('g-t1', 'gp1', true) },
  { ...task('g-t2', 'gp1', false) },
];
const goalProjects = [{ id: 'gp1', title: 'Goal project', status: 'active', goalId: 'g1' }];
const projectTasks = [task('p-t1', 'p1', true), task('p-t2', 'p1', false)];

function renderGlance(surface, extraProjects = []) {
  const planner = {
    currentTime: new Date(`${TODAY}T17:25:00`),
    tasks: projectTasks, unscheduledTasks: goalTasks, todayAgenda: [], recurringTasks: [],
    filterableTags: [], selectedTags: [], minimizedSections: {},
    agendaNowMarker: { insideTask: false, insertAfterIndex: 0, nowTimeStr: '17:25' },
    glanceAhead: { dayLabel: 'Wednesday', committedMinutes: 0, isEmpty: true, taskCount: 0, eventCount: 0, deadlineCount: 0 },
    getTodayStr: () => TODAY,
    getOverdueTasks: () => [],
    filterByTags: (tasks) => tasks,
    formatTime: (time) => time,
    timeToMinutes: (time) => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    },
    darkMode: false,
    textPrimary: 'text-stone-900', textSecondary: 'text-stone-500',
    cardBg: 'bg-white', borderClass: 'border-stone-200', hoverBg: 'hover:bg-stone-100',
  };
  const features = {
    aiConfig: { features: {} },
    myFrames: [],
    getFrameInstancesForDate: () => [],
    goals: [goal],
    projects: [project, hiddenProject, tomorrowProject, doneProject, archivedProject, ...goalProjects, ...extraProjects],
    hgVisibleProjects: [],
    goalsProjectsEnabled: true,
    // The hidden project is the one this user cannot see; everything else is.
    isVisibleForUser: (entity) => !(entity.assignedUserSyncIds ?? []).includes('other'),
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18nextInstance}>
      <DayPlannerContext.Provider value={planner}>
        <FeaturesContext.Provider value={features}>
          <SyncContext.Provider value={{}}>
            {surface === 'mobile' ? <MobileGlanceSection /> : <GlanceSidebar variant="desktop" />}
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

let i18nextInstance;
const render = async (surface, extraProjects) => {
  i18nextInstance = await i18n();
  return renderGlance(surface, extraProjects);
};

/** One due-today row's markup, by kind, in DOM order. */
const rows = (html, kind) => html.split(`data-due-today-kind="${kind}"`).slice(1);

describe.each(['desktop', 'mobile'])('%s GLANCE due-today card', (surface) => {
  it('lists a project whose target date is today beside the due-today goals', async () => {
    const html = await render(surface);
    expect(rows(html, 'goal')).toHaveLength(1);
    expect(rows(html, 'project')).toHaveLength(1);
    expect(html).toContain('Roof');
    expect(html).toContain('Ship the beta');
  });

  it('carries the same row as a goal: progress plus done/total project tasks', async () => {
    const html = await render(surface);
    const [row] = rows(html, 'project');
    expect(row).toContain('50%');
    expect(row).toContain('1/2');
    expect(row).toContain('Due today');
  });

  it('leaves out projects that are not due today, not active, or not visible to this user', async () => {
    const html = await render(surface);
    expect(html).not.toContain('Next week project');
    expect(html).not.toContain('Finished project');
    expect(html).not.toContain('Archived project');
    expect(html).not.toContain('Someone else\'s project');
  });

  it('draws no progress bar for a project with nothing to measure, rather than a red 0%', async () => {
    const empty = { ...project, id: 'p-empty', title: 'Empty project' };
    const html = await render(surface, [empty]);
    const row = rows(html, 'project').find((r) => r.includes('Empty project'));
    expect(row).toBeDefined();
    expect(row).not.toContain('%');
    expect(row).not.toContain('#ef4444');
  });
});
