/** Geolocation permission helpers and the screen wake lock. */

/** @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'|'insecure'|'unknown'>} */
export async function queryGeoPermission() {
  if (!('geolocation' in navigator)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Calls cb(state) now and whenever the permission changes. Returns an unsubscribe fn. */
export async function watchGeoPermission(cb) {
  if (!navigator.permissions || !navigator.permissions.query) { cb(await queryGeoPermission()); return () => {}; }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    const handler = () => cb(status.state);
    status.addEventListener('change', handler);
    cb(status.state);
    return () => status.removeEventListener('change', handler);
  } catch {
    cb('unknown');
    return () => {};
  }
}

export function describePermission(state) {
  switch (state) {
    case 'granted': return { label: 'GPS allowed', tone: 'success' };
    case 'denied': return { label: 'GPS blocked', tone: 'danger' };
    case 'prompt': return { label: 'GPS not asked', tone: 'warning' };
    case 'unsupported': return { label: 'No GPS', tone: 'danger' };
    case 'insecure': return { label: 'Needs HTTPS', tone: 'danger' };
    default: return { label: 'GPS unknown', tone: 'muted' };
  }
}

export const PERMISSION_HELP = {
  denied: 'Location is blocked. In Chrome tap the lock icon → Permissions → Location → Allow. In an Android app wrapper, open Android Settings → Apps → this app → Permissions → Location → Allow while using the app, then come back.',
  unsupported: 'This browser or WebView does not provide location services.',
  insecure: 'Location only works on HTTPS pages. Open the app from its https:// address.'
};

/**
 * Keeps the screen on while touring. A locked screen suspends web pages (and
 * their GPS updates), so this is the only reliable way to keep sharing from a
 * browser or WebView. It costs battery, so it is opt-in.
 */
export class WakeLock {
  constructor() {
    this.sentinel = null;
    this.wanted = false;
    this._onVisible = () => { if (this.wanted && document.visibilityState === 'visible') this._acquire(); };
    document.addEventListener('visibilitychange', this._onVisible);
  }

  static get supported() { return 'wakeLock' in navigator; }

  async _acquire() {
    if (!WakeLock.supported || this.sentinel) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => { this.sentinel = null; });
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  async enable() { this.wanted = true; return this._acquire(); }

  async disable() {
    this.wanted = false;
    try { await this.sentinel?.release(); } catch { /* ignore */ }
    this.sentinel = null;
  }

  destroy() {
    document.removeEventListener('visibilitychange', this._onVisible);
    return this.disable();
  }
}
