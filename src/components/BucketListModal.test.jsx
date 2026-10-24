import React from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { normalizeBucketConfig } from '../utils/bucketList.js';
import BucketListModal from './BucketListModal.jsx';

// The Bucket List's shared notes follow the #2067 height policy like every
// other notes box: the editor opens at the note's height (autoSizeTextarea),
// both states cap at 60vh, and neither is squashed by the scrolling column.
// Before this, a long note read fine and opened as a two-row editor.

let i18n;
beforeEach(async () => {
  if (i18n) return;
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const render = (notes, { isMobile = false } = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayPlannerContext.Provider value={{
      isMobile, isTablet: false, darkMode: false,
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      unscheduledTasks: [], setUnscheduledTasks: () => {}, reorderUnscheduledTasks: () => {},
      scheduleTaskAtNextSlot: () => {}, moveToRecycleBin: () => {}, openMobileEditTask: () => {},
      bucketConfig: normalizeBucketConfig({ notes }), updateBucketConfig: () => {}, setShowBucketList: () => {},
      pushUndo: () => {}, setUndoToast: () => {}, colors: [],
    }}>
      <FeaturesContext.Provider value={{ isVisibleForUser: () => true, multiUserEnabled: false }}>
        <BucketListModal />
      </FeaturesContext.Provider>
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('the Bucket List notes', () => {
  it('shows a note as a capped preview that cannot be squashed', () => {
    const html = render('Line one\nLine two');
    expect(html).toMatch(/<button[^>]*data-bucket-notes-preview[^>]*flex-shrink-0[^>]*max-h-\[60vh\]/);
    expect(html).not.toContain('<textarea');
  });

  it('edits in a box that keeps its height in the column, capped at 60vh, drag-resizable on desktop only', () => {
    expect(render('')).toMatch(/<textarea[^>]*data-bucket-notes-editor[^>]*flex-shrink-0[^>]*max-h-\[60vh\][^>]*resize-y/);
    expect(render('', { isMobile: true })).toMatch(/<textarea[^>]*resize-none/);
  });
});
