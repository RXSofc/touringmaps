/**
 * Entry point. Kept free of Firebase imports so that a missing configuration
 * or an unreachable SDK produces a helpful screen instead of a blank page.
 */
import { isFirebaseConfigured } from './config.js';
import { renderSetup, renderFatal } from './views/setup.js';

const LEAFLET_SOURCES = [
  { js: 'vendor/leaflet/leaflet.js', css: 'vendor/leaflet/leaflet.css' },
  { js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' },
  { js: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', css: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css' }
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error(`Could not load ${src}`)); };
    document.head.append(s);
  });
}

function loadCss(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/** Uses vendor/leaflet if present, otherwise falls back to a CDN. */
async function ensureLeaflet() {
  if (window.L) return;
  for (const src of LEAFLET_SOURCES) {
    try {
      await loadScript(src.js);
      if (window.L) { loadCss(src.css); return; }
    } catch { /* try next source */ }
  }
  throw new Error('The map library (Leaflet) could not be loaded. Check your connection, or run scripts/vendor-leaflet.sh.');
}

async function start() {
  const app = document.getElementById('app');
  const splashDone = () => { try { window.__splash?.done(); } catch { /* splash is cosmetic */ } };
  if (!isFirebaseConfigured()) { renderSetup(app); splashDone(); return; }
  try {
    await ensureLeaflet();
    const { boot } = await import('./main.js');
    await boot(app);
  } catch (err) {
    console.error(err);
    renderFatal(app, err);
  }
  splashDone();   // the first screen is on the page: let the road widen into it
}

start();
