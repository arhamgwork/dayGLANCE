/* eslint-disable react-hooks/rules-of-hooks -- React is mocked below; the hook
   is called as a plain function, rendered again after each update, as
   useSnapshotFileSync.test.js does. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import en from '../../public/locales/en/translation.json';
import { stripSpans } from '../utils/quickAddParser.js';

// Accepting a suggestion re-reads the title the way typing does (a user
// report, 2026-10-27: after accepting "#rückrufe" the chip still read
// "#rückr"). The chips are the visible half; the spans save strips from the
// title BY POSITION are the other, and a completion that moved the text left
// them pointing at the wrong characters.
//
// React's hooks are plain slots kept across renders, so the hook can be
// rendered, driven, and rendered again.
let slots = [];
let at = 0;
vi.mock('react', () => ({
  useState: (init) => {
    const i = at++;
    if (!(i in slots)) slots[i] = { value: typeof init === 'function' ? init() : init };
    const slot = slots[i];
    return [slot.value, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; }];
  },
  useRef: (init) => {
    const i = at++;
    if (!(i in slots)) slots[i] = { current: init };
    return slots[i];
  },
  useEffect: () => { at++; },
}));
const { default: useNewTaskInput } = await import('./useNewTaskInput.js');

let t;
beforeEach(async () => {
  slots = [];
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
  t = i18n.t.bind(i18n);
});
const render = () => {
  at = 0;
  return useNewTaskInput({ allTags: ['rückrufe'], showAddTask: true, t, language: 'en', use24HourClock: false });
};
const typeTitle = (value, cursor = value.length) => {
  render().handleNewTaskInputChange({ target: { value, selectionStart: cursor } });
  const hook = render();
  hook.newTaskInputRef.current = { selectionStart: cursor, focus: () => {} };
  return hook;
};
const chips = (task) => task.nlChips.map((c) => `${c.type}:${task.title.slice(c.start, c.end)}`);

describe('accepting a suggestion re-reads the title', () => {
  it('a completed tag: the chip names the whole tag, and save strips the right words', () => {
    const hook = typeTitle('call #rü tomorrow', 8);
    hook.applySuggestionForNewTask({ type: 'tag', value: 'rückrufe' });
    const task = render().newTask;
    expect(task.title).toMatch(/^call #rückrufe\s+tomorrow$/);
    expect(task.nlChips.find((c) => c.type === 'tag').value).toBe('rückrufe');
    expect(chips(task)).toEqual(['tag:#rückrufe', 'date:tomorrow']);
    expect(stripSpans(task.title, task.nlSpans)).toBe('call #rückrufe');
  });

  it('a completed shortcut that moves the text: save still strips the phrase, not its neighbours', () => {
    const hook = typeTitle('Task %4 tomorrow', 7);
    const fortyFive = hook.buildSuggestions('Task %4 tomorrow', 7).find((s) => s.type === 'duration' && s.value === 45);
    hook.applySuggestionForNewTask(fortyFive);
    const task = render().newTask;
    expect(task.duration).toBe(45);
    expect(chips(task)).toEqual(['date:tomorrow']);
    expect(stripSpans(task.title, task.nlSpans)).toBe(task.title.replace(/\s*tomorrow$/, ''));
  });
});
