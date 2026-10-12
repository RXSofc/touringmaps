/**
 * Route calculation (OSRM-compatible HTTP API).
 *
 * What this is: a road-network route with an estimated duration, from the
 * routing profile the server offers (the public OSRM demo = a car profile).
 * What this is NOT: live traffic, road closures, a motorcycle-validated route
 * or turn-by-turn guidance. The UI says so wherever an ETA is shown.
 */
import { APP } from './config.js';
import { fetchJson, NetError } from './net.js';
import { haversine, distanceToPolyline, isValidPoint } from './geo.js';

export class RouteError extends Error {
  constructor(code, message) { super(message); this.name = 'RouteError'; this.code = code; }
}

/**
 * @param {{latitude:number,longitude:number}} from
 * @param {{latitude:number,longitude:number}} to
 * @returns {Promise<{coords:number[][], distanceMeters:number, durationSeconds:number}>}
 */
export async function fetchRoute(from, to, { signal } = {}) {
  if (!isValidPoint(from) || !isValidPoint(to)) throw new RouteError('invalid', 'Both route points need valid coordinates.');
  const r = APP.routing;
  const coords = `${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`;
  const url = `${r.baseUrl}/${coords}?overview=${r.overview}&geometries=geojson&steps=false&alternatives=false`;

  let data;
  try {
    data = await fetchJson(url, { signal, timeoutMs: r.timeoutMs });
  } catch (err) {
    if (err instanceof NetError) {
      if (err.kind === 'aborted') throw new RouteError('aborted', 'Route request cancelled.');
      if (err.kind === 'timeout') throw new RouteError('timeout', 'The routing service is too slow right now.');
      if (err.kind === 'network') throw new RouteError('network', 'No connection to the routing service.');
      if (err.kind === 'http' && err.status === 429) throw new RouteError('rate-limit', 'The routing service is rate-limiting requests. Try again in a minute.');
      if (err.kind === 'http' && err.status === 400) throw new RouteError('no-route', 'No road route was found between these points.');
      throw new RouteError('service', 'The routing service had a problem.');
    }
    throw err;
  }

  if (data?.code === 'NoRoute') throw new RouteError('no-route', 'No road route was found between these points.');
  const route = data?.code === 'Ok' ? data.routes?.[0] : null;
  const line = route?.geometry?.coordinates;
  if (!route || !Array.isArray(line) || line.length < 2 || !Number.isFinite(route.distance)) {
    throw new RouteError('invalid', 'The routing service sent an unusable answer.');
  }
  return {
    coords: line.map(([lng, lat]) => [lat, lng]),
    distanceMeters: route.distance,
    durationSeconds: Number.isFinite(route.duration) ? route.duration : NaN
  };
}

/** Links that hand navigation to a dedicated maps app. */
export function externalNavLinks(dest) {
  const ll = `${dest.latitude},${dest.longitude}`;
  return {
    // Google Maps documents travelmode=two-wheeler for supported regions.
    google: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ll)}&travelmode=two-wheeler`,
    osm: `https://www.openstreetmap.org/directions?route=%3B${encodeURIComponent(ll)}`,
    geo: `geo:${ll}?q=${encodeURIComponent(`${ll}(${String(dest.name || 'Destination').slice(0, 60)})`)}`
  };
}

/**
 * Owns "when to recalculate". Feed it destination and position updates freely;
 * it only issues a request when one of these holds:
 *   - the destination changed
 *   - I moved far from where the current route started
 *   - I am off the route line
 *   - the user pressed refresh
 * and never faster than the configured intervals.
 */
export class RouteManager {
  constructor({ onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.destination = null;
    this.origin = null;
    this.state = { status: 'idle', route: null, error: null, calculatedAt: null };
    this.routeOrigin = null;
    this.lastRequestAt = 0;
    this.controller = null;
    this.offRouteStrikes = 0;
    this.generation = 0;
    this.enabled = true;
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this._cancel();
  }

  setDestination(dest) {
    const same = this.destination && dest &&
      this.destination.latitude === dest.latitude && this.destination.longitude === dest.longitude;
    if (same) { this.destination = dest; return; }
    this.destination = dest || null;
    this._cancel();
    this.routeOrigin = null;
    this.offRouteStrikes = 0;
    if (!dest) { this._set({ status: 'idle', route: null, error: null, calculatedAt: null }); return; }
    this._set({ status: this.origin ? 'loading' : 'idle', route: null, error: null, calculatedAt: null });
    if (this.origin) this._request('destination-changed', true);
  }

  updateOrigin(point) {
    if (!isValidPoint(point)) return;
    this.origin = point;
    if (!this.destination || !this.enabled) return;
    const { status, route } = this.state;
    const r = APP.routing;
    const sinceLast = Date.now() - this.lastRequestAt;

    if (status === 'loading') return;
    if (!route) {
      // First route after a position arrives (error state waits for manual retry).
      if (status === 'idle') this._request('first-position', true);
      return;
    }
    if (sinceLast < r.minRecalcIntervalMs) return;

    const moved = this.routeOrigin ? haversine(this.routeOrigin, point) : Infinity;
    if (moved >= r.recalcMoveMeters) {
      const off = distanceToPolyline(point, route.coords);
      if (off > r.offRouteMeters) this.offRouteStrikes += 1; else this.offRouteStrikes = 0;
      // Moving along the route: refresh occasionally. Off the route twice in a row: refresh now.
      if (this.offRouteStrikes >= 2 || moved >= r.recalcMoveMeters * 4) this._request('moved', true);
    }
  }

  /** User-requested refresh. */
  refresh() {
    if (!this.destination || !this.origin) return false;
    if (Date.now() - this.lastRequestAt < APP.routing.manualMinIntervalMs) return false;
    this._request('manual', true);
    return true;
  }

  _cancel() {
    this.generation += 1;
    if (this.controller) this.controller.abort();
    this.controller = null;
  }

  async _request(_reason, showLoading) {
    if (!this.destination || !this.origin) return;
    this._cancel();
    const generation = this.generation;
    this.controller = new AbortController();
    this.lastRequestAt = Date.now();
    const from = this.origin;
    const to = this.destination;
    if (showLoading) this._set({ status: 'loading', error: null });
    try {
      const route = await fetchRoute(from, to, { signal: this.controller.signal });
      if (generation !== this.generation) return;
      this.routeOrigin = from;
      this.offRouteStrikes = 0;
      this._set({ status: 'ok', route, error: null, calculatedAt: Date.now() });
    } catch (err) {
      if (generation !== this.generation || err?.code === 'aborted') return;
      // Keep the previous route line if we have one; just flag the failure.
      this._set({ status: 'error', error: err instanceof RouteError ? err : new RouteError('service', 'Route calculation failed.') });
    }
  }

  destroy() { this._cancel(); this.onChange = () => {}; }
}
