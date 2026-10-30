# VEXLANE reference

The long-form operating notes that used to be the README: feature table, setup details, voice, providers, limits, data lifecycle, manual test checklist. The README itself is now the short tour.


Private, real-time coordination for motorcycle touring groups of 2–30 riders (default 6): live positions on a shared map, one shared destination, a route from each rider's own position, in-app push-to-talk voice, and a Discord backup button.

Static site (HTML + CSS + vanilla JS modules) → deploys to **GitHub Pages**, runs inside an **Android WebView** wrapper such as AppMint. No framework, no build step, no server.

## What works

| Area | Details |
|---|---|
| Accounts | Email/password sign-in, registration, password reset, session restored after refresh, sign out |
| Profile | Display name, bike, avatar (https link **or** uploaded photo shrunk to ~96 px and stored in the database, so no Firebase Storage/billing needed) |
| Rooms | Create (random 10-symbol invite code, SHA-256 hashed in the index), join by code with preview, owner picks 2–30 riders (default 6), closed / expired / full / removed errors, copy & share invitation, rotate code, close, delete, remove rider |
| Live map | Leaflet + OpenStreetMap tiles, avatar markers updated in place, accuracy circle, follow-me, fit-all, destination jump, route toggle, legend, collapsible rider list |
| GPS | `watchPosition` with configurable options, movement/interval throttling, accuracy gate, permission explainer, denied/unavailable/timeout handling, pause sharing, recovery when the app returns from the background, optional screen wake lock |
| Presence | `.info/connected` + `onDisconnect()`, server-clock-corrected freshness: riders are shown **live / old fix / lost / offline / not sharing**; old coordinates are never presented as current |
| Destination | Search by name (Nominatim or Photon), enter coordinates (combined or separate fields), or tap the map; preview marker, editable label, explicit confirm; owner-only by default, optional "all riders" policy; visual notice when it changes |
| Routing | OSRM route from *your* position, recalculated only on destination change, large movement, leaving the route or manual refresh; error + retry + "Open in Maps" fallback |
| Voice | Hold the mic button to talk to everyone online (WebRTC, rider-to-rider, mono Opus ~24 kbps, mic open only while held). Signalling via Supabase Realtime Broadcast or Firebase |
| Discord | Validated `https` Discord invite/channel link (owner-editable) opened outside the app |
| Security | `firebase/database.rules.json` (membership-gated reads, invite-hash joins, slot-based capacity, owner-only settings) |

## Setup (about 15 minutes)

1. **Firebase project** – <https://console.firebase.google.com> → Add project.
2. **Authentication** → Sign-in method → enable **Email/Password**.
3. **Realtime Database** → Create database → then open **Rules**, paste the contents of `firebase/database.rules.json`, **Publish**.
4. **Project settings → Your apps → Web app** → copy the config into `js/config.js` (`firebaseConfig`).
5. **Authentication → Settings → Authorized domains** → add `YOUR-USERNAME.github.io`.
6. *(Recommended)* Vendor Leaflet so the app has no CDN dependency: `./scripts/vendor-leaflet.sh`. Without it the app loads Leaflet 1.9.4 from unpkg/jsDelivr.
7. **GitHub Pages**: push this folder to a repo → Settings → Pages → deploy from branch (`/root`). Open `https://USERNAME.github.io/REPOSITORY/`.

All paths are relative and routing uses `#/hash` URLs, so it works under any repository name. `.nojekyll` is included.

Local test: `python3 -m http.server 8080` in this folder, then open <http://localhost:8080> (localhost counts as a secure context, so GPS works). Add `localhost` to Firebase authorized domains (it is there by default).

## AppMint / Android WebView notes

- Load the **https** GitHub Pages URL (GPS needs a secure context).
- Grant **location** permission to the wrapper app, and enable geolocation in its WebView settings (AppMint: allow location access / "Geolocation"). The page asks the user first; if Android blocks it, the app shows how to fix it.
- Enable **external links** (`target="_blank"` / system browser) so the Discord and "Open in Maps" buttons can hand off to Android.
- Web pages are suspended when the screen locks. Turn on **Room menu → Keep screen on** (Wake Lock) while riding. If you later need *reliable background GPS*, that requires a native Android foreground location service, which a WebView cannot provide.

## Voice (push-to-talk)

How it stays cheap: the microphone opens only when you press the button (and stays warm 12 s so repeat presses are instant), nothing connects until someone talks, audio is sent only while the button is held, and connections close after a minute of silence. Nothing is recorded or stored. Hold mode or tap-to-toggle mode is in Room menu → This device.

**Signalling** (the tiny handshake that lets two phones find each other; audio never goes through it):

