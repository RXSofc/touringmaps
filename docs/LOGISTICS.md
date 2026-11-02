# Logistics: fuel stops and quick messages (2026.11.02-1)

## Fuel stops (SPBU) along the route
- Source: OpenStreetMap (`amenity=fuel`) through the Overpass API. Two public servers, the second is the fallback.
- What is sent: a thinned copy of the next 60 km of the route line (about one point per km) and a search radius of 400 m. Nothing else, no account data.
- When: once a route exists. The window moves on as you ride (a new lookup when you are 15 km from the end of the last one). A failed lookup waits 60 s before trying again, so a weak signal does not hammer the server.
- On the map: up to 10 small pump badges for the stations within 40 km ahead (flat and 3D map; neon-green in the Neon skin). Tap one for its name, distance and side of the road.
- Heads-up: 2 km before a station, a popup, a short vibration and (if spoken navigation is on) a voice line such as "SPBU Pertamina dua kilo lagi di sebelah kiri". Stations closer than 6 km after the last announcement stay quiet, so a city does not turn into a stream of announcements.
- Controls: Map menu → **Fuel stops** (ON/OFF, remembered per device). While on, the row shows the distance to the next station, e.g. "12 km".
- Limits: coverage depends on OpenStreetMap; small village pumps (pertamini, bottles) are often missing. Opening hours are not shown. Needs a connection; with none, the last stations found stay on the map.
- Code: `js/fuel.js` (logic, tested in `tests/fuel-test.mjs`), markers in `js/map.js` and `js/map3d.js` (`setFuelStops`), wiring in `js/views/touring.js`.

## Quick messages
- Map menu → **Quick message**: eight one-tap buttons (Berhenti dulu, Tunggu gue, Gue ketinggalan, Istirahat, Isi bensin, Lanjut jalan, Hati-hati, Ada masalah). No typing.
- Everyone else in the room gets a popup with the rider's name, a vibration, and a voice line if spoken navigation is on ("Woi, Budi minta berhenti dulu!"). "Berhenti dulu" and "Ada masalah" interrupt the voice; the others wait their turn. The voice does not talk over a rider using the group voice chat.
- The sender sees "Terkirim" and the buttons rest for 3 seconds.
- Data: `rooms/<room>/signals/<uid> = {k, at}`. One slot per rider, overwritten on every send, so nothing piles up. `at` is the server time. A new message is detected by `at` changing after the first snapshot, so joining a room never replays old messages.
- **Firebase rules must be published again** (`firebase/database.rules.json`): members only, own slot only, the eight ids only, no free text, open rooms only, and at least 2 s between messages from the same rider. Until then sending shows "Quick messages are not enabled yet".
- Code: `js/signal-kinds.js` (the list), `js/signals.js` (send + inbox), panel in `js/views/mapMenu.js`, rules tested in `tests/rules-eval-test.mjs` and `firebase/tests/rules.test.mjs`.
