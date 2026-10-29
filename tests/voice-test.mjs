// Spoken navigation: voice choice, speech queue, when the voice speaks along a route, traffic/speed watchers, line text.
import { scoreVoice, pickVoice, SpeechGuide } from '../js/speech.js';
import { VoiceNav } from '../js/voicenav.js';
import { CrawlWatch, SpeedWatch } from '../js/trafficwatch.js';
import { maneuverLine, lines, distanceWords, kmWords, speakName, setRandom } from '../js/voicelines.js';
import { buildPath } from '../js/guidance.js';
let ok = 0, fail = 0; const check = (n, c, x = '') => { c ? ok++ : fail++; if (!c) console.log('FAIL ' + n + (x ? `  [${x}]` : '')); };
setRandom(() => 0);

// ---- voice choice
const V = (name, lang, extra = {}) => ({ name, lang, voiceURI: name, localService: true, ...extra });
const android = [V('English United States', 'en-US'), V('id-id-x-idd-local', 'id-ID'), V('id-id-x-ida-local', 'id-ID'), V('id-id-x-ide-local', 'id-ID')];
check('android: female id voice wins', pickVoice(android).name === 'id-id-x-ida-local', pickVoice(android)?.name);
const win = [V('Microsoft Andika Online (Natural) - Indonesian (Indonesia)', 'id-ID', { localService: false }), V('Microsoft Gadis Online (Natural) - Indonesian (Indonesia)', 'id-ID', { localService: false }), V('Microsoft David - English', 'en-US')];
check('windows: Gadis over Andika', /Gadis/.test(pickVoice(win).name));
check('chrome: Google Bahasa Indonesia picked', /Google Bahasa/.test(pickVoice([V('Google US English', 'en-US'), V('Google Bahasa Indonesia', 'id-ID')]).name));
check('legacy in-ID language code counts as Indonesian', pickVoice([V('x', 'in-ID')])?.name === 'x');
check('no Indonesian voice -> null (engine default)', pickVoice([V('English', 'en-US')]) === null);
check('saved voice name wins', pickVoice(android, 'id-id-x-idd-local').name === 'id-id-x-idd-local');
check('male scores below female', scoreVoice(android[1]) < scoreVoice(android[2]));

// ---- speech queue with a fake engine
function fake() {
  const log = []; let cur = null;
  const synth = { getVoices: () => android, speak(u) { cur = u; log.push(['speak', u.text, u.voice?.name, u.pitch]); }, cancel() { log.push(['cancel']); cur = null; } };
  class Utter { constructor(t) { this.text = t; } }
  return { synth, Utter, log, finish() { const u = cur; cur = null; u?.onend?.(); } };
}
let f = fake(); let t = 0;
const sg = new SpeechGuide({ synth: f.synth, Utter: f.Utter, now: () => t });
check('disabled: says nothing', sg.say('x') === false && f.log.length === 0);
sg.setEnabled(true);
sg.say('satu'); check('speaks with the female id voice', f.log[0][1] === 'satu' && f.log[0][2] === 'id-id-x-ida-local' && f.log[0][3] > 1, JSON.stringify(f.log[0]));
sg.say('dua'); sg.say('tiga'); check('a busy voice keeps only the newest waiting sentence', f.log.length === 1 && sg.pending.text === 'tiga');
f.finish(); check('then the waiting sentence is spoken', f.log.at(-1)[1] === 'tiga');
sg.say('mendesak', { urgent: true }); check('urgent cancels and speaks', f.log.at(-2)[0] === 'cancel' && f.log.at(-1)[1] === 'mendesak');
f.finish(); t += 20000;
sg.say('x', { key: 'k', gapMs: 5000 }); f.finish(); t += 1000;
check('same key inside the gap is skipped', sg.say('x', { key: 'k', gapMs: 5000 }) === false);
t += 6000; check('after the gap it speaks again', sg.say('x', { key: 'k', gapMs: 5000 }) === true); f.finish();
sg.isBlocked = () => true; check('talking on the group voice: normal lines are dropped', sg.say('y') === false);
check('...but urgent ones still speak', sg.say('z', { urgent: true }) === true); f.finish(); sg.isBlocked = null;
t += 20000; sg.say('stale1'); sg.say('stale2'); t += 9000; f.finish(); check('a waiting sentence older than 8 s is dropped', f.log.at(-1)[1] !== 'stale2');
sg.setEnabled(false); check('turning off cancels', f.log.at(-1)[0] === 'cancel');
check('no engine: unsupported, no crash', new SpeechGuide({ synth: undefined, Utter: undefined }).supported === false);

