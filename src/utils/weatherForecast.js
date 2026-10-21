// The Open-Meteo forecast request and its hourly reading, shared by the app's
// weather hook (hooks/useWeather.js) and the headless refresh
// (headless/HeadlessRefresh.jsx), so the dial's weather ring reads the same
// numbers whichever root fetched them.

/** The forecast URL: current, six daily and hourly temperature/code/UV in the user's unit. */
export const forecastUrl = ({ lat, lon, tempUnit = 'fahrenheit', timezone }) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
  + '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code'
  + `&hourly=temperature_2m,weather_code,uv_index&temperature_unit=${tempUnit}`
  + `&timezone=${encodeURIComponent(timezone)}&forecast_days=6`;

/**
 * Hour-grained temps/codes by local date, for the Day Dial's weather ring:
 * { 'YYYY-MM-DD': { 0: {temp, code, uv}, ..., 23: {...} } }. Only dates the
 * forecast covers exist as keys; the dial treats a missing date as "no data"
 * and drops the layer for it.
 *
 * uv_index is the cloud-adjusted figure, not the clear-sky one, so an
 * overcast day genuinely reads lower; the dial's daylight band uses it to
 * scale intensity, and it is the only term there that knows about the sky
 * (haze, cloud, thin air at altitude) rather than about where the sun is.
 */
export function hourlyByDateFrom(data) {
  const hourlyByDate = {};
  if (!data?.hourly?.time) return hourlyByDate;
  data.hourly.time.forEach((iso, i) => {
    const [dateStr, hh] = iso.split('T');
    (hourlyByDate[dateStr] ??= {})[parseInt(hh, 10)] = {
      temp: Math.round(data.hourly.temperature_2m[i]),
      code: data.hourly.weather_code[i],
      uv: data.hourly.uv_index?.[i],
    };
  });
  return hourlyByDate;
}

/**
 * The hourly forecast for stored coordinates, or null when there are none or
 * the request fails or outlasts [timeoutMs]. Never throws: a run without a
 * forecast is still a run, and the launcher shell keeps the last one.
 */
export async function fetchHourlyForecast({ coords, tempUnit, timezone, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon) || typeof fetchImpl !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  // Raced rather than trusted to the abort signal, so a transport that
  // ignores the signal still cannot hold the run.
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { controller?.abort(); resolve(null); }, timeoutMs);
  });
  const request = (async () => {
    try {
      const response = await fetchImpl(forecastUrl({ lat: coords.lat, lon: coords.lon, tempUnit, timezone }), controller ? { signal: controller.signal } : undefined);
      if (!response?.ok) return null;
      const byDate = hourlyByDateFrom(await response.json());
      return Object.keys(byDate).length > 0 ? byDate : null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
