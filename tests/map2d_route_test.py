from playwright.sync_api import sync_playwright
JS = r"""
async () => {
  const lines=[]; const ev=()=>({on(){return this},off(){return this}});
  const Lg=()=>({addTo(){return this},clearLayers(){lines.length=0},remove(){},eachLayer(f){lines.forEach(f)}});
  const L={ map:()=>({...ev(),getZoom:()=>10,getCenter:()=>({lat:0,lng:0}),setView(){},remove(){},attributionControl:{setPrefix(){}},latLngToContainerPoint:()=>({x:0,y:0}),getSize:()=>({x:10,y:10}),panBy(){}}),
    control:{zoom:()=>({addTo(){}})}, tileLayer:()=>({...ev(),addTo(){return this},remove(){}}), layerGroup:Lg,
    polyline:(c,o)=>{const l={c,o,addTo(){lines.push(l);return l},setStyle(x){Object.assign(l.o,x)}};return l}, marker:()=>({}), divIcon:()=>({}), circle:()=>({}) };
  window.L=L;
  const { TouringMap } = await import('/js/map.js');
  const m = new TouringMap(document.body,{});
  const coords=Array.from({length:101},(_,i)=>[-6.2+i*0.0001,106.8]); // ~1.1 km
  m.setRoute(coords);
  const cas=lines[0], segs=lines.slice(1);
  const out={casing:cas.o.color, w:cas.o.weight, nSeg:segs.length, first:segs[0].o.color, last:segs[segs.length-1].o.color,
    covers: segs[0].c[0][0]===coords[0][0] && segs[segs.length-1].c.at(-1)[0]===coords.at(-1)[0],
    contiguous: segs.every((s,i)=>i===0||s.c[0][0]===segs[i-1].c.at(-1)[0]), snapper: !!m.snapper};
  m.setRouteDim(true); out.dim = lines.every(l=>l.o.opacity<0.5); m.setRouteDim(false); out.undim = lines.every(l=>l.o.opacity===1);
  m.setRoute(null); out.cleared = lines.length===0 && m.snapper===null;
  return out;
}
"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8099/tests/map3d-fake.html'); print(pg.evaluate(JS), errs); b.close()
