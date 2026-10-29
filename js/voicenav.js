/**
 * Decides WHEN the navigation voice speaks along a route. Pure logic: it is told the distance travelled along the
 * route and the speed, and calls `say(text, opts)`. The turn popup (TurnGuide) is not touched.
 *
 * Per maneuver it speaks once per stage (far, near, now), with the same speed-based distances as the popup. On top of
 * the popup it also speaks: the start of the trip, "keep going straight" on long stretches, leaving a roundabout,
 * going into an underpass (OSRM "tunnel" class) and the last stretch before the destination.
 * It only knows what the routing service sent: no traffic, no police, no roadworks, no flyovers.
 */
import { buildPath, projectOnPath, isActionable } from './guidance.js';
import { maneuverLine, lines } from './voicelines.js';

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const RANK = { far: 1, near: 2, now: 3 };

export class VoiceNav {
  /** @param {object} cfg APP.guidance + APP.speech values  @param {(text:string, opts?:object)=>void} say */
  constructor(cfg, say) { this.cfg = cfg; this.say = say || (() => {}); this.setRoute(null); }

  /** @param {{mode?:'start'|'rerouted'|'quiet'}} opts  what to say when the route arrives: the trip start line, "new road found", or nothing */
  setRoute(route, { mode = 'start' } = {}) {
    this.items = []; this.path = null; this.legId = -1; this.legSaid = false; this.nextRemind = 0;
    this.startPending = false; this.road = '';
    if (!route || !(route.coords?.length > 1) || route.blockedClasses?.length) return;
    this.path = buildPath(route.coords);
    const steps = route.steps || [];
    let prev = 0; let prevTunnel = false;
    for (const step of steps) {
      const p = projectOnPath(this.path, step.location[0], step.location[1], prev);
      prev = Math.max(prev, p.along);
      const along = step.type === 'arrive' ? this.path.total : p.along;
      if (isActionable(step)) this.items.push({ kind: 'maneuver', step, along, rank: 0 });
      else if (step.type === 'exit roundabout' || step.type === 'exit rotary') this.items.push({ kind: 'rbexit', step, along, rank: 0 });
      if (step.tunnel && !prevTunnel && step.type !== 'arrive') this.items.push({ kind: 'underpass', step, along, rank: 0 });
      prevTunnel = !!step.tunnel;
    }
    this.items.sort((a, b) => a.along - b.along);
    this.road = steps.find((st) => st.name)?.name || '';
    if (mode === 'rerouted') this.say(lines.rerouted(), { key: 'rerouted' });
    else if (mode === 'start') this.startPending = true;
  }

  get active() { return !!this.path; }

  /** @param {{alongM:number, speed:number|null, arrived:boolean}} p  distance travelled along the route, m/s */
  update({ alongM, speed, arrived }) {
    if (!this.path) return;
    const c = this.cfg;
    const v = Number.isFinite(speed) ? speed : 0;
    const far = clamp(v * c.farSeconds, c.farMinM, c.farMaxM);
    const near = clamp(v * c.nearSeconds, c.nearMinM, c.nearMaxM);

    if (this.startPending) {
      this.startPending = false;
      if (alongM < 150) {
        this.say(lines.start(this.road), { key: 'start' });
        this.legId = 0; this.legSaid = true; this.nextRemind = alongM + c.straightEveryM;   // "lurus" was just said
      }
    }

    let first = true; let prevAlong = 0; let nextLeg = null;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const d = it.along - alongM;
      if (d < -c.passedM) { prevAlong = it.along; continue; }
      if (!nextLeg) nextLeg = { id: i, start: prevAlong, end: it.along };
      let want = null;
      if (it.kind === 'maneuver') {
        if (it.step.type === 'arrive') want = arrived || d <= c.arriveM + 5 ? 'now' : d <= near ? 'near' : null;
        else want = d <= c.nowM ? 'now' : d <= near ? 'near' : d <= far ? 'far' : null;
      } else if (it.kind === 'rbexit') want = d <= c.nowM + 10 ? 'now' : null;
      else if (it.kind === 'underpass') want = d <= near && d > 0 ? 'near' : null;
      // only the closest upcoming item may announce early stages; a second one right behind it only gets its "now"
      if (want && !first && want !== 'now') want = null;
      first = false;
      if (want && RANK[want] > it.rank) {
        it.rank = RANK[want];
        const text = it.kind === 'maneuver' ? maneuverLine(it.step, want, Math.max(d, 0)) : it.kind === 'rbexit' ? lines.rbExit() : lines.underpass();
        if (text) this.say(text, { urgent: want === 'now', key: `m${i}:${want}` });
      }
    }

    // long straight stretches: say it once, then now and then
    if (nextLeg && !arrived) {
      if (nextLeg.id !== this.legId) { this.legId = nextLeg.id; this.legSaid = false; this.nextRemind = nextLeg.start + c.straightFirstM + c.straightEveryM; }
      const legLen = nextLeg.end - nextLeg.start; const left = nextLeg.end - alongM;
      if (legLen >= c.straightMinM) {
        if (!this.legSaid && alongM >= nextLeg.start + c.straightFirstM && left > 600) { this.legSaid = true; this.say(lines.straight(), { key: 'straight' }); }
        else if (this.legSaid && alongM >= this.nextRemind && left > 1200) { this.nextRemind = alongM + c.straightEveryM; this.say(lines.straightAgain(left), { key: 'straightAgain' }); }
      }
    }
  }
}
