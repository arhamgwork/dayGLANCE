import { describe, it, expect, vi, afterEach } from 'vitest';
import { forecastUrl, hourlyByDateFrom, fetchHourlyForecast } from './weatherForecast.js';

const body = {
  hourly: {
    time: ['2026-10-19T08:00', '2026-10-19T09:00', '2026-10-20T00:00'],
    temperature_2m: [10.4, 11.6, 3.2],
    weather_code: [1, 2, 3],
    uv_index: [0.5, 1.25, 0],
  },
};

describe('forecastUrl', () => {
  it('asks for hourly temperature, code and UV in the unit, for six days, in the zone', () => {
    const url = forecastUrl({ lat: 39.74, lon: -104.99, tempUnit: 'celsius', timezone: 'America/Denver' });
    expect(url).toContain('latitude=39.74&longitude=-104.99');
    expect(url).toContain('hourly=temperature_2m,weather_code,uv_index');
    expect(url).toContain('temperature_unit=celsius');
    expect(url).toContain('timezone=America%2FDenver');
    expect(url).toContain('forecast_days=6');
  });
});

describe('hourlyByDateFrom', () => {
  it('groups hours by local date with rounded temperatures', () => {
    expect(hourlyByDateFrom(body)).toEqual({
      '2026-10-19': { 8: { temp: 10, code: 1, uv: 0.5 }, 9: { temp: 12, code: 2, uv: 1.25 } },
      '2026-10-20': { 0: { temp: 3, code: 3, uv: 0 } },
    });
  });

  it('is empty without hourly data', () => {
    expect(hourlyByDateFrom({})).toEqual({});
    expect(hourlyByDateFrom(null)).toEqual({});
  });
});

describe('fetchHourlyForecast', () => {
  afterEach(() => { vi.useRealTimers(); });
  const coords = { lat: 39.74, lon: -104.99 };

  it('fetches nothing without stored coordinates', async () => {
    const fetchImpl = vi.fn();
    expect(await fetchHourlyForecast({ coords: null, tempUnit: 'celsius', timezone: 'UTC', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the hourly forecast', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => body }));
    const out = await fetchHourlyForecast({ coords, tempUnit: 'celsius', timezone: 'UTC', fetchImpl });
    expect(Object.keys(out)).toEqual(['2026-10-19', '2026-10-20']);
    expect(fetchImpl.mock.calls[0][0]).toContain('temperature_unit=celsius');
  });

  it('a failed, refused or empty response is null, never a throw', async () => {
    expect(await fetchHourlyForecast({ coords, timezone: 'UTC', fetchImpl: async () => { throw new Error('offline'); } })).toBeNull();
    expect(await fetchHourlyForecast({ coords, timezone: 'UTC', fetchImpl: async () => ({ ok: false }) })).toBeNull();
    expect(await fetchHourlyForecast({ coords, timezone: 'UTC', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })).toBeNull();
  });

  it('gives up at the timeout even when the transport ignores the abort', async () => {
    vi.useFakeTimers();
    const pending = fetchHourlyForecast({ coords, timezone: 'UTC', timeoutMs: 1000, fetchImpl: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBeNull();
  });
});
