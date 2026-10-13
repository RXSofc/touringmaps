// Simulated ride: run with  node tests/gps-sim.mjs  (prints raw vs filtered error and marker step size)
import { PositionFilter } from '../js/gps-filter.js';
import { MotionTrack } from '../js/motion.js';
import { haversine } from '../js/geo.js';
const cfg = { minAccuracyM:3,maxSpeedMps:70,jumpConfirmations:3,resetAfterMs:20000,stillSpeedMps:0.6,unknownSpeedMps:3,headingMinSpeedMps:1.5,headingMinMoveM:8 };
const sm = { extrapolateMs:2500, easeMs:280, snapMeters:120, minSpeedMps:1.0 };
let seed=7; const rnd=()=>{seed=(seed*1664525+1013904223)%4294967296; return seed/4294967296}; const gauss=()=>Math.sqrt(-2*Math.log(rnd()+1e-12))*Math.cos(2*Math.PI*rnd());
const M=111320;
function run(label, {withSpeed, hz, drift=1}) {
  const f = new PositionFilter(cfg);
  let truth = { lat:-7.8, lng:110.37 }; let heading=90; let t0=1.7e12;
  const errRaw=[], errF=[]; let rejected=0; let biasE=0,biasN=0;
  const dtS = 1/hz;
  for (let i=0;i<Math.round(180*hz);i++) {
    const t = i*dtS;
    // phases: 0-60 ride 15 m/s east, 60-70 stop, 70-130 ride with turns, 130-180 slow 5 m/s
    let sp = t<60?15: t<70?0: t<130?15:5;
    if (t>=90 && t<92) heading=(heading+45*dtS)%360;
    const vE=sp*Math.sin(heading*Math.PI/180), vN=sp*Math.cos(heading*Math.PI/180);
    truth.lat += vN*dtS/M; truth.lng += vE*dtS/(M*Math.cos(truth.lat*Math.PI/180));
    biasE=0.9*biasE+0.44*gauss()*4*drift; biasN=0.9*biasN+0.44*gauss()*4*drift;   // correlated drift
    let nE=gauss()*5+biasE, nN=gauss()*5+biasN;
    if (rnd()<0.02) { nE+=90*(rnd()<.5?1:-1); nN+=70; }               // jump outliers
    const acc = 5+Math.abs(gauss())*4;
    const raw = { latitude: truth.lat+nN/M, longitude: truth.lng+nE/(M*Math.cos(truth.lat*Math.PI/180)), accuracy: acc, speed: withSpeed? sp+gauss()*0.3:null, heading: withSpeed&&sp>0.5?heading:null, timestamp: t0+t*1000 };
    const r = f.process(raw);
    const eRaw = haversine({latitude:truth.lat,longitude:truth.lng}, raw);
    errRaw.push(eRaw);
    if (r.rejected) { rejected++; errF.push(errF.length? errF[errF.length-1]:0); continue; }
    errF.push(haversine({latitude:truth.lat,longitude:truth.lng}, r.fix));
  }
  const rms=a=>Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length), p95=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length*.95)];
  console.log(`${label}: raw rms ${rms(errRaw).toFixed(1)} m p95 ${p95(errRaw).toFixed(1)} | filtered rms ${rms(errF).toFixed(1)} m p95 ${p95(errF).toFixed(1)} | rejected ${rejected}`);
  return { rawRms: rms(errRaw), fRms: rms(errF), rawP95:p95(errRaw), fP95:p95(errF) };
}
run('white noise only, doppler', {withSpeed:true,hz:1,drift:0}); run('white noise only, no doppler', {withSpeed:false,hz:1,drift:0}); run('noise + drift, doppler', {withSpeed:true,hz:1}); run('noise + drift, no doppler', {withSpeed:false,hz:1});
// stationary jitter
const f=new PositionFilter(cfg); let out=[]; const t0=1.7e12;
for(let i=0;i<60;i++){ const raw={latitude:-7.8+gauss()*6/M,longitude:110.37+gauss()*6/M,accuracy:8,speed:0,heading:null,timestamp:t0+i*1000}; const r=f.process(raw); if(r.fix) out.push(r.fix); }
const jit=(arr)=>{let s=0;for(let i=1;i<arr.length;i++)s+=haversine(arr[i-1],arr[i]);return s/(arr.length-1)};
console.log('stationary: avg step raw-like ~8.5 m, filtered', jit(out.slice(10)).toFixed(2),'m');
// motion smoothness: reports each 2 s, 15 m/s east, render 60 fps
const tr=new MotionTrack(sm); let lat=-7.8,lng=110.37; let now=2e12; tr.setFix({lat,lng,speed:15,heading:90,measuredAt:now});
let maxStep=0, prev=null, steps=[]; let nextReport=now+2000; let truthLng=lng;
for(let k=0;k<60*10;k++){ now+=1000/60; truthLng+=15*(1/60)/(M*Math.cos(lat*Math.PI/180));
  if(now>=nextReport){ // report arrives 400ms late, measured 400ms ago
    const mAt=now-400; const lg=lng+ (15*((mAt-2e12)/1000))/(M*Math.cos(lat*Math.PI/180)); tr.setFix({lat,lng:lg,speed:15,heading:90,measuredAt:mAt}); nextReport+=2000; }
  const s=tr.sample(now); if(prev){const st=haversine(prev,{latitude:s.lat,longitude:s.lng}); steps.push(st); maxStep=Math.max(maxStep,st);} prev={latitude:s.lat,longitude:s.lng}; }
const expected=15/60;
console.log(`motion: expected step ${expected.toFixed(2)} m/frame, max ${maxStep.toFixed(2)} m, min ${Math.min(...steps).toFixed(2)} m`);
// naive (no smoothing) step for comparison: jump per report
console.log('naive: jump per report would be', (15*2).toFixed(0),'m every 2 s');
// stop scenario: rider stops; last reports speed 0
const t2=new MotionTrack(sm); let n2=3e12; t2.setFix({lat:-7.8,lng:110.37,speed:15,heading:90,measuredAt:n2}); let overshoot=0;
for(let k=0;k<60;k++){n2+=1000/60;t2.sample(n2)} t2.setFix({lat:-7.8,lng:110.37+ (15*1.0)/(M),speed:0,heading:null,measuredAt:n2});
let last; for(let k=0;k<60*4;k++){n2+=1000/60; last=t2.sample(n2)}
console.log('after stop, settled:', last.settled, 'final offset from report', (haversine({latitude:-7.8,longitude:110.37+15/M},{latitude:last.lat,longitude:last.lng})).toFixed(2),'m');
