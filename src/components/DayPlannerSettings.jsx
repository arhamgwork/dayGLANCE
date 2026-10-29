import React from 'react';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import SettingsCard from './settings/SettingsCard.jsx';
import useDayRoutine from '../hooks/useDayRoutine.js';
import { mealBlocks, minToTime } from '../utils/dayRoutine.js';
import { isNativeAndroid } from '../native.js';

// Settings → Notifications → Day planner: the fixed routine a voice dump is
// planned around (wake, sleep, meals) and whether alarms speak.
const DayPlannerSettings = () => {
  const { t } = useTranslation();
  const { darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const [routine, update] = useDayRoutine();

  const inputClass = `px-2 py-1 border ${borderClass} rounded text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`;
  const row = (label, control) => (
    <label className="flex items-center justify-between gap-3">
      <span className={`text-sm ${textPrimary}`}>{label}</span>
      {control}
    </label>
  );
  const timeInput = (key) => (
    <input type="time" value={routine[key]} onChange={(e) => e.target.value && update({ [key]: e.target.value })} className={inputClass} />
  );
  const numberInput = (key, min, max) => (
    <input
      type="number" min={min} max={max} value={routine[key]}
      onChange={(e) => update({ [key]: e.target.value })}
      className={`${inputClass} w-20 text-right`}
    />
  );
  const meals = mealBlocks(routine);

  return (
    <SettingsCard
      cardId="dayPlanner"
      icon={CalendarClock}
      title={t('dayPlanner.title', { defaultValue: 'Day planner' })}
      switchLabel={t('dayPlanner.autoPlan', { defaultValue: 'Plan my voice dumps into my day' })}
      hint={t('dayPlanner.hint', { defaultValue: 'Speak a list of tasks; the app fits them around your routine and sets an alarm for each.' })}
      checked={routine.autoPlan}
      onToggle={(next) => update({ autoPlan: next })}
      darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
    >
      <div className="space-y-3">
        {row(t('dayPlanner.wake', { defaultValue: 'Wake up' }), timeInput('wake'))}
        {row(t('dayPlanner.sleep', { defaultValue: 'Sleep' }), timeInput('sleep'))}
        {row(t('dayPlanner.firstMeal', { defaultValue: 'Breakfast' }), timeInput('firstMeal'))}
        {row(t('dayPlanner.mealCount', { defaultValue: 'Meals per day' }), numberInput('mealCount', 0, 8))}
        {row(t('dayPlanner.mealGap', { defaultValue: 'Hours between meals' }), numberInput('mealGapHours', 1, 12))}
        {row(t('dayPlanner.mealMinutes', { defaultValue: 'Minutes per meal' }), numberInput('mealMinutes', 5, 120))}
        {row(t('dayPlanner.buffer', { defaultValue: 'Break between tasks (min)' }), numberInput('bufferMinutes', 0, 60))}
        {meals.length > 0 && (
          <p className={`text-xs ${textSecondary}`}>
            🍽️ {meals.map((m) => `${m.name} ${minToTime(m.start)}`).join(' · ')}
          </p>
        )}
        {isNativeAndroid() && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={routine.speakAlarms}
              onChange={(e) => update({ speakAlarms: e.target.checked })}
              className="w-4 h-4 accent-blue-600"
            />
            <span className={`text-sm ${textPrimary}`}>{t('dayPlanner.speakAlarms', { defaultValue: 'Read the task out loud when its alarm rings' })}</span>
          </label>
        )}
      </div>
    </SettingsCard>
  );
};

export default DayPlannerSettings;
