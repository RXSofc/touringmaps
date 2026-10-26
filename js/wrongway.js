/**
 * "Menjauh dari tujuan" detector, for when there is no route to judge by (no route yet, the route
 * was refused because of a toll road, or the request failed). With a usable route the route
 * itself is the judge (off-route detection in guidance.js); straight-line distance would cry wolf
 * on every winding mountain road.
 *
 * It follows the straight-line distance to the destination: `min` is the closest it has been,
 * `max` the farthest since then. Away = we are `awayM` or more beyond the closest approach and
 * still near that farthest point. Turning back by `turnBackM` re-anchors and clears the alert.
 */
import { haversine } from './geo.js';

export class WrongWayWatch {
  constructor({ awayM = 150, turnBackM = 60, minSpeed = 2, maxAccuracy = 50 } = {}) {
    this.cfg = { awayM, turnBackM, minSpeed, maxAccuracy };
    this.reset();
  }

  reset() { this.key = null; this.min = Infinity; this.max = 0; this.away = false; }

  /**
   * @param {{latitude:number,longitude:number,speed?:number|null,accuracy?:number}} fix
   * @param {{latitude:number,longitude:number}|null} dest
   * @returns {boolean} true while moving away from the destination
   */
  update(fix, dest) {
    if (!fix || !dest) { this.reset(); return false; }
    const key = `${dest.latitude.toFixed(5)},${dest.longitude.toFixed(5)}`;
    if (key !== this.key) { this.reset(); this.key = key; }
    const moving = Number.isFinite(fix.speed) ? fix.speed >= this.cfg.minSpeed : true;
    const accurate = !Number.isFinite(fix.accuracy) || fix.accuracy <= this.cfg.maxAccuracy;
    if (!moving || !accurate) return this.away;   // jitter while standing still must not count as travel
    const d = haversine(fix, dest);
    if (d < this.min) { this.min = d; this.max = d; this.away = false; return false; }
    this.max = Math.max(this.max, d);
    if (this.away && this.max - d >= this.cfg.turnBackM) {   // turned around: start measuring again from here
      this.min = d; this.max = d; this.away = false; return false;
    }
    if (!this.away && this.max - this.min >= this.cfg.awayM && this.max - d < this.cfg.turnBackM) this.away = true;
    return this.away;
  }
}
