import { useState, useEffect } from 'react';
import { ICS_CALENDARS_KEY, loadIcsCalendars, PRIMARY_CAL_META_KEY, loadPrimaryCalendarMeta } from '../utils/icsFeedSync.js';
import { writeItem } from '../utils/storageWrites.js';
import { readTaskCalendarAuth, readSyncRetentionDays } from '../utils/storedSlices.js';
import { hasNativeCalendar } from '../utils/nativeCalendar.js';
import { isNativeApp, nativeHttpRequest } from '../native.js';
import { webdavFetch } from '../utils/cloudSyncProviders.js';
import { normalizeEtag } from '@glance-apps/sync';
import { shiftDateStr } from '@glance-apps/agenda-core';
import { fetchIcsFeed, replaceFeedEvents, PRIMARY_FEED_ID, isActiveIcsCalendar } from '../utils/icsFeedSync.js';
import { parseICS, filterByDateWindow, expandMultiDayEvent } from '../utils/icsParser.js';
import { dateToString, computeTaskCalendarTombstones, computeRecurringSeriesTombstones } from '../utils/taskUtils.js';
import { CALENDAR_PROJECTION_WINDOW_DAYS } from '../utils/obsidianCalendarProjection.js';
import { absorbCalendarWindow, readCalendarProjectionCache, writeCalendarProjectionCache } from '../utils/calendarProjectionCache.js';
import { buildCalendarProxyUrl } from '../utils/calendarProxyUrl.js';
import { applyTaskCompletionToIcs } from '../utils/caldavTaskCompletion.js';

const useCalendarSync = () => {
  const [calSyncStatus, setCalSyncStatus] = useState(null); // null | 'success' | 'error'
  const [calSyncLastSynced, setCalSyncLastSynced] = useState(() =>
    localStorage.getItem('day-planner-cal-sync-last-synced') || null
  );
  const [taskCalendarUrl, setTaskCalendarUrl] = useState('');
  const [taskCalendarAuth, setTaskCalendarAuth] = useState(readTaskCalendarAuth);
  const [syncRetentionDays, setSyncRetentionDays] = useState(readSyncRetentionDays);
  // Additional ICS/CalDAV event calendars beyond the primary Calendar URL:
  // [{id, name, url, username, password, color, enabled}]. The primary feed
  // stays in the legacy day-planner-sync-url key for old-build compatibility.
  const [icsCalendars, setIcsCalendars] = useState(loadIcsCalendars);
  // Display meta for the primary calendar (name/color/enabled). Its URL and
  // credentials stay in the legacy keys; see icsFeedSync.js (unified list).
  const [primaryCalendarMeta, setPrimaryCalendarMeta] = useState(loadPrimaryCalendarMeta);
  const [completedTaskUids, setCompletedTaskUids] = useState(new Set());
  const [pendingImportFile, setPendingImportFile] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importColor, setImportColor] = useState('bg-gray-600');

  // Persist task calendar auth to localStorage
  useEffect(() => {
    writeItem('day-planner-task-calendar-auth', JSON.stringify(taskCalendarAuth));
  }, [taskCalendarAuth]);

  // Persist additional calendars to localStorage
  useEffect(() => {
    writeItem(ICS_CALENDARS_KEY, JSON.stringify(icsCalendars));
  }, [icsCalendars]);

  // Persist primary calendar meta to localStorage
  useEffect(() => {
    writeItem(PRIMARY_CAL_META_KEY, JSON.stringify(primaryCalendarMeta));
  }, [primaryCalendarMeta]);

  return {
    calSyncStatus, setCalSyncStatus,
    calSyncLastSynced, setCalSyncLastSynced,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    icsCalendars, setIcsCalendars,
    primaryCalendarMeta, setPrimaryCalendarMeta,
    syncRetentionDays, setSyncRetentionDays,
    completedTaskUids, setCompletedTaskUids,
    pendingImportFile, setPendingImportFile,
    showImportModal, setShowImportModal,
    importColor, setImportColor,
  };
};

