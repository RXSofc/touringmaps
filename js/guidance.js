/**
 * Turn alerts: follows the rider along the route and says what is coming.
 *
 * Pure logic, no DOM. The touring view feeds it the route (with OSRM maneuvers)
 * and every filtered GPS fix; it reports the next maneuver, how far away it is
 * ALONG THE ROAD (not in a straight line), and fires one alert per stage:
 *   far  - about 30 s ahead (never closer than 200 m or farther than 500 m)
 *   near - about 10 s ahead (60 to 200 m)
 *   now  - at the turn (30 m)
 * Thresholds follow the rider's speed, so 500 m at 25 m/s and 200 m at 8 m/s both
 * leave about the same time to react. Alerts are visual + vibration only.
 *
 * Also detects when the rider has left the route and asks for a new one.
 * It never makes up maneuvers: whatever the routing service did not provide
 * (traffic lights, speed bumps, lane advice) is simply not shown.
 */
import { haversine } from './geo.js';

const M_LAT = 111320;
const toRad = (d) => (d * Math.PI) / 180;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* ------------------------------------------------------------ path maths */

/** Cumulative distance along a [lat,lng] polyline. */
export function buildPath(coords) {
  const cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    cum[i] = cum[i - 1] + haversine({ latitude: coords[i - 1][0], longitude: coords[i - 1][1] }, { latitude: coords[i][0], longitude: coords[i][1] });
  }
  return { coords, cum, total: cum[coords.length - 1] || 0 };
}

/**
 * Nearest point on the path. Prefers a match at or after `minAlong` so a route
 * that doubles back over itself does not make the rider jump backwards.
 * @returns {{along:number, lateral:number}}
 */
export function projectOnPath(path, lat, lng, minAlong = -Infinity) {
  const { coords, cum } = path;
  const mLng = M_LAT * Math.cos(toRad(lat));
  let best = null;
  const cands = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][1] - lng) * mLng; const ay = (coords[i][0] - lat) * M_LAT;
    const bx = (coords[i + 1][1] - lng) * mLng; const by = (coords[i + 1][0] - lat) * M_LAT;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : clamp(-(ax * dx + ay * dy) / len2, 0, 1);
    const lateral = Math.hypot(ax + t * dx, ay + t * dy);
    const along = cum[i] + t * (cum[i + 1] - cum[i]);
    const c = { along, lateral };
    cands.push(c);
    if (!best || lateral < best.lateral) best = c;
  }
  if (!best) return { along: 0, lateral: Infinity };
  // among near-best candidates, take the first one that is not behind where we already were
  const ok = cands.filter((c) => c.lateral <= best.lateral + 15 && c.along >= minAlong - 40);
  if (ok.length) return ok.reduce((a, c) => (Math.abs(c.along - Math.max(minAlong, 0)) < Math.abs(a.along - Math.max(minAlong, 0)) ? c : a));
  return best;
}

/* --------------------------------------------------------- instruction text */

const SIDE = { left: 'kiri', 'slight left': 'kiri', 'sharp left': 'kiri', right: 'kanan', 'slight right': 'kanan', 'sharp right': 'kanan' };
const COMPASS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];
const ordinal = (n) => `ke-${n}`;

/** Maneuvers worth an alert. Everything else (name changes, "continue", exits of a roundabout…) is skipped. */
export function isActionable(step) {
  switch (step.type) {
    case 'turn': return step.modifier !== 'straight';
    case 'end of road': case 'fork': case 'merge': case 'on ramp': case 'off ramp':
    case 'roundabout': case 'rotary': case 'roundabout turn': case 'arrive':
      return true;
    case 'continue': return step.modifier === 'uturn';
    default: return false;
  }
}

/** @returns {{icon:string, title:string, detail:string}} Indonesian text + icon name for a maneuver. */
export function describeStep(step) {
  const side = SIDE[step.modifier] || '';
  const name = step.name ? `ke ${step.name}` : '';
  const turnIcon = { left: 'turn-left', right: 'turn-right', 'slight left': 'slight-left', 'slight right': 'slight-right', 'sharp left': 'sharp-left', 'sharp right': 'sharp-right', straight: 'arrow-up', uturn: 'uturn' }[step.modifier] || 'arrow-up';
  const strength = step.modifier === 'sharp left' || step.modifier === 'sharp right' ? 'Belok tajam ke ' : step.modifier?.startsWith('slight') ? 'Agak ke ' : 'Belok ';

  switch (step.type) {
    case 'turn':
    case 'continue':
      if (step.modifier === 'uturn') return { icon: 'uturn', title: 'Putar balik', detail: name };
      return { icon: turnIcon, title: `${strength}${side}`, detail: name };
    case 'end of road':
      return { icon: turnIcon, title: `Di ujung jalan, belok ${side || 'sesuai arah'}`, detail: name };
    case 'fork':
      return { icon: turnIcon, title: `Ambil ${side || 'jalur'} di pertigaan`, detail: name };
    case 'merge':
      return { icon: 'fork', title: `Gabung ke ${side || 'jalur'}`, detail: name };
    case 'on ramp':
      return { icon: turnIcon, title: `Masuk jalur ${side}`.trim(), detail: name };
    case 'off ramp':
      return { icon: turnIcon, title: `Keluar ke ${side || 'jalur samping'}`, detail: name };
    case 'roundabout':
    case 'rotary':
      return { icon: 'roundabout', title: step.exit ? `Di bundaran, ambil jalan keluar ${ordinal(step.exit)}` : 'Masuk bundaran', detail: name };
    case 'roundabout turn':
      return { icon: turnIcon, title: `Di bundaran kecil, belok ${side || 'sesuai arah'}`, detail: name };
    case 'arrive':
      return { icon: 'flag', title: side ? `Tiba di tujuan, di sebelah ${side}` : 'Tiba di tujuan', detail: '' };
    case 'depart': {
      const dir = Number.isFinite(step.bearingAfter) ? COMPASS[Math.round(step.bearingAfter / 45) % 8] : '';
      return { icon: 'arrow-up', title: dir ? `Mulai ke arah ${dir}` : 'Mulai', detail: name };
    }
    default:
      return { icon: 'arrow-up', title: 'Lanjut', detail: name };
  }
}

