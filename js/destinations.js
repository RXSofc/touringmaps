/**
 * Destination helpers: place search (geocoding), reverse geocoding and
 * coordinate parsing. Pure browser code, no Firebase. Saving a destination
 * lives in rooms.js.
 */
import { APP } from './config.js';
import { fetchJson, sleep, NetError } from './net.js';
import { isValidLat, isValidLng, roundTo } from './geo.js';

export class GeocodeError extends Error {
  /** @param {'empty'|'short'|'timeout'|'network'|'rate-limit'|'service'|'invalid'|'aborted'} code */
  constructor(code, message) {
    super(message);
    this.name = 'GeocodeError';
    this.code = code;
  }
}

/* ------------------------------------------------------------ Coordinates */

function parseDecimal(value) {
  if (typeof value === 'number') return value;
  const s = String(value ?? '').trim().replace(/−/g, '-').replace(/°/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

/**
 * Validates a latitude/longitude pair given as strings or numbers.
 * @returns {{ok:true, latitude:number, longitude:number}|{ok:false, error:string}}
 */
export function validateLatLng(latRaw, lngRaw) {
  if (String(latRaw ?? '').trim() === '' || String(lngRaw ?? '').trim() === '') {
    return { ok: false, error: 'Enter both latitude and longitude.' };
  }
  const latitude = parseDecimal(latRaw);
  const longitude = parseDecimal(lngRaw);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    return { ok: false, error: 'Use plain decimal numbers with a dot, like -7.7956 and 110.3695.' };
  }
  if (!isValidLat(latitude)) return { ok: false, error: 'Latitude must be between -90 and 90.' };
  if (!isValidLng(longitude)) return { ok: false, error: 'Longitude must be between -180 and 180.' };
  return { ok: true, latitude: roundTo(latitude, 6), longitude: roundTo(longitude, 6) };
}

/** Parses "-7.7956, 110.3695" (comma, semicolon or whitespace separated). */
export function parseCoordinates(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, error: 'Enter coordinates like -7.7956, 110.3695.' };
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 2) return validateLatLng(parts[0], parts[1]);
  if (parts.length === 4 && /\d,\d/.test(s)) {
    return { ok: false, error: 'It looks like decimal commas were used. Write decimals with a dot: -7.7956, 110.3695.' };
  }
  return { ok: false, error: 'Enter two numbers: latitude, then longitude (for example -7.7956, 110.3695).' };
}

/* -------------------------------------------------------------- Geocoding */

const cache = new Map();
let lastRequestAt = 0;

function cacheKey(kind, value) { return `${APP.geocoder.provider}|${kind}|${value}`; }

function withLanguage(url) {
  const { language, provider } = APP.geocoder;
  if (language) url.searchParams.set(provider === 'photon' ? 'lang' : 'accept-language', language);
  return url;
}

async function throttled(signal) {
  const wait = Math.max(0, lastRequestAt + APP.geocoder.minIntervalMs - Date.now());
  if (wait) await sleep(wait, signal);
  lastRequestAt = Date.now();
}

function mapNetError(err) {
  if (err instanceof NetError) {
    if (err.kind === 'aborted') return new GeocodeError('aborted', 'Search cancelled.');
    if (err.kind === 'timeout') return new GeocodeError('timeout', 'The search service is too slow right now. Try again.');
    if (err.kind === 'network') return new GeocodeError('network', 'No connection. Check your internet and try again.');
    if (err.kind === 'http' && (err.status === 429 || err.status === 403)) {
      return new GeocodeError('rate-limit', 'Too many searches. Wait a few seconds and try again.');
    }
    if (err.kind === 'parse') return new GeocodeError('invalid', 'The search service sent an unreadable answer.');
    return new GeocodeError('service', 'The search service had a problem. Try again shortly.');
  }
  return err;
}

