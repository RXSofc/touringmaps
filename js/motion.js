/**
 * Smooth movement of a map marker between position updates.
 *
 * Updates arrive every second or two. Jumping the marker to each one looks
 * jerky, so a MotionTrack keeps the DISPLAYED position separate from the
 * REPORTED one:
 *   1. Short dead-reckoning: from the last report, move forward along the
 *      rider's speed and heading for the time that has passed since it was
 *      measured (capped, so a rider who stopped or lost signal is never
 *      dragged on down the road).
 *   2. Easing: the displayed position glides toward that prediction instead of
 *      snapping, so corrections are absorbed over a fraction of a second.
 *   3. Teleports (very large corrections) snap immediately.
 * It is only a drawing aid. Shared data stays the real measured positions.
 */
const M_PER_DEG = 111320;
const toRad = (d) => (d * Math.PI) / 180;

export class MotionTrack {
  /** @param {{extrapolateMs:number,easeMs:number,snapMeters:number,minSpeedMps:number}} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.base = null;        // last reported {lat,lng}
    this.measuredAt = 0;     // local-clock ms when it was measured
    this.vE = 0;             // east velocity m/s
    this.vN = 0;             // north velocity m/s
    this.pos = null;         // displayed {lat,lng}
    this.lastSampleAt = 0;
  }

  /** @returns {boolean} true if this report was newer than what we had */
  setFix({ lat, lng, speed, heading, measuredAt }) {
    const c = this.cfg;
    if (!this.base) {
      this.base = { lat, lng }; this.pos = { lat, lng }; this.measuredAt = measuredAt;
      this.vE = 0; this.vN = 0; this.lastSampleAt = measuredAt;
      this._setVelocity(speed, heading);
      return true;
    }
    if (measuredAt <= this.measuredAt) return false;
    const dt = (measuredAt - this.measuredAt) / 1000;
    const speedKnown = Number.isFinite(speed);
    if (speedKnown && speed < c.minSpeedMps) {
      this.vE = 0; this.vN = 0;                         // explicitly standing still
    } else if (speedKnown && Number.isFinite(heading)) {
      this._setVelocity(speed, heading);                // device speed + heading
    } else if (dt > 0.2 && dt < 15) {
      // Speed and/or heading not reported: use how far the rider really moved.
      const dN = (lat - this.base.lat) * M_PER_DEG;
      const dE = (lng - this.base.lng) * M_PER_DEG * Math.cos(toRad(lat));
      const dist = Math.hypot(dE, dN);
      const sp = speedKnown ? speed : dist / dt;
      if (sp >= c.minSpeedMps && dist > 0.5) {
        const vE = (dE / dist) * sp; const vN = (dN / dist) * sp;
        this.vE = this.vE * 0.4 + vE * 0.6; this.vN = this.vN * 0.4 + vN * 0.6;
      } else { this.vE = 0; this.vN = 0; }
    } else { this.vE = 0; this.vN = 0; }
    this.base = { lat, lng };
    this.measuredAt = measuredAt;
    return true;
  }

  _setVelocity(speed, heading) {
    if (Number.isFinite(speed) && Number.isFinite(heading) && speed >= this.cfg.minSpeedMps) {
      this.vE = speed * Math.sin(toRad(heading));
      this.vN = speed * Math.cos(toRad(heading));
    } else { this.vE = 0; this.vN = 0; }
  }

  /** Where the dot should be drawn at `now` (ms, local clock). */
  sample(now) {
    const c = this.cfg;
    const dt = Math.min(Math.max((now - this.lastSampleAt) / 1000, 0), 0.25);
    this.lastSampleAt = now;
    const ageMs = Math.min(Math.max(now - this.measuredAt, 0), c.extrapolateMs);
    const age = ageMs / 1000;
    const damp = 1 - 0.5 * (ageMs / c.extrapolateMs);     // fade the prediction out as it gets older
    const tLat = this.base.lat + (this.vN * age * damp) / M_PER_DEG;
    const tLng = this.base.lng + (this.vE * age * damp) / (M_PER_DEG * Math.cos(toRad(this.base.lat)));

    const errN = (tLat - this.pos.lat) * M_PER_DEG;
    const errE = (tLng - this.pos.lng) * M_PER_DEG * Math.cos(toRad(tLat));
    const err = Math.hypot(errN, errE);
    if (err > c.snapMeters) { this.pos = { lat: tLat, lng: tLng }; }
    else {
      const a = 1 - Math.exp(-(dt * 1000) / c.easeMs);
      this.pos = { lat: this.pos.lat + (tLat - this.pos.lat) * a, lng: this.pos.lng + (tLng - this.pos.lng) * a };
    }
    const moving = (this.vE !== 0 || this.vN !== 0) && ageMs < c.extrapolateMs;
    return { lat: this.pos.lat, lng: this.pos.lng, settled: !moving && err < 0.2 };
  }
}
