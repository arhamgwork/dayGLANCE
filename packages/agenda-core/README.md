# @glance-apps/agenda-core

The dayGLANCE **agenda core**, shared verbatim by the dayGLANCE app and the
dayglance-bridge Obsidian plugin. The plugin's agenda sidebar shows the same
day the app does because both build it with this code: a recurring series, a
routine strip or a project's progress cannot come out differently on the two
sides.

## The boundary

Pure functions only: calendar math and agenda shaping. No app state, no
storage, no DOM, no network. Ownership policy (who wins a conflict, when an
edit is adopted) stays in dayGLANCE.

## What it holds

| Module | Exports |
| --- | --- |
| `recurrence.js` | Recurrence expansion: `getOccurrencesInRange`, `getNextOccurrence`, the recurrence presets and weekday helpers. Moved verbatim from the app's recurrence engine. |
| `agenda.js` | Day agendas: `buildAgenda`, `expandRecurringTemplate`, `recurringInstanceId`, `datesWithItems`, and the local-date helpers `localDateStr` and `shiftDateStr`. |
| `routines.js` | `routinesForDate`, the routines placed on a day. |
| `title.js` | `splitTitle`, a task title split into text, tags and `[[wikilinks]]` for display. |
| `calendar.js` | `mergeCalendarProjections`, which merges each device's projection of its read-only calendar events, day by day. |
| `events.js` | Calendar-event semantics: `isCalendarEvent`, `eventHasEnded`, `agendaClock`. |
| `progress.js` | Project and goal progress: `calculateProjectProgress`, `projectProgressPercent`, `getProjectTotalDuration`, `isProjectStalled`, `calculateGoalProgress`. |
| `noteBlock.js` | The `dayglance:` frontmatter map on a linked project or goal note: `projectNoteBlock`, `goalNoteBlock`, `noteBlockChanged`, `noteWikilink`, `NOTE_BLOCK_KEY`. |

Everything is re-exported from the package root:

```js
import { buildAgenda, getOccurrencesInRange } from '@glance-apps/agenda-core';
```

Types are in `types/index.d.ts`.

## Stability

The app and the plugin update separately, so a change here reaches users at
two different times. A change to what a function returns for the same input
is a change both sides must ship together. The tests beside each module pin
that behaviour and travel with the package.

## Consumption

dayGLANCE uses it through `file:packages/agenda-core` in its own repository.
The bridge plugin depends on the published version.

## License

MIT
