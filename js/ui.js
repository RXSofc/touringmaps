/**
 * UI helpers: safe DOM building (no innerHTML with user data), icons,
 * toasts, sheets, dialogs, formatters.
 */

/* ---------------------------------------------------------------- DOM */

/**
 * Hyperscript-style element builder. Text children are inserted as text nodes,
 * so user-controlled strings can never become markup.
 */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mountInto(node, ...children) {
  clear(node);
  return appendChildren(node, children);
}

/* -------------------------------------------------------------- Icons */

// Static, trusted SVG path data (24x24 grid, stroke-based).
const ICONS = {
  locate: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  'arrow-up': '<path d="M12 20V5M6 11l6-6 6 6"/>',
  'turn-right': '<path d="M7 20v-8a4 4 0 0 1 4-4h8M15 4l4 4-4 4"/>',
  'turn-left': '<path d="M17 20v-8a4 4 0 0 0-4-4H5M9 4L5 8l4 4"/>',
  'slight-right': '<path d="M8 20v-8l8-7M10 5h6v6"/>',
  'slight-left': '<path d="M16 20v-8l-8-7M14 5H8v6"/>',
  'sharp-right': '<path d="M6 4v6l11 6M17 11v6h-6"/>',
  'sharp-left': '<path d="M18 4v6L7 16M7 11v6h6"/>',
  uturn: '<path d="M8 20V9a4 4 0 0 1 8 0v8M12 13l4 4 4-4"/>',
  roundabout: '<circle cx="12" cy="14" r="5"/><path d="M12 19v3M12 9V3M9 6l3-3 3 3"/>',
  fork: '<path d="M12 21v-8M12 13L6 6M12 13l6-7M6 11V6h5M18 11V6h-5"/>',
  flag: '<path d="M5 21V4M5 4h13l-3 4.5L18 13H5"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-4 3-6 6.5-6s6.5 2 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.4c2 .8 3 2.6 3 5.6"/>',
  headset: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6"/><rect x="17" y="14" width="4" height="6"/>',
  mic: '<rect x="9" y="3" width="6" height="11"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>',
  copy: '<rect x="8" y="8" width="12" height="12"/><path d="M4 16V4h12"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  back: '<path d="M20 12H5M11 5l-7 7 7 7"/>',
  settings: '<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>',
  logout: '<path d="M10 4H4v16h6M15 8l4 4-4 4M19 12H9"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  check: '<path d="M4 12.5l5 5L20 6"/>',
  alert: '<path d="M12 3L2 20h20L12 3z"/><path d="M12 10v4.5M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  refresh: '<path d="M20 5v5h-5"/><path d="M19.5 10A8 8 0 1 0 20 14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><path d="M12 19.5v.5"/>'
};

export function icon(name, { label } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  if (label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label); }
  else svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || ''; // trusted constants only
  return svg;
}

/* ------------------------------------------------------------- Toasts */

