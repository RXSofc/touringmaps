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
  version: '2026.10.11-4',   // shown on the sign-in screen so you can tell which build is running

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
    maximumAge: 5000,
    timeout: 15000
  }),

  /** When to write my position to Realtime Database. */
  publish: Object.freeze({
    minMoveMeters: 15,           // publish after moving this far…
    minIntervalMs: 3000,         // …but never more often than this
    stationaryIntervalMs: 30000, // heartbeat while standing still
    maxAccuracyMeters: 200       // fixes worse than this are shown to me but not shared
  }),

  /** How "fresh" a rider's last fix must be to be called live. */
  freshness: Object.freeze({
    liveMaxAgeMs: 75000,         // > 2 heartbeats of slack
    staleMaxAgeMs: 600000,       // older than this: "lost", drawn faded
    uiTickMs: 5000
  }),

  map: Object.freeze({
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    tileMaxZoom: 19,
    defaultCenter: [-2.5, 118],  // Indonesia, shown until a position is known
    defaultZoom: 5,
    followZoom: 16
  }),

  /**
   * Geocoding.
   *  - 'nominatim' (default): OSM's public service. Its usage policy forbids
   *    search-as-you-type and allows ~1 request/second, so searching runs on
   *    submit and requests are spaced out.
   *  - 'photon': Komoot's OSM geocoder, tolerant of typeahead. Set
   *    autoSearch: true if you switch to it.
   */
  geocoder: Object.freeze({
    provider: 'nominatim',
    nominatimUrl: 'https://nominatim.openstreetmap.org',
    photonUrl: 'https://photon.komoot.io',
    language: 'en',
    countryCodes: '',            // e.g. 'id' to restrict results; '' = worldwide
    limit: 6,
    timeoutMs: 10000,
    minIntervalMs: 1100,
    autoSearch: false,
    debounceMs: 900,
    minChars: 3
  }),

  /**
   * Routing. The public OSRM demo server is for light use, offers a car
   * profile only, and has no SLA. For production, self-host OSRM/Valhalla
   * or use a commercial router, and read the provider's usage policy.
   */
  routing: Object.freeze({
    baseUrl: 'https://router.project-osrm.org/route/v1/driving',
    overview: 'simplified',
    timeoutMs: 12000,
    recalcMoveMeters: 300,       // re-route after moving this far from the route origin…
    minRecalcIntervalMs: 30000,  // …and at least this long since the last request
    offRouteMeters: 150,         // treat the route as invalid beyond this distance
    manualMinIntervalMs: 3000
  }),

  discord: Object.freeze({
    allowedHosts: ['discord.gg', 'discord.com', 'www.discord.com', 'discordapp.com', 'www.discordapp.com']
  })
});
