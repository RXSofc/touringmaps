# GPS accuracy and smooth movement

## What the app does
1. **Fresh fixes only.** `maximumAge: 0` and high-accuracy mode, so the phone never hands back a cached position.
2. **Kalman smoothing** (`js/gps-filter.js`). Each fix is weighted by the accuracy the phone reports for it; the noise model follows your speed (little lag while riding, steady dot while stopped). Heading and speed come from the phone's Doppler data, or from movement when the WebView leaves them out.
3. **Jump rejection.** A fix that implies an impossible speed (default 250 km/h) is ignored; if the new place is confirmed three times in a row the filter re-locks there.
4. **Adaptive sharing.** While riding (> ~11 km/h) your position is sent at most every 1.5 s and every 5 m; slower, every 3 s / 10 m; standing still, a 30 s heartbeat. Fixes worse than ±100 m are shown to you but not shared.
5. **Smooth markers** (`js/motion.js`). Each marker glides between reports and is predicted a short way ahead along the rider's speed and heading (max 2.5 s, fading out), so riders do not teleport every 2 s and a rider who stops is not dragged onward. Follow mode re-centres the map every frame. The animation loop sleeps when nothing moves.

All numbers are in `js/config.js` → `APP.gps` and `APP.publish`.

## Measured on a simulated ride (`node tests/gps-sim.mjs`)
Straight and turning riding at ~54 km/h, 1 Hz fixes, 2 % GPS jumps, one 10 s stop:

| Noise | Raw RMS error | Filtered RMS error |
|---|---|---|
| random noise only | ~21 m (with jumps) | ~6-7 m |
| random noise + slow drift | ~14-20 m (with jumps) | ~8.5-9 m |

Standing still, the dot moves ~0.5 m per update instead of ~8 m. The motion loop moves a marker ≤ ~1 m per frame at 54 km/h instead of one 30 m jump per report. These are simulated numbers, not road measurements.

## What it cannot fix
- **The ceiling is the phone's GPS.** Typically 3-10 m in the open, worse between tall buildings, under trees, in tunnels or with the phone in a pocket or bag. Filtering removes random noise, not a bias such as reflections along a whole street (the "drift" row above).
- **WebView location depends on Android.** Allow *Precise* location for the wrapper app and keep Android's location accuracy (Google Location Accuracy) on. If the WebView reports no speed/heading, the app derives them, which is less precise.
- **No background tracking.** A web page is paused when the screen locks; use "Keep screen on". Real background tracking needs a native foreground service.
- **Map matching** (snapping the dot to the road) is not done: the public routing/matching services are not meant for it and would be wrong in lanes and junctions.
- **Prediction is cosmetic.** Shared data are real measurements only; a hard brake shows up one report late.

## GPS details panel
Tap the **GPS chip** (top right of the touring screen) to see raw vs used accuracy, speed, heading, fix rate, ignored GPS jumps and how many positions were shared. **Copy log (CSV)** copies the last ~400 fixes (raw and filtered) so a real ride can be analysed and the numbers below tuned with evidence instead of guesses.

## Tuning on a real ride
Ride the same loop with two phones. If dots lag, lower `filter.unknownSpeedMps` or `smoothing.easeMs`; if they wander when stopped, lower `stillSpeedMps`; if you see rubber-banding at stops, lower `smoothing.extrapolateMs`. For tighter updates raise Firebase usage by lowering `publish.fastIntervalMs` (1 s is reasonable for 6 riders).