- **Supabase (recommended, keeps this off Firebase).** In `js/config.js` → `APP.supabase.url`, paste your Project URL (Supabase → Project Settings → API / Data API → `https://xxxx.supabase.co`). The publishable key is already set (it is meant to be public). It uses Realtime *Broadcast* only: no tables, no SQL, nothing stored. Free tier limits are far above 6 riders.
- **Firebase (automatic fallback)** when `url` is empty: uses `rooms/{id}/rtc` and `rooms/{id}/voice`, covered by the rules in `firebase/database.rules.json` (publish the updated rules).

Supabase broadcast channels are not authenticated per user here (rooms use Firebase Auth). The channel name contains the unguessable room id, and the app ignores any signal from someone who is not a room member, but treat it as "unlisted", not "private". A leaked channel name could let a stranger *disturb* signalling, not hear audio (audio only flows to members the talker's app connects to).

**TURN (important for mobile data).** STUN-only works on most Wi-Fi/home networks but often fails between two phones on carrier NAT. Add a TURN relay to `APP.voice.iceServers` (Metered, Cloudflare, Twilio, or your own coturn). If a rider cannot be reached the app tells you and suggests Discord.

**AppMint/WebView:** allow *microphone / audio recording* for the wrapper app and enable media playback without a user gesture if offered. Like GPS, voice pauses when the screen locks or the app is backgrounded.

## Map providers (`js/map-config.js`)

Tiles, geocoding and routing are plain tables in `js/map-config.js`, each with an ordered fallback `chain`. Defaults are free, key-less OpenStreetMap services (OSM tiles, Nominatim → Photon, OSRM demo), which are **for light, development-scale use with no SLA**. Keyed providers (MapTiler, Stadia, LocationIQ, your own OSRM) ship as `YOUR_…` placeholders that are skipped until you fill them in and add them to a chain, so no paid service is used silently. Manual latitude/longitude always works, even when search is down.

**Read [`docs/MAP-PROVIDERS.md`](docs/MAP-PROVIDERS.md)** for exact limits, throttling, fallback behaviour, key-restriction steps and the production checklist. Firebase settings stay in `js/config.js`.

## Other settings (`js/config.js`)

- `gps` – high-accuracy fresh fixes, Kalman filter and marker-smoothing settings; `publish` – faster sharing while riding (1.5 s / 5 m), 3 s / 10 m otherwise, 30 s standing still, max accepted accuracy 100 m. See [`docs/GPS.md`](docs/GPS.md) for what it does, simulated results and its limits.
- `freshness` – a fix older than 75 s is "old", older than 10 min is "lost".
- `voice`, `supabase` – see Voice above.

## Honest limitations

- **Routes are estimates, not navigation.** Public OSRM = car profile, no live traffic, no closures, not verified safe for motorcycles. The UI says so; turn-by-turn is handed to a maps app.
- **No background tracking** in a browser/WebView (see above). Others see "old fix"/"offline" instead of stale data posing as live.
- **No push notifications**; changes (new destination, riders joining) are shown in-app only.
- Avatar links are fetched by other riders' devices (the image host sees their IPs); uploads avoid that.
- Rules cannot rate-limit. Consider enabling **Firebase App Check** and keep Email Enumeration Protection on.

## Data lifecycle

- Position records live at `rooms/{id}/locations/{uid}`: coordinates, accuracy, optional heading/speed, GPS time and server time. Nothing else is stored (no history).
- Leaving the touring screen, pausing sharing, leaving the room, signing out, or deleting the room removes your position. Presence flips to offline via `onDisconnect()` if the app dies.
- Deleting a room removes members, positions, destination and invite entry. Other members' personal "recent rooms" shortcut is pruned the next time they open the dashboard.

## Project layout

```
index.html            entry (Leaflet loader + module app)
manifest.webmanifest  sw.js  .nojekyll  firebase.json
css/                  tokens, base, components, layout, responsive
js/                   app, main, router, config, firebase, auth, profile, rooms,
                      presence, location, permissions, map, map-config, gps-filter, motion, destinations, routing,
                      voice, signaling, discord, geo, net, ui
js/views/             setup, auth, dashboard, profile, touring, destinationPanel, roomSheet
docs/                 MAP-PROVIDERS.md (limits, setup, production checklist)
firebase/             database.rules.json, README.md, tests/ (rules tests)
tests/                gps-sim.mjs (simulated ride for the GPS filter and marker motion)
scripts/              vendor-leaflet.sh
assets/icons/         icon.svg + PNGs
```

Differences from the suggested structure: screens are JS views behind a hash router (`js/views/`) instead of separate `pages/*.html`, which avoids GitHub Pages 404/base-path issues and keeps Firebase auth state across screens.

## Manual test checklist

0. Voice: two phones, hold the mic on A, B hears it and sees "A is talking"; release, then repeat from B. Test once on mobile data for each rider (TURN).
1. Register two accounts (two browsers/devices). Create a room on A, join with the code on B.
2. Both grant location → each sees the other's avatar marker; one rider alone shows "Waiting for riders".
3. Owner searches "Kawah Putih, Ciwidey" → pick result → confirm; B sees the marker + notice; both get routes. Repeat with `-7.7956, 110.3695`.
4. Turn Wi-Fi off on B: A sees B as **offline** (not live). B shows the offline banner. Turn it back on.
5. Lock B's screen for a minute, unlock: B shows the background banner, A saw "old fix" meanwhile.
6. Owner removes B: B is told, can't reopen the room. Rotate the code and confirm the old code fails.
7. Run `firebase/tests` (see `firebase/README.md`).

## Turn alerts
Popup + vibration before turns, roundabouts and arrival, no sound, toll roads avoided. See [docs/GUIDANCE.md](docs/GUIDANCE.md) for thresholds and limits.

### Voice diagnostics
Room menu → **Voice diagnostics** shows, live: signalling transport, TURN status, mic state, whether audio playback is blocked, and for every audio connection its state, the network path chosen (host / srflx / relay), packets sent or received and an event log. **Copy report** puts it on the clipboard. Take one report from each phone right after trying to talk.

Reading it: `path: relay` means TURN is carrying the audio; no `srflx` candidates means the phone's network blocks STUN; a SEND connection stuck in `connecting`/`failed` while the other phone shows no RECEIVE means the direct path is blocked (add TURN in `APP.voice.iceServers`).

## 3D map

Tap **3D** in the map buttons for a tilted map with 3D buildings that turns with your direction while you follow yourself. Flat map is the default. In 3D the hills are always there as a soft, nearly flat relief, and the **NEON** button switches the Neon Night map skin on and off (details in `docs/MAP-SKIN.md`). Details and how to change the tile source: `docs/MAP-PROVIDERS.md`.

## Room size

The owner chooses the maximum number of riders (2 to 30, default 6) when creating a room; it cannot change afterwards. The limit is enforced by the database rules (`slotsAllowed`), so you must **publish the updated `firebase/database.rules.json`** before creating rooms with a size. Rooms created earlier keep their six slots. Bigger rooms cost much more Firebase data (every position goes to every rider) and the in-app voice is a direct connection between phones, so for large groups use Discord for voice.

## Navigation: off-route and toll safety

- Leaving the route is noticed after 2 GPS fixes (1 fix when clearly far away with a good signal); the new route is requested within about 3.5 s. While it is being calculated the old line is faded and the popup says "Menghitung ulang rute…". A failed request is retried with a growing delay.
- Routes never use toll roads: the server is asked with `exclude=toll`, then `exclude=motorway`; every answer is scanned for `toll`/`motorway` classes and for roads literally named "Tol". If a route still touches one, it is faded, guidance is switched off for it, a red warning appears and the phone vibrates a long pattern.

## Region alerts (weather popup)

Shortly before you cross into another kabupaten/kota a small popup shows, for about 7 seconds, for example:
`Sebentar lagi memasuki Kab. Bandung Barat, Cililin` / `Cerah · 30°C` (plus "peluang hujan N%" when rain is likely). It appears 0.8–1.5 km before the border; with a route the look-ahead follows the route line, without one it follows the heading (and must see the same region twice). A border crossed without a warning is announced as "Memasuki …". The same region is not repeated within 20 minutes. Switch: Room menu → Region alerts.

Data: region names from the geocoder chain (`reverse` with `addressdetails`, Nominatim by default, shared throttle and cool-down), weather from Open-Meteo (free, no key, non-commercial). Both need internet; when either fails the popup is skipped or shown without the weather line. Tuning: `APP.region` in `js/config.js`. Tests: `node tests/regionwatch.mjs`.

## Colour palette

Five colours from the reference image plus one light tint of Equilibrium for cards, all defined once in `css/tokens.css`: Dark Void `#141616` (text, borders, shadows), Iridium `#3D3C38` (filled / active / selected / success), Artillery `#746D67` (secondary fills), Equilibrium `#A49F9D` (page background, muted fills, warnings), Falu Red `#7F1D1A` (danger, errors, cancel / back / close, off-route, toll warning) and Paper `#E6E3E1` (cards, panels, dock). Warnings differ by a dashed border, not by another colour. The base map stays neutral gray; the route keeps its muted red-to-white gradient.

## Map options menu (2026.10.30-1)
The map's button column is now two buttons: **GPS locate** (always standalone) and **Map menu**.
The menu (`js/views/mapMenu.js`) holds labelled rows: Fit all riders, Go to destination, Route line (ON/OFF),
3D map (ON/OFF), Neon Night skin (only while 3D is on), Spoken navigation (ON/OFF), Map legend.
Action rows (fit, destination) close the menu; toggle rows keep it open. Tapping the map also closes it.

## Room sheet scroll fix (2026.10.30-1)
`roomSheet.js` used to rebuild its whole DOM on every touring render (each GPS fix), so any toggle jumped to the top.
It now skips the redraw when the state is unchanged and restores scroll position and focus when it does redraw.
Harness: `tests/room-sheet-scroll.html`. Preview of the menu: `tests/map-menu.html`.
