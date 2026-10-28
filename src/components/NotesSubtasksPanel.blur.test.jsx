import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';

// #2247: leaving a note shows it formatted. It used to stay in the raw editor
// until the panel was reopened (Shift+Enter was the only way out). An empty
// note stays open, and switching to another app keeps the editor in place.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
let windowFocused = true;
beforeEach(() => {
  windowFocused = true;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
  globalThis.document = { hasFocus: () => windowFocused, addEventListener: () => {}, removeEventListener: () => {} };
});
afterEach(() => { delete globalThis.requestAnimationFrame; delete globalThis.document; });

const noop = () => {};
function mount(notes) {
  const field = { value: notes, selectionStart: 0, selectionEnd: 0, style: {}, focus: vi.fn(), setSelectionRange: vi.fn() };
  const updateTaskNotes = vi.fn();
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <NotesSubtasksPanel
          task={{ id: 't', title: 'Quote', notes }} isInbox darkMode={false} noAutoFocus
          updateTaskNotes={updateTaskNotes} addSubtask={noop} toggleSubtask={noop} deleteSubtask={noop} updateSubtaskTitle={noop}
        />
      </I18nextProvider>,
      { createNodeMock: (el) => (el.type === 'textarea' ? field : { style: {} }) },
    );
  });
  const editor = () => root.root.findAll((n) => n.type === 'textarea' && n.props['aria-label'] === 'Notes')[0];
  const text = () => JSON.stringify(root.toJSON());
  const open = () => act(() => { root.root.find((n) => n.type === 'div' && n.props.className?.includes('cursor-text')).props.onClick(); });
  const type = (value) => act(() => { editor().props.onChange({ target: { ...field, value, selectionStart: value.length, selectionEnd: value.length } }); });
  const blur = () => act(() => { editor().props.onBlur(); });
  return { editor, text, open, type, blur, updateTaskNotes };
}

describe('NotesSubtasksPanel: leaving the note (#2247)', () => {
  it('saves and shows the note formatted, a table included', () => {
    const p = mount('Quote');
    p.open();
    p.type('Quote\n| Item | Price |\n|---|---|\n| Tiles | ~~150~~ 120 |');
    p.blur();
    expect(p.updateTaskNotes).toHaveBeenCalledWith('t', 'Quote\n| Item | Price |\n|---|---|\n| Tiles | ~~150~~ 120 |', true);
    expect(p.editor()).toBeUndefined();
    expect(p.text()).toContain('"table"');
    expect(p.text()).toContain('"s"');
  });

  it('an empty note stays open for typing', () => {
    const p = mount('');
    expect(p.editor()).toBeDefined();
    p.blur();
    expect(p.editor()).toBeDefined();
  });

  it('switching to another app keeps the editor where it was', () => {
    const p = mount('Quote');
    p.open();
    p.type('Quote, half typed');
    windowFocused = false;
    p.blur();
    expect(p.editor()).toBeDefined();
    expect(p.updateTaskNotes).toHaveBeenCalledWith('t', 'Quote, half typed', true);
  });
});
