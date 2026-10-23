import React from 'react';
import { Flag, FolderOpen, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The callouts at the top of the day summary sheet: goals and projects due
// today, then goals and projects completed today. Shared by the desktop sheet
// (App.jsx) and the mobile one (MobileBottomSheets.jsx), which used to carry
// the same markup twice. A project's own target date (#2160) joined the "due
// today" rows here; the lists come from useStats, already filtered to what
// this user can see.
export default function DaySummaryCallouts({
  dueGoals = [], dueProjects = [], completedGoals = [], completedProjects = [], darkMode,
}) {
  const { t } = useTranslation();
  if (dueGoals.length + dueProjects.length + completedGoals.length + completedProjects.length === 0) return null;
  const row = (tone) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? tone.dark : tone.light}`;
  const due = { dark: 'bg-yellow-900/30 text-yellow-300', light: 'bg-yellow-50 text-yellow-700' };
  const goalDone = { dark: 'bg-amber-900/30 text-amber-300', light: 'bg-amber-50 text-amber-700' };
  const projectDone = { dark: 'bg-green-900/30 text-green-300', light: 'bg-green-50 text-green-700' };
  return (
    <div className="space-y-1.5 mb-3" data-day-summary-callouts>
      {dueGoals.map(g => (
        <div key={`due-goal-${g.id}`} className={row(due)}>
          <Flag size={14} className="flex-shrink-0" />
          <span className="truncate">{t('app.goalDueToday', { title: g.title })}</span>
        </div>
      ))}
      {dueProjects.map(p => (
        <div key={`due-project-${p.id}`} className={row(due)} data-due-project>
          <Target size={14} className="flex-shrink-0" />
          <span className="truncate">{t('app.projectDueToday', { title: p.title })}</span>
        </div>
      ))}
      {completedGoals.map(g => (
        <div key={`done-goal-${g.id}`} className={row(goalDone)}>
          <Flag size={14} className="flex-shrink-0" />
          <span className="truncate">{t('app.goalComplete', { title: g.title })}</span>
        </div>
      ))}
      {completedProjects.map(p => (
        <div key={`done-project-${p.id}`} className={row(projectDone)}>
          <FolderOpen size={14} className="flex-shrink-0" />
          <span className="truncate">{t('app.projectComplete', { title: p.title })}</span>
        </div>
      ))}
    </div>
  );
}
