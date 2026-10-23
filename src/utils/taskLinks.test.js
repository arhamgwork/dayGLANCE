import { describe, expect, it } from 'vitest';
import { canLinkTask, findBacklinks, insertTaskLink, linkCandidates, pickerQueryAt } from './taskLinks.js';
import { findTaskLinks, taskLink } from './followUp.js';

// #2145: copy a link to a task, insert one with `@@`, and list who links here.

describe('pickerQueryAt', () => {
  it('opens on @@ and carries what is typed after it', () => {
    expect(pickerQueryAt('see @@', 6)).toEqual({ start: 4, query: '' });
    expect(pickerQueryAt('see @@roof rep', 14)).toEqual({ start: 4, query: 'roof rep' });
  });

  it('reads only up to the caret, so the picker follows the cursor', () => {
    expect(pickerQueryAt('@@roof and more', 6)).toEqual({ start: 0, query: 'roof' });
  });

  it('closes on a new line, a single @, no @@, or a long run', () => {
    expect(pickerQueryAt('@@roof\nnext', 11)).toBeNull();
    expect(pickerQueryAt('mail me @ home', 14)).toBeNull();
    expect(pickerQueryAt('a@@b@c', 6)).toBeNull();
    expect(pickerQueryAt('plain note', 10)).toBeNull();
    expect(pickerQueryAt(`@@${'x'.repeat(61)}`, 63)).toBeNull();
  });
});

describe('insertTaskLink', () => {
  it('replaces @@query with the link and a space, and puts the caret after it', () => {
    const text = 'Waiting on @@roo until Friday';
    const out = insertTaskLink(text, { start: 11, caret: 16 }, { id: 'r1', title: 'Roof repair' }, taskLink);
    expect(out.text).toBe('Waiting on [Roof repair](dayglance://task?id=r1)  until Friday');
    expect(out.text.slice(0, out.caret)).toBe('Waiting on [Roof repair](dayglance://task?id=r1) ');
    expect(findTaskLinks(out.text).map(l => l.id)).toEqual(['r1']);
  });
});

describe('linkCandidates', () => {
  const tasks = [
    { id: 's1', title: 'Roof repair #home', date: '2026-10-20' },
    { id: 's2', title: 'Call the roofer', date: '2026-10-24', completed: true },
    { id: 's3', title: 'Roofing quote', date: '2026-10-22' },
    { id: 'ev', title: 'Roof inspection', date: '2026-10-21', imported: true },
    { id: 'nat', title: 'Roof (calendar)', date: '2026-10-21', _native: true },
  ];
  const unscheduledTasks = [{ id: 'i1', title: 'Ask [[Robin]] about the roof' }, { id: 's1', title: 'dup' }];

  it('offers linkable tasks matching the plain-words title, never calendar events', () => {
    const ids = linkCandidates({ tasks, unscheduledTasks }, 'roof').map(c => c.task.id);
    expect(ids).toEqual(expect.arrayContaining(['s1', 's2', 's3', 'i1']));
    expect(ids).not.toContain('ev');
    expect(ids).not.toContain('nat');
    expect(ids.filter(id => id === 's1')).toHaveLength(1);
  });

  it('puts open before done, then a title that starts with the query, then the latest date', () => {
    const ids = linkCandidates({ tasks, unscheduledTasks }, 'roof').map(c => c.task.id);
    expect(ids).toEqual(['s3', 's1', 'i1', 's2']);
  });

  it('leaves out the task being edited, and shows titles as plain words', () => {
    const out = linkCandidates({ tasks, unscheduledTasks }, 'roof', { excludeId: 's3' });
    expect(out.map(c => c.task.id)).not.toContain('s3');
    expect(out.find(c => c.task.id === 's1').title).toBe('Roof repair');
    expect(out.find(c => c.task.id === 'i1').title).toBe('Ask Robin about the roof');
  });

  it('with nothing typed yet offers the open tasks first, capped', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}` }));
    expect(linkCandidates({ tasks: many }, '')).toHaveLength(8);
  });
});

describe('findBacklinks', () => {
  const target = { id: 'r 1', title: 'Roof repair' };
  const link = taskLink(target);
  it('lists the tasks whose notes link here, not the task itself or a mere mention', () => {
    const tasks = [
      { id: 'a', title: 'Call roofer', notes: `About ${link}` },
      { id: 'r 1', title: 'Roof repair', notes: `self ${link}` },
      { id: 'b', title: 'Mentions', notes: 'dayglance://task?id=r%201 without brackets' },
      { id: 'c', title: 'Other link', notes: '[x](dayglance://task?id=r%2010)' },
    ];
    const unscheduledTasks = [{ id: 'd', title: 'Follow up: #waitingfor', notes: `Follows up on ${link}, done Oct 20.` }];
    expect(findBacklinks('r 1', { tasks, unscheduledTasks }).map(b => [b.task.id, b.title])).toEqual([['a', 'Call roofer'], ['d', 'Follow up:']]);
  });

  it('finds links to one occurrence of a recurring task by its occurrence id', () => {
    const occurrence = 'recurring-tpl-2026-10-20';
    const tasks = [{ id: 'a', title: 'Notes on that standup', notes: taskLink({ id: occurrence, title: 'Standup' }) }];
    expect(findBacklinks(occurrence, { tasks }).map(b => b.task.id)).toEqual(['a']);
  });

  it('is empty without an id or without links', () => {
    expect(findBacklinks(null, { tasks: [{ id: 'a', notes: link }] })).toEqual([]);
    expect(findBacklinks('zzz', { tasks: [{ id: 'a', notes: link }] })).toEqual([]);
  });
});

describe('canLinkTask', () => {
  it('a task we keep, never a calendar event', () => {
    expect(canLinkTask({ id: 'a' })).toBe(true);
    expect(canLinkTask({ id: 'a', imported: true, isTaskCalendar: true })).toBe(true);
    expect(canLinkTask({ id: 'a', imported: true })).toBe(false);
    expect(canLinkTask({ id: 'a', nativeEventId: 'x' })).toBe(false);
  });
});
