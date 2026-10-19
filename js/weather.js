/**
 * Current weather for a point (Open-Meteo: free, no key, CORS enabled, non-commercial use).
 * Failure is normal (offline, rate limit): callers just skip the weather line.
 */
import { fetchJson } from './net.js';
import { roundTo } from './geo.js';

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const cache = new Map();   // "lat,lng" (2 decimals) -> {at, value}

const TEXT = {
  0: 'Cerah', 1: 'Cerah berawan', 2: 'Berawan', 3: 'Mendung', 45: 'Berkabut', 48: 'Berkabut',
  51: 'Gerimis', 53: 'Gerimis', 55: 'Gerimis lebat', 56: 'Gerimis', 57: 'Gerimis',
  61: 'Hujan ringan', 63: 'Hujan', 65: 'Hujan lebat', 66: 'Hujan', 67: 'Hujan lebat',
  71: 'Salju', 73: 'Salju', 75: 'Salju', 77: 'Salju', 80: 'Hujan lokal', 81: 'Hujan lokal', 82: 'Hujan lebat',
  85: 'Salju', 86: 'Salju', 95: 'Badai petir', 96: 'Badai petir', 99: 'Badai petir'
};

export const describeWeather = (code) => TEXT[code] || 'Berawan';
export const isWet = (code) => [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);

/** "Cerah · 30°C", plus "peluang hujan 60%" only when rain is likely but not already falling. */
export function weatherLine(w) {
  if (!w) return '';
  const parts = [describeWeather(w.code), `${w.temp}°C`];
  if (!isWet(w.code) && w.rainChance >= 50) parts.push(`peluang hujan ${w.rainChance}%`);
  return parts.join(' · ');
}

export async function fetchWeather(latitude, longitude, { signal, ttlMs = 600000 } = {}) {
  const key = `${roundTo(latitude, 2)},${roundTo(longitude, 2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const url = new URL(URL_BASE);
  url.searchParams.set('latitude', String(roundTo(latitude, 3)));
  url.searchParams.set('longitude', String(roundTo(longitude, 3)));
  url.searchParams.set('current', 'temperature_2m,weather_code');
  url.searchParams.set('hourly', 'precipitation_probability');
  url.searchParams.set('forecast_hours', '3');
  url.searchParams.set('timezone', 'auto');
  const data = await fetchJson(url.toString(), { signal, timeoutMs: 8000 });
  const t = Number(data?.current?.temperature_2m);
  const code = Number(data?.current?.weather_code);
  if (!Number.isFinite(t) || !Number.isFinite(code)) return null;
  const probs = (data?.hourly?.precipitation_probability || []).slice(0, 2).filter(Number.isFinite);
  const value = { temp: Math.round(t), code, rainChance: probs.length ? Math.max(...probs) : 0 };
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  return value;
}