// ---- along a route
const cfg = { farSeconds: 30, farMinM: 200, farMaxM: 500, nearSeconds: 10, nearMinM: 60, nearMaxM: 200, nowM: 30, passedM: 25, arriveM: 25, straightMinM: 1500, straightFirstM: 120, straightEveryM: 3000 };
const M = 111320, LAT0 = -7.8, LNG0 = 110.37, cosL = Math.cos(LAT0 * Math.PI / 180);
const ll = (x, y) => [LAT0 + y / M, LNG0 + x / (M * cosL)];
const pts = [[0, 0], [5000, 0], [5000, 800], [5000, 1400]]; const coords = [];
for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 10); for (let k = 0; k < n; k++) coords.push(ll(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n)); } coords.push(ll(5000, 1400));
const steps = [
  { type: 'depart', modifier: null, name: 'Jl. Sayuran', distance: 5000, location: ll(0, 0) },
  { type: 'turn', modifier: 'left', name: 'Jl. Kenanga', distance: 800, location: ll(5000, 0) },
  { type: 'roundabout', modifier: 'right', exit: 2, name: 'Jl. Raya', distance: 100, location: ll(5000, 700) },
  { type: 'exit roundabout', modifier: 'right', name: 'Jl. Raya', distance: 600, location: ll(5000, 740) },
  { type: 'arrive', modifier: 'right', name: '', distance: 0, location: ll(5000, 1400) }
];
function drive(opts = {}) {
  const said = []; let at = 0;
  const vn = new VoiceNav(cfg, (text, o) => said.push({ text, o, at }));
  vn.setRoute({ coords, steps }, opts.route || {});
  const path = buildPath(coords);
  for (let pos = 0; pos <= path.total + 20; pos += 15) { at = pos; vn.update({ alongM: pos, speed: 15, arrived: path.total - pos <= 25 }); }
  return said;
}
let said = drive();
const texts = said.map((s) => s.text);
check('trip start says the road name', texts[0] === lines.start('Jl. Sayuran') && /Jalan Sayuran/.test(texts[0]), texts[0]);
check('long straight stretch: the start line counts as the first "lurus", then one reminder', texts.filter((x) => /^Masih lurus terus/.test(x)).length === 1 && !texts.some((x) => /^Lurus terus (aja|woi)/.test(x)));
const leftTurn = said.filter((s) => /belok kiri|Kiri/.test(s.text));
check('left turn spoken far, near, now in order', leftTurn.length === 3 && /lagi belok kiri/.test(leftTurn[0].text) && /siap-siap belok kiri|Bentar lagi belok kiri/.test(leftTurn[1].text) && /^Kiri/.test(leftTurn[2].text), JSON.stringify(leftTurn.map((l) => l.text)));
check('far warning mentions the road and ~half a kilo', /Setengah kilo lagi belok kiri ke Jalan Kenanga/.test(leftTurn[0].text), leftTurn[0].text);
check('"now" is urgent, far/near are not', leftTurn[2].o.urgent === true && !leftTurn[0].o.urgent);
check('roundabout names the exit (kedua)', said.some((s) => /belokan kedua/.test(s.text)));
check('roundabout exit line is spoken', texts.includes(lines.rbExit()));
check('arrival: right side, spoken once', texts.filter((x) => /Di kanan tuh tempatnya/.test(x)).length === 1);
check('arrival heads-up before the end', texts.some((x) => /Dikit lagi nyampe woi, tujuan lu di kanan/.test(x)));
check('nothing is said twice in a row at the same stage', new Set(said.map((s) => s.o.key)).size === said.filter((s) => s.o.key).length);
said = drive({ route: { mode: 'quiet' } }); check('quiet mode: no start line, the straight line is said instead', !said.some((s) => /Gas anjing/.test(s.text)) && said.some((s) => /^Lurus terus (aja|woi)/.test(s.text)));
const vn2 = new VoiceNav(cfg, (x) => said.push(x)); said = []; vn2.setRoute({ coords, steps }, { mode: 'rerouted' }); check('rerouted mode speaks the new-road line', said[0] === lines.rerouted(), String(said[0]));
const vn3 = new VoiceNav(cfg, (x) => said.push(x)); said = []; vn3.setRoute({ coords, steps, blockedClasses: ['toll'] }); vn3.update({ alongM: 100, speed: 10 }); check('a route with a toll road is not narrated', said.length === 0);

