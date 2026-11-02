/**
 * Quick messages between riders: one tap, no typing.
 *
 * Each rider has ONE slot, rooms/<room>/signals/<uid> = {k, at}. Sending overwrites it, so the database never grows
 * and there is nothing to clean up. `k` is one of the fixed ids below (the rules accept only these), `at` is the
 * server time. Receivers announce a change of `at` after their first snapshot (the first snapshot is just the
 * baseline, so joining a room never replays old messages).
 */
import { db, ref, set, serverTimestamp } from './firebase.js';

import { SIGNALS, SIGNAL_IDS, signalById, SIGNAL_GAP_MS } from './signal-kinds.js';
export { SIGNALS, SIGNAL_IDS, signalById, SIGNAL_GAP_MS };

export async function sendSignal(roomId, uid, kind) {
  if (!signalById(kind)) throw new Error('unknown signal');
  await set(ref(db, `rooms/${roomId}/signals/${uid}`), { k: kind, at: serverTimestamp() });
}

/**
 * Turns snapshots of the `signals` node into "someone just said X" events.
 * The first snapshot only sets the baseline.
 */
export class SignalInbox {
  constructor(selfUid, onSignal) { this.selfUid = selfUid; this.onSignal = onSignal; this.seen = null; }
  push(map) {
    const m = map || {};
    if (this.seen === null) { this.seen = new Map(Object.entries(m).map(([u, v]) => [u, v?.at])); return; }
    for (const [uid, v] of Object.entries(m)) {
      if (!v || !signalById(v.k) || !Number.isFinite(v.at)) continue;
      const prev = this.seen.get(uid);
      this.seen.set(uid, v.at);
      if (uid === this.selfUid || prev === v.at) continue;
      this.onSignal({ uid, kind: v.k, at: v.at });
    }
  }
}
