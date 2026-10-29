/**
 * Two small GPS-only watchers for the voice. They only look at the rider's own speed, so they are estimates:
 *  - CrawlWatch: creeping along (about 1 to 18 km/h) for a while after riding normally = probably a traffic jam.
 *    A full stop longer than `parkedMs` (red light, parking, a rest) resets it. There is no real traffic data.
 *  - SpeedWatch: above the speed limit set in config for a few seconds (the limit is a fixed number, not the road's).
 */
export class CrawlWatch {
  constructor({ slowMinMs = 0.3, slowMaxMs = 5, needMs = 90000, parkedMs = 30000, movedMs = 8, movedWithinMs = 600000, cooldownMs = 900000 } = {}) {
    Object.assign(this, { slowMinMs, slowMaxMs, needMs, parkedMs, movedMs, movedWithinMs, cooldownMs });
    this.reset();
  }
  reset() { this.slowSince = null; this.zeroSince = null; this.lastFast = -Infinity; this.lastFire = -Infinity; }
  /** @returns {boolean} true once when a jam is likely */
  update(speed, now) {
    if (!Number.isFinite(speed)) return false;
    if (speed >= this.movedMs) { this.lastFast = now; this.slowSince = null; this.zeroSince = null; return false; }
    if (speed >= this.slowMinMs && speed <= this.slowMaxMs) {
      this.zeroSince = null;
      if (this.slowSince === null) this.slowSince = now;
    } else if (speed < this.slowMinMs) {
      if (this.zeroSince === null) this.zeroSince = now;
      if (now - this.zeroSince > this.parkedMs) this.slowSince = null;
    }
    if (this.slowSince !== null && now - this.slowSince >= this.needMs && now - this.lastFast <= this.movedWithinMs && now - this.lastFire >= this.cooldownMs) {
      this.lastFire = now; this.slowSince = null; return true;
    }
    return false;
  }
}

export class SpeedWatch {
  constructor({ limitKmh = 90, holdMs = 5000, cooldownMs = 45000, rearmKmh = 10 } = {}) {
    this.limit = limitKmh / 3.6; this.rearm = (limitKmh - rearmKmh) / 3.6; this.holdMs = holdMs; this.cooldownMs = cooldownMs;
    this.over = null; this.lastFire = -Infinity;
  }
  reset() { this.over = null; }
  update(speed, now) {
    if (!Number.isFinite(speed)) return false;
    if (speed > this.limit) {
      if (this.over === null) this.over = now;
      if (now - this.over >= this.holdMs && now - this.lastFire >= this.cooldownMs) { this.lastFire = now; return true; }
    } else if (speed < this.rearm) this.over = null;
    return false;
  }
}
