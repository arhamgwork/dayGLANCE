import { describe, it, expect, vi } from 'vitest';

vi.mock('react', () => ({ useCallback: (fn) => fn }));

const { default: useNavigation } = await import('./useNavigation.js');

// #2131: the search can be opened over the Project Planner, and every result
// navigates the calendar or the inbox behind it.
describe('handleSpotlightSelect', () => {
  it('closes the Project Planner so the result is not hidden behind it', () => {
    vi.useFakeTimers();
    const closePlanner = vi.fn();
    const setShowSpotlight = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight, isMobile: false, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, closePlanner,
    });

    handleSpotlightSelect({ source: 'inbox', task: { id: 't1' } });

    expect(setShowSpotlight).toHaveBeenCalledWith(false);
    expect(closePlanner).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('opens a goal, project or area result in the Goals space (#2131)', () => {
    const openGoalsTarget = vi.fn();
    const closePlanner = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight: vi.fn(), isMobile: true, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, closePlanner, openGoalsTarget,
    });

    handleSpotlightSelect({ source: 'goal', task: { id: 'g1' } });
    handleSpotlightSelect({ source: 'project', task: { id: 'p1' } });
    handleSpotlightSelect({ source: 'area', task: { id: 'a1' } });

    expect(openGoalsTarget.mock.calls).toEqual([['goal', 'g1'], ['project', 'p1'], ['area', 'a1']]);
    expect(closePlanner).toHaveBeenCalledTimes(3);
  });

  // #2231: the calendar and the Inbox are hidden and inert in the Goals &
  // Projects space, so a result that lives there leaves it; a goal, project or
  // area result is the Goals space and stays.
  it('leaves the Goals space for a result on the calendar or in the Inbox', () => {
    vi.useFakeTimers();
    const setDesktopSpace = vi.fn();
    const { handleSpotlightSelect } = useNavigation({
      visibleDays: 1, effectiveViewMode: 'multi',
      selectedDate: new Date(2026, 9, 19), setSelectedDate: vi.fn(), setShowMonthView: vi.fn(),
      setShowSpotlight: vi.fn(), isMobile: false, setMobileActiveTab: vi.fn(), setTabletActiveTab: vi.fn(),
      setInboxProjectFilter: vi.fn(), setInboxArchivedExpanded: vi.fn(), setDailyNotesModalDate: vi.fn(),
      calendarRef: { current: null }, setDesktopSpace,
    });

    handleSpotlightSelect({ source: 'scheduled', task: { id: 's1', date: '2026-10-20' } });
    handleSpotlightSelect({ source: 'inbox', task: { id: 'i1' } });
    expect(setDesktopSpace.mock.calls).toEqual([['calendar'], ['calendar']]);

    setDesktopSpace.mockClear();
    handleSpotlightSelect({ source: 'project', task: { id: 'p1' } });
    expect(setDesktopSpace).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
