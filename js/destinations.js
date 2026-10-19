/**
 * Destination helpers: place search (geocoding), reverse geocoding and
 * coordinate parsing. Pure browser code, no Firebase. Saving a destination
 * lives in rooms.js.
 */
import { MAP_CONFIG, usableProviders } from './map-config.js';
import { fetchJson, sleep, NetError } from './net.js';
import { isValidLat, isValidLng, roundTo } from './geo.js';
import { regionFromNominatim, regionFromPhoton } from './region.js';

export class GeocodeError extends Error {
  /** @param {'empty'|'short'|'timeout'|'network'|'rate-limit'|'service'|'invalid'|'aborted'|'unavailable'} code */
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
/*
 * Providers come from js/map-config.js. Each one has an adapter by `type`.
 * Search walks the provider chain: a provider that is rate-limiting, slow,
 * offline or broken is skipped (and cooled down after a 429/403) and the next is
 * tried. Manual coordinates never depend on any of this.
 */

const G = MAP_CONFIG.geocoder;
const cache = new Map();
const runtime = new Map();   // provider id -> {lastAt, coolUntil}
const rt = (id) => { let r = runtime.get(id); if (!r) { r = { lastAt: 0, coolUntil: 0 }; runtime.set(id, r); } return r; };

const cacheKey = (kind, value) => `${kind}|${value}`;

function endpoint(p, path) {
  const url = new URL(`${p.baseUrl.replace(/\/+$/, '')}${path}`);
  if (p.apiKeyParam && p.apiKey) url.searchParams.set(p.apiKeyParam, p.apiKey);
  return url;
}

function localise(url, p) {
  if (G.language) url.searchParams.set(p.type === 'photon' ? 'lang' : 'accept-language', G.language);
  if (G.contactEmail && p.type === 'nominatim' && p.id === 'nominatim') url.searchParams.set('email', G.contactEmail);
  return url;
}

async function throttled(p, signal) {
  const r = rt(p.id);
  const wait = Math.max(0, r.lastAt + p.minIntervalMs - Date.now());
  r.lastAt = Date.now() + wait;
  if (wait) await sleep(wait, signal);
}

function mapNetError(err) {
  if (err instanceof NetError) {
    if (err.kind === 'aborted') return new GeocodeError('aborted', 'Search cancelled.');
    if (err.kind === 'timeout') return new GeocodeError('timeout', 'The search service is too slow right now.');
    if (err.kind === 'network') return new GeocodeError('network', 'No connection. Check your internet and try again.');
    if (err.kind === 'http' && (err.status === 429 || err.status === 403)) return new GeocodeError('rate-limit', 'The search service is limiting requests.');
    if (err.kind === 'parse') return new GeocodeError('invalid', 'The search service sent an unreadable answer.');
    return new GeocodeError('service', 'The search service had a problem.');
  }
  return err;
}

const MANUAL_HINT = ' You can still enter coordinates manually.';
const RETRY_NEXT = new Set(['timeout', 'network', 'rate-limit', 'service', 'invalid']);

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

const ADAPTERS = {
  nominatim: {
    async search(p, q, signal) {
      const url = localise(endpoint(p, '/search'), p);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(G.limit));
      url.searchParams.set('addressdetails', '0');
      if (G.countryCodes) url.searchParams.set('countrycodes', G.countryCodes);
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      if (!Array.isArray(data)) throw new NetError('parse', 'unexpected answer');
      return data.map(normalizeNominatim);
    },
    async reverse(p, lat, lng, signal) {
      const url = localise(endpoint(p, '/reverse'), p);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('zoom', '17');
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      return data && !data.error ? normalizeNominatim({ ...data, lat: data.lat ?? lat, lon: data.lon ?? lng }) : null;
    },
    async region(p, lat, lng, signal) {
      const url = localise(endpoint(p, '/reverse'), p);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      url.searchParams.set('zoom', '14');          // up to suburb level: enough for kabupaten/kota + area
      url.searchParams.set('addressdetails', '1');
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      return data && !data.error ? regionFromNominatim(data.address) : null;
    }
  },
  photon: {
    async search(p, q, signal) {
      const url = localise(endpoint(p, '/api/'), p);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', String(G.limit));
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      if (!data || !Array.isArray(data.features)) throw new NetError('parse', 'unexpected answer');
      return data.features.map(normalizePhoton);
    },
    async reverse(p, lat, lng, signal) {
      const url = localise(endpoint(p, '/reverse'), p);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      const f = data?.features?.[0];
      return f ? normalizePhoton(f) : null;
    },
    async region(p, lat, lng, signal) {
      const url = localise(endpoint(p, '/reverse'), p);
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lng));
      const data = await fetchJson(url.toString(), { signal, timeoutMs: G.timeoutMs });
      return regionFromPhoton(data?.features?.[0]?.properties);
    }
  }
};

