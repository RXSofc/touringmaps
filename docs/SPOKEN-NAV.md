# Spoken navigation

The browser's own text-to-speech (`speechSynthesis`) reads the route out loud. No server, no key, no cost. It is off until the
rider taps the speaker button on the map (or the switch in the room menu) and it needs **Turn alerts** on, because it follows the
same route and position as the popups. Popups and vibration are unchanged.

## What it says

All sentences are in `js/voicelines.js` (casual, rude-friendly Indonesian, as the rider asked). Change a line there; nothing else needs editing.

| When | Line family |
| --- | --- |
| Start of the trip | `lines.start` (says the first road name) |
| Long stretch with no turn | `lines.straight`, then `lines.straightAgain` every 3 km |
| Turn, 3 stages (about 30 s ahead, 10 s ahead, at the turn) | far (half a kilo / two hundred metres), near, now |
| Fork, slight turn (Y-junction), merge, U-turn | own lines per stage |
| Roundabout: entering (names the exit number) and leaving | `maneuverLine` + `lines.rbExit` |
| Ramps and toll (the app never routes via toll, so these are rare) | `tollIn`, `tollOut`, `rampIn`, `rampOut` |
| Underpass (OSRM "tunnel" class) | `lines.underpass` |
| Left the route / new route found | `lines.offRoute`, `lines.rerouted` |
| Going away from the destination, no route | `lines.away`, repeated every 12 s while moving |
| Route unavoidably uses a toll road | `lines.toll` |
| Arrival: heads-up, then left / right / straight ahead | `maneuverLine` arrive |
| Probably a traffic jam | `lines.jam` |
| Too fast | `lines.speed` |

Region and weather popups are not spoken.

## What it cannot do (no data source)

Police, speed cameras, roadworks, accidents and real traffic need a data feed that has no free, key-less source. Flyovers are not in the
routing answer (only tunnels are). The "jam" line is a GPS guess: after riding normally, creeping at about 1 to 18 km/h for 90 s (a full stop of
30 s or more resets it). The speed warning uses one fixed number (`APP.speech.speedWarnKmh`, 90 km/h), not the road's real limit.

## The voice

Browsers do not say whether a voice is female. `js/speech.js` prefers an Indonesian voice whose name looks female (Android `ida`, Google Bahasa
Indonesia, Microsoft Gadis, Damayanti), avoids male-looking names (Andika, `idd`, `ide`) and uses a slightly higher pitch. If it guesses wrong, pick another
voice in Room menu > Spoken navigation. No Indonesian voice installed: the phone's default voice reads it and a toast says so.

## Limits to know

- The screen must stay on: when the app is in the background or the screen is off, WebViews pause speech (same as vibration and GPS timers).
- Some WebViews have no speech engine or an empty voice list; the app then keeps working silently.
- Web pages cannot lower the music or take audio focus: speech may play over music.
- While a rider is talking on the group voice, normal lines are dropped; urgent ones (turn now, off route, speed) still speak.
- Online "network" voices can fail without signal; on-device voices work offline.

Tests: `node tests/voice-test.mjs` (voice choice, speech queue, timing along a route, jam and speed watchers, every line).
