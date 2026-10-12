/**
 * Connection state, server clock and rider presence.
 *
 * Three different things are tracked and never conflated:
 *   - connected:  is this device's database socket up?           (presence)
 *   - fix age:    how old is the last GPS fix it managed to send? (location)
 *   - sharing:    has the rider chosen to share a position at all? (location exists)
 */
import { db, ref, set, onValue, onDisconnect, serverTimestamp } from './firebase.js';
import { APP } from './config.js';

let connected = false;
let serverOffsetMs = 0;
const connListeners = new Set();
let clockStarted = false;

/** Start watching the connection and the offset between this device's clock and the server's. */
export function initClock() {
  if (clockStarted) return;
  clockStarted = true;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    const v = snap.val();
    if (typeof v === 'number') serverOffsetMs = v;
  });
  onValue(ref(db, '.info/connected'), (snap) => {
    connected = snap.val() === true;
    connListeners.forEach((fn) => { try { fn(connected); } catch (e) { console.error(e); } });
  });
}

export const isConnected = () => connected;
export const serverOffset = () => serverOffsetMs;
/** Best estimate of "now" on the server, immune to a wrong phone clock. */
export const serverNow = () => Date.now() + serverOffsetMs;

/** Calls fn immediately with the current state, then on every change. Returns an unsubscribe fn. */
export function onConnectionChange(fn) {
  connListeners.add(fn);
  try { fn(connected); } catch (e) { console.error(e); }
  return () => connListeners.delete(fn);
}

/**
 * Marks me connected in a room and registers onDisconnect() so the server flips
 * me to disconnected if the app is killed or loses its connection.
 * @returns {() => Promise<void>} stop function (call on leave / logout / view exit)
 */
export function startRoomPresence(roomId, uid) {
  const presenceRef = ref(db, `rooms/${roomId}/presence/${uid}`);
  let active = true;

  const unsubscribe = onConnectionChange(async (isUp) => {
    if (!isUp || !active) return;
    try {
      // Register the server-side cleanup first, then announce.
      await onDisconnect(presenceRef).set({ connected: false, lastSeen: serverTimestamp() });
      if (active) await set(presenceRef, { connected: true, lastSeen: serverTimestamp() });
    } catch (err) {
      console.warn('presence update failed', err);
    }
  });

  return async function stop() {
    if (!active) return;
    active = false;
    unsubscribe();
    try {
      await onDisconnect(presenceRef).cancel();
      await set(presenceRef, { connected: false, lastSeen: serverTimestamp() });
    } catch { /* already offline or no longer a member */ }
  };
}

/**
 * Honest status for one rider.
 *  live       connected and the last fix is recent
 *  stale      connected but the last fix is old (GPS stalled, app backgrounded, tunnel…)
 *  lost       connected but no fix for a very long time
 *  offline    their app is not connected; position shown is only "last known"
 *  nolocation no position shared (permission denied, paused, or not yet received)
 */
export function riderStatus({ presence, location, now = serverNow() }) {
  const fixAt = location && Number.isFinite(location.fixAt) ? location.fixAt : null;
  if (fixAt === null) {
    return { state: 'nolocation', ageMs: null, connected: presence?.connected === true };
  }
  const ageMs = Math.max(0, now - fixAt);
  const isUp = presence?.connected === true;
  if (!isUp) return { state: 'offline', ageMs, connected: false };
  if (ageMs <= APP.freshness.liveMaxAgeMs) return { state: 'live', ageMs, connected: true };
  if (ageMs <= APP.freshness.staleMaxAgeMs) return { state: 'stale', ageMs, connected: true };
  return { state: 'lost', ageMs, connected: true };
}
