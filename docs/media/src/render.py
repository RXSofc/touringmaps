"""Renders docs/media/*.gif from the app's own CSS and splash. Needs: python3 + playwright, ffmpeg.
   python3 docs/media/src/render.py   (serves the repo on :8099 first: python3 -m http.server 8099)"""
import subprocess, shutil, tempfile, os, glob
from playwright.sync_api import sync_playwright
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..')); OUT = os.path.join(ROOT, 'docs', 'media')
BASE = 'http://localhost:8099'
def gif(frames_glob, out, fps, width, colors=32):
    pal = os.path.join(tempfile.gettempdir(), 'pal.png')
    f = f'fps={fps},scale={width}:-1:flags=lanczos'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate',str(fps),'-i',frames_glob,'-vf',f'{f},palettegen=max_colors={colors}:stats_mode=diff',pal],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate',str(fps),'-i',frames_glob,'-i',pal,'-lavfi',f'{f}[x];[x][1:v]paletteuse=dither=none','-loop','0',out],check=True)
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) the real launch splash
    tmp = tempfile.mkdtemp()
    ctx = b.new_context(viewport={'width':360,'height':720}, record_video_dir=tmp, record_video_size={'width':360,'height':720})
    pg = ctx.new_page(); pg.route('**/*', lambda r: r.abort() if any(x in r.request.url for x in ('gstatic','googleapis')) else r.continue_())
    pg.goto(BASE + '/index.html'); pg.wait_for_timeout(4300); ctx.close()
    webm = glob.glob(os.path.join(tmp, '*.webm'))[0]
    pal = os.path.join(tmp, 'p.png')
    vf = 'fps=14,scale=216:-1:flags=lanczos'
    SS = ['-ss', '0.7']   # the recording starts with a blank page
    subprocess.run(['ffmpeg','-y','-loglevel','error',*SS,'-i',webm,'-vf',vf+',palettegen=max_colors=24:stats_mode=diff',pal],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error',*SS,'-i',webm,'-i',pal,'-lavfi',vf+'[x];[x][1:v]paletteuse=dither=none','-loop','0',os.path.join(OUT,'splash.gif')],check=True)
    # 2) a scripted ride: follow-me map, turn cards, region popup, off-route + reroute
    fr = tempfile.mkdtemp(); pg = b.new_page(viewport={'width':320,'height':640}, device_scale_factor=1)
    pg.goto(BASE + '/docs/media/src/ride.html'); pg.wait_for_timeout(300)
    n = 0
    for i in range(0, 17*10):
        pg.evaluate(f'render({i/10})'); pg.screenshot(path=os.path.join(fr, f'f{n:04d}.png')); n += 1
    for _ in range(12):   # hold the last frame
        shutil.copy(os.path.join(fr, f'f{n-1:04d}.png'), os.path.join(fr, f'f{n:04d}.png')); n += 1
    gif(os.path.join(fr, 'f%04d.png'), os.path.join(OUT, 'ride.gif'), 10, 240, 40)
    # 3) palette strip
    pg = b.new_page(viewport={'width':720,'height':120})
    pg.set_content('<body style="margin:0;display:flex;font:700 12px/1 monospace">' + ''.join(f'<div style="flex:1;background:{c};color:{t};padding:10px;display:flex;align-items:flex-end">{n}<br>{c}</div>' for c,t,n in [('#141616','#E6E3E1','Dark Void'),('#3D3C38','#E6E3E1','Iridium'),('#746D67','#E6E3E1','Artillery'),('#A49F9D','#141616','Equilibrium'),('#7F1D1A','#E6E3E1','Falu Red')]) + '</body>')
    pg.screenshot(path=os.path.join(OUT,'palette.png')); b.close()
print('done')
