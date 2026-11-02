/**
 * Fuel stops (SPBU) along the route.
 *
 * Station data comes from OpenStreetMap through the Overpass API: one query for the next stretch of the route
 * (default 60 km), repeated as the rider moves on. Only a thinned-out copy of the route line is sent.
 * The maths (placing stations on the route, left/right side, "next one") is plain and tested in tests/fuel-test.mjs.
 */
import { buildPath, projectOnPath } from './guidance.js';

const M_LAT = 111320;
const toRad = (d) => (d * Math.PI) / 180;

export const OVERPASS = Object.freeze([
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
]);

/** Points along `path` every `stepM` between `fromM` and `toM`, as [lat,lng]. Always includes both ends. */
export function samplePath(path, fromM, toM, stepM = 1000, maxPts = 90) {
  const { coords, cum, total } = path;
  if (!coords || coords.length < 2) return [];
  const a = Math.max(0, fromM); const b = Math.min(total, toM);
  if (b <= a) return [];
  const step = Math.max(stepM, (b - a) / (maxPts - 1));
  const out = [];
  let i = 0;
  for (let m = a; m < b + step * 0.999; m += step) {
    const d = Math.min(m, b);
    while (i < coords.length - 2 && cum[i + 1] < d) i++;
    const span = cum[i + 1] - cum[i];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[i]) / span)) : 0;
    out.push([coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t]);
    if (d >= b) break;
  }
  return out;
}

/** Overpass QL for every fuel station within `radiusM` of the polyline. */
export function buildQuery(points, radiusM = 400) {
  const poly = points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(',');
  return `[out:json][timeout:25];nwr["amenity"="fuel"](around:${radiusM},${poly});out center tags 200;`;
}

