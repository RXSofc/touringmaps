/**
 * GPS watching (browser Geolocation API) and publishing to Realtime Database.
 *
 * Honest limits: a web page, especially inside a WebView, is suspended when
 * the screen locks or the app is backgrounded. Nothing here can change that.
 * We recover quickly when the page becomes active again (see touring view).
 * Reliable background tracking would need a native Android foreground service.
 */
import { db, ref, set, remove, serverTimestamp } from './firebase.js';
import { APP } from './config.js';
import { haversine, isValidLat, isValidLng, roundTo } from './geo.js';
import { serverOffset } from './presence.js';

/** @typedef {{latitude:number,longitude:number,accuracy:number,heading:number|null,speed:number|null,timestamp:number}} Fix */

/** Maps a GeolocationPositionError to a stable code + human message. */
export function describeGeoError(err) {
  if (!err) return { code: 'unavailable', message: 'Location is unavailable.' };
  if (err.code === 1) return { code: 'denied', message: 'Location permission was denied.' };
  if (err.code === 2) return { code: 'unavailable', message: 'Your position could not be determined. Check that GPS/location services are on.' };
  if (err.code === 3) return { code: 'timeout', message: 'Waiting for a GPS fix… try moving to open sky.' };
  return { code: err.code === 'unsupported' ? 'unsupported' : 'unavailable', message: err.message || 'Location is unavailable.' };
}

export class LocationTracker {
  /**
   * @param {{onFix:(fix:Fix)=>void, onError:(e:{code:string,message:string})=>void}} handlers
   */
  constructor({ onFix, onError }) {
    this.onFix = onFix;
    this.onError = onError;
    this.watchId = null;
    this.lastEventAt = 0;
    this.watchdog = null;
    this.lastFix = null;
  }

  get active() { return this.watchId !== null; }

  start() {
    if (this.watchId !== null) return;
    if (!('geolocation' in navigator)) { this.onError({ code: 'unsupported', message: 'This device does not support location.' }); return; }
    this.lastEventAt = Date.now();
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._handle(pos),
      (err) => { this.lastEventAt = Date.now(); this.onError(describeGeoError(err)); },
      { ...APP.gps }
    );
    // Some WebViews silently drop a watch after a timeout; restart if it goes quiet.
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (this.watchId !== null && Date.now() - this.lastEventAt > APP.gps.timeout * 3) this.restart();
    }, APP.gps.timeout);
  }

  stop() {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    clearInterval(this.watchdog);
    this.watchdog = null;
  }

  restart() { this.stop(); this.start(); }

  /** One-shot refresh, e.g. right after the app returns to the foreground. */
  refresh() {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => this._handle(pos),
      (err) => this.onError(describeGeoError(err)),
      { enableHighAccuracy: APP.gps.enableHighAccuracy, maximumAge: 0, timeout: APP.gps.timeout }
    );
  }

  _handle(pos) {
    this.lastEventAt = Date.now();
    const c = pos?.coords;
    if (!c || !isValidLat(c.latitude) || !isValidLng(c.longitude)) return; // never accept garbage
    const fix = {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: Number.isFinite(c.accuracy) ? c.accuracy : 9999,
      heading: Number.isFinite(c.heading) ? c.heading : null,
      speed: Number.isFinite(c.speed) ? c.speed : null,
      timestamp: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now()
    };
    this.lastFix = fix;
    this.onFix(fix);
  }
}

/**
 * Throttles and writes my position to rooms/{roomId}/locations/{uid}.
 * `fixAt` is the moment the GPS measured the position (converted to server
 * time), so a write that was queued while offline and flushed later can never
 * make an old position look fresh.
 */
export class LocationPublisher {
  constructor({ roomId, uid, onWriteError }) {
    this.roomId = roomId;
    this.uid = uid;
    this.onWriteError = onWriteError || (() => {});
    this.last = null;        // {latitude, longitude, at}
    this.inFlight = false;
  }

  get _ref() { return ref(db, `rooms/${this.roomId}/locations/${this.uid}`); }

  /**
   * @param {Fix} fix
   * @param {{canPublish:boolean}} ctx  canPublish = sharing on, session active, online
   * @returns {Promise<'published'|'skipped-blocked'|'skipped-accuracy'|'skipped-throttle'|'skipped-busy'|'error'>}
   */
  async handleFix(fix, { canPublish }) {
    if (!canPublish) return 'skipped-blocked';
    const p = APP.publish;
    if (fix.accuracy > p.maxAccuracyMeters) return 'skipped-accuracy';
    if (this.inFlight) return 'skipped-busy';

    const now = Date.now();
    if (this.last) {
      const sinceMs = now - this.last.at;
      if (sinceMs < p.minIntervalMs) return 'skipped-throttle';
      const moved = haversine(this.last, fix);
      if (moved < p.minMoveMeters && sinceMs < p.stationaryIntervalMs) return 'skipped-throttle';
    }

    const payload = {
      latitude: roundTo(fix.latitude, 6),
      longitude: roundTo(fix.longitude, 6),
      accuracy: Math.round(fix.accuracy),
      fixAt: Math.round(fix.timestamp + serverOffset()),
      updatedAt: serverTimestamp()
    };
    if (fix.heading !== null && fix.heading >= 0 && fix.heading <= 360) payload.heading = Math.round(fix.heading);
    if (fix.speed !== null && fix.speed >= 0 && fix.speed <= 200) payload.speed = roundTo(fix.speed, 1);

    this.inFlight = true;
    try {
      await set(this._ref, payload);
      this.last = { latitude: fix.latitude, longitude: fix.longitude, at: now };
      return 'published';
    } catch (err) {
      this.onWriteError(err);
      return 'error';
    } finally {
      this.inFlight = false;
    }
  }

  /** Forget the throttle state, e.g. after sharing was resumed, so the next fix goes out at once. */
  reset() { this.last = null; }

  /** Delete my shared position (pause sharing, leave room, sign out). */
  async clear() {
    this.last = null;
    try { await remove(this._ref); } catch { /* not a member any more, or offline */ }
  }
}
