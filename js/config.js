/**
 * TouringTogether configuration.
 *
 * 1. Replace the Firebase placeholders with your own project's web config
 *    (Firebase console → Project settings → Your apps → Web app).
 * 2. Everything else is a tunable default. GPS and routing values are starting
 *    points: test them on real devices and tune for battery and accuracy.
 *
 * A Firebase web API key is an identifier, not a secret. Access is protected
 * by Firebase Authentication plus firebase/database.rules.json.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyCJ17kf2QMBXXMebA7PDvRo80RARwuULA8',
  authDomain: 'touringtogether-85465.firebaseapp.com',
  databaseURL: 'https://touringtogether-85465-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'touringtogether-85465',
  storageBucket: 'touringtogether-85465.firebasestorage.app',
  messagingSenderId: '523677033304',
  appId: '1:523677033304:web:86c4e7188bf3c47b533b2d',
  measurementId: 'G-JG7GK129T9'
};

export function isFirebaseConfigured() {
  const required = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId'];
  return required.every((k) => {
    const v = firebaseConfig[k];
    return typeof v === 'string' && v.length > 0 && !v.startsWith('YOUR_');
  });
}

export const APP = Object.freeze({
  name: 'TouringTogether',
  version: '2026.10.13-1',   // shown on the sign-in screen so you can tell which build is running

  limits: Object.freeze({
    maxMembers: 6,              // enforced by database rules via six fixed slots
    minMembersForSession: 2,    // location is only published while >= this many members
    roomName: 60,
    displayName: 40,
    motorcycle: 60,
    password: 8
  }),

  invite: Object.freeze({
    length: 10,
    // 31 symbols, no I/L/O/0/1 to avoid misreading: 31^10 ≈ 8e14 (~49.5 bits)
    alphabet: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789',
    ttlDays: 14
  }),

  /** Passed straight to navigator.geolocation.watchPosition(). Tune on real devices. */
  gps: Object.freeze({
    enableHighAccuracy: true,
    maximumAge: 0,               // never accept a cached position: stale fixes make the dot lag
    timeout: 15000,
    /** Kalman smoothing + outlier rejection (js/gps-filter.js) */
    filter: Object.freeze({
      minAccuracyM: 3,           // no phone is better than this; stops over-confidence
      maxSpeedMps: 70,           // 250 km/h: anything faster between two fixes is a GPS jump
      jumpConfirmations: 3,      // a "jump" repeated this many fixes in a row is believed
      resetAfterMs: 20000,       // after this long without fixes, start fresh
      stillSpeedMps: 0.6,        // below this you count as standing still (the dot is held steady)
      unknownSpeedMps: 3,        // assumed speed when the device reports none
      headingMinSpeedMps: 1.5,   // trust the heading only above this speed
      headingMinMoveM: 8         // derive a heading from movement after this distance
    }),
    /** Smooth drawing of markers between updates (js/motion.js) */
    smoothing: Object.freeze({
      extrapolateMs: 2500,       // predict ahead at most this long after the last report
      easeMs: 280,               // how quickly the dot glides onto the prediction
      snapMeters: 120,           // bigger corrections jump instead of gliding
      minSpeedMps: 1.0           // slower than this the dot is not moved by prediction
    })
  }),

  /** When to write my position to Realtime Database. Faster while moving fast. */
  publish: Object.freeze({
    minMoveMeters: 10,           // slow/normal: publish after moving this far…
    minIntervalMs: 3000,         // …but never more often than this
    fastSpeedMps: 3,             // above ~11 km/h counts as "riding"
    fastMoveMeters: 5,           // riding: publish after this much movement…
    fastIntervalMs: 1500,        // …at most this often
    stationaryIntervalMs: 30000, // heartbeat while standing still
    maxAccuracyMeters: 100       // fixes worse than this are shown to me but not shared
  }),

  /** How "fresh" a rider's last fix must be to be called live. */
  freshness: Object.freeze({
    liveMaxAgeMs: 75000,         // > 2 heartbeats of slack
    staleMaxAgeMs: 600000,       // older than this: "lost", drawn faded
    uiTickMs: 5000
  }),

  // Map tiles, geocoding and routing providers live in js/map-config.js.

  /**
   * Optional Supabase project used ONLY as a voice signalling side channel
   * (Realtime Broadcast: no tables, nothing stored). Paste your Project URL
   * (Supabase -> Project Settings -> API / Data API -> Project URL, looks like
   * https://abcdxyz.supabase.co). Leave url empty to signal through Firebase.
   * The publishable key is designed to be public.
   */
  supabase: Object.freeze({
    url: '',
    publishableKey: 'sb_publishable_10GfraSrUI6umaSJT5e3JA_bBVSc435',
    sdkUrl: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm'
  }),

  /**
   * In-app push-to-talk voice (WebRTC). Audio goes rider-to-rider; Firebase only
   * carries the connection handshake.
   *
   * TURN: STUN alone connects most home/Wi-Fi networks but often FAILS between two
   * phones on mobile-carrier NAT. For reliable voice add a TURN relay below, e.g.
   *   { urls: ['turn:YOUR_TURN_HOST:443?transport=tcp', 'turns:YOUR_TURN_HOST:443?transport=tcp'],
   *     username: 'YOUR_USER', credential: 'YOUR_PASSWORD' }
   * (Metered, Cloudflare, Twilio or your own coturn). These values are visible to
   * every rider, so use a key that can be revoked. See README -> Voice.
   */
  voice: Object.freeze({
    enabled: true,
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    ],
    bitrate: 24000,            // Opus bits/s while talking (voice stays clear at 16-24 kbps)
    micWarmMs: 12000,          // keep the mic open this long after release so the next press is instant (0 = close at once)
    idleCloseMs: 60000,        // close the audio connections after this much silence
    maxTalkMs: 60000,          // safety: a stuck button stops transmitting after this long
    connectTimeoutMs: 12000,   // give up on one rider's connection after this long
    signalMaxAgeMs: 60000,     // ignore handshake messages older than this (Firebase transport)
    signaling: 'auto'          // 'auto' = Supabase when APP.supabase.url is set, else Firebase; 'firebase' forces Firebase
  }),

  discord: Object.freeze({
    allowedHosts: ['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com']
  })
});