function normalizeNominatim(item) {
  const latitude = Number(item?.lat);
  const longitude = Number(item?.lon);
  if (!isValidLat(latitude) || !isValidLng(longitude)) return null;
  const display = String(item.display_name || '').trim();
  const name = String(item.name || '').trim() || display.split(',')[0].trim() || 'Selected place';
  return { name, address: display, latitude: roundTo(latitude, 6), longitude: roundTo(longitude, 6), source: 'geocoding' };
}

function normalizePhoton(feature) {
  const [lng, lat] = feature?.geometry?.coordinates || [];
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!isValidLat(latitude) || !isValidLng(longitude)) return null;
  const p = feature.properties || {};
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = String(p.name || street || p.city || 'Selected place').trim();
  const address = [name !== street ? street : null, p.district, p.city || p.county, p.state, p.country].filter(Boolean).join(', ');
  return { name, address: address || name, latitude: roundTo(latitude, 6), longitude: roundTo(longitude, 6), source: 'geocoding' };
}

/**
 * Searches places by name.
 * @returns {Promise<Array<{name,address,latitude,longitude,source}>>}
 * @throws {GeocodeError}
 */
export async function searchPlaces(query, { signal } = {}) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) throw new GeocodeError('empty', 'Type a place name or address.');
  if (q.length < APP.geocoder.minChars) throw new GeocodeError('short', `Type at least ${APP.geocoder.minChars} characters.`);

  const key = cacheKey('search', q.toLowerCase());
  if (cache.has(key)) return cache.get(key);

  try {
    await throttled(signal);
    const g = APP.geocoder;
    let results;
    if (g.provider === 'photon') {
      const url = withLanguage(new URL('/api/', g.photonUrl));
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(g.limit));
      const data = await fetchJson(url.toString(), { signal, timeoutMs: g.timeoutMs });
      if (!data || !Array.isArray(data.features)) throw new GeocodeError('invalid', 'The search service sent an unexpected answer.');
      results = data.features.map(normalizePhoton);
    } else {
      const url = withLanguage(new URL('/search', g.nominatimUrl));
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(g.limit));
      url.searchParams.set('addressdetails', '0');
      if (g.countryCodes) url.searchParams.set('countrycodes', g.countryCodes);
      const data = await fetchJson(url.toString(), { signal, timeoutMs: g.timeoutMs });
      if (!Array.isArray(data)) throw new GeocodeError('invalid', 'The search service sent an unexpected answer.');
      results = data.map(normalizeNominatim);
    }
    const clean = results.filter(Boolean);
    cache.set(key, clean);
    if (cache.size > 40) cache.delete(cache.keys().next().value);
    return clean;
  } catch (err) {
    throw mapNetError(err);
  }
}

/**
 * Looks up a human-readable name for a coordinate. Failure is expected and
 * harmless: callers keep using the raw coordinates.
 */
export async function reverseGeocode(latitude, longitude, { signal } = {}) {
  const key = cacheKey('reverse', `${roundTo(latitude, 4)},${roundTo(longitude, 4)}`);
  if (cache.has(key)) return cache.get(key);
  try {
    await throttled(signal);
    const g = APP.geocoder;
    let result = null;
    if (g.provider === 'photon') {
      const url = withLanguage(new URL('/reverse', g.photonUrl));
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      const data = await fetchJson(url.toString(), { signal, timeoutMs: g.timeoutMs });
      const f = data?.features?.[0];
      result = f ? normalizePhoton(f) : null;
    } else {
      const url = withLanguage(new URL('/reverse', g.nominatimUrl));
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(latitude));
      url.searchParams.set('lon', String(longitude));
      url.searchParams.set('zoom', '17');
      const data = await fetchJson(url.toString(), { signal, timeoutMs: g.timeoutMs });
      result = data && !data.error ? normalizeNominatim({ ...data, lat: data.lat ?? latitude, lon: data.lon ?? longitude }) : null;
    }
    if (!result) throw new GeocodeError('invalid', 'No place name found for these coordinates.');
    // Keep the coordinates the user chose, only borrow the name/address.
    const named = { name: result.name, address: result.address };
    cache.set(key, named);
    return named;
  } catch (err) {
    throw mapNetError(err);
  }
}
