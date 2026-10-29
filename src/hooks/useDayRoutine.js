import { useState, useEffect, useCallback } from 'react';
import { loadDayRoutine, saveDayRoutine, onDayRoutineChange } from '../utils/dayRoutine.js';

/** The day routine as React state, kept in step with every other reader. */
export default function useDayRoutine() {
  const [routine, setRoutine] = useState(loadDayRoutine);
  useEffect(() => onDayRoutineChange(setRoutine), []);
  const update = useCallback((patch) => {
    setRoutine((prev) => saveDayRoutine({ ...prev, ...patch }));
  }, []);
  return [routine, update];
}