/** Runs `op` against each usable provider in turn until one answers. */
async function viaChain(op, signal) {
  const chain = usableProviders('geocoder').filter((p) => ADAPTERS[p.type]);
  if (!chain.length) throw new GeocodeError('unavailable', `Place search is not configured.${MANUAL_HINT}`);
  let lastErr = null;
  for (const p of chain) {
    const r = rt(p.id);
    if (Date.now() < r.coolUntil) { lastErr ||= new GeocodeError('rate-limit', 'The search service is limiting requests.'); continue; }
    try {
      await throttled(p, signal);
      const value = await op(ADAPTERS[p.type], p);
      return { value, provider: p };
    } catch (raw) {
      const err = mapNetError(raw);
      if (err.code === 'aborted') throw err;
      if (err.code === 'rate-limit') r.coolUntil = Date.now() + G.cooldownMs;
      if (!RETRY_NEXT.has(err.code)) throw err;
      lastErr = err;
    }
  }
  const e = lastErr || new GeocodeError('service', 'The search service had a problem.');
  throw new GeocodeError(e.code, `${e.message}${MANUAL_HINT}`);
}

/**
 * Searches places by name.
 * The returned array has a non-enumerable `provider` id telling which service answered.
 * @returns {Promise<Array<{name,address,latitude,longitude,source}>>}
 * @throws {GeocodeError}
 */
export async function searchPlaces(query, { signal } = {}) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!q) throw new GeocodeError('empty', 'Type a place name or address.');
  if (q.length < G.minChars) throw new GeocodeError('short', `Type at least ${G.minChars} characters.`);

  const key = cacheKey('search', q.toLowerCase());
  if (cache.has(key)) return cache.get(key);

  const { value, provider } = await viaChain((adapter, p) => adapter.search(p, q, signal), signal);
  const clean = value.filter(Boolean);
  Object.defineProperty(clean, 'provider', { value: provider.id, enumerable: false });
  Object.defineProperty(clean, 'providerLabel', { value: provider.label, enumerable: false });
  Object.defineProperty(clean, 'isFallback', { value: provider.id !== usableProviders('geocoder')[0]?.id, enumerable: false });
  cache.set(key, clean);
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return clean;
}

/**
 * Looks up a human-readable name for a coordinate. Failure is expected and
 * harmless: callers keep using the raw coordinates.
 */
export async function reverseGeocode(latitude, longitude, { signal } = {}) {
  const key = cacheKey('reverse', `${roundTo(latitude, 4)},${roundTo(longitude, 4)}`);
  if (cache.has(key)) return cache.get(key);
  const { value } = await viaChain((adapter, p) => adapter.reverse(p, latitude, longitude, signal), signal);
  if (!value) throw new GeocodeError('invalid', 'No place name found for these coordinates.');
  // Keep the coordinates the user chose, only borrow the name/address.
  const named = { name: value.name, address: value.address };
  cache.set(key, named);
  return named;
}

/**
 * Which kabupaten/kota (and area) a coordinate is in: {key, label, area} or null.
 * Shares the provider chain, throttle and cool-down with search; results are cached per ~110 m.
 */
const regionCache = new Map();
export async function reverseRegion(latitude, longitude, { signal } = {}) {
  const key = `${roundTo(latitude, 3)},${roundTo(longitude, 3)}`;
  if (regionCache.has(key)) return regionCache.get(key);
  const { value } = await viaChain((adapter, p) => adapter.region(p, latitude, longitude, signal), signal);
  regionCache.set(key, value || null);
  if (regionCache.size > 120) regionCache.delete(regionCache.keys().next().value);
  return value || null;
}