/* ------------------------------------------------------------------ guide */

export class TurnGuide {
  /**
   * @param {object} cfg APP.guidance
   * @param {{onAlert:(a:{stage:'far'|'near'|'now', maneuver:object})=>void, onOffRoute:()=>void, onChange:()=>void}} handlers
   */
  constructor(cfg, { onAlert, onOffRoute, onChange } = {}) {
    this.cfg = cfg;
    this.onAlert = onAlert || (() => {});
    this.onOffRoute = onOffRoute || (() => {});
    this.onChange = onChange || (() => {});
    this.setRoute(null);
  }

  /** @param {{coords:number[][], steps:object[], blockedClasses?:string[]}|null} route */
  setRoute(route) {
    this.path = null;
    this.maneuvers = [];
    this.index = 0;
    this.stage = null;
    this.alongM = 0;
    this.lateral = 0;
    this.offStrikes = 0;
    this.offRoute = false;
    this.arrived = false;
    this.blocked = route?.blockedClasses?.length ? route.blockedClasses : null;
    this.hasFix = false;
    if (route && route.coords?.length > 1 && !this.blocked) {
      this.path = buildPath(route.coords);
      let prev = 0;
      for (const step of route.steps || []) {
        const p = projectOnPath(this.path, step.location[0], step.location[1], prev);
        prev = Math.max(prev, p.along);
        if (isActionable(step)) this.maneuvers.push({ step, along: step.type === 'arrive' ? this.path.total : p.along, ...describeStep(step) });
      }
    }
    this.onChange();
  }

  get active() { return !!this.path && !this.blocked; }

  /** Feed every filtered GPS fix. */
  update(fix) {
    if (!this.active) return;
    const c = this.cfg;
    const proj = projectOnPath(this.path, fix.latitude, fix.longitude, this.alongM);
    this.hasFix = true;

    // off route?
    const limit = Math.max(c.offRouteM, (fix.accuracy || 0) * 1.5);
    if (proj.lateral > limit) {
      this.offStrikes += 1;
      const farOff = c.offRouteFarM && proj.lateral > c.offRouteFarM && (fix.accuracy || 0) <= (c.offRouteFarMaxAccM ?? 30);
      if ((this.offStrikes >= c.offRouteFixes || farOff) && !this.offRoute) { this.offRoute = true; this.onOffRoute(); }
    } else {
      this.offStrikes = 0;
      if (this.offRoute) { this.offRoute = false; }
    }
    this.lateral = proj.lateral;
    if (this.offRoute) { this.onChange(); return; }
    this.alongM = Math.max(this.alongM, proj.along);

    // arrived?
    if (this.path.total - this.alongM <= c.arriveM) {
      if (!this.arrived) { this.arrived = true; this.stage = 'now'; this.index = this.maneuvers.length - 1; const m = this.maneuvers[this.index]; if (m) this.onAlert({ stage: 'now', maneuver: m }); }
      this.onChange();
      return;
    }

    // drop maneuvers that are behind us
    while (this.index < this.maneuvers.length && this.maneuvers[this.index].along < this.alongM - c.passedM) {
      this.index += 1; this.stage = null;
    }
    const m = this.maneuvers[this.index];
    if (m) {
      const d = m.along - this.alongM;
      const v = Number.isFinite(fix.speed) ? fix.speed : 0;
      const far = clamp(v * c.farSeconds, c.farMinM, c.farMaxM);
      const near = clamp(v * c.nearSeconds, c.nearMinM, c.nearMaxM);
      const want = d <= c.nowM ? 'now' : d <= near ? 'near' : d <= far ? 'far' : null;
      const rank = { far: 1, near: 2, now: 3 };
      if (want && rank[want] > (rank[this.stage] || 0)) {
        this.stage = want;
        this.onAlert({ stage: want, maneuver: m });
      }
    }
    this.onChange();
  }

  /** What the popup should show right now, or null. */
  get view() {
    if (!this.active || !this.hasFix) return null;
    if (this.offRoute) return { kind: 'offroute' };
    if (this.arrived) { const m = this.maneuvers[this.maneuvers.length - 1]; return m ? { kind: 'arrive', ...m, distance: 0, stage: 'now' } : null; }
    const m = this.maneuvers[this.index];
    if (!m || !this.stage) return null;
    return { kind: 'maneuver', icon: m.icon, title: m.title, detail: m.detail, distance: Math.max(0, m.along - this.alongM), stage: this.stage, step: m.step };
  }
}
