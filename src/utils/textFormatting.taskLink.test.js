import { describe, it, expect, afterEach } from 'vitest';
import { CheckSquare, ExternalLink, FileSymlink, FileText } from 'lucide-react';
import {
  onlyTaskLink, isTaskLinkOnlyTask, isLinkOnlyTask, getLinkUrl, noteActionTarget, openNoteAction, noteIconFor,
} from './textFormatting.jsx';
import { PEEK_TASK_EVENT } from './followUp.js';

// A note that is only a link to another task gets the action button that
// URL-only notes have: a tap shows the linked task in the peek, a long press
// edits the note (the press handling is the cards', shared with URL notes).

const LINK = '[Roof repair](dayglance://task?id=r1)';
const task = (notes, over = {}) => ({ id: 't1', title: 'Call the roofer', notes, ...over });

afterEach(() => { delete globalThis.window; });

describe('onlyTaskLink', () => {
  it('a note that is one task link, with or without surrounding whitespace', () => {
    expect(onlyTaskLink(LINK)).toEqual({ label: 'Roof repair', id: 'r1' });
    expect(onlyTaskLink(`\n  ${LINK}  \n`)).toEqual({ label: 'Roof repair', id: 'r1' });
  });

  it('decodes the id, as the peek reads it', () => {
    expect(onlyTaskLink('[Gym](dayglance://task?id=recurring-7%2F2026-10-23)').id).toBe('recurring-7/2026-10-23');
  });

  it('words around the link, or a second link, make an ordinary note', () => {
    expect(onlyTaskLink(`Follow-up to ${LINK}`)).toBeNull();
    expect(onlyTaskLink(`${LINK} first`)).toBeNull();
    expect(onlyTaskLink(`${LINK}\n${LINK}`)).toBeNull();
    expect(onlyTaskLink(`${LINK}${LINK}`)).toBeNull();
  });

  it('an ordinary Markdown link, a bare URL, or nothing is not a task link', () => {
    expect(onlyTaskLink('[Docs](https://example.com)')).toBeNull();
    expect(onlyTaskLink('dayglance://task?id=r1')).toBeNull();
    expect(onlyTaskLink('')).toBeNull();
    expect(onlyTaskLink(undefined)).toBeNull();
  });
});

describe('task-link-only notes', () => {
  it('are action notes with the linked label as their target and no URL', () => {
    expect(isTaskLinkOnlyTask(task(LINK))).toBe(true);
    expect(isLinkOnlyTask(task(LINK))).toBe(true);
    expect(noteActionTarget(task(LINK))).toBe('Roof repair');
    expect(getLinkUrl(task(LINK))).toBeNull();
  });

  it('subtasks disable the affordance, same as for URLs', () => {
    const withSubtasks = task(LINK, { subtasks: [{ id: 's1', title: 'Ladder' }] });
    expect(isTaskLinkOnlyTask(withSubtasks)).toBe(false);
    expect(isLinkOnlyTask(withSubtasks)).toBe(false);
    expect(noteIconFor(withSubtasks)).toBe(FileText);
  });

  it('URL notes keep their behaviour', () => {
    const url = task('https://example.com/a');
    expect(isTaskLinkOnlyTask(url)).toBe(false);
    expect(isLinkOnlyTask(url)).toBe(true);
    expect(getLinkUrl(url)).toBe('https://example.com/a');
    expect(noteActionTarget(url)).toBe('https://example.com/a');
  });

  it('openNoteAction shows the linked task in the peek and never opens a URL', () => {
    const peeked = [];
    const opened = [];
    globalThis.window = {
      open: (...args) => opened.push(args),
      dispatchEvent: (e) => peeked.push([e.type, e.detail]),
      location: { href: 'app://dayglance/' },
    };
    openNoteAction(task(LINK));
    expect(peeked).toEqual([[PEEK_TASK_EVENT, { id: 'r1' }]]);
    expect(opened).toEqual([]);
    expect(window.location.href).toBe('app://dayglance/');

    openNoteAction(task('https://example.com/a'));
    expect(peeked).toHaveLength(1);
    expect(opened).toEqual([['https://example.com/a', '_blank', 'noopener,noreferrer']]);
  });
});

describe('noteIconFor', () => {
  it('picks the icon by what a tap does', () => {
    expect(noteIconFor(task(LINK))).toBe(FileSymlink);
    expect(noteIconFor(task('https://example.com/a'))).toBe(ExternalLink);
    expect(noteIconFor(task(`Follow-up to ${LINK}`))).toBe(FileText);
    expect(noteIconFor(task('', { subtasks: [{ id: 's1' }] }))).toBe(CheckSquare);
    expect(noteIconFor(task(''))).toBe(FileText);
  });
});
