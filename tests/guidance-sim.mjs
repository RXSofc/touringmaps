// Simulated drive for the turn alerts: node tests/guidance-sim.mjs
import { TurnGuide, describeStep, buildPath } from '../js/guidance.js';
const cfg = { enabled:true, farSeconds:30, farMinM:200, farMaxM:500, nearSeconds:10, nearMinM:60, nearMaxM:200, nowM:30, passedM:25, arriveM:25, offRouteM:40, offRouteFixes:3, rerouteMinIntervalMs:8000, vibrate:true };
const M = 111320, LAT0 = -7.8, LNG0 = 110.37, cosL = Math.cos(LAT0*Math.PI/180);
const ll = (x, y) => [LAT0 + y/M, LNG0 + x/(M*cosL)];       // metres east/north of origin -> [lat,lng]
// route: east 1000 m, LEFT (north) 800 m, roundabout (exit 2) then continue north 600 m, U-turn... then arrive
const pts = [[0,0],[1000,0],[1000,800],[1000,1400]]; const coords = [];
for (let i=0;i<pts.length-1;i++){ const [x0,y0]=pts[i],[x1,y1]=pts[i+1]; const n=Math.round(Math.hypot(x1-x0,y1-y0)/10); for(let k=0;k<n;k++) coords.push(ll(x0+(x1-x0)*k/n, y0+(y1-y0)*k/n)); } coords.push(ll(1000,1400));
const steps = [
  { type:'depart', modifier:null, exit:null, bearingAfter:90, name:'Jl. Sayuran', distance:1000, location: ll(0,0) },
  { type:'turn', modifier:'left', exit:null, bearingAfter:0, name:'Jl. Kenanga', distance:800, location: ll(1000,0) },
  { type:'new name', modifier:'straight', exit:null, name:'Jl. Melati', distance:300, location: ll(1000,300) },
  { type:'roundabout', modifier:'right', exit:2, name:'Jl. Raya', distance:100, location: ll(1000,800) },
  { type:'exit roundabout', modifier:'right', exit:null, name:'Jl. Raya', distance:600, location: ll(1000,830) },
  { type:'arrive', modifier:'right', exit:null, name:'', distance:0, location: ll(1000,1400) }
];
let ok = 0, fail = 0; const check = (n, c, x='') => { c ? ok++ : fail++; console.log((c?'PASS ':'FAIL ')+n+(c||!x?'':`  [${x}]`)); };

// text
check('left turn text', describeStep(steps[1]).title === 'Belok kiri' && describeStep(steps[1]).detail === 'ke Jl. Kenanga');
check('roundabout exit text', describeStep(steps[3]).title === 'Di bundaran, ambil jalan keluar ke-2', describeStep(steps[3]).title);
check('u-turn text', describeStep({type:'turn',modifier:'uturn',name:''}).title === 'Putar balik');
check('arrive side text', describeStep(steps[5]).title === 'Tiba di tujuan, di sebelah kanan');
check('slight + sharp text', describeStep({type:'turn',modifier:'slight right',name:''}).title === 'Agak ke kanan' && describeStep({type:'turn',modifier:'sharp left',name:''}).title === 'Belok tajam ke kiri');
check('fork text', describeStep({type:'fork',modifier:'slight left',name:''}).title === 'Ambil kiri di pertigaan');

function drive({ speed, route=coords, stepList=steps, offAt=null, hz=1 }) {
  const alerts=[], offs=[]; const g = new TurnGuide(cfg, { onAlert: a => alerts.push({ ...a, at: pos }), onOffRoute: () => offs.push(pos) });
  g.setRoute({ coords: route, steps: stepList }); let pos = 0; const path = buildPath(route); const views=[];
  for (let t=0; pos < path.total + 30 && t < 2000; t += 1/hz) {
    pos += speed/hz; let lat, lng;
    // find point at distance pos along the polyline
    let i=1; while (i<path.cum.length-1 && path.cum[i] < pos) i++; const f=(pos-path.cum[i-1])/(path.cum[i]-path.cum[i-1]||1); lat = route[i-1][0]+(route[i][0]-route[i-1][0])*Math.min(1,f); lng = route[i-1][1]+(route[i][1]-route[i-1][1])*Math.min(1,f);
    if (offAt && pos > offAt && pos < offAt + 400) { lat += 80/M; }               // wander 80 m off the road
    g.update({ latitude: lat, longitude: lng, accuracy: 6, speed });
    views.push(g.view);
  }
  return { alerts, offs, g, views };
}

