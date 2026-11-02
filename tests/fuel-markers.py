from playwright.sync_api import sync_playwright
JS = r"""
async () => {
  const out = {}; const ev=()=>({on(){return this},off(){return this}});
  // ---- 2D (Leaflet) with a fake L
  let made = [];
  const Lg=()=>({addTo(){return this},clearLayers(){},remove(){}});
  window.L={ map:()=>({...ev(),getZoom:()=>10,getCenter:()=>({lat:0,lng:0}),setView(){},remove(){},attributionControl:{setPrefix(){}},latLngToContainerPoint:()=>({x:0,y:0}),getSize:()=>({x:10,y:10}),panes:{}}),
    control:{zoom:()=>({addTo(){}})}, tileLayer:()=>({...ev(),addTo(){return this},remove(){}}), layerGroup:Lg,
    polyline:()=>({addTo(){return this}}), divIcon:(o)=>o,
    marker:(ll,o)=>{ const m={ll,o,removed:false,handlers:{},addTo(){return m},remove(){m.removed=true},on(k,f){m.handlers[k]=f;return m}}; made.push(m); return m; }, circle:()=>({addTo(){return this}}) };
  const { TouringMap } = await import('/js/map.js');
  let clicked = null;
  const m2 = new TouringMap(document.body, { onFuelClick: (f) => { clicked = f.id; } });
  const A={id:'a',lat:-6.2,lng:106.8,name:'SPBU A'}, B={id:'b',lat:-6.21,lng:106.81,name:'SPBU B'}, C={id:'c',lat:-6.22,lng:106.82,name:'SPBU C'};
  m2.setFuelStops([A,B]); out.n2 = made.length; m2.setFuelStops([A,B]); out.same = made.length;
  m2.setFuelStops([B,C]); out.after = made.length; out.removedA = made.find(x=>x.o.title==='SPBU A').removed; out.keptB = !made.find(x=>x.o.title==='SPBU B').removed;
  made.find(x=>x.o.title==='SPBU C').handlers.click(); out.click2d = clicked;
  out.html = made.find(x=>x.o.title==='SPBU A').o.icon.html.className; m2.setFuelStops([]); out.cleared = made.every(x=>x.removed);
  return out;
}
"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8099/tests/map3d-fake.html'); r=pg.evaluate(JS); print(r, errs)
    ok = r['n2']==2 and r['same']==2 and r['after']==3 and r['removedA'] and r['keptB'] and r['click2d']=='c' and r['html']=='fuel-marker' and r['cleared'] and not errs
    print('OK' if ok else 'FAIL'); b.close()