/** Overpass JSON -> [{id, lat, lng, name, brand}] (no road maths yet). */
export function parseStations(json) {
  const out = [];
  for (const el of json?.elements || []) {
    const lat = Number(el.lat ?? el.center?.lat); const lng = Number(el.lon ?? el.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const t = el.tags || {};
    const brand = String(t.brand || t.operator || '').trim();
    const name = String(t.name || brand || 'SPBU').trim();
    out.push({ id: `${el.type || 'n'}${el.id}`, lat, lng, name: name.slice(0, 60), brand: brand.slice(0, 40) });
  }
  return out;
}

/** Network call with a mirror fallback. */
export async function fetchStations(points, { signal, radiusM = 400, timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const body = `data=${encodeURIComponent(buildQuery(points, radiusM))}`;
  let lastErr = null;
  for (const url of OVERPASS) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await fetchImpl(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseStations(await res.json());
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
  throw lastErr || new Error('fuel lookup failed');
}

/** Which side of the road the point is on, looking in the direction of travel. */
export function sideAt(path, along, lat, lng) {
  const { coords, cum } = path;
  let i = 0;
  while (i < coords.length - 2 && cum[i + 1] < along) i++;
  const mLng = M_LAT * Math.cos(toRad(lat));
  const bx = (coords[i + 1][1] - coords[i][1]) * mLng; const by = (coords[i + 1][0] - coords[i][0]) * M_LAT;
  const sx = (lng - coords[i][1]) * mLng; const sy = (lat - coords[i][0]) * M_LAT;
  const cross = bx * sy - by * sx;
  return cross > 0 ? 'left' : 'right';
}

/** Places stations on the route: distance along it, sideways offset, side. Drops far ones and duplicates. */
export function placeStations(path, stations, { maxLateralM = 450, dedupeM = 60 } = {}) {
  const placed = [];
  for (const s of stations) {
    const p = projectOnPath(path, s.lat, s.lng);
    if (p.lateral > maxLateralM) continue;
    placed.push({ ...s, along: p.along, lateral: p.lateral, side: sideAt(path, p.along, s.lat, s.lng) });
  }
  placed.sort((a, b) => a.along - b.along);
  const kept = [];
  for (const s of placed) {
    const twin = kept.find((k) => Math.abs(k.along - s.along) < dedupeM && Math.hypot((k.lat - s.lat) * M_LAT, (k.lng - s.lng) * M_LAT * Math.cos(toRad(s.lat))) < dedupeM);
    if (twin) { if (!twin.brand && s.brand) twin.brand = s.brand; continue; }
    kept.push(s);
  }
  return kept;
}

/** "SPBU Pertamina" / "SPBU Shell": the name as the rider would say it. */
export function spokenName(s) {
  const n = (s.brand || s.name || '').replace(/^spbu\s*/i, '').replace(/\s*\d[\d.\- ]*$/, '').trim();
  return n && n.toLowerCase() !== 'spbu' ? `SPBU ${n}` : 'SPBU';
}

/**
 * Keeps the station list for the current route up to date and says when one is coming up.
 *
 * cfg: {windowM, refetchM, announceM, announceGapM, retryMs}
 * io:  {fetcher(points, {signal}) -> stations, onChange(list), onAnnounce(station, distanceM)}
 */
export class FuelWatch {
  constructor(cfg, io) {
    this.cfg = cfg;
    this.io = io;
    this.enabled = true;
    this.setRoute(null);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) { this._abort(); this.io.onChange?.([]); } else if (this.path) this.io.onChange?.(this.list);
  }

  /** `keep`: same trip, new route line (a refresh): keep the stations already found, so nothing flickers. */
  setRoute(route, { keep = false } = {}) {
    this._abort();
    const prevRaw = keep ? this.raw : null;
    const prevAnnounced = keep ? this.announced : null;
    this.path = route?.coords?.length > 1 ? buildPath(route.coords) : null;
    this.raw = prevRaw && this.path ? prevRaw : new Map();
    this.list = this.path && this.raw.size ? placeStations(this.path, [...this.raw.values()]) : [];
    this.fetchedTo = -1;
    this.busy = false;
    this.retryAt = 0;
    this.failed = false;
    this.announced = prevAnnounced && this.path ? prevAnnounced : new Set();
    this.lastAnnouncedAlong = -Infinity;
    this.along = 0;
    this.io.onChange?.(this.list);
  }

  _abort() { this.ctl?.abort(); this.ctl = null; this.gen = (this.gen || 0) + 1; }

  /** Stations still ahead (nearest first). */
  ahead(alongM = this.along, limitM = Infinity) {
    return this.list.filter((s) => s.along - alongM > 40 && s.along - alongM <= limitM);
  }

  next(alongM = this.along) { return this.ahead(alongM)[0] || null; }

  update(alongM, now = Date.now()) {
    if (!this.enabled || !this.path || !Number.isFinite(alongM)) return;
    this.along = alongM;
    const c = this.cfg;
    if (!this.busy && now >= this.retryAt && this.fetchedTo < this.path.total && alongM > this.fetchedTo - c.refetchM) this._fetch(alongM, now);
    const nxt = this.next(alongM);
    if (nxt && !this.announced.has(nxt.id)) {
      const d = nxt.along - alongM;
      if (d <= c.announceM && alongM - this.lastAnnouncedAlong >= c.announceGapM) {
        this.announced.add(nxt.id);
        this.lastAnnouncedAlong = alongM;
        this.io.onAnnounce?.(nxt, d);
      }
    }
  }

  async _fetch(alongM, now) {
    const c = this.cfg;
    const from = Math.max(0, Math.min(alongM - 300, this.fetchedTo > 0 ? this.fetchedTo - 500 : alongM - 300));
    const to = Math.min(this.path.total, alongM + c.windowM);
    const pts = samplePath(this.path, from, to);
    if (pts.length < 2) { this.fetchedTo = this.path.total; return; }
    this.busy = true;
    const gen = this.gen;
    this.ctl = new AbortController();
    try {
      const found = await this.io.fetcher(pts, { signal: this.ctl.signal });
      if (gen !== this.gen) return;
      for (const s of found) this.raw.set(s.id, s);
      this.fetchedTo = to;
      this.failed = false;
      this.list = placeStations(this.path, [...this.raw.values()]);
      this.io.onChange?.(this.list);
    } catch (e) {
      if (gen !== this.gen) return;
      this.failed = true;
      this.retryAt = now + c.retryMs;
    } finally {
      if (gen === this.gen) { this.busy = false; this.ctl = null; }
    }
  }
}
