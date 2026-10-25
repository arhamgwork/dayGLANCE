// How much of the screen the soft keyboard covers, as a CSS variable.
//
// The Android shell runs with windowSoftInputMode="adjustNothing" so the tab
// bar stays put under the keyboard; the cost is that the WebView is never
// resized and its visualViewport never learns the keyboard is up, so a field
// in a bottom sheet or low on the Goals tab was typed into blind. MainActivity
// reports the overlap (window.__dayglanceKeyboardInset); in a mobile browser
// it is read from visualViewport. Either way it lands on :root as
// --dg-keyboard-inset, and the layouts that hold fields lift or shrink by it
// (KEYBOARD_INSET, keyboardSheet below). The iOS shell's WKWebView scrolls a
// focused field into view itself, so it reports nothing.

import { isNativeAndroid, isNativeApp } from '../native.js';

export const KEYBOARD_INSET_VAR = '--dg-keyboard-inset';
export const KEYBOARD_INSET = `var(${KEYBOARD_INSET_VAR}, 0px)`;

// A bottom sheet held above the keyboard: the full-screen backdrop container
// pads its bottom by the keyboard (so the sheet, pushed to the end, sits on
// top of it) and the sheet gives up the same height from its cap.
export const keyboardSheet = (maxHeight) => ({
  overlay: { paddingBottom: KEYBOARD_INSET },
  sheet: { maxHeight: `calc(${maxHeight} - ${KEYBOARD_INSET})` },
});

let current = 0;

const NON_TEXT_INPUTS = /^(checkbox|radio|button|submit|reset|range|color|file|image)$/i;
export const isTextEntry = (el) => !!el && (
  el.isContentEditable ||
  el.tagName === 'TEXTAREA' ||
  (el.tagName === 'INPUT' && !NON_TEXT_INPUTS.test(el.type || ''))
);

// Scroll the focused field into whatever room the keyboard left. Next frame,
// so the layouts have already shrunk by the new inset.
const revealFocused = () => {
  requestAnimationFrame(() => {
    const el = document.activeElement;
    if (isTextEntry(el)) el.scrollIntoView?.({ block: 'nearest' });
  });
};

export const getKeyboardInset = () => current;

export const setKeyboardInset = (px) => {
  const next = Math.max(0, Math.round(Number(px) || 0));
  if (next === current) return;
  const opened = next > current;
  current = next;
  const root = document.documentElement.style;
  if (next) root.setProperty(KEYBOARD_INSET_VAR, `${next}px`);
  else root.removeProperty(KEYBOARD_INSET_VAR);
  if (opened) revealFocused();
};

// Installed once by App on mobile. Returns the cleanup.
export const installKeyboardInset = () => {
  window.__dayglanceKeyboardInset = setKeyboardInset;
  // Moving to another field with the keyboard already up: the WebView does
  // not know to scroll it clear either.
  const onFocusIn = (e) => { if (current > 0 && isTextEntry(e.target)) revealFocused(); };
  document.addEventListener('focusin', onFocusIn);

  // A mobile browser: the same reading App's tab-bar effect makes. Not in the
  // native shells, where visualViewport carries edge-to-edge artefacts rather
  // than the keyboard (see that effect).
  const vv = !isNativeApp() ? window.visualViewport : null;
  let timer = null;
  const fromViewport = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      setKeyboardInset(window.innerHeight - vv.height - vv.offsetTop);
    }, 50);
  };
  if (vv) {
    vv.addEventListener('resize', fromViewport);
    vv.addEventListener('scroll', fromViewport);
  }

  return () => {
    if (window.__dayglanceKeyboardInset === setKeyboardInset) delete window.__dayglanceKeyboardInset;
    document.removeEventListener('focusin', onFocusIn);
    if (vv) {
      clearTimeout(timer);
      vv.removeEventListener('resize', fromViewport);
      vv.removeEventListener('scroll', fromViewport);
    }
    setKeyboardInset(0);
  };
};

// What the keyboard overlaps of a layout that ends above the mobile tab bar.
// In the Android shell the tab bar stays under the keyboard, so the first
// 3.5rem of it covers only the tab bar; in a browser App lifts the tab bar
// onto the keyboard, so all of it covers the layout.
export const keyboardOverTabLayout = () => (isNativeAndroid()
  ? `max(0px, calc(${KEYBOARD_INSET} - 3.5rem))`
  : KEYBOARD_INSET);
