import { dailyNotesWritesInFlight } from '../utils/dailyNotesStore.js';

// What the native side asks before it closes a page that stopped answering the
// launcher (LauncherPageRetire, docs/launcher-integration.md "Freshness"). A
// backgrounded WebView can stop running timers and network replies while still
// running a script handed to it directly, so this is called that way, and it
// must answer synchronously: `ok` when closing loses nothing, `busy` when a
// write is still in flight. Every other slice saves synchronously on each
// change (useSaveOnChange), so only the daily notes, written to IndexedDB, can
// have a write outstanding.

/** `ok` or `busy`. */
export function retireCheck({ notesWritesInFlight = dailyNotesWritesInFlight } = {}) {
  return notesWritesInFlight() > 0 ? 'busy' : 'ok';
}