export function toast(message, { type = 'info', timeout, action } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return () => {};
  if (timeout === undefined) timeout = type === 'info' || type === 'success' ? 2600 : 4200;
  // Sit just above the dock so the map stays clear; fall back to a fixed offset.
  const dock = document.querySelector('.dock');
  const dockH = dock ? Math.round(dock.getBoundingClientRect().height) : 0;
  host.style.setProperty('--toast-bottom', `${(dockH || 84) + 10}px`);
  // The same message again replaces the old one instead of stacking.
  for (const old of [...host.children]) if (old.dataset.msg === String(message)) old.remove();
  const el = h('div', { class: `toast toast--${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', {}, message),
    action ? h('button', { type: 'button', class: 'btn btn--sm', onclick: () => { action.onClick(); dismiss(); } }, action.label) : null
  );
  const dismiss = () => el.remove();
  el.dataset.msg = String(message);
  if (!action) el.addEventListener('click', dismiss);
  host.append(el);
  while (host.children.length > 2) host.firstChild.remove();
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}

/* -------------------------------------------------------------- Sheets */

let sheetSeq = 0;

function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null);
}

/**
 * Modal bottom sheet (centered dialog on wide screens).
 * @returns {{close:(result?:any)=>void, body:HTMLElement, sheet:HTMLElement}}
 */
export function openSheet({ title, content, footer, onClose, className = '' }) {
  const previouslyFocused = document.activeElement;
  const titleId = `sheet-title-${++sheetSeq}`;
  let closed = false;

  const body = h('div', { class: 'sheet__body' }, content);
  const sheet = h('div', { class: `sheet ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'sheet__head' },
      h('h2', { class: 'sheet__title', id: titleId }, title),
      h('button', { type: 'button', class: 'btn btn--icon btn--sm btn--cancel', 'aria-label': 'Close', onclick: () => close() }, icon('close'))
    ),
    body,
    footer ? h('div', { class: 'sheet__foot' }, footer) : null
  );
  const backdrop = h('div', { class: 'backdrop', onpointerdown: (e) => { if (e.target === backdrop) close(); } }, sheet);

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables(sheet);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function close(result) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (!document.querySelector('.backdrop')) document.body.classList.remove('has-sheet');
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    if (onClose) onClose(result);
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  document.body.classList.add('has-sheet');
  const first = focusables(body)[0] || sheet.querySelector('button');
  if (first) first.focus({ preventScroll: true });

  return { close, body, sheet };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const sheet = openSheet({
      title,
      content: h('p', {}, message),
      footer: [
        h('button', { type: 'button', class: 'btn', onclick: () => sheet.close() }, cancelLabel),
        h('button', { type: 'button', class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => { answer = true; sheet.close(); } }, confirmLabel)
      ],
      onClose: () => resolve(answer)
    });
  });
}

/* --------------------------------------------------------------- Async */

/** Disable a button and show a spinner while `task` runs. */
export async function withBusy(button, task) {
  if (button) { button.classList.add('is-loading'); button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    return await task();
  } finally {
    if (button) { button.classList.remove('is-loading'); button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

/** Leading + trailing throttle. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pendingArgs = null;
  return (...args) => {
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer); timer = null; last = now; fn(...args);
    } else {
      pendingArgs = args;
      if (!timer) timer = setTimeout(() => { last = Date.now(); timer = null; fn(...pendingArgs); }, remaining);
    }
  };
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  const ta = h('textarea', { readonly: true, style: { position: 'fixed', top: '-1000px', opacity: '0' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

/* ---------------------------------------------------------- Formatters */

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '–';
  if (meters < 1000) return `${Math.round(meters / 10) * 10 || Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${hrs} h ${rem} min` : `${hrs} h`;
}

export function formatAge(ms) {
  if (!Number.isFinite(ms)) return '–';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function formatCoord(n, digits = 5) {
  return Number.isFinite(n) ? n.toFixed(digits) : '–';
}

export function formatLatLng(lat, lng, digits = 5) {
  return `${formatCoord(lat, digits)}, ${formatCoord(lng, digits)}`;
}

export function formatClock(ts) {
  if (!Number.isFinite(ts)) return '–';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts) {
  if (!Number.isFinite(ts)) return '–';
  return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatSpeedKmh(metersPerSecond) {
  if (!Number.isFinite(metersPerSecond)) return null;
  return `${Math.round(metersPerSecond * 3.6)} km/h`;
}

/** Trim, collapse whitespace, strip control characters, cap length. */
export function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Inline SVG data-URL avatar with the rider's initial. Used when no photo is set. */
export function defaultAvatar(name, seed = '') {
  const palette = ['#FFFFFF', '#000000'];
  let hash = 0;
  for (const ch of `${seed}${name}`) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  const bg = palette[hash % palette.length];
  const fg = bg === '#000000' ? '#FFFFFF' : '#000000';
  const initial = ([...String(name || '?').trim()][0] || '?').toUpperCase();
  const safe = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[initial] || initial;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="43" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-weight="900" font-size="34" fill="${fg}">${safe}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function avatarFor(person, uid = '') {
  return person?.avatarUrl || defaultAvatar(person?.displayName, uid);
}

/** Wire an <img> to fall back to the default avatar if its source fails to load. */
export function avatarImg(person, uid, className = 'avatar') {
  const img = h('img', { class: className, alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  const fallback = defaultAvatar(person?.displayName, uid);
  img.addEventListener('error', () => { if (img.src !== fallback) img.src = fallback; }, { once: true });
  img.src = avatarFor(person, uid);
  return img;
}
