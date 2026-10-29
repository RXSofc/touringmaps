/**
 * Route calculation (OSRM-compatible HTTP API).
 *
 * What this is: a road-network route with an estimated duration, from the
 * routing profile the server offers (the public OSRM demo = a car profile).
 * What this is NOT: live traffic, road closures, a motorcycle-validated route
 * or turn-by-turn guidance. The UI says so wherever an ETA is shown.
 */
import { MAP_CONFIG, usableProviders } from './map-config.js';
import { fetchJson, NetError, sleep } from './net.js';
import { haversine, distanceToPolyline, isValidPoint } from './geo.js';

export class RouteError extends Error {
  constructor(code, message) { super(message); this.name = 'RouteError'; this.code = code; }
}

const R = MAP_CONFIG.routing;
const runtime = new Map();   // provider id -> {lastAt, coolUntil}
const rt = (id) => { let r = runtime.get(id); if (!r) { r = { lastAt: 0, coolUntil: 0 }; runtime.set(id, r); } return r; };
const RETRY_NEXT = new Set(['timeout', 'network', 'rate-limit', 'service', 'invalid']);

function mapNetError(err) {
  if (err instanceof NetError) {
    if (err.kind === 'aborted') return new RouteError('aborted', 'Route request cancelled.');
    if (err.kind === 'timeout') return new RouteError('timeout', 'The routing service is too slow right now.');
    if (err.kind === 'network') return new RouteError('network', 'No connection to the routing service.');
    if (err.kind === 'http' && (err.status === 429 || err.status === 403)) return new RouteError('rate-limit', 'The routing service is rate-limiting requests. Try again in a minute.');
    if (err.kind === 'http' && err.status === 400) return new RouteError('no-route', 'No road route was found between these points.');
    return new RouteError('service', 'The routing service had a problem.');
  }
  return err;
}

const noExclude = new Set();   // "providerId:value" whose server rejected that `exclude=` (remembered for this session)
// Only these OSRM answers mean "I do not understand exclude=". Anything else (NoSegment, TooBig…)
// must NOT switch the toll filter off for the rest of the session.
const EXCLUDE_UNSUPPORTED = new Set(['InvalidValue', 'InvalidOptions', 'InvalidQuery', 'InvalidUrl']);

/** Turns an OSRM route into what the app needs, including the road classes it uses. */
function parseOsrmRoute(route) {
  const line = route?.geometry?.coordinates;
  if (!route || !Array.isArray(line) || line.length < 2 || !Number.isFinite(route.distance)) {
    throw new RouteError('invalid', 'The routing service sent an unusable answer.');
  }
  const steps = [];
  const classes = new Set();
  for (const leg of route.legs || []) {
    for (const st of leg.steps || []) {
      const m = st.maneuver;
      if (!m || !Array.isArray(m.location)) continue;
      const stepClasses = new Set();
      for (const inter of st.intersections || []) for (const c of inter.classes || []) { classes.add(c); stepClasses.add(c); }
      // belt and braces: a road literally called "Tol ..." / "... Toll" counts as toll even when untagged
      const tolled = /(^|[^a-z])(tol|toll)([^a-z]|$)/i.test(`${st.name || ''} ${st.ref || ''}`);
      if (tolled) classes.add('toll');
      steps.push({
        type: m.type,
        modifier: m.modifier || null,
        exit: Number.isFinite(m.exit) ? m.exit : null,
        bearingAfter: Number.isFinite(m.bearing_after) ? m.bearing_after : null,
        name: String(st.name || ''),
        distance: Number.isFinite(st.distance) ? st.distance : 0,
        toll: tolled || stepClasses.has('toll'),
        tunnel: stepClasses.has('tunnel'),
        location: [m.location[1], m.location[0]]       // [lat, lng]
      });
    }
  }
  return {
    coords: line.map(([lng, lat]) => [lat, lng]),
    distanceMeters: route.distance,
    durationSeconds: Number.isFinite(route.duration) ? route.duration : NaN,
    steps,
    classes: [...classes]
  };
}

