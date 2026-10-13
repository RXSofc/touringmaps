/**
 * Cleans up raw GPS fixes before they are drawn or shared.
 *
 * What it does (all numbers are in js/config.js → APP.gps.filter):
 *  - Kalman smoothing: every fix is weighted by its own reported accuracy, so a
 *    ±5 m fix pulls the position hard and a ±60 m fix barely moves it. The
 *    process noise follows the rider's speed, so there is almost no lag while
 *    riding and the dot stops wandering when standing still.
 *  - Outlier rejection: a fix that implies an impossible speed (a GPS "jump",
 *    common between buildings or in tunnels) is ignored; if the new place keeps
 *    being confirmed the filter re-locks onto it.
 *  - Heading/speed: uses the device's Doppler speed and heading when moving,
 *    falls back to the direction/speed between fixes when the WebView omits them.
 *
 * What it cannot do: make a phone's GPS better than the hardware, signal and sky
 * allow. It removes noise; it does not remove a systematic error (for example a
 * building reflecting the signal for a whole street).
 */
import { haversine } from './geo.js';

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function bearing(a, b) {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x = Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) - Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export class PositionFilter {
  /** @param {{minAccuracyM:number,maxSpeedMps:number,resetAfterMs:number,stillSpeedMps:number,unknownSpeedMps:number,jumpConfirmations:number,headingMinSpeedMps:number,headingMinMoveM:number}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.reset();
  }

  reset() {
    this.s = null;          // {latitude, longitude, variance, t}
    this.speed = null;      // smoothed speed m/s
    this.heading = null;    // last good heading (deg)
    this.anchor = null;     // position used to derive heading from movement
    this.jumps = 0;
  }

  /**
   * @param {{latitude:number,longitude:number,accuracy:number,speed:number|null,heading:number|null,timestamp:number}} fix
   * @returns {{fix:object|null, rejected:null|'old'|'jump'}}
   */
  process(fix) {
    const c = this.cfg;
    const acc = Math.min(Math.max(Number.isFinite(fix.accuracy) ? fix.accuracy : 9999, c.minAccuracyM), 5000);
    const t = fix.timestamp;

    if (!this.s || t - this.s.t > c.resetAfterMs) {
      this.s = { latitude: fix.latitude, longitude: fix.longitude, variance: acc * acc, t };
      this.anchor = { latitude: fix.latitude, longitude: fix.longitude };
      this.speed = Number.isFinite(fix.speed) ? fix.speed : null;
      this.heading = Number.isFinite(fix.heading) && (fix.speed ?? 0) >= c.headingMinSpeedMps ? fix.heading : null;
      this.jumps = 0;
      return { fix: this._out(fix, acc), rejected: null };
    }

    const dt = (t - this.s.t) / 1000;
    if (dt <= 0) return { fix: null, rejected: 'old' };

    // Impossible movement for the time that passed? Probably a GPS jump.
    const dist = haversine(this.s, fix);
    const reach = c.maxSpeedMps * dt + acc + Math.sqrt(this.s.variance);
    if (dist > reach && acc <= 150) {
      this.jumps += 1;
      if (this.jumps < c.jumpConfirmations) return { fix: null, rejected: 'jump' };
      // The new place has been confirmed repeatedly: trust it and start over there.
      this.s = { latitude: fix.latitude, longitude: fix.longitude, variance: acc * acc, t };
      this.anchor = { latitude: fix.latitude, longitude: fix.longitude };
      this.jumps = 0;
      return { fix: this._out(fix, acc), rejected: null };
    }
    this.jumps = 0;

    // Process noise follows speed: fast riding = trust new fixes, standing still = hold steady.
    const known = Number.isFinite(fix.speed) ? fix.speed : (this.speed ?? c.unknownSpeedMps);
    const q = Math.max(known < c.stillSpeedMps ? 0.5 : known, 0.5);
    let variance = this.s.variance + dt * q * q;
    const k = variance / (variance + acc * acc);
    const latitude = this.s.latitude + k * (fix.latitude - this.s.latitude);
    const longitude = this.s.longitude + k * (fix.longitude - this.s.longitude);
    variance = (1 - k) * variance;
    this.s = { latitude, longitude, variance, t };

    // Speed: device value if present, else movement between fixes (smoothed).
    if (Number.isFinite(fix.speed)) this.speed = fix.speed;
    else this.speed = this.speed === null ? dist / dt : this.speed * 0.6 + (dist / dt) * 0.4;

    // Heading: device heading while moving; otherwise direction of real movement.
    if (Number.isFinite(fix.heading) && (this.speed ?? 0) >= c.headingMinSpeedMps) {
      this.heading = fix.heading;
      this.anchor = { latitude, longitude };
    } else if (this.anchor && haversine(this.anchor, { latitude, longitude }) >= c.headingMinMoveM) {
      this.heading = bearing(this.anchor, { latitude, longitude });
      this.anchor = { latitude, longitude };
    }
    return { fix: this._out(fix, acc), rejected: null };
  }

  _out(raw, acc) {
    const s = this.s;
    const speed = this.speed !== null && this.speed >= this.cfg.stillSpeedMps ? this.speed : (this.speed !== null ? 0 : null);
    return {
      latitude: s.latitude,
      longitude: s.longitude,
      accuracy: Math.min(Math.max(Math.sqrt(s.variance), this.cfg.minAccuracyM), Math.max(acc, this.cfg.minAccuracyM)),
      speed,
      heading: speed ? this.heading : (this.heading ?? null),
      timestamp: raw.timestamp
    };
  }
}
