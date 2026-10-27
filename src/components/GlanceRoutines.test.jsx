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

// The GLANCE routines row (#2234). GLANCE shows what is coming up, so a done
// routine leaves the row. When every routine scheduled today is done, the row
// used to vanish with its "+ Add", and a new user had no visible way back to
// the Routines modal. It now keeps one quiet "all done" line that opens it. A
// day with nothing scheduled keeps its own empty state, unchanged.

const TODAY = '2026-09-08';

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const routines = [
  { id: 'r1', name: 'Stretch', bucket: 'morning' },
  { id: 'r2', name: 'Journal', bucket: 'evening' },
];

async function render(surface, { todayRoutines, routineCompletions = {} }) {
  const planner = {
    currentTime: new Date(`${TODAY}T17:25:00`),
    tasks: [], unscheduledTasks: [], todayAgenda: [], recurringTasks: [],
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
    goals: [], projects: [], hgVisibleProjects: [],
    isVisibleForUser: () => true,
    routinesEnabled: true, todayRoutines, routineCompletions,
    toggleRoutineCompletion: () => {}, openRoutinesDashboard: () => {},
  };
  return renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
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

describe.each(['desktop', 'mobile'])('%s GLANCE routines row (#2234)', (surface) => {
  it('every routine done: one "all done" line that opens the routines, not an empty space', async () => {
    const html = await render(surface, { todayRoutines: routines, routineCompletions: { r1: true, r2: true } });
    expect(html).toContain('data-routines-all-done');
    expect(html).toContain('All done for today');
    // The done routines themselves stay out of GLANCE, as before.
    expect(html).not.toContain('Stretch');
    expect(html).not.toContain('Journal');
    expect(html).not.toContain('None scheduled');
  });

  it('some still to do: only those are listed, and no "all done" line', async () => {
    const html = await render(surface, { todayRoutines: routines, routineCompletions: { r1: true } });
    expect(html).toContain('Journal');
    expect(html).not.toContain('Stretch');
    expect(html).not.toContain('data-routines-all-done');
  });

  it('nothing scheduled today: the empty state, unchanged', async () => {
    const html = await render(surface, { todayRoutines: [] });
    expect(html).toContain('None scheduled');
    expect(html).not.toContain('data-routines-all-done');
  });
});
