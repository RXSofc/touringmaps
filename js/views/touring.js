/**
 * Live touring screen: map, riders, shared destination, route, Discord, room tools.
 */
import {
  h, icon, toast, withBusy, mountInto, clear, avatarImg, avatarFor, openSheet, confirmDialog,
  formatDistance, formatDuration, formatAge, formatLatLng, formatSpeedKmh, formatClock
} from '../ui.js';
import { APP } from '../config.js';
import { MAP_CONFIG, usableProviders } from '../map-config.js';
import { getUser, onBeforeLogout } from '../auth.js';
import { ensureProfile } from '../profile.js';
import {
  subscribeRoom, saveDestination, clearDestination, updateRoomSettings, setRoomStatus, deleteRoom,
  rotateInvite, roomCapacity, removeMember, allowRejoin, leaveRoom, setCurrentRoom, forgetRoomEntry
} from '../rooms.js';
import { startRoomPresence, riderStatus, serverNow, serverOffset, onConnectionChange, isConnected } from '../presence.js';
import { LocationTracker, LocationPublisher } from '../location.js';
import { PositionFilter } from '../gps-filter.js';
import { TurnGuide } from '../guidance.js';
import { queryGeoPermission, watchGeoPermission, describePermission, PERMISSION_HELP, WakeLock } from '../permissions.js';
import { TouringMap } from '../map.js';
import { TouringMap3D, loadMapLibre, webglSupported } from '../map3d.js';
import { RouteManager, fetchRoute, externalNavLinks } from '../routing.js';
import { RegionWatch } from '../regionwatch.js';
import { reverseRegion } from '../destinations.js';
import { fetchWeather, weatherLine } from '../weather.js';
import { regionName } from '../region.js';
import { openDiscord, openExternal } from '../discord.js';
import { VoiceChat, VOICE_SUPPORTED } from '../voice.js';
import { haversine } from '../geo.js';
import { openDestinationPanel } from './destinationPanel.js';
import { openRoomSheet } from './roomSheet.js';
import { openGpsSheet } from './gpsSheet.js';
import { openVoiceSheet } from './voiceSheet.js';
import { navigate } from '../router.js';

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* blocked */ } },
  getSession(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  removeSession(key) { try { sessionStorage.removeItem(key); } catch { /* blocked */ } }
};

