/**
 * Voice signalling transports. WebRTC needs a tiny side channel to swap
 * connection offers/answers/ICE candidates and to say "X is talking". Audio never
 * travels through it.
 *
 *  - Supabase Realtime *Broadcast* (preferred when APP.supabase.url is set):
 *    WebSocket pub/sub, no tables, nothing stored, and it keeps this chatter off Firebase.
 *  - Firebase Realtime Database (fallback): rooms/{id}/rtc and rooms/{id}/voice,
 *    protected by firebase/database.rules.json.
 *
 * Both give VoiceChat the same four things: send(), talk(), destroy() and two callbacks.
 */
import { db, ref, set, remove, push, onValue, onDisconnect, serverTimestamp } from './firebase.js';
import { APP } from './config.js';
import { serverNow } from './presence.js';

export const supabaseConfigured = () => {
  const c = APP.supabase;
  return !!(c && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(c.url || '') && c.publishableKey);
};

/**
 * @param {{roomId:string, uid:string,
 *          onSignal:(from:string, m:{t:string,sid:string,d:string})=>void,
 *          onTalk:(flags:Record<string,{talking:true,at:number}>)=>void}} h
 * @returns {{kind:'supabase'|'firebase', start:()=>Promise<void>|void, send:(to:string,t:string,sid:string,d:string)=>void,
 *            talk:(on:boolean)=>void, destroy:()=>Promise<void>}}
 */
export function createSignaling(h) {
  return supabaseConfigured() && APP.voice.signaling !== 'firebase' ? supabaseTransport(h) : firebaseTransport(h);
}

/* ============================================================== Supabase */
function supabaseTransport({ roomId, uid, onSignal, onTalk }) {
  const flags = {};
  let client = null;
  let channel = null;
  let dead = false;
  let ready = false;
  const backlog = [];

  const publish = (event, payload) => {
    if (dead) return;
    if (!channel || !ready) { backlog.push([event, payload]); if (backlog.length > 60) backlog.shift(); return; }
    channel.send({ type: 'broadcast', event, payload }).catch(() => {});
  };

  return {
    kind: 'supabase',
    async start() {
      const { createClient } = await import(/* webpackIgnore: true */ APP.supabase.sdkUrl);
      if (dead) return;
      client = createClient(APP.supabase.url, APP.supabase.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { params: { eventsPerSecond: 20 } }
      });
      channel = client.channel(`tt-voice-${roomId}`, { config: { broadcast: { self: false, ack: false } } });
      channel.on('broadcast', { event: 'sig' }, ({ payload }) => {
        if (!payload || payload.to !== uid || payload.from === uid || typeof payload.d !== 'string') return;
        onSignal(String(payload.from), { t: payload.t, sid: payload.sid, d: payload.d });
      });
      channel.on('broadcast', { event: 'talk' }, ({ payload }) => {
        if (!payload || payload.from === uid || typeof payload.from !== 'string') return;
        if (payload.on === true) flags[payload.from] = { talking: true, at: serverNow() };
        else delete flags[payload.from];
        onTalk({ ...flags });
      });
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          ready = true;
          for (const [e, p] of backlog.splice(0)) channel.send({ type: 'broadcast', event: e, payload: p }).catch(() => {});
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          ready = false; // supabase-js rejoins on its own
        }
      });
    },
    send(to, t, sid, d) { publish('sig', { to, from: uid, t, sid, d }); },
    talk(on) { publish('talk', { from: uid, on }); },
    async destroy() {
      dead = true;
      try { if (channel) await client.removeChannel(channel); } catch { /* ignore */ }
      channel = null; client = null;
    }
  };
}

/* ============================================================== Firebase */
function firebaseTransport({ roomId, uid, onSignal, onTalk }) {
  const base = `rooms/${roomId}`;
  const unsubs = [];
  let seen = new Set();
  let dead = false;
  const maxAgeMs = APP.voice.signalMaxAgeMs;

  return {
    kind: 'firebase',
    start() {
      unsubs.push(onValue(ref(db, `${base}/rtc/${uid}`), (snap) => {
        const inbox = snap.val() || {};
        const now = serverNow();
        const jobs = [];
        for (const [from, msgs] of Object.entries(inbox)) {
          for (const [key, m] of Object.entries(msgs || {})) {
            if (seen.has(key)) continue;
            seen.add(key);
            remove(ref(db, `${base}/rtc/${uid}/${from}/${key}`)).catch(() => {}); // consumed
            if (!m || typeof m.d !== 'string' || (typeof m.at === 'number' && now - m.at > maxAgeMs)) continue;
            jobs.push({ from, key, m });
          }
        }
        jobs.sort((a, b) => (a.key < b.key ? -1 : 1)); // push keys sort chronologically
        for (const j of jobs) onSignal(j.from, j.m);
        if (seen.size > 500) seen = new Set([...seen].slice(-200));
      }, () => {}));
      unsubs.push(onValue(ref(db, `${base}/voice`), (snap) => {
        const all = snap.val() || {};
        const out = {};
        for (const [id, f] of Object.entries(all)) if (id !== uid && f && f.talking === true) out[id] = { talking: true, at: typeof f.at === 'number' ? f.at : serverNow() };
        onTalk(out);
      }, () => {}));
    },
    send(to, t, sid, d) {
      if (dead && t !== 'bye') return;
      const r = push(ref(db, `${base}/rtc/${to}/${uid}`));
      set(r, { t, sid, d, at: serverTimestamp() }).catch((err) => console.warn('voice signal failed', err?.code || err));
    },
    talk(on) {
      const r = ref(db, `${base}/voice/${uid}`);
      if (on) {
        onDisconnect(r).remove().catch(() => {});
        set(r, { talking: true, at: serverTimestamp() }).catch(() => {});
      } else remove(r).catch(() => {});
    },
    async destroy() {
      dead = true;
      for (const u of unsubs.splice(0)) { try { u(); } catch { /* ignore */ } }
      await Promise.allSettled([remove(ref(db, `${base}/voice/${uid}`)), remove(ref(db, `${base}/rtc/${uid}`))]);
    }
  };
}
