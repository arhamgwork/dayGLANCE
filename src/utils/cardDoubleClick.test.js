import { describe, expect, it, vi } from 'vitest';
import { cardDoubleClickHandler, opensEditorOnDoubleClick } from './cardDoubleClick.js';

// Double-click a DAY or MULTI timeline card to open its editor, but never
// when the double-click belongs to something inside the card.

// A minimal element: a tag, optional attributes and classes, and a parent.
const el = (tag, { attrs = {}, classes = [], parent = null } = {}) => ({
  tagName: tag.toUpperCase(),
  parentElement: parent,
  classList: { contains: (c) => classes.includes(c) },
  matches(selector) {
    return selector.split(',').map(s => s.trim()).some((s) => {
      if (s === tag) return true;
      const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
      if (!attr) return false;
      return attr[2] === undefined ? attr[1] in attrs : attrs[attr[1]] === attr[2];
    });
  },
});

describe('opensEditorOnDoubleClick', () => {
  // The outer card carries notes-panel-container itself; only an INNER one
  // (the expanded notes) is excluded.
  const card = el('div', { classes: ['notes-panel-container'] });
  const content = el('div', { parent: card });

  it('opens from the card body and its plain text', () => {
    expect(opensEditorOnDoubleClick(card, card)).toBe(true);
    expect(opensEditorOnDoubleClick(el('span', { parent: content }), card)).toBe(true);
  });

  it('leaves a control, the resize handle, the recurrence icon and the expanded notes alone', () => {
    expect(opensEditorOnDoubleClick(el('button', { parent: content }), card)).toBe(false);
    const icon = el('svg', { attrs: { 'data-no-card-dblclick': '' }, parent: content });
    expect(opensEditorOnDoubleClick(el('path', { parent: icon }), card)).toBe(false);
    const handle = el('div', { attrs: { 'data-no-card-dblclick': '' }, parent: card });
    expect(opensEditorOnDoubleClick(handle, card)).toBe(false);
    const notes = el('div', { classes: ['notes-panel-container'], parent: content });
    expect(opensEditorOnDoubleClick(el('p', { parent: notes }), card)).toBe(false);
    expect(opensEditorOnDoubleClick(el('textarea', { parent: notes }), card)).toBe(false);
  });
});

describe('cardDoubleClickHandler', () => {
  const task = { id: 't1', title: 'Write report' };

  it('opens the editor for the card\'s task and stops there', () => {
    const open = vi.fn();
    const card = el('div');
    const handler = cardDoubleClickHandler({ task, isImported: false, isTablet: false, open });
    const e = { target: card, currentTarget: card, stopPropagation: vi.fn() };
    handler(e);
    expect(open).toHaveBeenCalledWith(task);
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('does nothing on a control inside the card', () => {
    const open = vi.fn();
    const card = el('div');
    cardDoubleClickHandler({ task, isImported: false, isTablet: false, open })({ target: el('button', { parent: card }), currentTarget: card, stopPropagation: vi.fn() });
    expect(open).not.toHaveBeenCalled();
  });

  it('is absent for a calendar event and on a touch tablet', () => {
    expect(cardDoubleClickHandler({ task, isImported: true, isTablet: false, open: vi.fn() })).toBeUndefined();
    expect(cardDoubleClickHandler({ task, isImported: false, isTablet: true, open: vi.fn() })).toBeUndefined();
  });
});
