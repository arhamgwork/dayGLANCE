import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_INSET, KEYBOARD_INSET_VAR, getKeyboardInset, installKeyboardInset,
  isTextEntry, keyboardOverTabLayout, keyboardSheet, setKeyboardInset,
} from './keyboardInset.js';

// The soft keyboard over the Android shell's adjustNothing WebView: the shell
// reports it, :root carries it, and the field being typed in is kept clear.

// No DOM in this suite: just what the module touches.
const fakeDom = () => {
  const props = new Map();
  const listeners = {};
  globalThis.window = {
    requestAnimationFrame: (cb) => { cb(0); return 0; },
    innerHeight: 800,
  };
  globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
  globalThis.document = {
    activeElement: null,
    documentElement: { style: {
      setProperty: (k, v) => props.set(k, v),
      removeProperty: (k) => props.delete(k),
      getPropertyValue: (k) => props.get(k) || '',
    } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
  };
  return { listeners };
};
const field = (tagName, type) => ({ tagName, type, isContentEditable: false, scrollIntoView: vi.fn() });
const focus = (el, dom) => {
  document.activeElement = el;
  dom.listeners.focusin?.({ target: el });
};
const cssVar = () => document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR);

describe('keyboardInset', () => {
  let uninstall = null;
  let dom;
  beforeEach(() => { dom = fakeDom(); });
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    setKeyboardInset(0);
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.requestAnimationFrame;
  });

  it('puts the inset on :root, and clears it when the keyboard closes', () => {
    setKeyboardInset(301.6);
    expect(cssVar()).toBe('302px');
    expect(getKeyboardInset()).toBe(302);
    setKeyboardInset(0);
    expect(cssVar()).toBe('');
    setKeyboardInset(-40);
    expect(getKeyboardInset()).toBe(0);
  });

  it('is what the Android shell calls once installed, and no longer after', () => {
    uninstall = installKeyboardInset();
    window.__dayglanceKeyboardInset(280);
    expect(cssVar()).toBe('280px');
    uninstall();
    uninstall = null;
    expect(window.__dayglanceKeyboardInset).toBeUndefined();
    expect(cssVar()).toBe('');
  });

  it('scrolls the focused field into view as the keyboard opens, not as it closes', () => {
    const input = field('INPUT', 'text');
    focus(input, dom);
    setKeyboardInset(300);
    expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    input.scrollIntoView.mockClear();
    setKeyboardInset(0);
    expect(input.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls a field focused while the keyboard is already up', () => {
    uninstall = installKeyboardInset();
    setKeyboardInset(300);
    const area = field('TEXTAREA');
    focus(area, dom);
    expect(area.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('counts text fields, not checkboxes or buttons', () => {
    expect(isTextEntry(field('INPUT', 'text'))).toBe(true);
    expect(isTextEntry(field('INPUT', 'search'))).toBe(true);
    expect(isTextEntry(field('TEXTAREA'))).toBe(true);
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTextEntry(field('INPUT', 'checkbox'))).toBe(false);
    expect(isTextEntry(field('BUTTON'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('lifts a sheet by the keyboard and takes the same height off its cap', () => {
    expect(keyboardSheet('85vh')).toEqual({
      overlay: { paddingBottom: KEYBOARD_INSET },
      sheet: { maxHeight: `calc(85vh - ${KEYBOARD_INSET})` },
    });
  });

  it('lets the tab bar absorb the first 3.5rem in the Android shell only', () => {
    expect(keyboardOverTabLayout()).toBe(KEYBOARD_INSET);
    window.DayGlanceNative = {};
    expect(keyboardOverTabLayout()).toBe(`max(0px, calc(${KEYBOARD_INSET} - 3.5rem))`);
  });
});