/** OSRM-compatible adapter (also fits self-hosted OSRM and most OSRM-style hosted services). */
const ADAPTERS = {
  async osrm(p, from, to, signal) {
    const coords = `${from.longitude.toFixed(6)},${from.latitude.toFixed(6)};${to.longitude.toFixed(6)},${to.latitude.toFixed(6)}`;
    const build = (exclude) => {
      const url = new URL(`${p.baseUrl.replace(/\/+$/, '')}/${coords}`);
      url.searchParams.set('overview', R.overview);
      url.searchParams.set('geometries', 'geojson');
      url.searchParams.set('steps', String(!!R.steps));
      url.searchParams.set('alternatives', 'false');
      if (exclude) url.searchParams.set('exclude', exclude);
      if (p.apiKeyParam && p.apiKey) url.searchParams.set(p.apiKeyParam, p.apiKey);
      return url.toString();
    };
    const ask = async (exclude) => {
      try {
        return await fetchJson(build(exclude), { signal, timeoutMs: R.timeoutMs });
      } catch (err) {
        if (err instanceof NetError && err.kind === 'http' && err.status === 400 && err.body) return err.body; // OSRM answers errors as JSON
        throw err;
      }
    };

    // Attempt order: every configured avoid value (toll first), then the same without exclude.
    // Whatever comes back is scanned for toll/motorway classes and flagged UNSAFE if it has them.
    const attempts = R.avoid.filter((v) => !noExclude.has(`${p.id}:${v}`));
    let firstBlocked = null;
    let sawNoRoute = false;
    for (const exclude of [...attempts, null]) {
      const data = await ask(exclude);
      if (exclude && data?.code && !['Ok', 'NoRoute'].includes(data.code)) {
        if (EXCLUDE_UNSUPPORTED.has(data.code)) noExclude.add(`${p.id}:${exclude}`);   // server cannot do this exclude; try the next
        else if (data.code === 'NoSegment') throw new RouteError('no-route', 'No road was found near your position or the destination.');
        continue;
      }
      if (data?.code === 'NoRoute') { sawNoRoute = true; continue; }
      if (data?.code !== 'Ok') { if (!exclude) throw new RouteError('invalid', 'The routing service sent an unusable answer.'); continue; }
      const parsed = parseOsrmRoute(data.routes?.[0]);
      const blocked = R.blockClasses.filter((c) => parsed.classes.includes(c));
      const result = { ...parsed, tollAvoidedByServer: !!exclude, blockedClasses: blocked };
      if (!blocked.length) return result;            // clean route: done
      firstBlocked ||= result;                       // remember it, maybe the next attempt is clean
    }
    if (firstBlocked) return firstBlocked;           // every option touches toll/motorway: flag it, never guide it
    if (sawNoRoute && attempts.length) {
      throw new RouteError('no-route-toll-free', 'No route without toll roads was found. Motorcycles cannot use toll roads, so use a maps app.');
    }
    throw new RouteError('no-route', 'No road route was found between these points.');
  }
};

/**
 * Calculates a road route, trying each configured routing provider in order.
 * Providers that are rate-limiting are skipped for a cool-down; "no route" is
 * final (another provider would say the same) and goes straight to the user.
 * @param {{latitude:number,longitude:number}} from
 * @param {{latitude:number,longitude:number}} to
 * @returns {Promise<{coords:number[][], distanceMeters:number, durationSeconds:number, provider:string, providerLabel:string, isFallback:boolean}>}
 */