// ---- text
check('distance words', distanceWords(450) === 'Setengah kilo' && distanceWords(900) === 'Satu kilo' && distanceWords(250) === 'Dua ratus meter' && distanceWords(399) === 'Tiga ratus meter');
check('km words', kmWords(2000) === 'dua kilo' && kmWords(1500) === 'satu setengah kilo' && kmWords(400) === 'setengah kilo', kmWords(1500));
check('road abbreviations are expanded', speakName('Jl. Raya Cihampelas') === 'Jalan Raya Cihampelas' && speakName('Gg. Mawar') === 'Gang Mawar');
const T = (type, modifier, extra = {}) => ({ type, modifier, name: '', ...extra });
const say = (step, stage, d = 100) => maneuverLine(step, stage, d);
check('your lines: kanan sekarang', say(T('turn', 'right'), 'now') === 'Kanan sekarang bangsat, gaskeun!');
check('your lines: kiri sekarang', say(T('turn', 'left'), 'now') === 'Kiri woi kiri sekarang! Banting setir anjing!');
check('your lines: dekat', say(T('turn', 'left'), 'near') === 'Depan siap-siap belok kiri! Nyalain sein dari sekarang goblog, jangan pas belok baru nyala!');
check('your lines: sedang (200 m)', say(T('turn', 'right'), 'far', 250) === 'Dua ratus meter lagi belok kanan! Siap-siap, jangan dadakan!');
check('your lines: jauh (500 m)', say(T('turn', 'right'), 'far', 480) === 'Setengah kilo lagi belok kanan woi! Jangan ngelamun aja lu babi!');
check('your lines: Y-junction', say(T('fork', 'slight left'), 'near') === 'Pecahan jalan depan lu ambil serong kiri! Jangan ngambil jalur orang!');
check('slight turn is treated like a fork', /serong kanan/.test(say(T('turn', 'slight right'), 'near')));
check('your lines: putar balik', /Siap-siap putar balik depan/.test(say(T('turn', 'uturn'), 'near')) && say(T('turn', 'uturn'), 'now') === 'Kelewatan tolol! Muter balik sekarang buruan!');
check('your lines: tol', say(T('on ramp', 'right', { toll: true }), 'now') === 'Masuk tol sekarang, gass yang kenceng tapi jangan sampe mati konyol!' && say(T('off ramp', 'left', { toll: true }), 'now') === 'Keluar tol sekarang! Rem woi rem, jangan kebablasan!' && /Ambil lajur kiri njing/.test(say(T('off ramp', 'left', { toll: true }), 'near')));
check('your lines: tujuan', /di kiri tuh/.test(say(T('arrive', 'left'), 'now')) && /Di kanan tuh/.test(say(T('arrive', 'right'), 'now')) && /Matiin mesinnya/.test(say(T('arrive', 'straight'), 'now')));
check('your lines: other', lines.offRoute().startsWith('Bisa baca map gak sih sia?') && lines.jam().startsWith('Macet asu') && lines.speed().includes('tahu bulat') && lines.underpass().includes('underpass') && lines.rbExit().startsWith('Nah ini dia belokannya'));
check('sharp turn adds "tajam"', /belok kanan tajam/.test(say(T('turn', 'sharp right'), 'far', 250)));
for (const type of ['turn', 'end of road', 'fork', 'merge', 'on ramp', 'off ramp', 'roundabout', 'roundabout turn', 'arrive'])
  for (const stage of ['far', 'near', 'now']) check(`every maneuver has a line: ${type}/${stage}`, say(T(type, 'right', { exit: 1 }), stage, 300).length > 5);

// ---- watchers
const cw = new CrawlWatch({ needMs: 90000 }); let fired = 0; let n = 0;
for (let s = 0; s < 60; s += 1) { n = s * 1000; cw.update(15, n); }
for (let s = 0; s < 120; s += 2) { n = 60000 + s * 1000; if (cw.update(2, n)) fired++; }
check('creeping 90 s after riding = jam, once', fired === 1, fired);
const cw2 = new CrawlWatch({ needMs: 90000 }); fired = 0; for (let s = 0; s < 30; s++) cw2.update(15, s * 1000);
for (let s = 0; s < 200; s += 2) { if (cw2.update(0, 30000 + s * 1000)) fired++; } check('standing still (parked / red light) is not a jam', fired === 0);
const cw3 = new CrawlWatch({ needMs: 90000 }); fired = 0; for (let s = 0; s < 100; s += 2) { if (cw3.update(2, s * 1000)) fired++; } check('slow from the very start (never rode normally) is not a jam', fired === 0);
const sw = new SpeedWatch({ limitKmh: 90, holdMs: 5000, cooldownMs: 45000 }); fired = 0;
for (let s = 0; s < 40; s++) if (sw.update(30, s * 1000)) fired++;           // 108 km/h for 40 s
check('speeding: warned once per cooldown', fired === 1, fired);
fired = 0; const sw2 = new SpeedWatch({ limitKmh: 90 }); for (let s = 0; s < 20; s++) if (sw2.update(24, s * 1000)) fired++; check('86 km/h is fine', fired === 0);
fired = 0; const sw3 = new SpeedWatch({ limitKmh: 90 }); for (let s = 0; s < 3; s++) if (sw3.update(30, s * 1000)) fired++; check('a 3 s burst is ignored', fired === 0);

console.log(`${ok} passed${fail ? `, ${fail} FAILED` : ''}`); process.exit(fail ? 1 : 0);
