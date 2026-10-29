/**
 * Hash router. Hash URLs (#/room/abc) work under any GitHub Pages sub-path and
 * need no server rewrites, which also suits WebView wrappers.
 *
 * A route handler returns a view: { mount(container, ctx) , unmount() }.
 */
import { getUser, onAuth } from './auth.js';
import { clear } from './ui.js';

const BG_KEY = 'vex-backdrop';
export function getBackdrop() { try { return localStorage.getItem(BG_KEY) === 'contour' ? 'contour' : 'road'; } catch { return 'road'; } }
export function setBackdrop(v) { try { localStorage.setItem(BG_KEY, v); } catch { /* private mode: applies for this visit only */ } document.body.dataset.bg = v === 'contour' ? 'contour' : 'road'; }
const routes = [];
let outlet = null;
let activeView = null;
let token = 0;
let notFound = null;

export function addRoute(pattern, handler, { auth = 'required' } = {}) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ regex, keys, handler, auth });
}

export function setNotFound(handler) { notFound = handler; }

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: new URLSearchParams(query) };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (location.hash === target) { resolve(); return; }
  if (replace) location.replace(`${location.pathname}${location.search}${target}`);
  else location.hash = target;
}

function match(path) {
  for (const route of routes) {
    const m = route.regex.exec(path);
    if (m) {
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

async function resolve() {
  const myToken = ++token;
  const { path, query } = parseHash();
  const user = getUser();
  const found = match(path);

  if (path === '/' || !found && !notFound) {
    navigate(user ? '/dashboard' : '/login', { replace: true });
    return;
  }
  const route = found?.route;
  if (route?.auth === 'required' && !user) {
    const next = path !== '/dashboard' ? `?next=${encodeURIComponent(path)}` : '';
    navigate(`/login${next}`, { replace: true });
    return;
  }
  if (route?.auth === 'guest' && user) {
    const next = query.get('next');
    navigate(next && next.startsWith('/') ? next : '/dashboard', { replace: true });
    return;
  }

  if (activeView) {
    try { await activeView.unmount?.(); } catch (e) { console.error(e); }
    activeView = null;
  }
  if (myToken !== token) return;
  clear(outlet);
  document.body.dataset.route = path.split('/')[1] || '';
  document.body.dataset.bg = getBackdrop();

  const handler = route ? route.handler : notFound;
  const view = handler(found?.params || {}, query);
  activeView = view;
  try {
    await view.mount(outlet, { query, params: found?.params || {} });
  } catch (err) {
    console.error('view failed to mount', err);
  }
  if (myToken !== token) {
    try { await view.unmount?.(); } catch { /* ignore */ }
    if (activeView === view) activeView = null;
    return;
  }
  window.scrollTo(0, 0);
  outlet.focus({ preventScroll: true });
}

export function startRouter(container) {
  outlet = container;
  window.addEventListener('hashchange', resolve);
  // Re-evaluate guards when someone signs in or out.
  let lastUid = getUser()?.uid ?? null;
  onAuth((user) => {
    const uid = user?.uid ?? null;
    if (uid !== lastUid) { lastUid = uid; resolve(); }
  });
  resolve();
}
