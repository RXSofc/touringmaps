from playwright.sync_api import sync_playwright
JS = r"""
async () => {
  const log = [];
  const calls = [];
  class Src { constructor(){ this.d=null; } setData(d){ this.d=d; calls.push('setData'); } }
  class Marker { constructor(o){ this.el=o.element; this.o=o; this.ll=null; document.body.append(this.el); }
    setLngLat(ll){ this.ll={lng:ll[0],lat:ll[1]}; return this; } getLngLat(){ return this.ll; } addTo(){ return this; }
    getElement(){ return this.el; } remove(){ this.el.remove(); this.removed=true; } }
  let inst;
  class Map { constructor(o){ inst=this; this.o=o; this.h={}; this.src={route:new Src(),route2:new Src(),accuracy:new Src()};
      this.c={lng:o.center[0],lat:o.center[1]}; this.z=o.zoom; this.vis={}; this.pad=null;
      this.touchZoomRotate={enableRotation(){}}; this.cv=document.createElement('canvas');
      setTimeout(()=>this.h.load&&this.h.load(),0); }
    on(e,f){ this.h[e]=f; } addControl(){} getCanvas(){ return this.cv; } getContainer(){ return {clientHeight:600}; }
    getSource(id){ return this.src[id]; } getLayer(){ return {}; } setLayoutProperty(id,k,v){ this.vis[id]=v; } setPaintProperty(id,k,v){ (this.paint ||= {})[id+':'+k]=v; }
    jumpTo(o){ if(o.center) this.c={lng:o.center[0],lat:o.center[1]}; if(o.bearing!==undefined) this.b=o.bearing; if(o.zoom!==undefined) this.z=o.zoom; this.jumps=(this.jumps||0)+1; }
    easeTo(o){ this.ease=o; } flyTo(o){ this.fly=o; } fitBounds(b,o){ this.fit={b,o}; } setPadding(p){ this.pad=p; } setTerrain(t){ this.terrain=t; } setLayerZoomRange(id,a,b){ (this.zr ||= {})[id]=[a,b]; }
    getCenter(){ return this.c; } getBearing(){ return this.b||0; } getZoom(){ return this.z; } resize(){ this.resized=true; } remove(){ this.gone=true; } }
  window.maplibregl = { Map, Marker, AttributionControl: class{} };
  const { TouringMap3D } = await import('/js/map3d.js');
  const { buildStyle } = await import('/js/map-style.js');
  const fails = [];
  const ok = (c,m)=>{ if(!c) fails.push(m); };
  // style sanity
  const st = buildStyle(); const ids = st.layers.map(l=>l.id);
  ok(new Set(ids).size===ids.length,'dup layer ids');
  ok(st.layers.every(l=>l.type==='background'||st.sources[l.source]),'layer without source');
  ok(st.glyphs && st.sources.openmaptiles.url && st.sources.openmaptiles.maxzoom===undefined,'source config');
  ok(st.sources.route.lineMetrics===true,'route lineMetrics for gradient');
  ok(JSON.stringify(st.layers.find(l=>l.id==='route-line').paint['line-gradient']).includes('line-progress'),'route gradient');
  ok(ids.includes('building-3d') && ids.indexOf('route-line')>ids.indexOf('building-3d'),'route above buildings');

  let slow=0, terrErr=0, panned=0, clicks=[], rider=[], tileErr=0;
  const m = new TouringMap3D(document.getElementById('m'), {onUserPan:()=>panned++, onMapClick:l=>clicks.push(l), onRiderClick:u=>rider.push(u), onTileError:()=>tileErr++, onTerrainError:()=>terrErr++, onTerrainSlow:()=>slow++}, {lat:-6.2,lng:106.8,zoom:16});
  ok(Math.abs(inst.z-15)<1e-9,'zoom conversion (leaflet 16 -> ml 15), got '+inst.z);
  ok(inst.o.pitch===60,'pitch');
  ok(Math.abs(m.getView().zoom-16)<1e-9,'getView round trip');
  // data before load is deferred
  m.setRoute([[-6.2,106.8],[-6.21,106.81]]);
  ok(inst.src.route.d===null,'route deferred before load');
  await new Promise(r=>setTimeout(r,20));
  ok(inst.src.route.d && inst.src.route.d.features[0].geometry.coordinates[0][0]===106.8,'route applied on load as [lng,lat]');
  m.setRoute(null); ok(inst.src.route.d.features.length===0,'route cleared');
  m.setOtherRoute([[-6.2,106.8],[-6.3,106.9]]); ok(inst.src.route2.d.features.length===1,'other route');
  m.setRouteVisible(false); ok(inst.vis['route-line']==='none','route hidden');
  m.setRouteVisible(true); ok(inst.vis['route-line']==='visible','route shown');
  // riders
  const now=Date.now();
  const r1={uid:'a',name:'Anto',avatar:'',state:'live',lat:-6.2,lng:106.8,ageMs:0,isSelf:true,selected:false,fix:{speed:10,heading:90,measuredAt:now}};
  const r2={uid:'b',name:'Budi',avatar:'',state:'live',lat:-6.21,lng:106.81,ageMs:0,isSelf:false,selected:false,fix:{speed:0,heading:0,measuredAt:now}};
  m.syncRiders([r1,r2]);
  ok(m.riders.size===2,'two riders');
  const el=m.riders.get('b').el; el.click(); ok(rider[0]==='b','rider click');
  ok(clicks.length===0,'rider click must not hit map click (stopPropagation)');
  m.syncRiders([{...r2,selected:true,name:'Budi2'}]); ok(m.riders.size===1 && m.riders.get('b').el.textContent.includes('Budi2'),'update + removal');
  m.syncRiders([r1,r2]);
  // follow: heading east -> bearing turns toward 90
  m.setFollow('a'); ok(inst.pad && inst.pad.top>100,'follow padding');
  await new Promise(r=>setTimeout(r,400));
  ok(inst.jumps>3 && inst.jumps<20,'follow jumps camera but throttled, got '+inst.jumps); ok(inst.b>0 && inst.b<=90,'bearing turns toward heading, got '+inst.b);
  const jumps=inst.jumps; m.setFollow(null); ok(inst.pad.top===0,'padding reset');

  // my dot is pulled onto my route line (4 m beside it)
  { const off = 4/(111320*Math.cos(6.2*Math.PI/180));
    m.setRoute([[-6.19,106.8],[-6.21,106.8]]);
    m.syncRiders([{...r1, lat:-6.2, lng:106.8+off, fix:{speed:0,heading:0,accuracy:5,measuredAt:Date.now()+1}}, r2]);
    await new Promise(r=>setTimeout(r,500));
    const self=m.riders.get('a'); ok(Math.abs(self.lng-106.8)<1e-7,'self dot snapped to the route, lng '+self.lng);
    const other=m.riders.get('b'); ok(Math.abs(other.lng-106.81)<1e-6,'other riders not snapped');
    m.setRoute(null); }

  // hills: off by default, on/off toggles terrain + hillshade, failing elevation tiles switch it off by themselves
  ok(inst.terrain===null||inst.terrain===undefined,'terrain off by default');
  m.setTerrain(true); ok(inst.terrain && inst.terrain.source==='terrain' && inst.terrain.exaggeration>1,'terrain on'); ok(inst.vis['hillshade']==='visible','hillshade shown');
  m.setTerrain(false); ok(inst.terrain===null && inst.vis['hillshade']==='none','terrain off again');
  // hill levels: 1 = shading only (no mesh), 2 = full terrain with flat buildings, watchdog drops 2 -> 1 when frames are slow
  m.setTerrain(1); ok(inst.terrain===null && inst.vis['hillshade']==='visible' && inst.vis['building-3d']!=='none','level 1: shading only, 3D buildings kept');
  m.setTerrain(2); ok(inst.terrain && inst.vis['building-3d']==='none' && inst.vis['building-outline']==='none','level 2: terrain mesh, extrusions swapped for the flat footprints');
  { const flat=st.layers.find(l=>l.id==='building-flat'); ok(flat && flat.maxzoom===undefined && flat.minzoom===13,'flat footprints exist at every zoom (no hole where hide_3d outlines have partial parts)'); }
  { let T=0; const real=performance.now.bind(performance); performance.now=()=>T; m.setTerrain(2);
    for(const dt of [1600,500,500,500]){ T+=dt; inst.h.render&&inst.h.render(); }
    performance.now=real;
    ok(slow===1 && m.terrainLevel===1 && inst.terrain===null && inst.vis['hillshade']==='visible','slow frames drop full terrain to shading once, got '+slow+' level '+m.terrainLevel);
    let T2=0; performance.now=()=>T2; m.setTerrain(2);
    for(let i=0;i<60;i++){ T2+= i===0?1600:16; inst.h.render&&inst.h.render(); }
    performance.now=real; ok(slow===1 && m.terrainLevel===2,'a smooth map keeps full terrain'); }
  m.setTerrain(0); ok(inst.terrain===null && inst.vis['hillshade']==='none' && inst.vis['building-3d']==='visible','off restores everything');
  m.setTerrain(true); for(let i=0;i<5;i++) inst.h.error({sourceId:'terrain',error:{message:'x'}});
  ok(terrErr===1 && inst.terrain===null,'bad elevation tiles switch hills off once, got '+terrErr); ok(tileErr===0,'terrain errors do not count as map errors');
  ok(st.sources.terrain.type==='raster-dem' && st.sources.terrain.encoding==='terrarium','terrain source'); ok(ids.includes('hillshade') && ids.indexOf('hillshade')<ids.indexOf('road-primary'),'hillshade under roads');
  // accuracy
  m.setAccuracy({latitude:-6.2,longitude:106.8,accuracy:25});
  const ring=inst.src.accuracy.d.features[0].geometry.coordinates[0]; ok(ring.length===49,'accuracy ring');
  m.setAccuracy(null); ok(inst.src.accuracy.d.features.length===0,'accuracy cleared');
  // destination + fit
  m.setDestination({latitude:-6.3,longitude:106.9,name:'X'}); ok(!!m.destMarker,'dest marker');
  ok(m.fitAll()===true && inst.fit.b[0][0]<=106.81 && inst.fit.b[1][0]>=106.9,'fitAll bounds'); ok(inst.fit.o.maxZoom===15,'fit maxZoom converted');
  ok(m.focusDestination()===true && inst.fly.zoom===15,'focusDestination zoom converted, got '+(inst.fly&&inst.fly.zoom));
  m.previewDestination({latitude:-6.4,longitude:106.95},{pan:true,paddingBottom:200}); ok(inst.fly.padding.bottom===200,'preview padding');
  m.previewDestination(null); ok(m.previewMarker===null,'preview removed');
  // user pan + click events
  inst.h.dragstart({originalEvent:{}}); inst.h.dragstart({}); ok(panned===1,'only user drags count');
  inst.h.click({lngLat:{lat:1,lng:2}}); ok(clicks.length===1&&clicks[0].lat===1,'map click');
  // tile errors -> give up once
  for(let i=0;i<10;i++) inst.h.error({sourceId:'openmaptiles',error:{message:'x'}});
  ok(tileErr===1,'gives up exactly once, got '+tileErr);
  inst.h.error({sourceId:'other',error:{message:'glyph'}});
  m.destroy(); ok(inst.gone,'map removed'); ok(m.riders.size===0,'riders cleared');
  return fails;
}
"""
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://localhost:8099/tests/map3d-fake.html')
    print('FAILS:',pg.evaluate(JS)); print('PAGEERR:',errs)
    b.close()
