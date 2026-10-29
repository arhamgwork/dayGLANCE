import React from 'react';
import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import useDayRoutine from '../hooks/useDayRoutine.js';

// The one-tap "plan my day" button: opens the voice modal already listening.
// Tapping the modal's mic stops it; nothing listens until this is tapped.
// Bottom-centre, clear of the right-hand FAB stacks on every layout.
const VoicePlanFab = () => {
  const { t } = useTranslation();
  const { isMobile, mobileActiveTab, showWelcome, voiceAutoStartRef } = useDayPlannerCtx();
  const { showVoiceInput, setShowVoiceInput } = useFeaturesCtx();
  const [routine] = useDayRoutine();

  if (!routine.autoPlan || showVoiceInput || showWelcome) return null;
  if (isMobile && mobileActiveTab === 'settings') return null;

  const label = t('dayPlanner.fab', { defaultValue: 'Speak your tasks' });
  return (
    <button
      onClick={() => { voiceAutoStartRef.current = true; setShowVoiceInput(true); }}
      className="fixed left-1/2 -translate-x-1/2 z-40 w-16 h-16 rounded-full bg-purple-600 text-white shadow-xl shadow-purple-600/30 hover:bg-purple-700 active:bg-purple-800 flex items-center justify-center transition-colors"
      style={{ bottom: isMobile ? 'calc(4.75rem + env(safe-area-inset-bottom, 0px))' : '3.5rem' }}
      title={label}
      aria-label={label}
      data-voice-plan-fab
    >
      <Mic size={30} />
    </button>
  );
};

export default VoicePlanFab;