export async function fetchRoute(from, to, { signal } = {}) {
  if (!isValidPoint(from) || !isValidPoint(to)) throw new RouteError('invalid', 'Both route points need valid coordinates.');
  const chain = usableProviders('routing').filter((p) => ADAPTERS[p.type]);
  if (!chain.length) throw new RouteError('unavailable', 'No routing service is configured. Use “Open in Maps” for directions.');

  let lastErr = null;
  for (const p of chain) {
    const r = rt(p.id);
    if (Date.now() < r.coolUntil) { lastErr ||= new RouteError('rate-limit', 'The routing service is rate-limiting requests. Try again in a minute.'); continue; }
    try {
      const wait = Math.max(0, r.lastAt + (p.minIntervalMs || 0) - Date.now());
      r.lastAt = Date.now() + wait;
      if (wait) await sleep(wait, signal);
      const result = await ADAPTERS[p.type](p, from, to, signal);
      return { ...result, provider: p.id, providerLabel: p.label, isFallback: p.id !== chain[0].id };
    } catch (raw) {
      const err = mapNetError(raw);
      if (err.code === 'aborted' || err.code === 'no-route' || err.code === 'no-route-toll-free') throw err;
      if (err.code === 'rate-limit') r.coolUntil = Date.now() + R.cooldownMs;
      if (!RETRY_NEXT.has(err.code)) throw err;
      lastErr = err;
    }
  }
  throw lastErr || new RouteError('service', 'The routing service had a problem.');
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
    this.state = { status: 'idle', route: null, error: null, calculatedAt: null, rerouting: false };
    this.rerouteTries = 0;
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
    clearTimeout(this._rerouteTimer);
    this.rerouteTries = 0;
    if (!dest) { this._set({ status: 'idle', route: null, error: null, calculatedAt: null, rerouting: false }); return; }
    this._set({ status: this.origin ? 'loading' : 'idle', route: null, error: null, calculatedAt: null, rerouting: false });
    if (this.origin) this._request('destination-changed', true);
  }

  updateOrigin(point) {
    if (!isValidPoint(point)) return;
    this.origin = point;
    if (!this.destination || !this.enabled) return;
    const { status, route } = this.state;
    const r = R;
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
    if (Date.now() - this.lastRequestAt < R.manualMinIntervalMs) return false;
    this._request('manual', true);
    return true;
  }

  /**
   * Fast recalculation when the rider has left the route (turn guidance asked for it).
   * Rate limited to `minGapMs`; a request inside that window is deferred, not dropped.
   * The old route line stays on the map while the new one loads.
   */
  reroute(minGapMs = 3500, retries = 5) {
    if (!this.destination || !this.origin || !this.enabled) return false;
    clearTimeout(this._rerouteTimer);
    this.rerouteTries = 0;
    this.rerouteMax = retries;
    this.rerouteGap = minGapMs;
    if (!this.state.rerouting) this._set({ rerouting: true });   // UI: "recalculating", old line dimmed
    this._scheduleReroute(minGapMs);
    return true;
  }

  _scheduleReroute(gapMs) {
    clearTimeout(this._rerouteTimer);
    const wait = Math.max(0, gapMs - (Date.now() - this.lastRequestAt));
    const run = () => { if (this.destination && this.origin && this.state.rerouting) this._request('off-route', false); };
    if (wait === 0) run(); else this._rerouteTimer = setTimeout(run, wait);
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
      this.rerouteTries = 0;
      this._set({ status: 'ok', route, error: null, calculatedAt: Date.now(), rerouting: false });
    } catch (err) {
      if (generation !== this.generation || err?.code === 'aborted') return;
      const error = err instanceof RouteError ? err : new RouteError('service', 'Route calculation failed.');
      // Keep the previous route line if we have one; just flag the failure.
      // After leaving the route a failed request is retried with a growing delay, so a weak signal does not strand the rider.
      const fatal = ['no-route', 'no-route-toll-free', 'unavailable'].includes(error.code);
      if (this.state.rerouting && !fatal && this.rerouteTries < (this.rerouteMax ?? 5)) {
        this.rerouteTries += 1;
        this._set({ status: 'error', error });
        this._scheduleReroute(Math.min(15000, (this.rerouteGap || 3500) * 2 ** this.rerouteTries));
        return;
      }
      this._set({ status: 'error', error, rerouting: false });
    }
  }

  destroy() { clearTimeout(this._rerouteTimer); this._cancel(); this.onChange = () => {}; }
}