// normal drive at 15 m/s (54 km/h): far = clamp(450,200,500)=450, near = 150
let r = drive({ speed: 15 });
const turnAlerts = r.alerts.filter(a => a.maneuver.step.type === 'turn');
check('left turn: 3 alerts in order far/near/now', turnAlerts.map(a=>a.stage).join() === 'far,near,now', turnAlerts.map(a=>a.stage).join());
const dist = (a) => a.maneuver.along - a.at;
check('left turn: far alert ~450 m before', Math.abs(dist(turnAlerts[0]) - 450) < 20, dist(turnAlerts[0]).toFixed(0));
check('left turn: near alert ~150 m before', Math.abs(dist(turnAlerts[1]) - 150) < 20, dist(turnAlerts[1]).toFixed(0));
check('left turn: now alert within 30 m', dist(turnAlerts[2]) <= 30 && dist(turnAlerts[2]) > 5, dist(turnAlerts[2]).toFixed(0));
const rb = r.alerts.filter(a => a.maneuver.step.type === 'roundabout');
check('roundabout alerted with exit number', rb.length >= 2 && rb[0].maneuver.title.includes('ke-2'), rb.length);
check('no alerts for "new name"/"exit roundabout"/depart', !r.alerts.some(a => ['new name','exit roundabout','depart'].includes(a.maneuver.step.type)));
check('arrival announced once at the end', r.alerts.filter(a => a.maneuver.step.type === 'arrive' && a.stage === 'now').length === 1);
check('popup view shows distance shrinking', (() => { const ds = r.views.filter(v => v?.kind==='maneuver' && v.step.type==='turn').map(v=>v.distance); return ds.length>10 && ds.every((d,i)=> i===0 || d <= ds[i-1]+1); })());
check('no popup between turns (map stays clean)', r.views.some(v => v === null));
check('never off-route on a clean drive', r.offs.length === 0);

// slow drive at 6 m/s: far=clamp(180,200,500)=200, near=clamp(60,60,200)=60
r = drive({ speed: 6 });
const t6 = r.alerts.filter(a => a.maneuver.step.type === 'turn');
check('slow: far alert at the 200 m floor', Math.abs(dist(t6[0]) - 200) < 15, dist(t6[0]).toFixed(0));
// fast 28 m/s: far capped at 500
r = drive({ speed: 28 });
const t28 = r.alerts.filter(a => a.maneuver.step.type === 'turn');
check('fast: far alert capped at 500 m', Math.abs(dist(t28[0]) - 500) < 40, dist(t28[0]).toFixed(0));
// off route
r = drive({ speed: 15, offAt: 400 });
check('leaving the road triggers one off-route request', r.offs.length === 1, r.offs.length);
check('off-route view shown', r.views.some(v => v?.kind === 'offroute'));
// blocked (toll)
const gb = new TurnGuide(cfg, {}); gb.setRoute({ coords, steps, blockedClasses: ['toll'] });
gb.update({ latitude: coords[5][0], longitude: coords[5][1], accuracy: 5, speed: 10 });
check('toll route: guidance is not active', gb.active === false && gb.view === null && gb.blocked[0] === 'toll');
// new route resets
const g2 = new TurnGuide(cfg, {}); g2.setRoute({ coords, steps }); g2.update({ latitude: coords[60][0], longitude: coords[60][1], accuracy: 5, speed: 15 }); g2.setRoute({ coords, steps });
check('setRoute resets progress', g2.alongM === 0 && g2.stage === null);
// starting close to a turn: single alert at the right stage, no stale earlier ones
const g3alerts=[]; const g3 = new TurnGuide(cfg, { onAlert: a => g3alerts.push(a.stage) }); g3.setRoute({ coords, steps });
g3.update({ latitude: coords[95][0], longitude: coords[95][1], accuracy: 5, speed: 5 });   // 950 m along: 50 m from the turn
check('joining 50 m before a turn fires only "now"... or "near", not a burst', g3alerts.length === 1 && ['near','now'].includes(g3alerts[0]), g3alerts.join());
console.log(`\n${ok}/${ok+fail} passed`); process.exit(fail ? 1 : 0);
