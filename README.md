# TouringTogether

Private, real-time coordination for motorcycle touring groups of 2–6 riders: live positions on a shared map, one shared destination, a route from each rider's own position, and a Discord voice button.

Static site (HTML + CSS + vanilla JS modules) → deploys to **GitHub Pages**, runs inside an **Android WebView** wrapper such as AppMint. No framework, no build step, no server.

## What works

| Area | Details |
|---|---|
| Accounts | Email/password sign-in, registration, password reset, session restored after refresh, sign out |
| Profile | Display name, bike, avatar (https link **or** uploaded photo shrunk to ~96 px and stored in the database, so no Firebase Storage/billing needed) |
| Rooms | Create (random 10-symbol invite code, SHA-256 hashed in the index), join by code with preview, max 6 riders, closed / expired / full / removed errors, copy & share invitation, rotate code, close, delete, remove rider |
| Live map | Leaflet + OpenStreetMap tiles, avatar markers updated in place, accuracy circle, follow-me, fit-all, destination jump, route toggle, legend, collapsible rider list |
| GPS | `watchPosition` with configurable options, movement/interval throttling, accuracy gate, permission explainer, denied/unavailable/timeout handling, pause sharing, recovery when the app returns from the background, optional screen wake lock |
| Presence | `.info/connected` + `onDisconnect()`, server-clock-corrected freshness: riders are shown **live / old fix / lost / offline / not sharing**; old coordinates are never presented as current |
| Destination | Search by name (Nominatim or Photon), enter coordinates (combined or separate fields), or tap the map; preview marker, editable label, explicit confirm; owner-only by default, optional "all riders" policy; visual notice when it changes |
| Routing | OSRM route from *your* position, recalculated only on destination change, large movement, leaving the route or manual refresh; error + retry + "Open in Maps" fallback |
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

## Configuration worth reviewing (`js/config.js`)

- `gps` – `enableHighAccuracy`, `maximumAge`, `timeout` (starting points; test on real devices for battery and accuracy).
- `publish` – movement threshold (15 m), min interval (3 s), stationary heartbeat (30 s), max accepted accuracy (200 m).
- `freshness` – a fix older than 75 s is "old", older than 10 min is "lost".
- `geocoder` – Nominatim by default (policy: no search-as-you-type, ~1 req/s, so search runs on submit). Switch to `photon` and set `autoSearch: true` for typeahead, or self-host.
- `routing.baseUrl` – public OSRM demo (car profile, light use, no SLA). Self-host OSRM/Valhalla or buy a routing API for real use.
- `map.tileUrl` – OSM's public tiles are for light use; use a tile provider for heavier traffic.

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
                      presence, location, permissions, map, destinations, routing,
                      discord, geo, net, ui
js/views/             setup, auth, dashboard, profile, touring, destinationPanel, roomSheet
firebase/             database.rules.json, README.md, tests/ (rules tests)
scripts/              vendor-leaflet.sh
assets/icons/         icon.svg + PNGs
```

Differences from the suggested structure: screens are JS views behind a hash router (`js/views/`) instead of separate `pages/*.html`, which avoids GitHub Pages 404/base-path issues and keeps Firebase auth state across screens.

## Manual test checklist

1. Register two accounts (two browsers/devices). Create a room on A, join with the code on B.
2. Both grant location → each sees the other's avatar marker; one rider alone shows "Waiting for riders".
3. Owner searches "Kawah Putih, Ciwidey" → pick result → confirm; B sees the marker + notice; both get routes. Repeat with `-7.7956, 110.3695`.
4. Turn Wi-Fi off on B: A sees B as **offline** (not live). B shows the offline banner. Turn it back on.
5. Lock B's screen for a minute, unlock: B shows the background banner, A saw "old fix" meanwhile.
6. Owner removes B: B is told, can't reopen the room. Rotate the code and confirm the old code fails.
7. Run `firebase/tests` (see `firebase/README.md`).
