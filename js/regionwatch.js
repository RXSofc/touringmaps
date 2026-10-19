/**
 * "Sebentar lagi memasuki …": announces the next kabupaten/kota shortly before the rider crosses into it.
 *
 * How it looks ahead: every ~1 km of riding (and at most every 30 s) it asks which region a point
 * `aheadM` further along lies in. With a route that point is on the route line (reliable);
 * without one it is projected along the heading (less reliable, so the same answer is required twice).
 * Network and storage are injected, so the logic is testable without either.
 */
import { buildPath, projectOnPath } from './guidance.js';
import { haversine } from './geo.js';

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const R_EARTH = 6371008.8;

/** Point `distM` along `heading` (degrees from north) from a start. */
export function project(lat, lng, headingDeg, distM) {
  const d = distM / R_EARTH; const b = toRad(headingDeg); const p1 = toRad(lat); const l1 = toRad(lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lng: ((toDeg(l2) + 540) % 360) - 180 };
}

/** Point `m` metres along a built path (clamped to its ends). */
export function pointAtAlong(path, m) {
  const { coords, cum, total } = path;
  const t = Math.min(Math.max(m, 0), total);
  let i = 1;
  while (i < coords.length - 1 && cum[i] < t) i++;
  const seg = cum[i] - cum[i - 1];
  const f = seg > 0 ? (t - cum[i - 1]) / seg : 0;
  return { lat: coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * f, lng: coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * f };
}

export class RegionWatch {
  /**
   * @param {object} o
   * @param {object} o.cfg APP.region
   * @param {(lat:number,lng:number)=>Promise<{key,label,area}|null>} o.geocode
   * @param {(lat:number,lng:number)=>Promise<{temp,code,rainChance}|null>} o.weather
   * @param {(info:{kind:'ahead'|'entered', region:object, weather:object|null})=>void} o.onAnnounce
   * @param {()=>number} [o.now]
   */
  constructor({ cfg, geocode, weather, onAnnounce, now = Date.now }) {
    Object.assign(this, { cfg, geocode, weather, onAnnounce, now });
    this.cur = null;              // the region I am (or am about to be) in
    this.last = null;             // {lat,lng,t} of the last look-ahead check
    this.lastHere = null;         // {lat,lng} of the last "where am I" lookup
    this.announced = new Map();   // region key -> time
    this.candidate = null;        // {key,count}: heading mode wants the same answer twice
    this.busy = false;
    this.quietUntil = 0;
    this.pathFor = null; this.path = null; this.along = -Infinity;
    this.destroyed = false;
  }

  reset() { this.cur = null; this.last = null; this.lastHere = null; this.candidate = null; this.path = null; this.pathFor = null; this.along = -Infinity; }
  destroy() { this.destroyed = true; }

  /** Feed every accepted GPS fix. `coords` is my route as [lat,lng] pairs, or null. Cheap when nothing is due. */
  update(fix, coords) {
    if (this.destroyed || !this.cfg.enabled || this.busy) return;
    const now = this.now();
    if (now < this.quietUntil) return;
    const moving = Number.isFinite(fix.speed) ? fix.speed >= this.cfg.minSpeedMs : true;
    const moved = this.last ? haversine(this.last, fix) : Infinity;
    const due = !this.last || (moved >= this.cfg.recheckMoveM && now - this.last.t >= this.cfg.minGapMs);
    if (!due || (this.last && !moving)) return;
    this.last = { latitude: fix.latitude, longitude: fix.longitude, t: now };
    this._check(fix, coords).catch(() => { this.quietUntil = this.now() + 60000; });
  }

  _recent(key) {
    const t = this.announced.get(key);
    return t !== undefined && this.now() - t < this.cfg.repeatSilenceMs;
  }

  _ahead(fix, coords) {
    const A = this.cfg.aheadM;
    if (coords && coords.length > 1) {
      if (this.pathFor !== coords) { this.path = buildPath(coords); this.pathFor = coords; this.along = -Infinity; }
      const proj = projectOnPath(this.path, fix.latitude, fix.longitude, this.along);
      if (proj.lateral <= 80) {
        this.along = Math.max(this.along, proj.along);
        const left = this.path.total - this.along;
        if (left < 300) return null;                       // nearly there: nothing new ahead
        return { ...pointAtAlong(this.path, this.along + Math.min(A, left)), reliable: true };
      }
    }
    if (!Number.isFinite(fix.heading) || !(fix.speed >= this.cfg.minSpeedMs)) return null;
    return { ...project(fix.latitude, fix.longitude, fix.heading, A), reliable: false };
  }

  async _check(fix, coords) {
    this.busy = true;
    try {
      // 1) where am I (rare: only every few km, or when unknown)
      if (!this.cur || !this.lastHere || haversine(this.lastHere, fix) >= this.cfg.hereEveryM) {
        const here = await this.geocode(fix.latitude, fix.longitude);
        if (this.destroyed) return;
        this.lastHere = { latitude: fix.latitude, longitude: fix.longitude };
        if (here) {
          if (this.cur && here.key !== this.cur.key && !this._recent(here.key)) {
            // crossed a border without a warning (no look-ahead possible): say it now
            this.announced.set(here.key, this.now());
            this.cur = here;
            await this._announce('entered', here, fix.latitude, fix.longitude);
            return;
          }
          this.cur = here;
        }
      }
      if (!this.cur) return;

      // 2) where will I be shortly
      const ahead = this._ahead(fix, coords);
      if (!ahead) { this.candidate = null; return; }
      const next = await this.geocode(ahead.lat, ahead.lng);
      if (this.destroyed) return;
      if (!next || next.key === this.cur.key) { this.candidate = null; return; }
      if (this._recent(next.key)) return;
      if (!ahead.reliable) {
        this.candidate = this.candidate?.key === next.key ? { key: next.key, count: this.candidate.count + 1 } : { key: next.key, count: 1 };
        if (this.candidate.count < this.cfg.headingConfirm) return;
      }
      this.candidate = null;
      this.announced.set(next.key, this.now());
      this.cur = next;                                      // from here on "ahead" means the one after this
      await this._announce('ahead', next, ahead.lat, ahead.lng);
    } finally { this.busy = false; }
  }

  async _announce(kind, region, lat, lng) {
    let weather = null;
    try { weather = await this.weather(lat, lng); } catch { /* no weather line, the region alone is still useful */ }
    if (!this.destroyed) this.onAnnounce({ kind, region, weather });
  }
}