export function touringView(roomId) {
  const user = getUser();
  const uid = user.uid;
  const cleanups = [];
  let destroyed = false;
  let sharingStopped = false;

  /* ------------------------------------------------------------ state */
  const state = {
    roomId, uid,
    ready: false,
    meta: {}, members: {}, locations: {}, presence: {}, destination: null, settings: {}, banned: {},
    myFix: null,
    lastFixEventAt: 0,
    perm: 'unknown',            // geolocation permission
    geoError: null,             // {code,message}
    gateDismissed: false,       // "continue without sharing"
    tracking: false,
    sharing: storage.get(`tt.sharing.${roomId}`) !== '0',
    keepAwake: storage.get('tt.keepAwake') === '1',
    regionAlerts: storage.get('tt.region') !== '0',
    publishNote: null,          // why my position is not being shared right now
    online: true,
    selectedUid: null,
    following: false,
    route: { status: 'idle', route: null, error: null, calculatedAt: null },
    otherRoute: null,           // {uid, status:'loading'|'ok'|'error', route, error}
    routeVisible: true,
    legendOpen: false,
    ridersOpen: false,
    voiceMode: storage.get('tt.voiceMode') === 'toggle' ? 'toggle' : 'hold',   // hold the button, or tap to start/stop
    guidance: APP.guidance.enabled && storage.get('tt.guidance') !== '0',   // turn alerts (per device)
    map3d: false,               // 3D (MapLibre) map active; remembered per device
    terrain: (() => { const v = storage.get('tt.terrain'); return v === '2' && storage.get('tt.terrainFullBad') !== '1' ? 2 : v === '1' || v === '2' ? 1 : 0; })(),   // 3D map hills: 0 off, 1 shading, 2 full terrain
    voiceMicHinted: false,
    backgroundGapMs: null,
    destNotice: null,           // {text}
    dismissed: new Set(),
    tileProblem: false,
    didInitialFit: false,
    firstDestSnapshot: true,
    firstMembersSnapshot: true
  };

  let map = null;
  let tracker = null;
  let publisher = null;
  const gpsFilter = new PositionFilter(APP.gps.filter);
  const gpsStats = { received: 0, rejected: 0, published: 0, skippedAccuracy: 0, deviceDoppler: null, log: [] };
  let gpsSheet = null;
  let voiceSheet = null;
  let stopPresence = null;
  let routeManager = null;
  let guide = null;
  let lastGuidedRoute = null;
  let lastDrawnRoute = null;
  let lastTollWarned = null;
  let regionWatch = null;
  let destPanel = null;
  let roomSheet = null;
  let wakeLock = null;
  let voice = null;
  const problemToastAt = new Map();
  let hiddenAt = null;
  let otherRouteController = null;
  let rafPending = false;
  let els = {};

  const isOwner = () => state.meta.ownerUid === uid;
  const memberCount = () => Object.keys(state.members).length;
  const canEditDestination = () => state.meta.status === 'open' && (isOwner() || state.settings.destinationPolicy === 'members');
  const sessionActive = () => memberCount() >= APP.limits.minMembersForSession;

  /* ---------------------------------------------------------- layout */
  function buildLayout() {
    els.back = h('a', { class: 'btn btn--icon btn--sm btn--cancel topbar__back', href: '#/dashboard', 'aria-label': 'Back to dashboard' }, icon('back'));
    els.name = h('div', { class: 'topbar__name' }, 'Room');
    els.sub = h('div', { class: 'topbar__sub mono' }, '');
    els.connChip = h('span', { class: 'chip chip--muted' }, 'Connecting');
    els.gpsChip = h('button', { class: 'chip chip--muted chip--button', type: 'button', 'aria-label': 'GPS details', onclick: openGps }, 'GPS');
    els.alerts = h('div', { class: 'alerts', 'aria-live': 'polite' });
    els.mapEl = h('div', { class: 'map', id: 'map', role: 'application', 'aria-label': 'Live map of your riding group' });

    els.btnLocate = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Center on my position', title: 'Center on my position', onclick: onLocate }, icon('locate'));
    els.btnFit = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Fit all riders', title: 'Fit all riders', onclick: () => { state.following = false; map.fitAll(); render(); } }, icon('fit'));
    els.btnDest = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Go to destination', title: 'Go to destination', onclick: () => { state.following = false; if (!map.focusDestination()) toast('No destination set yet.', { type: 'info' }); } }, icon('flag'));
    els.btnRoute = h('button', { class: 'btn btn--icon', type: 'button', 'aria-pressed': 'true', 'aria-label': 'Show or hide route', title: 'Show or hide route', onclick: () => { state.routeVisible = !state.routeVisible; map.setRouteVisible(state.routeVisible); render(); } }, icon('route'));
    els.btn3d = h('button', { class: 'btn btn--icon btn--3d', type: 'button', 'aria-pressed': 'false', 'aria-label': '3D map', title: '3D map (tilted, follows your direction)', onclick: () => setMapMode(!state.map3d) }, h('span', { class: 'btn3d__label' }, '3D'));
    els.btnTerrain = h('button', { class: 'btn btn--icon btn--3d', type: 'button', hidden: true, 'aria-pressed': 'false', 'aria-label': 'Hills and mountains', title: 'Hills and mountains (3D map)', onclick: onToggleTerrain }, h('span', { class: 'btn3d__label btn3d__label--sm' }, 'HILL'));
    els.btnLegend = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Map legend', title: 'Map legend', 'aria-expanded': 'false', onclick: () => { state.legendOpen = !state.legendOpen; render(); } }, icon('layers'));
    els.controls = h('div', { class: 'map-controls' }, els.btnLocate, els.btnFit, els.btnDest, els.btnRoute, els.btn3d, els.btnTerrain, els.btnLegend);

    els.legend = h('div', { class: 'legend panel', hidden: true },
      h('div', { class: 'legend__row' }, h('span', { class: 'dot dot--self' }), 'You'),
      h('div', { class: 'legend__row' }, h('span', { class: 'dot dot--live' }), 'Rider, live'),
      h('div', { class: 'legend__row' }, h('span', { class: 'dot dot--stale' }), 'Position is old'),
      h('div', { class: 'legend__row' }, h('span', { class: 'dot dot--offline' }), 'Offline (last known)'),
      h('div', { class: 'legend__row' }, icon('flag'), 'Destination'),
      h('div', { class: 'legend__row' }, h('span', { class: 'legend__line' }), 'My route'));

    els.riderPanel = h('section', { class: 'rider-panel panel', 'aria-label': 'Riders', hidden: true });
    els.riderCard = h('section', { class: 'rider-card panel', 'aria-label': 'Selected rider', hidden: true });
    els.gate = h('div', { class: 'gps-gate panel', hidden: true });

    els.destBtn = h('button', { class: 'dock__dest', type: 'button', onclick: openDest });
    els.btnRefreshRoute = h('button', { class: 'btn btn--icon btn--sm', type: 'button', 'aria-label': 'Recalculate route', title: 'Recalculate route', onclick: onRefreshRoute }, icon('refresh'));
    els.btnNav = h('button', { class: 'btn btn--icon btn--sm', type: 'button', 'aria-label': 'Open destination in a maps app', title: 'Open in Maps app', onclick: onNavigateExternal }, icon('external'));
    els.btnInfo = h('button', { class: 'btn btn--icon btn--sm', type: 'button', 'aria-label': 'About routes and location sharing', title: 'About routes', onclick: openAbout }, icon('info'));
    els.routeStrip = h('div', { class: 'dock__route' }, els.destBtn, els.btnRefreshRoute, els.btnNav, els.btnInfo);

    els.btnTalk = h('button', { class: 'btn btn--primary dock__talk', type: 'button', 'aria-pressed': 'false' },
      h('span', { class: 'talk__icon' }, icon('mic')),
      h('span', { class: 'talk__label' }, 'Hold to talk'));
    bindTalkButton(els.btnTalk);
    els.btnDiscord = h('button', { class: 'btn btn--icon dock__discord', type: 'button', 'aria-label': 'Open Discord voice (backup)', title: 'Discord voice (backup)', onclick: onDiscord }, icon('headset'));
    els.btnRiders = h('button', { class: 'btn dock__riders', type: 'button', 'aria-expanded': 'false', 'aria-label': 'Riders list', onclick: () => { state.ridersOpen = !state.ridersOpen; render(); } }, icon('users'), h('span', { class: 'dock__count' }, '0'));
    els.btnShare = h('button', { class: 'btn dock__share', type: 'button', 'aria-pressed': 'true', onclick: onToggleSharing }, icon('pause'), h('span', { class: 'hide-sm' }, 'Sharing'));
    els.btnRoom = h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': 'Room menu and invite code', onclick: openRoom }, icon('menu'));
    els.dock = h('footer', { class: 'dock' }, els.routeStrip, h('div', { class: 'dock__row' }, els.btnTalk, els.btnDiscord, els.btnRiders, els.btnShare, els.btnRoom));

    return h('div', { class: 'touring' },
      h('header', { class: 'topbar' },
        els.back,
        h('div', { class: 'topbar__title' }, els.name, els.sub),
        h('div', { class: 'topbar__chips' }, els.connChip, els.gpsChip)),
      h('div', { class: 'map-wrap' }, els.mapEl, els.alerts, els.controls, els.legend, els.riderPanel, els.riderCard, els.gate),
      els.dock);
  }

  /* --------------------------------------------------------- derived */
  function computeRiders() {
    const now = serverNow();
    const riders = [];
    const talkerIds = new Set(voice ? voice.talkers() : []);
    for (const [id, m] of Object.entries(state.members)) {
      const isSelf = id === uid;
      let lat = null; let lng = null; let st = 'nolocation'; let ageMs = null; let loc = null; let motion = null;
      if (isSelf) {
        const fix = state.myFix;
        if (fix) {
          lat = fix.latitude; lng = fix.longitude;
          ageMs = Math.max(0, Date.now() - fix.timestamp);
          st = !isConnected() && state.sharing ? 'offline' : ageMs <= APP.freshness.liveMaxAgeMs ? 'live' : ageMs <= APP.freshness.staleMaxAgeMs ? 'stale' : 'lost';
          loc = { accuracy: fix.accuracy, speed: fix.speed, heading: fix.heading };
          motion = { speed: fix.speed, heading: fix.heading, accuracy: fix.accuracy, measuredAt: fix.timestamp };
        }
      } else {
        loc = state.locations[id] || null;
        const status = riderStatus({ presence: state.presence[id], location: loc, now });
        st = status.state; ageMs = status.ageMs;
        if (loc) {
          lat = loc.latitude; lng = loc.longitude;
          // fixAt is server time; convert to this device's clock for smooth movement
          motion = { speed: loc.speed, heading: loc.heading, accuracy: loc.accuracy, measuredAt: Number.isFinite(loc.fixAt) ? loc.fixAt - serverOffset() : undefined };
        }
      }
      const dist = state.destination && lat !== null
        ? haversine({ latitude: lat, longitude: lng }, state.destination) : null;
      riders.push({
        uid: id, name: m.displayName || 'Rider', avatar: avatarFor(m, id), member: m, isSelf,
        state: st, ageMs, lat, lng, loc, fix: motion, distToDest: dist, selected: state.selectedUid === id,
        talking: isSelf ? !!voice?.transmitting : talkerIds.has(id),
        connected: isSelf ? isConnected() : state.presence[id]?.connected === true,
        lastSeen: state.presence[id]?.lastSeen ?? null
      });
    }
    riders.sort((a, b) => (b.isSelf - a.isSelf) || a.name.localeCompare(b.name));
    return riders;
  }

  function stateLabel(r) {
    switch (r.state) {
      case 'live': return { text: r.isSelf ? 'You · live' : 'Live', tone: 'success' };
      case 'stale': return { text: `Old fix · ${formatAge(r.ageMs)}`, tone: 'warning' };
      case 'lost': return { text: `No fix · ${formatAge(r.ageMs)}`, tone: 'warning' };
      case 'offline': return { text: r.lastSeen ? `Offline · ${formatAge(serverNow() - r.lastSeen)}` : 'Offline', tone: 'muted' };
      default: return { text: r.isSelf ? 'Waiting for GPS' : 'Not sharing', tone: 'muted' };
    }
  }

  /* ----------------------------------------------------------- render */
  function render() {
    if (destroyed || !state.ready) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; if (!destroyed) renderNow(); });
  }

  function renderNow() {
    const riders = computeRiders();

    // topbar
    els.name.textContent = state.meta.name || 'Room';
    els.sub.textContent = `${memberCount()}/${roomCapacity(state.meta)} riders${state.meta.status === 'closed' ? ' · CLOSED' : ''}`;
    const up = isConnected();
    els.connChip.className = `chip ${up ? 'chip--success' : 'chip--warning'}`;
    mountInto(els.connChip, h('span', { class: `dot ${up ? 'dot--live' : 'dot--stale'}` }), up ? 'Online' : 'Offline');
    const gps = gpsChip();
    els.gpsChip.className = `chip chip--button chip--${gps.tone}`;
    els.gpsChip.textContent = gps.text;

    // map
    map.syncRiders(riders.filter((r) => r.lat !== null));
    map.setAccuracy(state.myFix);
    map.setDestination(state.destination);
    if (!state.didInitialFit && riders.some((r) => r.lat !== null)) {
      state.didInitialFit = true;
      map.fitAll();
    }

    // controls
    els.btnLocate.setAttribute('aria-pressed', String(state.following));
    map.setFollow(state.following && state.myFix ? uid : null);
    els.btnRoute.setAttribute('aria-pressed', String(state.routeVisible));
    els.btn3d.setAttribute('aria-pressed', String(state.map3d));
    els.btnTerrain.hidden = !state.map3d;
    els.btnTerrain.setAttribute('aria-pressed', String(state.terrain > 0));
    if (els.btnTerrain.firstChild) els.btnTerrain.firstChild.textContent = state.terrain === 2 ? 'HILL+' : 'HILL';
    els.btnTerrain.title = state.terrain === 2 ? 'Full 3D terrain (tap to turn off)' : state.terrain === 1 ? 'Hill shading (tap for full 3D terrain)' : 'Hills (3D map)';
    els.btnLegend.setAttribute('aria-expanded', String(state.legendOpen));
    els.legend.hidden = !state.legendOpen;

    renderAlerts(riders);
    renderRiderPanel(riders);
    renderRiderCard(riders);
    renderGate();
    renderDock(riders);
    roomSheet?.update();
  }

  function gpsChip() {
    if (state.geoError?.code === 'denied' || state.perm === 'denied') return { text: 'GPS blocked', tone: 'danger' };
    if (state.perm === 'unsupported' || state.perm === 'insecure') return describeToChip(describePermission(state.perm));
    if (!state.tracking) return { text: state.perm === 'granted' ? 'GPS idle' : 'GPS off', tone: 'muted' };
    if (state.geoError) return { text: 'GPS searching', tone: 'warning' };
    if (!state.myFix) return { text: 'GPS searching', tone: 'warning' };
    const age = Date.now() - state.myFix.timestamp;
    if (age > APP.freshness.liveMaxAgeMs) return { text: `GPS old ${formatAge(age)}`, tone: 'warning' };
    return { text: `GPS ±${Math.round(state.myFix.accuracy)}m`, tone: state.myFix.accuracy > APP.publish.maxAccuracyMeters ? 'warning' : 'success' };
  }
  const describeToChip = (d) => ({ text: d.label, tone: d.tone });

  function banner(key, tone, iconName, body, { dismissible = true, action } = {}) {
    if (state.dismissed.has(key)) return null;
    return h('div', { class: `banner banner--${tone}`, role: tone === 'danger' ? 'alert' : 'status' },
      icon(iconName),
      h('div', { class: 'banner__body' }, body),
      action ? h('button', { class: 'btn btn--sm', type: 'button', onclick: action.onClick }, action.label) : null,
      dismissible ? h('button', { class: 'btn btn--icon btn--sm btn--ghost btn--cancel', type: 'button', 'aria-label': 'Dismiss', onclick: () => { state.dismissed.add(key); render(); } }, icon('close')) : null);
  }

  const VIBRATION = { far: [120], near: [120, 80, 120], now: [300], arrive: [200, 100, 200], offroute: [80, 60, 80, 60, 80], toll: [400, 120, 400, 120, 400] };
  function vibrate(kind) {
    if (!APP.guidance.vibrate || !state.guidance) return;
    try { if (typeof navigator.vibrate === 'function') navigator.vibrate(VIBRATION[kind]); } catch { /* not supported in this WebView */ }
  }
  const roundTo10 = (m) => (m >= 1000 ? m : Math.max(10, Math.round(m / 10) * 10));

  /** The turn popup (first item in the alert stack), or null when nothing is due. */
  function navCard() {
    const rt = state.route?.route;
    if (!state.guidance) return null;
    if (rt?.blockedClasses?.length) {
      return h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'),
        h('div', { class: 'banner__body' }, h('strong', {}, 'Rute ini melewati jalan tol / bebas hambatan. '), 'Motor tidak boleh masuk tol, jadi petunjuk belokan dimatikan untuk rute ini. Pilih tujuan lain atau buka di aplikasi peta.'),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: onNavigateExternal }, 'Open in Maps'));
    }
    const v = guide?.view;
    if (!v) return null;
    if (v.kind === 'offroute') {
      return h('div', { class: 'navcard navcard--offroute', role: 'status' }, icon('refresh'),
        h('div', { class: 'navcard__body' }, h('strong', { class: 'navcard__title' }, 'Keluar jalur'), h('span', { class: 'navcard__detail' }, state.route?.error && state.route?.rerouting ? 'Sinyal lemah, mencoba lagi…' : 'Menghitung ulang rute…')));
    }
    return h('div', { class: `navcard navcard--${v.stage}${v.kind === 'arrive' ? ' navcard--arrive' : ''}`, role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'navcard__icon' }, icon(v.icon)),
      h('div', { class: 'navcard__body' },
        v.kind === 'arrive' ? null : h('span', { class: 'navcard__dist' }, `${v.stage === 'now' ? 'Sekarang' : `Dalam ${formatDistance(roundTo10(v.distance))}`}`),
        h('strong', { class: 'navcard__title' }, v.title),
        v.detail ? h('span', { class: 'navcard__detail' }, v.detail) : null));
  }

  function renderAlerts(riders) {
    const items = [];
    if (!isConnected()) items.push(banner('offline', 'warning', 'wifi', [h('strong', {}, 'No connection. '), 'Positions on screen may be out of date. Riders will not see you until you reconnect.'], { dismissible: false }));
    if (state.meta.status === 'closed') items.push(banner('closed', 'warning', 'alert', [h('strong', {}, 'Room closed. '), 'Live sharing is paused.'], { dismissible: false }));
    else if (!sessionActive()) items.push(banner('waiting', 'info', 'users', [h('strong', {}, 'Waiting for riders. '), `At least ${APP.limits.minMembersForSession} riders are needed before locations are shared. Send the invite code.`], { dismissible: false, action: { label: 'Invite', onClick: openRoom } }));
    if (state.geoError && state.geoError.code !== 'denied' && state.tracking) items.push(banner(`geo-${state.geoError.code}`, 'warning', 'alert', state.geoError.message));
    if (state.myFix && state.myFix.accuracy > APP.publish.maxAccuracyMeters && state.sharing && sessionActive()) {
      items.push(banner('accuracy', 'warning', 'alert', `GPS accuracy is poor (±${Math.round(state.myFix.accuracy)} m), so your position is not shared yet. Move to open sky.`, { dismissible: false }));
    }
    if (state.backgroundGapMs) items.push(banner('bg', 'warning', 'pause', [h('strong', {}, 'App was in the background. '), `Your position was not updated for about ${formatAge(state.backgroundGapMs)}. Refreshing now. Keep the screen on while riding (Room menu).`]));
    if (state.publishNote) items.push(banner('publish', 'danger', 'alert', state.publishNote));
    if (state.tileProblem) items.push(banner('tiles', 'warning', 'wifi', 'Map tiles are not loading. Positions are still accurate.'));
    if (state.destNotice) items.push(banner('destnotice', 'success', 'flag', state.destNotice.text, { dismissible: true }));
    const nodes = items.filter(Boolean);
    const nav = navCard();
    if (nav) nodes.unshift(nav);
    const talkers = riders.filter((r) => r.talking && !r.isSelf);
    if (talkers.length) {
      const names = talkers.map((r) => r.name);
      nodes.splice(nav ? 1 : 0, 0, h('div', { class: 'banner banner--voice', role: 'status' }, icon('mic'),
        h('div', { class: 'banner__body' }, h('strong', {}, names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(' & ')), ` ${names.length > 1 ? 'are' : 'is'} talking`)));
    }
    if (voice?.audioBlocked) {
      nodes.push(banner('audio', 'warning', 'alert', 'Voice audio is blocked by this device. Tap anywhere to turn it on.', { dismissible: false }));
    }
    mountInto(els.alerts, nodes.filter(Boolean));
  }

  function renderRiderPanel(riders) {
    els.riderPanel.hidden = !state.ridersOpen;
    els.btnRiders.setAttribute('aria-expanded', String(state.ridersOpen));
    els.btnRiders.querySelector('.dock__count').textContent = String(riders.length);
    if (!state.ridersOpen) return;
    mountInto(els.riderPanel,
      h('div', { class: 'rider-panel__head' }, h('h2', {}, 'Riders'), h('button', { class: 'btn btn--icon btn--sm btn--cancel', type: 'button', 'aria-label': 'Close riders list', onclick: () => { state.ridersOpen = false; render(); } }, icon('close'))),
      h('ul', { class: 'list' }, riders.map((r) => {
        const lab = stateLabel(r);
        const sub = [
          r.distToDest !== null ? `${formatDistance(r.distToDest)} to destination` : null,
          r.state === 'live' || r.ageMs === null ? null : `fix ${formatAge(r.ageMs)} ago`
        ].filter(Boolean).join(' · ');
        return h('li', {},
          h('button', { class: `row row--button${r.selected ? ' is-selected' : ''}`, type: 'button', onclick: () => selectRider(r.uid, true) },
            avatarImg(r.member, r.uid, 'avatar'),
            h('span', { class: 'row__main' },
              h('span', { class: 'row__title' }, r.name, r.isSelf ? ' (you)' : '', r.member.role === 'owner' ? ' ★' : '', r.talking ? h('span', { class: 'talk-ico', title: 'Talking' }, icon('mic')) : null),
              h('span', { class: 'row__sub' }, sub || (r.isSelf && !state.sharing ? 'Sharing paused (only you see this)' : ' '))),
            h('span', { class: `chip chip--${lab.tone}` }, h('span', { class: `dot dot--${r.state}` }), lab.text)));
      })));
  }

  function renderRiderCard(riders) {
    const r = riders.find((x) => x.uid === state.selectedUid);
    els.riderCard.hidden = !r;
    if (!r) return;
    const lab = stateLabel(r);
    const speed = r.loc && formatSpeedKmh(r.loc.speed);
    const canRoute = !!state.destination && r.lat !== null && !r.isSelf;
    const other = state.otherRoute && state.otherRoute.uid === r.uid ? state.otherRoute : null;
    mountInto(els.riderCard,
      h('div', { class: 'rider-card__head' },
        avatarImg(r.member, r.uid, 'avatar'),
        h('div', { class: 'row__main' }, h('strong', {}, r.name, r.isSelf ? ' (you)' : ''), h('div', { class: `chip chip--${lab.tone}` }, h('span', { class: `dot dot--${r.state}` }), lab.text)),
        h('button', { class: 'btn btn--icon btn--sm btn--cancel', type: 'button', 'aria-label': 'Close rider details', onclick: () => selectRider(null) }, icon('close'))),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Position'), h('dd', { class: 'mono' }, r.lat !== null ? formatLatLng(r.lat, r.lng) : 'Not shared'),
        h('dt', {}, 'Last fix'), h('dd', {}, r.ageMs === null ? '–' : `${formatAge(r.ageMs)} ago${r.state === 'offline' || r.state === 'stale' || r.state === 'lost' ? ' (not live)' : ''}`),
        r.loc?.accuracy !== undefined && r.loc ? [h('dt', {}, 'Accuracy'), h('dd', { class: 'mono' }, `±${Math.round(r.loc.accuracy)} m`)] : null,
        speed ? [h('dt', {}, 'Speed'), h('dd', { class: 'mono' }, speed)] : null,
        r.member.motorcycle ? [h('dt', {}, 'Bike'), h('dd', {}, r.member.motorcycle)] : null,
        state.destination ? [h('dt', {}, 'To destination'), h('dd', {}, r.distToDest !== null ? `${formatDistance(r.distToDest)} straight line` : '–')] : null,
        other?.status === 'ok' ? [h('dt', {}, 'By road'), h('dd', {}, `${formatDistance(other.route.distanceMeters)} · ~${formatDuration(other.route.durationSeconds)}`)] : null),
      other?.status === 'error' ? h('p', { class: 'field__error' }, other.error) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--sm btn--accent', type: 'button', disabled: r.lat === null, onclick: () => { state.following = false; map.panToRider(r.uid); } }, icon('locate'), 'Center'),
        canRoute ? h('button', { class: 'btn btn--sm', type: 'button', onclick: (e) => toggleOtherRoute(r, e.currentTarget) }, icon('route'), other?.status === 'ok' ? 'Hide their route' : 'Their route') : null));
  }

  function renderGate() {
    const need = state.perm !== 'granted' && !state.tracking && !state.gateDismissed;
    els.gate.hidden = !need;
    if (!need) return;
    const blocked = state.perm === 'denied' || state.geoError?.code === 'denied';
    const unsupported = state.perm === 'unsupported' || state.perm === 'insecure';
    mountInto(els.gate,
      h('span', { class: 'tag' }, 'Location'),
      h('h2', {}, unsupported ? 'Location not available' : blocked ? 'Location is blocked' : 'Share your position with the group?'),
      unsupported || blocked
        ? h('p', {}, PERMISSION_HELP[unsupported ? state.perm : 'denied'])
        : h('p', {}, 'VEXLANE needs your GPS position to show you on the map and let your group see where you are. Only members of this room can see it, and only while this screen is open. You can pause sharing anytime.'),
      h('div', { class: 'btn-row' },
        !unsupported ? h('button', { class: 'btn btn--primary', type: 'button', onclick: () => startTracking(true) }, icon('locate'), blocked ? 'Try again' : 'Enable location') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => { state.gateDismissed = true; render(); } }, 'Continue without sharing')));
  }

  function renderDock(riders) {
    const d = state.destination;
    const rs = state.route;
    let summary = '';
    if (d) {
      if (!state.myFix) summary = 'Waiting for GPS to plan a route…';
      else if (rs.status === 'loading' && !rs.route) summary = 'Calculating route…';
      else if (rs.status === 'error' && !rs.route) summary = rs.error?.message || 'Route unavailable';
      else if (rs.route) {
        summary = `${formatDistance(rs.route.distanceMeters)} · ~${formatDuration(rs.route.durationSeconds)}*${rs.route.isFallback ? ` · via ${rs.route.providerLabel}` : ''}${rs.rerouting ? ' · rerouting…' : rs.status === 'loading' ? ' · updating…' : rs.status === 'error' ? ' · refresh failed' : ''}`;
      }
    }
    mountInto(els.destBtn,
      icon('flag'),
      h('span', { class: 'dock__dest-text' },
        h('span', { class: 'dock__dest-name' }, d ? d.name : canEditDestination() ? 'Set destination' : 'No destination yet'),
        h('span', { class: 'dock__dest-sub mono' }, d ? summary : canEditDestination() ? 'Search a place or enter coordinates' : 'Waiting for the owner')));
    els.destBtn.setAttribute('aria-label', d ? `Destination ${d.name}. ${summary}. Open destination panel` : 'Open destination panel');
    els.btnRefreshRoute.hidden = !d;
    els.btnRefreshRoute.disabled = !state.myFix || rs.status === 'loading';
    els.btnNav.hidden = !d;
    els.routeStrip.classList.toggle('has-error', rs.status === 'error');

    els.btnShare.setAttribute('aria-pressed', String(state.sharing));
    mountInto(els.btnShare, icon(state.sharing ? 'pause' : 'play'), h('span', { class: 'hide-sm' }, state.sharing ? 'Pause' : 'Share'));
    els.btnShare.setAttribute('aria-label', state.sharing ? 'Pause location sharing' : 'Resume location sharing');
    els.btnShare.title = state.sharing ? 'Pause location sharing' : 'Resume location sharing';
    els.btnDiscord.classList.toggle('is-muted', !state.settings.discordInviteUrl);
    renderTalkButton();
  }

  /* ------------------------------------------------------------- voice */
  function voiceBlock() {
    if (!VOICE_SUPPORTED || !APP.voice.enabled) return 'unsupported';
    if (!isConnected()) return 'offline';
    if (!voicePeers().length) return 'alone';
    return null;
  }

  const voicePeers = () => Object.keys(state.members)
    .filter((id) => id !== uid && state.presence[id]?.connected === true)
    .map((id) => ({ uid: id, epoch: state.presence[id]?.lastSeen ?? 0 }));

  const BLOCK_TEXT = {
    unsupported: 'Voice is not supported in this browser. Use the Discord button.',
    offline: 'You are offline. Voice needs a connection.',
    alone: 'No other rider is online right now.'
  };

  function renderTalkButton() {
    const b = els.btnTalk;
    const block = voiceBlock();
    const phase = voice ? voice.phase() : 'idle';
    const toggle = state.voiceMode === 'toggle';
    const live = phase === 'live';
    const pending = phase === 'starting' || phase === 'connecting';
    b.classList.toggle('is-live', live);
    b.classList.toggle('is-pending', pending);
    b.classList.toggle('is-blocked', !!block && !pending && !live);
    b.setAttribute('aria-pressed', String(live || pending));
    b.setAttribute('aria-disabled', String(!!block && !pending && !live));
    let label;
    if (live) label = toggle ? 'Tap to stop' : 'Talking';
    else if (phase === 'starting') label = 'Mic…';
    else if (phase === 'connecting') label = 'Linking…';
    else if (block === 'unsupported') label = 'No voice';
    else if (block === 'offline') label = 'Offline';
    else if (block === 'alone') label = 'Nobody online';
    else label = toggle ? 'Tap to talk' : 'Hold to talk';
    b.querySelector('.talk__label').textContent = label;
    b.setAttribute('aria-label', live ? 'Talking. Release to stop' : `Push to talk. ${label}`);
  }

  function bindTalkButton(btn) {
    let held = false;
    const begin = () => {
      if (state.voiceMode === 'toggle') {
        if (voice && (voice.holding || voice.transmitting)) { endTalk(); return; }
      }
      held = true;
      startTalk();
    };
    const finish = () => {
      if (state.voiceMode === 'toggle' || !held) return;
      held = false;
      endTalk();
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      begin();
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, finish);
    btn.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(); }
    });
    btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); finish(); } });
    btn.addEventListener('blur', finish);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  async function startTalk() {
    const block = voiceBlock();
    if (block || !voice) { toast(BLOCK_TEXT[block || 'unsupported'], { type: 'info' }); return; }
    const res = await voice.press();
    if (!res.ok) {
      const msg = {
        denied: 'Microphone is blocked. Allow microphone access for this app in your phone or WebView settings, then try again.',
        nomic: 'No microphone found on this device.',
        unsupported: BLOCK_TEXT.unsupported,
        error: 'The microphone could not be started. Try again.'
      }[res.reason] || 'Voice could not start.';
      toast(msg, { type: 'error', timeout: 6000 });
    } else if (res.late) {
      toast('Microphone ready. Press and hold again to talk.', { type: 'info' });
    } else {
      try { navigator.vibrate?.(12); } catch { /* optional */ }
    }
    render();
  }

  function endTalk() {
    voice?.release();
    render();
  }

  function onVoiceProblem(peerUid, kind) {
    if (!peerUid) { toast('Voice signalling could not start. Check the Supabase settings or use Discord.', { type: 'warning', timeout: 6000 }); return; }
    const last = problemToastAt.get(peerUid) || 0;
    if (Date.now() - last < 60000) return;
    problemToastAt.set(peerUid, Date.now());
    const name = state.members[peerUid]?.displayName || 'that rider';
    toast(`Voice could not reach ${name}. Their network may block direct audio; a TURN server fixes this. Use Discord meanwhile.`, { type: 'warning', timeout: 7000 });
  }

  /* ---------------------------------------------------------- actions */
  function onLocate() {
    // second tap switches follow mode off again
    if (state.following) { state.following = false; render(); return; }
    state.following = true;
    if (state.myFix) {
      // 3D: setFollow swings the camera in behind the rider; flat map: just centre
      if (map.kind !== 'maplibre') map.panTo(state.myFix.latitude, state.myFix.longitude, MAP_CONFIG.view.followZoom);
    } else if (!state.tracking) {
      state.gateDismissed = false;
      startTracking(true);
    } else {
      toast('Still waiting for a GPS fix…', { type: 'info' });
    }
    render();
  }

  function onDiscord() {
    const result = openDiscord(state.settings.discordInviteUrl);
    if (result === 'opened') toast('Opening Discord… If nothing happens, copy the link from the Room menu.', { type: 'info' });
    else if (result === 'missing') {
      toast(isOwner() ? 'No Discord link yet. Add one in the Room menu.' : 'The owner has not added a Discord link yet.', {
        type: 'warning', action: isOwner() ? { label: 'Add', onClick: openRoom } : undefined
      });
    } else toast('The saved Discord link is not valid. The owner needs to update it.', { type: 'error' });
  }

  function onNavigateExternal() {
    if (!state.destination) return;
    openExternal(externalNavLinks(state.destination).google);
  }

  function onRefreshRoute() {
    if (!routeManager.refresh()) toast('Please wait a few seconds before refreshing again.', { type: 'info' });
  }

  async function onToggleSharing() {
    state.sharing = !state.sharing;
    storage.set(`tt.sharing.${roomId}`, state.sharing ? '1' : '0');
    if (!state.sharing) {
      await publisher.clear();
      toast('Sharing paused. Riders no longer see your position.', { type: 'info' });
    } else {
      publisher.reset();
      toast('Sharing resumed.', { type: 'success' });
      publishLatest();
    }
    render();
  }

  function selectRider(id, pan = false) {
    state.selectedUid = id;
    if (!id) { clearOtherRoute(); }
    else if (state.otherRoute && state.otherRoute.uid !== id) clearOtherRoute();
    if (id && pan) { state.following = false; map.panToRider(id); }
    if (id && window.innerWidth < 720) state.ridersOpen = false;
    render();
  }

  function clearOtherRoute() {
    otherRouteController?.abort();
    otherRouteController = null;
    state.otherRoute = null;
    map.setOtherRoute(null);
  }

  async function toggleOtherRoute(r, button) {
    if (state.otherRoute?.uid === r.uid && state.otherRoute.status === 'ok') { clearOtherRoute(); render(); return; }
    clearOtherRoute();
    otherRouteController = new AbortController();
    const mine = otherRouteController;
    state.otherRoute = { uid: r.uid, status: 'loading' };
    try {
      const route = await withBusy(button, () => fetchRoute({ latitude: r.lat, longitude: r.lng }, state.destination, { signal: mine.signal }));
      if (mine.signal.aborted) return;
      state.otherRoute = { uid: r.uid, status: 'ok', route };
      map.setOtherRoute(route.coords);
    } catch (err) {
      if (err.code === 'aborted') return;
      state.otherRoute = { uid: r.uid, status: 'error', error: err.message };
    }
    render();
  }

  function openDest() {
    if (destPanel) { destPanel.close(); return; }
    state.ridersOpen = false;
    destPanel = openDestinationPanel({
      host: els.mapEl.parentElement,
      map,
      canEdit: canEditDestination(),
      policy: state.settings.destinationPolicy || 'owner',
      destination: state.destination,
      myPosition: state.myFix,
      onSave: async (dest) => { await saveDestination(roomId, uid, dest); toast('Destination shared with the group.', { type: 'success' }); },
      onClear: async () => { await clearDestination(roomId); toast('Destination cleared.', { type: 'info' }); },
      onClose: () => { destPanel = null; setTimeout(() => map?.invalidate(), 50); render(); }
    });
    render();
  }

  function openRoom() {
    if (roomSheet) return;
    roomSheet = openRoomSheet({
      getState: () => ({
        uid, isOwner: isOwner(), meta: state.meta, members: state.members, banned: state.banned,
        settings: state.settings, memberCount: memberCount(), keepAwake: state.keepAwake, voiceMode: state.voiceMode, voiceSupported: VOICE_SUPPORTED && APP.voice.enabled,
        guidance: state.guidance, guidanceSupported: APP.guidance.enabled,
        regionAlerts: state.regionAlerts, regionSupported: APP.region.enabled
      }),
      actions: {
        removeMember: async (targetUid, m) => { try { await removeMember(roomId, targetUid, m); toast(`${m.displayName} was removed.`, { type: 'info' }); } catch (e) { toast(e.message, { type: 'error' }); } },
        allowRejoin: async (targetUid) => { try { await allowRejoin(roomId, targetUid); } catch (e) { toast(e.message, { type: 'error' }); } },
        saveDiscord: (value) => updateRoomSettings(roomId, { discordInviteUrl: value }),
        setPolicy: async (policy) => { try { await updateRoomSettings(roomId, { destinationPolicy: policy }); } catch (e) { toast(e.message, { type: 'error' }); } },
        rotateInvite: async () => {
          try { await rotateInvite(roomId, { oldHash: state.meta.inviteCodeHash, roomName: state.meta.name, status: state.meta.status, uid, capacity: roomCapacity(state.meta) }); toast('New invite code issued.', { type: 'success' }); }
          catch (e) { toast(e.message, { type: 'error' }); }
        },
        setStatus: async (status) => { try { await setRoomStatus(roomId, state.meta.inviteCodeHash, status); toast(status === 'closed' ? 'Room closed.' : 'Room reopened.', { type: 'success' }); } catch (e) { toast(e.message, { type: 'error' }); } },
        deleteRoom: async () => {
          try {
            await Promise.allSettled([voice?.destroy(), stopSharing()]);
            await deleteRoom(roomId, state.meta.inviteCodeHash, uid);
            toast('Room deleted.', { type: 'success' });
            navigate('/dashboard');
          } catch (e) { toast(e.message, { type: 'error' }); }
        },
        leave: async () => {
          try {
            await Promise.allSettled([voice?.destroy(), stopSharing()]);
            await leaveRoom(roomId, uid, state.members[uid]);
            toast('You left the room.', { type: 'success' });
            navigate('/dashboard');
          } catch (e) { toast(e.message, { type: 'error' }); }
        },
        setVoiceMode: (mode) => { state.voiceMode = mode === 'toggle' ? 'toggle' : 'hold'; storage.set('tt.voiceMode', state.voiceMode); if (voice?.holding) endTalk(); render(); },
        openVoiceDiag: () => { if (voiceSheet) return; voiceSheet = openVoiceSheet({ voice, getContext: () => ({ version: APP.version }), onClose: () => { voiceSheet = null; } }); },
        setGuidance: (on) => { state.guidance = !!on; storage.set('tt.guidance', on ? '1' : '0'); render(); },
        setRegionAlerts: (on) => { state.regionAlerts = !!on; storage.set('tt.region', on ? '1' : '0'); if (!on) regionWatch?.reset(); },
        setKeepAwake: async (on) => {
          state.keepAwake = on;
          storage.set('tt.keepAwake', on ? '1' : '0');
          if (on) { const ok = await wakeLock.enable(); if (!ok) toast('Could not keep the screen on on this device.', { type: 'warning' }); }
          else await wakeLock.disable();
        }
      },
      onClose: () => { roomSheet = null; }
    });
  }

  function openGps() {
    if (gpsSheet) return;
    gpsSheet = openGpsSheet({ stats: gpsStats, getState: () => state, onClose: () => { gpsSheet = null; } });
  }

  function openAbout() {
    openSheet({
      title: 'About routes & sharing',
      content: h('div', { class: 'about' },
        h('h3', {}, 'Routes'),
        h('p', {}, '* Route distance and time come from OpenStreetMap road data via the OSRM routing service. They are estimates for a ',
          h('strong', {}, 'car'), ' profile: no live traffic, no road closures, and not checked for motorcycle suitability. Use your own judgement on the road.'),
        h('p', {}, 'Each rider’s route starts from that rider’s own position. It refreshes when the destination changes, when you move a long way, or when you leave the route. Turn alerts (popup + vibration, no sound, toll roads avoided) follow the route while the screen is on; “Open in Maps” remains available as a backup.'),
        h('h3', {}, 'Location sharing'),
        h('p', {}, 'Your position is shared only with members of this room, only while this screen is open and at least two riders are in the room. Pausing or leaving deletes your shared position.'),
        h('p', {}, 'Browsers and app wrappers pause web pages when the screen locks. If you lock the phone or switch apps, others will see your position marked “old” or “offline” instead of pretending it is live. Turn on “Keep screen on” in the Room menu while riding.'),
        h('h3', {}, 'Map services'),
        h('p', {}, 'Map tiles, place search and routes come from free OpenStreetMap-based public services, meant for light use with no guarantee. If one is busy or down the app tries the next, and you can always enter coordinates by hand.'),
        h('ul', { class: 'about__providers' }, ['tiles', 'geocoder', 'routing'].map((sec) => {
          const list = usableProviders(sec).map((p) => p.label).join(' → ') || 'none configured';
          return h('li', {}, h('strong', {}, { tiles: 'Map tiles', geocoder: 'Place search', routing: 'Routes' }[sec]), `: ${list}`);
        })),
        h('h3', {}, 'Voice'),
        h('p', {}, 'Hold the microphone button to talk to everyone online in the room. The microphone is only on while you hold it (plus a few seconds so the next press is instant), and nothing is recorded or stored. Voice goes straight between phones; some mobile networks block that, and then the Discord button is the fallback.'),
        h('p', {}, 'Like GPS, voice pauses when the screen locks or the app goes to the background.'))
    });
  }

  /* ------------------------------------------------------- GPS & sharing */
  async function startTracking(userInitiated = false) {
    if (destroyed) return;
    if (!tracker) {
      tracker = new LocationTracker({
        onFix: handleFix,
        onError: handleGeoError
      });
    }
    state.geoError = null;
    if (!tracker.active) tracker.start();
    state.tracking = true;
    if (userInitiated) {
      state.gateDismissed = true;
      // Re-read the permission after the browser prompt has been answered.
      setTimeout(async () => { state.perm = await queryGeoPermission(); render(); }, 1500);
    }
    render();
  }

  function handleFix(rawFix) {
    const { fix, rejected } = gpsFilter.process(rawFix);
    gpsStats.received += 1;
    if (rejected) gpsStats.rejected += 1;
    if (Number.isFinite(rawFix.speed) || Number.isFinite(rawFix.heading)) gpsStats.deviceDoppler = true;
    else if (gpsStats.received > 5 && gpsStats.deviceDoppler === null) gpsStats.deviceDoppler = false;
    gpsStats.log.push({
      t: rawFix.timestamp, rawLat: rawFix.latitude.toFixed(6), rawLng: rawFix.longitude.toFixed(6), rawAcc: rawFix.accuracy,
      lat: fix ? fix.latitude.toFixed(6) : null, lng: fix ? fix.longitude.toFixed(6) : null, acc: fix?.accuracy ?? null,
      speed: fix?.speed ?? null, heading: fix?.heading ?? null, rejected: rejected || ''
    });
    if (gpsStats.log.length > 400) gpsStats.log.shift();
    if (rejected || !fix) { state.lastFixEventAt = Date.now(); return; }   // a GPS jump or an out-of-order fix: ignore it
    state.myFix = fix;
    state.lastFixEventAt = Date.now();
    state.geoError = null;
    if (state.perm !== 'granted') state.perm = 'granted';
    if (state.backgroundGapMs) state.backgroundGapMs = null;
    if (state.guidance) guide?.update(fix);
    if (state.regionAlerts) regionWatch?.update(fix, state.route?.route?.coords || null);
    routeManager.updateOrigin(fix);
    publishLatest();
    render();
  }

  function handleGeoError(err) {
    state.geoError = err;
    if (err.code === 'denied') {
      state.perm = 'denied';
      state.tracking = false;
      tracker?.stop();
      state.gateDismissed = false;
      publisher?.clear();
    }
    render();
  }

  async function publishLatest() {
    if (!state.myFix || !publisher) return;
    const canPublish = state.sharing && sessionActive() && isConnected() && state.meta.status === 'open' && !sharingStopped;
    const result = await publisher.handleFix(state.myFix, { canPublish });
    if (result === 'published') gpsStats.published += 1;
    else if (result === 'skipped-accuracy') gpsStats.skippedAccuracy += 1;
    if (result === 'published' && state.publishNote) { state.publishNote = null; render(); }
  }

  async function stopSharing() {
    if (sharingStopped) return;
    sharingStopped = true;
    tracker?.stop();
    state.tracking = false;
    try { await publisher?.clear(); } catch { /* ignore */ }
    try { await stopPresence?.(); } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------- lifecycle */
  function onVisibility() {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); voice?.suspend(); render(); return; }
    const gap = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (gap > 20000 && state.tracking) state.backgroundGapMs = gap;
    queryGeoPermission().then((p) => {
      state.perm = p;
      if (p === 'granted' && !state.tracking && !sharingStopped) startTracking();
      if (state.tracking) { tracker.restart(); tracker.refresh(); }
      render();
    });
    map?.invalidate();
    render();
  }

  function showAccessLost(reason) {
    if (destroyed) return;
    stopSharing();
    destroyed = true;
    forgetRoomEntry(uid, roomId).catch(() => {});
    setCurrentRoom(uid, null);
    const msg = reason === 'deleted' ? 'This room was deleted by its owner.'
      : reason === 'removed' ? 'You were removed from this room.'
        : 'You do not have access to this room. Join with an invite code from the dashboard.';
    destPanel?.close(); roomSheet?.close(); gpsSheet?.close();
    voice?.destroy();
    mountInto(els.root, h('div', { class: 'auth-shell' }, h('div', { class: 'card' },
      h('h1', {}, 'Room unavailable'),
      h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('div', { class: 'banner__body' }, msg)),
      h('a', { class: 'btn btn--primary', href: '#/dashboard' }, 'Back to dashboard'))));
    cleanupAll();
  }

  /* ------------------------------------------------- 2D / 3D map */
  function mapHandlers(mode) {
    return {
      onRiderClick: (id) => selectRider(id === state.selectedUid ? null : id),
      onMapClick: (ll) => {
        if (destPanel && destPanel.handleMapClick(ll)) return;
        if (state.selectedUid) selectRider(null);
      },
      onUserPan: () => { if (state.following) { state.following = false; render(); } },
      onTerrainError: () => {
        state.terrain = 0; storage.set('tt.terrain', '0');
        toast('Hills could not load here, so they are off. The 3D map still works.', { type: 'warning', timeout: 5000 });
        render();
      },
      onTerrainSlow: () => {
        state.terrain = 1; storage.set('tt.terrain', '1'); storage.set('tt.terrainFullBad', '1');
        toast('Full 3D terrain was too heavy for this phone, so it went back to hill shading.', { type: 'warning', timeout: 6000 });
        render();
      },
      onTileError: () => {
        if (mode === '3d') { toast('3D map could not load here. Back to the flat map.', { type: 'warning', timeout: 5000 }); setMapMode(false, { silent: true }); return; }
        state.tileProblem = true; render();
      }
    };
  }

  function createMap(mode, view) {
    return mode === '3d' ? new TouringMap3D(els.mapEl, mapHandlers('3d'), view) : new TouringMap(els.mapEl, mapHandlers('2d'));
  }

  /** Replays everything the old map was showing onto a fresh one. */
  function replayMapState() {
    lastDrawnRoute = state.route?.route || null;
    map.setRoute(state.route?.route?.coords || null);
    map.setOtherRoute(state.otherRoute?.route?.coords || null);
    map.setRouteVisible(state.routeVisible);
    map.setRouteDim(!!state.route?.rerouting || !!state.route?.route?.blockedClasses?.length);
    map.setTerrain(state.terrain);
  }

  function onToggleTerrain() {
    // off -> hill shading (cheap) -> full 3D terrain (heavy, skipped on phones where it already proved too slow) -> off
    const fullBad = storage.get('tt.terrainFullBad') === '1';
    state.terrain = state.terrain === 0 ? 1 : (state.terrain === 1 && !fullBad ? 2 : 0);
    storage.set('tt.terrain', String(state.terrain));
    map.setTerrain(state.terrain);
    if (state.terrain === 1) toast(fullBad ? 'Hill shading on.' : 'Hill shading on. Tap HILL again for full 3D terrain (heavier).', { type: 'info', timeout: 3500 });
    if (state.terrain === 2) toast('Full 3D terrain on. Heavy: it switches itself off if the map gets slow.', { type: 'info', timeout: 4500 });
    render();
  }

  let switching = false;
  async function setMapMode(want, { silent = false } = {}) {
    if (switching || destroyed || want === state.map3d) return;
    if (destPanel) { if (!silent) toast('Close the destination panel first.', { type: 'info' }); return; }
    switching = true;
    try {
      if (want) {
        if (!webglSupported()) { toast('This phone cannot show the 3D map (no WebGL).', { type: 'warning' }); return; }
        if (!silent) toast('Loading 3D map…', { type: 'info', timeout: 2500 });
        try { await loadMapLibre(); } catch (e) { toast(e.message, { type: 'warning', timeout: 5000 }); return; }
        if (destroyed) return;
      }
      const view = map?.getView?.();
      map?.destroy();
      const fresh = h('div', { class: `map${want ? ' map--3d' : ''}`, id: 'map', role: 'application', 'aria-label': 'Live map of your riding group' });
      els.mapEl.replaceWith(fresh);
      els.mapEl = fresh;
      map = createMap(want ? '3d' : '2d', view);
      state.map3d = want;
      state.tileProblem = false;
      storage.set('tt.map3d', want ? '1' : '0');
      replayMapState();
      render();
    } finally { switching = false; }
  }

  function cleanupAll() {
    for (const fn of cleanups.splice(0)) { try { fn(); } catch (e) { console.warn(e); } }
  }

  return {
    async mount(root) {
      els.root = root;
      const profile = await ensureProfile(user).catch(() => ({ displayName: user.displayName || 'Rider' }));
      void profile;
      const layout = buildLayout();
      mountInto(root, layout);

      map = createMap('2d');
      cleanups.push(() => map?.destroy());
      if (storage.get('tt.map3d') === '1') setTimeout(() => { if (!destroyed) setMapMode(true, { silent: true }); }, 0);

      routeManager = new RouteManager({
        onChange: (rs) => {
          state.route = rs;
          if (rs.status === 'ok' && rs.route) {
            if (rs.route !== lastDrawnRoute) { lastDrawnRoute = rs.route; map.setRoute(rs.route.coords); }
            if (rs.route !== lastGuidedRoute) { lastGuidedRoute = rs.route; guide?.setRoute(rs.route); }
          } else if (!rs.route && lastGuidedRoute) { lastGuidedRoute = null; guide?.setRoute(null); }
          else if (!state.destination) { lastDrawnRoute = null; map.setRoute(null); }
          // faded while re-routing, or when the route touches a toll road (not usable for a motorcycle)
          const tolled = !!rs.route?.blockedClasses?.length;
          map.setRouteDim(!!rs.rerouting || tolled);
          if (tolled && rs.route !== lastTollWarned) { lastTollWarned = rs.route; vibrate('toll'); }
          render();
        }
      });
      cleanups.push(() => routeManager.destroy());

      guide = new TurnGuide(APP.guidance, {
        onAlert: ({ stage, maneuver }) => vibrate(maneuver.step.type === 'arrive' ? 'arrive' : stage),
        onOffRoute: () => { vibrate('offroute'); routeManager.reroute(APP.guidance.rerouteMinIntervalMs, APP.guidance.rerouteRetries); }
      });
      cleanups.push(() => { guide = null; try { navigator.vibrate?.(0); } catch { /* ignore */ } });

      regionWatch = new RegionWatch({
        cfg: APP.region,
        geocode: (lat, lng) => reverseRegion(lat, lng),
        weather: (lat, lng) => fetchWeather(lat, lng),
        onAnnounce: ({ kind, region, weather }) => {
          if (destroyed || !state.regionAlerts) return;
          const head = `${kind === 'ahead' ? 'Sebentar lagi memasuki' : 'Memasuki'} ${regionName(region)}`;
          const line = weatherLine(weather);
          toast(line ? `${head}\n${line}` : head, { type: 'area', timeout: APP.region.popupMs });
        }
      });
      cleanups.push(() => { regionWatch?.destroy(); regionWatch = null; });

      wakeLock = new WakeLock();
      cleanups.push(() => wakeLock.destroy());
      if (state.keepAwake) wakeLock.enable();

      publisher = new LocationPublisher({
        roomId, uid,
        onWriteError: (err) => {
          const denied = /permission/i.test(`${err?.code} ${err?.message}`);
          state.publishNote = denied ? 'Your position could not be shared: the room is closed or you no longer have access.' : 'Your position could not be sent. It will retry on the next GPS update.';
          render();
        }
      });

      // connection changes: refresh UI and push my position as soon as we are back
      cleanups.push(onConnectionChange((up) => { state.online = up; if (up) publishLatest(); render(); }));

      const tick = setInterval(() => {
        render();
        // Standing still: browsers may not emit new fixes, so ask for one before my last goes stale.
        if (state.tracking && Date.now() - state.lastFixEventAt > APP.publish.stationaryIntervalMs && document.visibilityState === 'visible') tracker.refresh();
      }, APP.freshness.uiTickMs);
      cleanups.push(() => clearInterval(tick));

      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
      const onResize = () => map?.invalidate();
      window.addEventListener('resize', onResize);
      cleanups.push(() => window.removeEventListener('resize', onResize));

      const offHook = onBeforeLogout(async () => { await Promise.allSettled([voice?.destroy(), stopSharing()]); });
      cleanups.push(offHook);

      const offPerm = await watchGeoPermission((p) => {
        const before = state.perm;
        state.perm = p;
        if (p === 'granted' && before !== 'granted' && state.ready && !state.tracking && !sharingStopped) startTracking();
        if (p === 'denied' && state.tracking) handleGeoError({ code: 'denied', message: 'Location permission was denied.' });
        render();
      });
      cleanups.push(offPerm);

      const unsubscribe = subscribeRoom(roomId, uid, {
        onReady: async () => {
          state.ready = true;
          setCurrentRoom(uid, roomId);
          stopPresence = startRoomPresence(roomId, uid);
          if (VOICE_SUPPORTED && APP.voice.enabled && !voice) {
            voice = new VoiceChat({ roomId, uid, getPeers: voicePeers, isMember: (id) => !!state.members[id], onChange: render, onProblem: onVoiceProblem });
            voice.start();
            cleanups.push(() => { voice?.destroy(); });
          }
          renderNow();
          if (state.perm === 'granted') startTracking();
          if (storage.getSession('tt.justCreated') === roomId) { storage.removeSession('tt.justCreated'); openRoom(); }
          if (storage.getSession('tt.rulesOld') === '1') {
            storage.removeSession('tt.rulesOld');
            toast('Firebase rules are not updated yet, so this room is the old kind (6 riders). Publish database.rules.json to choose other sizes.', { type: 'warning', timeout: 9000 });
          }
        },
        onMeta: (meta) => { state.meta = meta; render(); },
        onMembers: (members) => {
          const before = state.members;
          state.members = members;
          if (!state.firstMembersSnapshot) {
            for (const [id, m] of Object.entries(members)) if (!before[id]) toast(`${m.displayName} joined the ride.`, { type: 'info' });
            for (const [id, m] of Object.entries(before)) if (!members[id]) toast(`${m.displayName} left.`, { type: 'info' });
          }
          state.firstMembersSnapshot = false;
          if (state.selectedUid && !members[state.selectedUid]) state.selectedUid = null;
          publishLatest();
          render();
        },
        onLocations: (locs) => { state.locations = locs; render(); },
        onPresence: (p) => { state.presence = p; if (voice?.transmitting) voice.syncPeers(); render(); },
        onSettings: (s) => { state.settings = s; render(); },
        onBanned: (b) => { state.banned = b; render(); },
        onDestination: (dest) => {
          const changed = JSON.stringify([dest?.latitude, dest?.longitude, dest?.updatedAt]) !== JSON.stringify([state.destination?.latitude, state.destination?.longitude, state.destination?.updatedAt]);
          state.destination = dest;
          routeManager?.setDestination(dest);
          if (!dest) { map?.setRoute(null); clearOtherRoute(); }
          if (!state.firstDestSnapshot && changed && dest && dest.updatedBy !== uid) {
            const who = state.members[dest.updatedBy]?.displayName || 'A rider';
            state.destNotice = { text: `${who} set the destination: ${dest.name}` };
            state.dismissed.delete('destnotice');
            toast(`New destination: ${dest.name}`, { type: 'info' });
          }
          if (!state.firstDestSnapshot && !dest) state.destNotice = null;
          state.firstDestSnapshot = false;
          destPanel?.update(dest);
          render();
        },
        onAccessLost: showAccessLost,
        onError: (err) => toast(err.message, { type: 'error' })
      });
      cleanups.push(unsubscribe);

      // Until the first snapshot arrives show a light loading state on the map area.
      els.alerts.append(h('div', { class: 'banner banner--info' }, h('span', { class: 'spinner' }), h('div', { class: 'banner__body' }, 'Loading room…')));
    },

    async unmount() {
      destroyed = true;
      destPanel?.close();
      roomSheet?.close();
      gpsSheet?.close();
      clearOtherRoute();
      await Promise.allSettled([voice?.destroy(), stopSharing()]);
      cleanupAll();
    }
  };
}
