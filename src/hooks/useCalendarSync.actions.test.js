import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/cloudSyncProviders.js', () => ({ webdavFetch: vi.fn() }));
vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: vi.fn(() => false) }));
vi.mock('../native.js', () => ({ isNativeApp: vi.fn(() => false), nativeHttpRequest: vi.fn() }));
vi.mock('../utils/icsFeedSync.js', async (original) => ({ ...await original(), fetchIcsFeed: vi.fn() }));

const { useCalendarSyncActions } = await import('./useCalendarSync.js');
const { webdavFetch } = await import('../utils/cloudSyncProviders.js');
const { hasNativeCalendar } = await import('../utils/nativeCalendar.js');
const { fetchIcsFeed, PRIMARY_FEED_ID } = await import('../utils/icsFeedSync.js');

const response = (status, body = '', etag = null) => ({ ok: status >= 200 && status < 300, status, text: async () => body, headers: { get: (h) => (h === 'etag' ? etag : null) } });
const VTODO = ['BEGIN:VCALENDAR', 'BEGIN:VTODO', 'UID:a@b', 'STATUS:NEEDS-ACTION', 'END:VTODO', 'END:VCALENDAR', ''].join('\r\n');
const event = (uid, summary, day = '20261026') => ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${summary}`, `DTSTART:${day}T090000Z`, `DTEND:${day}T100000Z`, 'END:VEVENT'];
const calendar = (...events) => ['BEGIN:VCALENDAR', ...events.flat(), 'END:VCALENDAR', ''].join('\r\n');

let tasks, deps, store;
function useActions(over = {}) {
  deps = {
    setTasks: vi.fn(update => { tasks = update(tasks); }),
    syncUrl: 'https://cal.example/primary.ics', setSyncUrl: vi.fn(),
    primaryCalendarMeta: { name: 'Work', color: 'bg-blue-500', enabled: true },
    calendarUrlAuth: { username: '', password: '' },
    icsCalendars: [], setIcsCalendars: vi.fn(),
    syncRetentionDays: 0, multiUserEnabled: false,
    taskCalendarUrl: '', setTaskCalendarUrl: vi.fn(),
    taskCalendarAuth: { username: 'zoë', appPassword: 'pw', caldavBaseUrl: 'https://dav.example/tasks//' },
    setSyncNotification: vi.fn(),
    ...over,
  };
  return useCalendarSyncActions(deps);
}

beforeEach(() => {
  tasks = [];
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; },
  });
  vi.stubGlobal('window', {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(webdavFetch).mockReset();
  vi.mocked(fetchIcsFeed).mockReset();
  vi.mocked(hasNativeCalendar).mockReturnValue(false);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('syncTaskCompletionToCalDAV', () => {
  it('does nothing without the CalDAV base URL and credentials', async () => {
    await useActions({ taskCalendarAuth: { username: 'u', appPassword: '', caldavBaseUrl: 'https://dav.example' } })
      .syncTaskCompletionToCalDAV('a@b', true);
    expect(webdavFetch).not.toHaveBeenCalled();
  });

  it('GETs the resource, rewrites it, and PUTs it back under the normalised ETag', async () => {
    vi.mocked(webdavFetch).mockResolvedValueOnce(response(200, VTODO, 'W/"abc-gzip"')).mockResolvedValueOnce(response(204));
    await useActions().syncTaskCompletionToCalDAV('a b@c', true);
    const auth = { 'X-WebDAV-Auth': `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('zoë:pw')))}` };
    expect(webdavFetch).toHaveBeenNthCalledWith(1, 'GET', 'https://dav.example/tasks/a%20b@c.ics', auth);
    const [method, url, headers, body, extra] = vi.mocked(webdavFetch).mock.calls[1];
    expect([method, url, headers]).toEqual(['PUT', 'https://dav.example/tasks/a%20b@c.ics', auth]);
    expect(extra).toEqual({ 'Content-Type': 'text/calendar; charset=utf-8', 'If-Match': '"abc"' });
    expect(body).toMatch(/STATUS:COMPLETED/);
    expect(deps.setSyncNotification).not.toHaveBeenCalled();
  });

  it('sends no If-Match when the server gives no ETag', async () => {
    vi.mocked(webdavFetch).mockResolvedValueOnce(response(200, VTODO)).mockResolvedValueOnce(response(204));
    await useActions().syncTaskCompletionToCalDAV('a@b', false);
    expect(vi.mocked(webdavFetch).mock.calls[1][4]).toEqual({ 'Content-Type': 'text/calendar; charset=utf-8' });
  });

  it.each([
    ['the GET fails', () => vi.mocked(webdavFetch).mockResolvedValueOnce(response(404)), /HTTP 404/, 1],
    ['the PUT fails', () => vi.mocked(webdavFetch).mockResolvedValueOnce(response(200, VTODO)).mockResolvedValueOnce(response(412)), /HTTP 412/, 2],
    ['the request throws', () => vi.mocked(webdavFetch).mockRejectedValueOnce(new Error('offline')), /offline/, 1],
  ])('says so when %s', async (_, arrange, message, calls) => {
    arrange();
    await useActions().syncTaskCompletionToCalDAV('a@b', true);
    expect(webdavFetch).toHaveBeenCalledTimes(calls);
    expect(deps.setSyncNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', title: 'CalDAV Sync', message: expect.stringMatching(message) }));
  });
});

describe('syncWithCalendar', () => {
  const extra = { id: 'cal-2', name: 'Home', url: ' https://cal.example/home.ics ', color: 'bg-green-500', enabled: true };
  const old = (feedId, title) => ({ id: `${feedId}-${title}`, title, imported: true, feedId, date: '2026-10-20' });

  it('leaves events to the native calendar where there is one', async () => {
    vi.mocked(hasNativeCalendar).mockReturnValue(true);
    expect(await useActions().syncWithCalendar()).toEqual({ success: false, error: 'no-url' });
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('drops leftover feed events when no feed is active', async () => {
    tasks = [old(PRIMARY_FEED_ID, 'stale'), { id: 'mine', title: 'Mine' }];
    expect(await useActions({ syncUrl: '' }).syncWithCalendar()).toEqual({ success: false, error: 'no-url' });
    expect(tasks.map(t => t.id)).toEqual(['mine']);
  });

  it('keeps the previous events of a feed that failed, and replaces the rest', async () => {
    tasks = [old(PRIMARY_FEED_ID, 'old-work'), old('cal-2', 'old-home'), { id: 'mine', title: 'Mine' }];
    vi.mocked(fetchIcsFeed).mockImplementation(async (url) => {
      if (url.includes('home')) throw new Error('boom');
      return { icsContent: calendar(event('w1', 'Standup')), effectiveUrl: url };
    });
    const result = await useActions({ icsCalendars: [extra] }).syncWithCalendar();
    expect(vi.mocked(fetchIcsFeed).mock.calls.map(call => call[0])).toEqual(['https://cal.example/primary.ics', 'https://cal.example/home.ics']);
    expect(result).toMatchObject({ success: true, count: 1, urlUpdated: false, failedFeeds: ['Home'] });
    expect(tasks.map(t => t.title)).toEqual(['old-home', 'Mine', 'Standup']);
    expect(tasks.at(-1)).toMatchObject({ feedId: PRIMARY_FEED_ID, color: 'bg-blue-500' });
  });

  it('touches nothing when every feed fails', async () => {
    tasks = [old(PRIMARY_FEED_ID, 'old-work')];
    vi.mocked(fetchIcsFeed).mockRejectedValue(new Error('not-ical'));
    expect(await useActions().syncWithCalendar()).toEqual({ success: false, error: 'not-ical', failedFeeds: ['Work'] });
    expect(deps.setTasks).not.toHaveBeenCalled();
  });

  it('remembers a corrected feed URL', async () => {
    vi.mocked(fetchIcsFeed).mockImplementation(async (url) => ({ icsContent: calendar(event('w1', 'Standup')), effectiveUrl: `${url}?export` }));
    const result = await useActions({ icsCalendars: [extra] }).syncWithCalendar();
    expect(result.urlUpdated).toBe(true);
    expect(deps.setSyncUrl).toHaveBeenCalledWith('https://cal.example/primary.ics?export');
    expect(store['day-planner-sync-url']).toBe('https://cal.example/primary.ics?export');
    const update = vi.mocked(deps.setIcsCalendars).mock.calls[0][0];
    expect(update([extra])).toEqual([{ ...extra, url: 'https://cal.example/home.ics?export' }]);
  });
});

describe('syncTaskCalendar', () => {
  const url = 'https://dav.example/tasks.ics';

  it('needs a task calendar URL', async () => {
    expect(await useActions().syncTaskCalendar()).toEqual({ success: false, error: 'no-url' });
  });

  it('replaces the synced task-calendar items, keeps file imports, and tombstones what vanished', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => calendar(event('t1', 'Write report')), headers: { get: () => null } })));
    tasks = [
      { id: 'gone', title: 'Gone', isTaskCalendar: true, date: '2026-10-20' },
      { id: 'filed', title: 'Filed', isTaskCalendar: true, importSource: 'file' },
      { id: 'mine', title: 'Mine' },
    ];
    store['day-planner-tasks'] = JSON.stringify(tasks);
    const result = await useActions({ taskCalendarUrl: url }).syncTaskCalendar();
    expect(fetch).toHaveBeenCalledWith(`/api/calendar-proxy/?url=${encodeURIComponent(url)}`, { headers: { 'X-Calendar-Auth': `Basic ${btoa('zoÃ«:pw')}` } });
    expect(result).toEqual({ success: true, count: 1, urlUpdated: false });
    expect(tasks.map(t => t.title)).toEqual(['Filed', 'Mine', 'Write report']);
    expect(Object.keys(JSON.parse(store['day-planner-deleted-task-ids']))).toEqual(['gone']);
  });

  it('reports a failed fetch without touching the tasks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, text: async () => '', headers: { get: () => null } })));
    expect(await useActions({ taskCalendarUrl: url }).syncTaskCalendar()).toEqual({ success: false, error: 'task-calendar' });
    expect(deps.setTasks).not.toHaveBeenCalled();
  });
});
