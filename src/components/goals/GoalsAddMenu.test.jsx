import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../../context/FeaturesContext.jsx';
import { SyncContext } from '../../context/SyncContext.jsx';
import GoalsAddMenu from './GoalsAddMenu.jsx';
import GoalDashboard, { ProjectForm } from './GoalDashboard.jsx';

// The Goals tab's "+" (#2133): a choice between a project in the goal on
// screen and a new goal, instead of a bare "+" that read as "add project"
// over a goal's project cards and added a goal.

vi.mock('../projects/ProjectCard.jsx', () => ({
  default: React.forwardRef(({ project }, ref) => <div ref={ref} data-project-card={project.id}>{project.title}</div>),
}));
vi.mock('./GoalTimeline.jsx', () => ({
  DEFAULT_PERIOD: '6m',
  default: () => <div data-goal-timeline />,
  GoalRangeToggle: () => null,
}));

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

// No DOM here: `document` is a stub that records its listeners and which
// node has the focus, and refs are mock nodes that report focus to it.
let listeners;
beforeEach(() => {
  listeners = {};
  globalThis.document = {
    activeElement: null,
    addEventListener: (type, fn) => { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener: (type, fn) => { listeners[type]?.delete(fn); },
  };
});
afterEach(() => { delete globalThis.document; });

const mockNode = (element) => {
  const node = {
    role: element.props.role,
    choice: element.props['data-add-choice'],
    focus: vi.fn(() => { globalThis.document.activeElement = node; }),
    contains: (target) => target === node || (node.children || []).includes(target),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }),
    scrollIntoView: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return node;
};

