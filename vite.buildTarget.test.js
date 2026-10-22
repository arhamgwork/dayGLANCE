import { describe, it, expect } from 'vitest';
import { BUILD_TARGET } from './vite.buildTarget.js';
import web from './vite.config.js';
import electron from './vite.config.electron.js';
import android from './vite.config.android.js';
import ios from './vite.config.ios.js';

// Vite's own default target moved from es2020 / Safari 14 (vite 5) to Chrome
// 111 / Safari 16.4 (vite 8). A config that lost its `build.target` would
// still build and pass every test here, and the only symptom would be a blank
// screen on an older phone. See vite.buildTarget.js.
describe('build target', () => {
  it.each([['web', web], ['electron', electron], ['android', android], ['ios', ios]])(
    'the %s build uses the shared target', (_, config) => {
      expect(config.build?.target).toBe(BUILD_TARGET);
    },
  );

  it('is still the browsers the app supported under vite 5', () => {
    expect(BUILD_TARGET).toEqual(['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']);
  });
});