// Encode a string that may contain non-ASCII characters as Base64.
// btoa() throws InvalidCharacterError for codepoints > 255 (CJK, emoji, etc.).
const toBase64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));

/**
 * The calendar sync actions, moved verbatim out of App.jsx behind a deps
 * object (the useTaskActions pattern): fetching every event feed, fetching the
 * task calendar, and writing a task's completion back to its CalDAV server
 * (the VTODO rewrite itself is pure, in utils/caldavTaskCompletion.js). Called
 * where the functions were, after the state they read; the calendar state
 * itself stays in useCalendarSync above.
 */
export function useCalendarSyncActions({
  setTasks, syncUrl, setSyncUrl, primaryCalendarMeta, calendarUrlAuth, icsCalendars, setIcsCalendars,
  syncRetentionDays, multiUserEnabled, taskCalendarUrl, setTaskCalendarUrl, taskCalendarAuth, setSyncNotification,
}) {
  // Fetches an ICS/CalDAV URL, routing through the Vercel proxy on web or via
  // the Electron main process on desktop (both avoid Chromium CORS restrictions).
  const icsProxyFetch = async (url, authValue) => {
    if (window.electronAPI?.isElectron) {
      const headers = { Accept: 'text/calendar, text/plain, */*' };
      if (authValue) headers['Authorization'] = authValue;
      const r = await window.electronAPI.proxyFetch('GET', url, headers, null);
      return { status: r.status, ok: r.ok, statusText: r.statusText, headers: { get: () => null }, text: async () => r.body };
    }
    const proxyHeaders = {};
    if (authValue) proxyHeaders['X-Calendar-Auth'] = authValue;
    return fetch(buildCalendarProxyUrl(url), { headers: proxyHeaders });
  };

  // Strip userinfo (credentials) from a URL before logging so they don't appear
  // in DevTools or crash-reporter payloads even when embedded in the URL.
  const redactUrl = (url) => {
    try { const u = new URL(url); u.username = ''; u.password = ''; return u.toString(); }
    catch { return url; }
  };

  // Sync every configured event feed: the primary Calendar URL plus all enabled
  // additional calendars. Feeds are fetched in parallel and applied in ONE
  // setTasks so one feed's result can never wipe another's. A feed that fails
  // keeps its previous events (keepFeedIds); events of feeds that were removed
  // from the config drop out because their feedId is in neither set.
  // Returns { success, count?, error?, urlUpdated?, failedFeeds?: string[] }
  const syncWithCalendar = async () => {
    // When a native calendar source is present (mobile bridge or macOS EventKit),
    // calendar events come from there. CalDAV iCal sync would duplicate those
    // events, so skip it entirely.
    if (hasNativeCalendar()) return { success: false, error: 'no-url' };

    const feeds = [];
    if (syncUrl && primaryCalendarMeta.enabled !== false) {
      feeds.push({
        id: PRIMARY_FEED_ID,
        url: syncUrl,
        name: primaryCalendarMeta.name || '',
        color: primaryCalendarMeta.color || 'bg-gray-600',
        authValue: (calendarUrlAuth.username && calendarUrlAuth.password)
          ? 'Basic ' + toBase64(calendarUrlAuth.username + ':' + calendarUrlAuth.password)
          : null,
      });
    }
    for (const cal of icsCalendars) {
      if (!isActiveIcsCalendar(cal)) continue;
      feeds.push({
        id: cal.id,
        url: cal.url.trim(),
        name: cal.name || '',
        color: cal.color || 'bg-gray-600',
        authValue: (cal.username && cal.password)
          ? 'Basic ' + toBase64(cal.username + ':' + cal.password)
          : null,
      });
    }
    if (feeds.length === 0) {
      // No active feeds — drop any leftover feed events (a feed was disabled or
      // its URL cleared and nothing else remains to sync them away).
      setTasks(prevTasks => replaceFeedEvents(prevTasks, []));
      if (!hasNativeCalendar()) {
        try {
          const today = dateToString(new Date());
          writeCalendarProjectionCache(absorbCalendarWindow(readCalendarProjectionCache(), [], {
            from: shiftDateStr(today, -CALENDAR_PROJECTION_WINDOW_DAYS), to: shiftDateStr(today, CALENDAR_PROJECTION_WINDOW_DAYS),
          }));
        } catch { /* best-effort */ }
      }
      return { success: false, error: 'no-url' };
    }

    const debug = import.meta.env.DEV ? (...args) => console.log('[calendar-sync]', ...args) : undefined;
    const results = await Promise.all(feeds.map(async (feed) => {
      try {
        const { icsContent, effectiveUrl } = await fetchIcsFeed(feed.url, feed.authValue, icsProxyFetch, debug);
        return { feed, icsContent, effectiveUrl };
      } catch (error) {
        console.error(`Sync error (${feed.name || feed.id}):`, error);
        return { feed, error: error.message === 'not-ical' ? 'not-ical' : 'calendar' };
      }
    }));

    let urlUpdated = false;
    const freshEvents = [];
    const failedFeedIds = new Set();
    const failedFeeds = [];
    let firstError = null;
    for (const r of results) {
      if (r.error) {
        failedFeedIds.add(r.feed.id);
        failedFeeds.push(r.feed.name || (r.feed.id === PRIMARY_FEED_ID ? 'calendar' : 'additional calendar'));
        if (!firstError) firstError = r.error;
        continue;
      }
      // Persist the corrected (?export) URL so future syncs use it directly
      if (r.effectiveUrl !== r.feed.url) {
        urlUpdated = true;
        if (r.feed.id === PRIMARY_FEED_ID) {
          setSyncUrl(r.effectiveUrl);
          localStorage.setItem('day-planner-sync-url', r.effectiveUrl);
        } else {
          setIcsCalendars(prev => prev.map(c => c.id === r.feed.id ? { ...c, url: r.effectiveUrl } : c));
        }
      }
      const events = parseICS(r.icsContent);
      const allImported = events.flatMap(event =>
        expandMultiDayEvent(event, {
          asTaskCalendar: false,
          feedId: r.feed.id,
          ...(r.feed.color ? { color: r.feed.color } : {}),
        })
      );
      freshEvents.push(...filterByDateWindow(allImported, syncRetentionDays));
    }

    if (failedFeedIds.size === feeds.length) {
      // Every feed failed — leave existing events untouched.
      return { success: false, error: firstError, failedFeeds };
    }

    // Replace sync-sourced imported events (not task calendar) with the fresh
    // ones, keeping the previous events of feeds that failed this round.
    // Preserves file-imported events; uses functional form to avoid stale closures
    setTasks(prevTasks => replaceFeedEvents(prevTasks, freshEvents, { keepFeedIds: failedFeedIds }));
    // Obsidian sidebar (companion 4.2): feed events feed the projection cache
    // over the whole projection window (a feed is fetched whole). Skipped on
    // native-calendar devices, where the EventKit fetch is the sole source
    // and the merge above drops feed events again on its next run.
    if (!hasNativeCalendar()) {
      try {
        const today = dateToString(new Date());
        writeCalendarProjectionCache(absorbCalendarWindow(readCalendarProjectionCache(), freshEvents, {
          from: shiftDateStr(today, -CALENDAR_PROJECTION_WINDOW_DAYS), to: shiftDateStr(today, CALENDAR_PROJECTION_WINDOW_DAYS),
          keepFeedIds: failedFeedIds, multiUserEnabled,
        }));
      } catch { /* best-effort */ }
    }
    return { success: true, count: freshEvents.length, urlUpdated, failedFeeds };
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncTaskCalendar = async () => {
    if (!taskCalendarUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      let icsContent;
      const taskAuthHeaders = { Accept: 'text/calendar, text/plain, */*' };
      if (taskCalendarAuth.username && taskCalendarAuth.appPassword) {
        taskAuthHeaders['Authorization'] = 'Basic ' + toBase64(taskCalendarAuth.username + ':' + taskCalendarAuth.appPassword);
      }
      let effectiveTaskUrl = taskCalendarUrl;
      if (isNativeApp()) {
        // On native apps: fetch directly — no CORS restrictions, no proxy server available
        const result = await nativeHttpRequest('GET', taskCalendarUrl, taskAuthHeaders, '');
        if (!result || !result.ok) throw new Error('Failed to fetch task calendar');
        icsContent = result.body;
      } else {
        const taskAuthValue = (taskCalendarAuth.username && taskCalendarAuth.appPassword)
          ? 'Basic ' + toBase64(taskCalendarAuth.username + ':' + taskCalendarAuth.appPassword)
          : null;
        const response = await icsProxyFetch(taskCalendarUrl, taskAuthValue);
        if (!response.ok) throw new Error('Failed to fetch task calendar');
        icsContent = await response.text();

        if (!icsContent.includes('BEGIN:VCALENDAR') && !taskCalendarUrl.includes('export')) {
          // Auto-retry with ?export for CalDAV collection URLs (Baikal, Nextcloud, etc.)
          if (import.meta.env.DEV) console.log('[task-calendar-sync] Response is not ICS. Content-Type:', response.headers.get('content-type'), '— First 300 chars:', icsContent.slice(0, 300));
          const exportUrl = taskCalendarUrl.includes('?') ? `${taskCalendarUrl}&export` : `${taskCalendarUrl}?export`;
          if (import.meta.env.DEV) console.log('[task-calendar-sync] Retrying with ?export:', redactUrl(exportUrl));
          try {
            const exportResponse = await icsProxyFetch(exportUrl, taskAuthValue);
            if (exportResponse.ok) {
              const exportContent = await exportResponse.text();
              if (exportContent.includes('BEGIN:VCALENDAR')) {
                icsContent = exportContent;
                effectiveTaskUrl = exportUrl;
              }
            }
          } catch { /* fall through, parseICS will handle gracefully */ }
        }
      }

      // Persist the corrected URL so future syncs use it directly
      if (effectiveTaskUrl !== taskCalendarUrl) {
        setTaskCalendarUrl(effectiveTaskUrl);
        localStorage.setItem('day-planner-task-calendar-url', effectiveTaskUrl);
      }

      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const allTaskItems = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: true, freshCompletedUids })
      );
      const taskCalendarItems = filterByDateWindow(allTaskItems, syncRetentionDays);

      // Tombstone task-calendar items that vanished from the feed (deleted/moved on
      // the server). Without a tombstone the cloud merge treats the still-present
      // remote copy as a "remote-only" item and resurrects it. Both helpers return
      // [] for an empty feed (likely a transient glitch, not a real wipe).
      //   - Non-recurring: diff occurrence ids against the unwindowed expansion, so
      //     an item merely aged past the retention window isn't mistaken for a delete.
      //   - Recurring: diff at the series level by master UID against the raw feed
      //     (events.masterUids), so normal occurrence advancement — and live series
      //     that expand to zero in-window occurrences — aren't mistaken for deletes.
      const tombstoneCutoffStr = syncRetentionDays > 0
        ? dateToString(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - syncRetentionDays))
        : null;
      const priorTasksSnapshot = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]');
      const tombstoneIds = [
        ...computeTaskCalendarTombstones(priorTasksSnapshot, allTaskItems, { cutoffDateStr: tombstoneCutoffStr }),
        ...computeRecurringSeriesTombstones(priorTasksSnapshot, events.masterUids, { cutoffDateStr: tombstoneCutoffStr }),
      ];
      if (tombstoneIds.length > 0) {
        const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
        const nowIso = new Date().toISOString();
        for (const id of tombstoneIds) tombstones[id] = nowIso;
        localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
      }

      // Remove old sync-sourced task calendar items and add the fresh ones
      // Preserves file-imported task calendar items; uses functional form to avoid stale closures
      setTasks(prevTasks => {
        const kept = prevTasks.filter(t => !(t.isTaskCalendar && t.importSource !== 'file'));
        return [...kept, ...taskCalendarItems];
      });
      return { success: true, count: taskCalendarItems.length, urlUpdated: effectiveTaskUrl !== taskCalendarUrl };
    } catch (error) {
      console.error('Task calendar sync error:', error);
      return { success: false, error: 'task-calendar' };
    }
  };

  // Sync task completion status back to CalDAV server
  // For non-recurring tasks: modifies STATUS/COMPLETED/PERCENT-COMPLETE directly.
  // For recurring tasks: advances DUE/DTSTART to the next RRULE occurrence (keeps
  // STATUS:NEEDS-ACTION) so Nextcloud immediately shows the next instance as a fresh
  // to-do. Nextcloud doesn't support RECURRENCE-ID overrides for VTODOs
  // (https://github.com/nextcloud/tasks/issues/2276), so per-instance completion
  // can't be represented — advancing the due date is the best compatible approach.
  const syncTaskCompletionToCalDAV = async (icalUid, completed, { isRecurring = false, date, startTime, isAllDay } = {}) => {
    const { username, appPassword, caldavBaseUrl } = taskCalendarAuth;
    if (!caldavBaseUrl || !username || !appPassword) {
      console.warn('CalDAV task sync skipped: caldavBaseUrl, username, or appPassword is not set in task calendar settings.');
      return;
    }

    const baseUrl = caldavBaseUrl.replace(/\/+$/, '');
    // Use encodeURI (not encodeURIComponent) for the UID — CalDAV UIDs often contain
    // @ and other characters that are valid in URL paths but encodeURIComponent would escape
    const resourceUrl = `${baseUrl}/${encodeURI(icalUid)}.ics`;
    const authHeaders = {
      'X-WebDAV-Auth': 'Basic ' + toBase64(username + ':' + appPassword)
    };

    try {
      const getRes = await webdavFetch('GET', resourceUrl, authHeaders);

      if (!getRes.ok) {
        console.error('CalDAV GET failed:', getRes.status, redactUrl(resourceUrl));
        setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Failed to fetch task from server (HTTP ${getRes.status}). Check CalDAV Base URL.` });
        return;
      }

      // Normalize before If-Match: Apache mod_deflate rewrites ETags on
      // gzip-encoded responses ("xyz" -> "xyz-gzip") and nginx downgrades them
      // to weak (W/"xyz"), either of which makes the PUT below 412 forever.
      const icsEtag = normalizeEtag(getRes.headers.get('etag')) || null;
      let icsContent = await getRes.text();
      icsContent = applyTaskCompletionToIcs(icsContent, { completed, isRecurring, date });

      // PUT the updated resource back
      const putExtraHeaders = { 'Content-Type': 'text/calendar; charset=utf-8' };
      if (icsEtag) putExtraHeaders['If-Match'] = icsEtag;
      const putRes = await webdavFetch('PUT', resourceUrl, authHeaders, icsContent, putExtraHeaders);

      if (!putRes.ok) {
        console.error('CalDAV PUT failed:', putRes.status, redactUrl(resourceUrl));
        setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Failed to update task on server (HTTP ${putRes.status})` });
      }
    } catch (err) {
      console.error('CalDAV completion sync error:', err);
      setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Sync error: ${err.message}` });
    }
  };

  return { syncWithCalendar, syncTaskCalendar, syncTaskCompletionToCalDAV };
}

export default useCalendarSync;
