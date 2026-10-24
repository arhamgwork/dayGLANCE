// Ambient-mode preferences for the Day Dial — shared between the dial's
// Layers panel (which edits them) and the app-level screensaver watcher
// (which only reads them, straight from storage each check, so the two
// never need state plumbing between them).
//
// Device-local by design, like the dial's layer toggles: a wall kiosk wants
// the screensaver, a laptop doesn't, and syncing the choice would make the
// two fight.
//
//   auto        — start ambient after idle while the dial is open
//   fromPlanner — ALSO start from anywhere in the planner (the true
//                 screensaver; only meaningful with auto on)
//   delayMin    — idle minutes before starting

export const DIAL_AMBIENT_KEY = 'day-planner-dial-ambient';
export const DEFAULT_AMBIENT_PREFS = { auto: false, fromPlanner: false, delayMin: 5 };
export const AMBIENT_DELAY_OPTIONS = [1, 5, 15, 30];

export function loadAmbientPrefs() {
  try {
    return { ...DEFAULT_AMBIENT_PREFS, ...JSON.parse(localStorage.getItem(DIAL_AMBIENT_KEY) || '{}') };
  } catch {
    return DEFAULT_AMBIENT_PREFS;
  }
}

export function saveAmbientPrefs(prefs) {
  try {
    localStorage.setItem(DIAL_AMBIENT_KEY, JSON.stringify(prefs));
  } catch { /* view pref only */ }
}

// The alarm mark (Android): whether the next clock-app alarm rides the dial,
// and from what time of day tomorrow's shows (utils/nextAlarm.js
// dialAlarmMark). Device-local, like everything here: the alarm is this
// device's. The home-screen dial reads it from the widget snapshot.
export const DIAL_ALARM_KEY = 'day-planner-dial-alarm';
export const DEFAULT_ALARM_PREFS = { on: true, fromMin: 18 * 60 };
export const ALARM_FROM_OPTIONS = [0, 17 * 60, 18 * 60, 19 * 60, 20 * 60, 21 * 60, 22 * 60];

export function loadAlarmPrefs() {
  try {
    const p = { ...DEFAULT_ALARM_PREFS, ...JSON.parse(localStorage.getItem(DIAL_ALARM_KEY) || '{}') };
    return {
      on: p.on !== false,
      fromMin: Number.isInteger(p.fromMin) && p.fromMin >= 0 && p.fromMin < 1440 ? p.fromMin : DEFAULT_ALARM_PREFS.fromMin,
    };
  } catch {
    return DEFAULT_ALARM_PREFS;
  }
}

export function saveAlarmPrefs(prefs) {
  try {
    localStorage.setItem(DIAL_ALARM_KEY, JSON.stringify(prefs));
  } catch { /* view pref only */ }
}

// Layer visibility: which of the dial's layers draw (a toggle hides a layer,
// it never fakes one). Device-local, like everything here: a wall panel and a
// phone reasonably want different layers, so it does not ride the sync
// payload. The GLANCElauncher's dial on this device follows it (the launcher
// snapshot's dayShape.dialLayers), so Home matches the app's dial.
export const DIAL_LAYERS_KEY = 'day-planner-dial-layers';
export const DEFAULT_DIAL_LAYERS = { solar: true, weather: true, calendars: true, routines: true, focus: true, frames: true };

export function loadDialLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(DIAL_LAYERS_KEY) || '{}');
    const out = { ...DEFAULT_DIAL_LAYERS };
    // Only known layers, and only booleans: a malformed value keeps the layer on.
    for (const key of Object.keys(DEFAULT_DIAL_LAYERS)) {
      if (typeof saved?.[key] === 'boolean') out[key] = saved[key];
    }
    return out;
  } catch {
    return { ...DEFAULT_DIAL_LAYERS };
  }
}

export function saveDialLayers(layers) {
  try {
    localStorage.setItem(DIAL_LAYERS_KEY, JSON.stringify(layers));
  } catch { /* view pref only */ }
}
