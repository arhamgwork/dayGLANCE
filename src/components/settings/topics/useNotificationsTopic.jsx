// Settings: the Notifications topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React from 'react';
import RemindersSettings from '../../RemindersSettings.jsx';
import DayPlannerSettings from '../../DayPlannerSettings.jsx';

export default function useNotificationsTopic() {
  return {
    dayPlanner: {
      show: true,
      node: <DayPlannerSettings />,
    },
    notifications: {
      show: true,
      node: <RemindersSettings />,
    },
  };
}