describe('GoalsAddMenu', () => {
  const setup = () => {
    const nodes = [];
    const onAddProject = vi.fn();
    const onAddGoal = vi.fn();
    const onClose = vi.fn();
    const anchor = { current: { focus: vi.fn(), contains: () => false } };
    let root;
    act(() => {
      root = create(
        <I18nextProvider i18n={i18n}>
          <GoalsAddMenu goalTitle="Ship iOS Apps" onAddProject={onAddProject} onAddGoal={onAddGoal} onClose={onClose} anchorRef={anchor} />
        </I18nextProvider>,
        {
          createNodeMock: (element) => {
            const node = mockNode(element);
            nodes.push(node);
            return node;
          },
        },
      );
    });
    const menuNode = nodes.find((n) => n.role === 'menu');
    const items = nodes.filter((n) => n.role === 'menuitem');
    const menu = root.root.findByProps({ role: 'menu' });
    const row = (choice) => root.root.findByProps({ 'data-add-choice': choice });
    const key = (k) => {
      const e = { key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      act(() => { menu.props.onKeyDown(e); });
      return e;
    };
    return { root, menuNode, items, row, key, onAddProject, onAddGoal, onClose, anchor };
  };
  const text = (inst) => inst.findAllByType('span').map((s) => s.children.join('')).join('');

  it('names the goal, with the project row last (nearest the "+") and focused', () => {
    const { row, items } = setup();
    expect(text(row('project'))).toBe('Add Project to Ship iOS Apps');
    expect(text(row('goal'))).toBe('Add Goal');
    expect(items.find((n) => n.choice === 'project').focus).toHaveBeenCalled();
    expect(globalThis.document.activeElement.choice).toBe('project');
  });

  it('each row does its one thing and closes the menu', () => {
    const { row, onAddProject, onAddGoal, onClose } = setup();
    act(() => { row('project').props.onClick(); });
    expect(onAddProject).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => { row('goal').props.onClick(); });
    expect(onAddGoal).toHaveBeenCalledTimes(1);
  });

  it('Up and Down move between the rows, and stop there', () => {
    const { key } = setup();
    const up = key('ArrowUp');
    expect(globalThis.document.activeElement.choice).toBe('goal');
    expect(up.stopPropagation).toHaveBeenCalled();
    key('ArrowDown');
    expect(globalThis.document.activeElement.choice).toBe('project');
  });

  it('a parent re-render with a new onClose does not pull the focus back', () => {
    const { root, key, anchor } = setup();
    key('ArrowUp');
    expect(globalThis.document.activeElement.choice).toBe('goal');
    act(() => {
      root.update(
        <I18nextProvider i18n={i18n}>
          <GoalsAddMenu goalTitle="Ship iOS Apps" onAddProject={vi.fn()} onAddGoal={vi.fn()} onClose={vi.fn()} anchorRef={anchor} />
        </I18nextProvider>,
      );
    });
    expect(globalThis.document.activeElement.choice).toBe('goal');
  });

  it('Escape closes, gives the focus back to the "+", and stops there', () => {
    const { key, onClose, anchor } = setup();
    const esc = key('Escape');
    expect(onClose).toHaveBeenCalled();
    expect(anchor.current.focus).toHaveBeenCalled();
    expect(esc.stopPropagation).toHaveBeenCalled();
  });

  it('Enter is left to the row but kept from the space\'s shortcuts', () => {
    const enter = setup().key('Enter');
    expect(enter.preventDefault).not.toHaveBeenCalled();
    expect(enter.stopPropagation).toHaveBeenCalled();
  });

  it('a tap outside closes it; a tap inside does not', () => {
    const { menuNode, onClose } = setup();
    const [onPointerDown] = listeners.pointerdown;
    onPointerDown({ target: menuNode });
    expect(onClose).not.toHaveBeenCalled();
    onPointerDown({ target: {} });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── The "+" in the space ─────────────────────────────────────────────────────

const GOALS = [
  { id: 'ios', title: 'Ship iOS Apps', status: 'active', color: 'bg-blue-500' },
  { id: 'electron', title: 'Ship Electron Apps', status: 'active', color: 'bg-purple-500' },
];
const PROJECTS = [{ id: 'asc', title: 'App Store Connect', goalId: 'ios', status: 'active' }];

const planner = () => ({
  tasks: [], unscheduledTasks: [], recurringTasks: [], setTasks: vi.fn(), setUnscheduledTasks: vi.fn(),
  getTodayStr: () => '2026-10-22', isMobile: false, isTablet: false, darkMode: false, use24HourClock: false,
  cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
  expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(), spaceCardSize: 'normal', setSpaceCardSize: vi.fn(),
  setShowAddTask: vi.fn(), setShowNewTaskDeadlinePicker: vi.fn(),
});
const features = (overrides = {}) => ({
  goals: GOALS, projects: PROJECTS, setProjects: vi.fn(), areas: [],
  goalsAreaFilter: 'all', setGoalsAreaFilter: vi.fn(), goalsViewMode: 'list', setGoalsViewMode: vi.fn(),
  goalsDashboardFocusId: null, setGoalsDashboardFocusId: vi.fn(),
  addGoal: vi.fn(), updateGoal: vi.fn(), deleteGoal: vi.fn(), addProject: vi.fn(), updateProject: vi.fn(), moveProject: vi.fn(),
  plannerProjectId: null, setPlannerProjectId: vi.fn(), isVisibleForUser: () => true, multiUserEnabled: false, users: [],
  ...overrides,
});

function renderSpace(props, feat = {}) {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={planner()}>
          <FeaturesContext.Provider value={features(feat)}>
            <SyncContext.Provider value={{ createProjectNote: vi.fn(), openInObsidian: vi.fn() }}>
              <GoalDashboard {...props} />
            </SyncContext.Provider>
          </FeaturesContext.Provider>
        </DayPlannerContext.Provider>
      </I18nextProvider>,
      { createNodeMock: mockNode },
    );
  });
  const plus = () => root.root.findByProps({ 'data-goals-plus': true });
  const menus = () => root.root.findAll((n) => n.props['data-goals-add-menu']);
  // The goal the project form the "+" opened is preset to.
  const projectFormGoal = () => root.root.findByType(ProjectForm).props.defaultGoalId;
  return { root, plus, menus, projectFormGoal };
}

describe('the Goals tab\'s "+"', () => {
  it('opens the choice naming the goal on screen, and the project row opens the form in that goal', () => {
    const { plus, menus, root, projectFormGoal } = renderSpace({ desktop: true, isActive: true });
    expect(plus().props['aria-haspopup']).toBe('menu');
    expect(menus()).toHaveLength(0);
    act(() => { plus().props.onClick(); });
    expect(menus()).toHaveLength(1);
    const project = root.root.findByProps({ 'data-add-choice': 'project' });
    expect(project.findAllByType('span').map((s) => s.children.join('')).join('')).toBe('Add Project to Ship iOS Apps');
    act(() => { project.props.onClick(); });
    expect(menus()).toHaveLength(0);
    expect(projectFormGoal()).toBe('ios');
  });

  it('a second press closes it', () => {
    const { plus, menus } = renderSpace({ desktop: true, isActive: true });
    act(() => { plus().props.onClick(); });
    act(() => { plus().props.onClick(); });
    expect(menus()).toHaveLength(0);
  });

  it('with no goal to name, it adds a goal straight away, no menu', () => {
    const { plus, menus } = renderSpace({ desktop: true, isActive: true }, { goals: [], projects: [] });
    expect(plus().props['aria-haspopup']).toBeUndefined();
    expect(plus().props['aria-label']).toBe('Add Goal');
    act(() => { plus().props.onClick(); });
    expect(menus()).toHaveLength(0);
  });

  it('in the Roadmap with no goal open, it adds a goal straight away', () => {
    const { plus } = renderSpace({ desktop: true, isActive: true }, { goalsViewMode: 'timeline' });
    expect(plus().props['aria-label']).toBe('Add Goal');
  });

  it('on the Projects tab it is Add Project, unchanged', () => {
    const { plus } = renderSpace({ desktop: true, isActive: true, initialSidebarTab: 'projects' });
    expect(plus().props['aria-label']).toBe('Add Project');
    expect(plus().props['aria-haspopup']).toBeUndefined();
  });

  it('N opens the same menu on the Goals tab', () => {
    const goalsSpaceKeysRef = { current: null };
    const { menus } = renderSpace({ desktop: true, isActive: true }, { goalsSpaceKeysRef });
    act(() => { goalsSpaceKeysRef.current.newItem(); });
    expect(menus()).toHaveLength(1);
  });

  it('on the phone it names the carousel\'s goal', () => {
    const { plus, root } = renderSpace({ embedded: true, isActive: true });
    act(() => { plus().props.onClick(); });
    const project = root.root.findByProps({ 'data-add-choice': 'project' });
    expect(project.findAllByType('span').map((s) => s.children.join('')).join('')).toBe('Add Project to Ship iOS Apps');
  });
});
