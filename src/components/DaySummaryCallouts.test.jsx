import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create } from 'react-test-renderer';
import { loaders } from '../locales.js';
import DaySummaryCallouts from './DaySummaryCallouts.jsx';
import useStats from '../hooks/useStats.js';
import { dateToString } from '../utils/taskUtils.js';

// The day summary sheet's callouts, shared by desktop and mobile, and the
// project target date (#2160) joining the "due today" rows.

async function render(props) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><DaySummaryCallouts {...props} /></I18nextProvider>);
}

describe('DaySummaryCallouts', () => {
  it('lists goals and projects due today, then what was completed', async () => {
    const html = await render({
      dueGoals: [{ id: 'g1', title: 'Ship the beta' }],
      dueProjects: [{ id: 'p1', title: 'Roof' }],
      completedGoals: [{ id: 'g2', title: 'Run a 10k' }],
      completedProjects: [{ id: 'p2', title: 'Garden' }],
    });
    expect(html).toContain('Goal due today: Ship the beta');
    expect(html).toContain('Project due today: Roof');
    expect(html).toContain('Goal complete: Run a 10k');
    expect(html).toContain('Project complete: Garden');
    expect(html.indexOf('Ship the beta')).toBeLessThan(html.indexOf('Roof'));
    expect(html.indexOf('Roof')).toBeLessThan(html.indexOf('Run a 10k'));
  });

  it('renders nothing when there is nothing to call out', async () => {
    expect(await render({})).toBe('');
  });
});

describe('useStats todayDueProjects', () => {
  it('is the active projects this user can see whose target date is today', () => {
    const today = dateToString(new Date());
    const projects = [
      { id: 'a', title: 'Due', status: 'active', targetDate: today },
      { id: 'b', title: 'Later', status: 'active', targetDate: '2999-01-01' },
      { id: 'c', title: 'Done', status: 'completed', targetDate: today },
      { id: 'd', title: 'Hidden', status: 'active', targetDate: today, hidden: true },
    ];
    let stats;
    const Probe = () => {
      stats = useStats({ tasks: [], unscheduledTasks: [], recurringTasks: [], goals: [], projects, isVisibleForUser: (p) => !p.hidden });
      return null;
    };
    act(() => { create(<Probe />); });
    expect(stats.todayDueProjects.map((p) => p.id)).toEqual(['a']);
  });
});
