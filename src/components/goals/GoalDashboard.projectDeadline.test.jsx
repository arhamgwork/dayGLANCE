import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import { ProjectForm } from './GoalDashboard.jsx';

// The project form's deadline field (2026-10-21): a project carries its own due
// date, independent of its tasks' deadlines. The form must show it, save it,
// and clear it — the save rides the existing addProject/updateProject spread,
// so this pins the fields the form hands over rather than the merge itself.

const planner = {
  tasks: [], unscheduledTasks: [], isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
};

async function enI18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const wrap = (i18n, children, { projects = [], goals = [] } = {}) => (
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={planner}>
      <FeaturesContext.Provider value={{ multiUserEnabled: false, users: [], goals, projects }}>
        <SyncContext.Provider value={{ obsidianConfig: { enabled: false } }}>
          {children}
        </SyncContext.Provider>
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>
);

const project = { id: 'p1', title: 'Roof', status: 'active', deadline: '2026-11-01' };

async function renderForm(props, ctx) {
  const root = { current: null };
  await act(async () => {
    root.current = create(wrap(await enI18n(), <ProjectForm {...props} />, ctx));
  });
  return root.current.root;
}

const dateInput = (root) => root.findAll((node) => node.type === 'input' && node.props.type === 'date')[0];
const titleInput = (root) => root.findAll((node) => node.type === 'input' && node.props.type !== 'date')[0];
const buttonText = (node) => (node.children || []).filter((child) => typeof child === 'string').join('');
const clearButtons = (root) => root.findAll((node) => node.type === 'button' && buttonText(node) === 'Clear');

describe('ProjectForm deadline', () => {
  it('prefills an existing project\'s deadline and offers Clear only when one is set', async () => {
    const root = await renderForm({ initial: project, goals: [], onSave: vi.fn(), onCancel: vi.fn() }, { projects: [project] });
    expect(dateInput(root).props.value).toBe('2026-11-01');
    expect(clearButtons(root)).toHaveLength(1);
    await act(async () => { clearButtons(root)[0].props.onClick(); });
    expect(dateInput(root).props.value).toBe('');
    expect(clearButtons(root)).toHaveLength(0);
  });

  it('renders empty with no Clear for a new project', async () => {
    const root = await renderForm({ initial: null, goals: [], onSave: vi.fn(), onCancel: vi.fn() });
    expect(dateInput(root).props.value).toBe('');
    expect(clearButtons(root)).toHaveLength(0);
  });

  it('hands the chosen date to onSave with the rest of the project fields', async () => {
    const onSave = vi.fn();
    const root = await renderForm({ initial: null, goals: [], onSave, onCancel: vi.fn() });
    await act(async () => { titleInput(root).props.onChange({ target: { value: 'Roof' } }); });
    await act(async () => { dateInput(root).props.onChange({ target: { value: '2026-12-01' } }); });
    await act(async () => { root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ title: 'Roof', deadline: '2026-12-01' });
  });

  it('saves an emptied date as undefined, which updateProject merges away', async () => {
    const onSave = vi.fn();
    const root = await renderForm({ initial: project, goals: [], onSave, onCancel: vi.fn() }, { projects: [project] });
    await act(async () => { dateInput(root).props.onChange({ target: { value: '' } }); });
    await act(async () => { root.findByType('form').props.onSubmit({ preventDefault() {} }); });
    expect('deadline' in onSave.mock.calls[0][0]).toBe(true);
    expect(onSave.mock.calls[0][0].deadline).toBeUndefined();
  });
});
