import { describe, it, expect } from 'vitest';
import { retireCheck } from './retireCheck.js';

// The answer the native side needs before it closes a page that stopped
// answering the launcher: only `ok` lets it close (LauncherPageRetire).
describe('retireCheck', () => {
  it('ok with no daily-note write in flight, busy with one', () => {
    expect(retireCheck({ notesWritesInFlight: () => 0 })).toBe('ok');
    expect(retireCheck({ notesWritesInFlight: () => 1 })).toBe('busy');
  });

  it('reads the real store by default', () => {
    expect(retireCheck()).toBe('ok');
  });
});
