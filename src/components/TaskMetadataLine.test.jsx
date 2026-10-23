import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskMetadataLine from './TaskMetadataLine.jsx';

// The editor's "Created … · Completed …" line (#2135), over the real en bundle.

async function render(task, ctx = {}) {
  const bundle = await loaders.en();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <DayPlannerContext.Provider value={{ recurringTasks: [], formatTime: (s) => s, textSecondary: '', ...ctx }}>
        <TaskMetadataLine task={task} />
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
}

describe('TaskMetadataLine', () => {
  it('shows when a completed task was created and completed', async () => {
    const html = await render({ id: 't', createdAt: '2026-10-19T09:14:00Z', completed: true, completedAt: '2026-10-21T16:02:00Z' });
    expect(html).toContain('Created Oct 19');
    expect(html).toContain('09:14');
    expect(html).toContain('Completed Oct 21');
    expect(html).toContain('16:02');
  });

  it('leaves out what is not known rather than saying "Unknown"', async () => {
    const html = await render({ id: 't', completed: true, completedAt: '2026-10-21T16:02:00Z' });
    expect(html).not.toContain('Created');
    expect(html).not.toMatch(/unknown/i);
    expect(html).toContain('Completed Oct 21');
  });

  it('renders nothing for a task from before creation times, still open', async () => {
    expect(await render({ id: 't', completed: false })).toBe('');
  });

  it('reads an occurrence\'s completion from its series', async () => {
    const recurringTasks = [{ id: 'r1', createdAt: '2026-10-01T06:00:00Z', completedDatesTimestamps: { '2026-10-22': '2026-10-22T08:05:00Z' } }];
    const html = await render(
      { id: 'recurring-r1-2026-10-22', isRecurring: true, recurringTemplateId: 'r1', date: '2026-10-22', completed: true },
      { recurringTasks },
    );
    expect(html).toContain('Created Oct 1');
    expect(html).toContain('Completed Oct 22');
  });
});
