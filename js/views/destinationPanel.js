/**
 * Destination panel: search by name, enter coordinates, or tap the map.
 * Nothing is saved until the user presses the confirm button.
 */
import { h, icon, clear, mountInto, withBusy, debounce, copyText, toast, formatLatLng, formatDistance } from '../ui.js';
import { MAP_CONFIG } from '../map-config.js';
import { searchPlaces, reverseGeocode, parseCoordinates, validateLatLng } from '../destinations.js';
import { externalNavLinks } from '../routing.js';
import { openExternal } from '../discord.js';
import { haversine } from '../geo.js';

/**
 * @param {{host:HTMLElement, map:import('../map.js').TouringMap, canEdit:boolean, policy:string,
 *          destination:object|null, myPosition:object|null,
 *          onSave:(dest:object)=>Promise<void>, onClear:()=>Promise<void>, onClose:()=>void}} opts
 */
export function openDestinationPanel(opts) {
  const { host, map, canEdit, onSave, onClear, onClose } = opts;
  let destination = opts.destination;
  let candidate = null;
  let searchController = null;
  let mode = 'search';
  let closed = false;

  const panel = h('section', { class: 'dest-panel panel', 'aria-label': 'Shared destination' });
  const body = h('div', { class: 'dest-panel__body' });
  const previewBox = h('div', { class: 'dest-preview', 'aria-live': 'polite' });
  const modeBox = h('div', { class: 'dest-mode' });

  /* ---------------- candidate handling ---------------- */
  function paddingBottom() { return Math.min(panel.offsetHeight || 260, window.innerHeight * 0.5); }

  function setCandidate(c, { pan = true } = {}) {
    candidate = c;
    map.previewDestination(c, { pan, paddingBottom: pan ? paddingBottom() : 0 });
    renderPreview();
  }

  function clearCandidate() {
    candidate = null;
    map.previewDestination(null);
    renderPreview();
  }

  function renderPreview() {
    clear(previewBox);
    if (!candidate) return;
    const labelInput = h('input', { class: 'input', id: 'dest-label', value: candidate.name, maxlength: 120, 'aria-label': 'Destination name' });
    labelInput.addEventListener('input', () => { candidate.name = labelInput.value; });
    const lookupBtn = candidate.source === 'geocoding' ? null : h('button', { class: 'btn btn--sm', type: 'button' }, 'Look up place name');
    const lookupMsg = h('div', { class: 'field__hint', role: 'status' });

    if (lookupBtn) {
      lookupBtn.addEventListener('click', async () => {
        try {
          const found = await withBusy(lookupBtn, () => reverseGeocode(candidate.latitude, candidate.longitude));
          candidate.name = found.name;
          candidate.address = found.address;
          labelInput.value = found.name;
          lookupMsg.textContent = found.address;
        } catch {
          lookupMsg.textContent = 'No place name found. You can still use the coordinates.';
        }
      });
    }

    const confirm = h('button', { class: 'btn btn--primary', type: 'button' }, icon('check'), 'Set as group destination');
    confirm.addEventListener('click', async () => {
      const dest = { ...candidate, name: labelInput.value.trim() || formatLatLng(candidate.latitude, candidate.longitude) };
      try {
        await withBusy(confirm, () => onSave(dest));
        map.previewDestination(null);
        close();
      } catch (err) {
        toast(err.message || 'Could not save the destination.', { type: 'error' });
      }
    });

    previewBox.append(
      h('div', { class: 'dest-preview__head' }, h('span', { class: 'tag' }, 'Selected'), h('span', { class: 'mono small' }, formatLatLng(candidate.latitude, candidate.longitude))),
      h('div', { class: 'field' }, h('label', { for: 'dest-label' }, 'Name shown to the group'), labelInput),
      candidate.address ? h('p', { class: 'muted small' }, candidate.address) : null,
      lookupBtn ? h('div', {}, lookupBtn) : null,
      lookupMsg,
      h('div', { class: 'dest-preview__actions' },
        h('button', { class: 'btn btn--cancel', type: 'button', onclick: clearCandidate }, 'Cancel'),
        confirm));
  }

  /* ---------------- search tab ---------------- */
  function buildSearch() {
    const input = h('input', { class: 'input', id: 'dest-q', type: 'search', placeholder: 'Malioboro, Yogyakarta', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search for a place' });
    const status = h('div', { class: 'field__hint', role: 'status', 'aria-live': 'polite' }, 'Search a place name or address, then pick the right result.');
    const results = h('ul', { class: 'list dest-results' });
    const searchBtn = h('button', { class: 'btn btn--accent', type: 'submit' }, icon('search'), h('span', { class: 'hide-sm' }, 'Search'));
    let lastQuery = '';

    async function run() {
      const q = input.value.trim();
      if (q.length < MAP_CONFIG.geocoder.minChars) { status.className = 'field__error'; status.textContent = `Type at least ${MAP_CONFIG.geocoder.minChars} characters.`; return; }
      if (q.toLowerCase() === lastQuery && results.children.length) return; // identical repeat: keep what is shown
      lastQuery = q.toLowerCase();
      searchController?.abort();
      searchController = new AbortController();
      const mine = searchController;
      status.className = 'field__hint';
      status.textContent = 'Searching…';
      clear(results);
      searchBtn.disabled = true;
      try {
        const found = await searchPlaces(q, { signal: mine.signal });
        if (mine.signal.aborted) return;
        if (!found.length) {
          status.textContent = 'No places found. Try a nearby town, a street name, or enter coordinates instead.';
          return;
        }
        status.textContent = (found.length > 1 ? `${found.length} results. Pick the right one.` : '1 result. Check it is the right place.') + (found.isFallback ? ` (via ${found.providerLabel}, the main search service was unavailable)` : '');
        for (const r of found) {
          const dist = opts.myPosition ? haversine(opts.myPosition, r) : null;
          results.append(h('li', {},
            h('button', { class: 'row row--button', type: 'button', onclick: () => setCandidate({ ...r }) },
              icon('pin'),
              h('span', { class: 'row__main' },
                h('span', { class: 'row__title' }, r.name),
                h('span', { class: 'row__sub dest-addr' }, r.address),
                h('span', { class: 'row__sub mono' }, `${formatLatLng(r.latitude, r.longitude, 4)}${dist ? ` · ${formatDistance(dist)} away` : ''}`)))));
        }
      } catch (err) {
        if (err.code === 'aborted') return;
        status.className = 'field__error';
        status.textContent = err.message || 'Search failed.';
        const retry = h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { lastQuery = ''; run(); } }, icon('refresh'), 'Retry');
        results.append(h('li', { class: 'btn-row' }, retry, h('button', { class: 'btn btn--sm btn--accent', type: 'button', onclick: () => showMode('coords') }, icon('pin'), 'Enter coordinates')));
      } finally {
        searchBtn.disabled = false;
      }
    }

    if (MAP_CONFIG.geocoder.autoSearch) {
      const debounced = debounce(() => { if (input.value.trim().length >= MAP_CONFIG.geocoder.minChars) run(); }, MAP_CONFIG.geocoder.debounceMs);
      input.addEventListener('input', debounced);
    }

    const form = h('form', { class: 'dest-search', onsubmit: (e) => { e.preventDefault(); run(); } },
      h('div', { class: 'input-row' }, input, searchBtn));
    queueMicrotask(() => input.focus({ preventScroll: true }));
    return h('div', { class: 'form' }, form, status, results);
  }

  /* ---------------- coordinates tab ---------------- */
  function buildCoords() {
    const combined = h('input', { class: 'input input--mono', id: 'dest-combined', placeholder: '-7.7956, 110.3695', inputmode: 'text', autocomplete: 'off', 'aria-label': 'Latitude and longitude' });
    const lat = h('input', { class: 'input input--mono', id: 'dest-lat', placeholder: '-7.7956', inputmode: 'decimal', autocomplete: 'off' });
    const lng = h('input', { class: 'input input--mono', id: 'dest-lng', placeholder: '110.3695', inputmode: 'decimal', autocomplete: 'off' });
    const msg = h('div', { class: 'field__hint', role: 'status', 'aria-live': 'polite' }, 'Decimal degrees. South and west are negative.');

    combined.addEventListener('input', () => {
      const parsed = parseCoordinates(combined.value);
      if (parsed.ok) { lat.value = String(parsed.latitude); lng.value = String(parsed.longitude); }
    });

    const form = h('form', { class: 'form', novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const parsed = combined.value.trim() ? parseCoordinates(combined.value) : validateLatLng(lat.value, lng.value);
      if (!parsed.ok) { msg.className = 'field__error'; msg.textContent = parsed.error; return; }
      msg.className = 'field__hint';
      msg.textContent = 'Check the marker on the map, then confirm below.';
      setCandidate({
        name: formatLatLng(parsed.latitude, parsed.longitude),
        address: '',
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        source: 'coordinates'
      });
    } },
    h('div', { class: 'field' }, h('label', { for: 'dest-combined' }, 'Latitude, longitude'), combined),
    h('details', { class: 'dest-separate' }, h('summary', {}, 'Enter separately'),
      h('div', { class: 'grid-2-tight' },
        h('div', { class: 'field' }, h('label', { for: 'dest-lat' }, 'Latitude'), lat),
        h('div', { class: 'field' }, h('label', { for: 'dest-lng' }, 'Longitude'), lng))),
    msg,
    h('button', { class: 'btn btn--accent', type: 'submit' }, icon('pin'), 'Show on map'));
    return form;
  }

  /* ---------------- map-pick tab ---------------- */
  function buildPick() {
    return h('div', { class: 'form' },
      h('div', { class: 'banner banner--info' }, icon('info'), h('div', { class: 'banner__body' }, 'Tap anywhere on the map to drop the destination marker. Zoom in first for accuracy.')));
  }

  function showMode(next) {
    mode = next;
    for (const t of tabs.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
    mountInto(modeBox, mode === 'search' ? buildSearch() : mode === 'coords' ? buildCoords() : buildPick());
  }

  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'How to choose a destination' },
    ...[['search', 'Search'], ['coords', 'Coordinates'], ['pick', 'Tap map']].map(([id, label]) =>
      h('button', { class: 'tab', type: 'button', role: 'tab', dataset: { mode: id }, 'aria-selected': String(id === 'search'), onclick: () => showMode(id) }, label)));

  /* ---------------- current destination block ---------------- */
  function currentBlock() {
    if (!destination) {
      return h('div', { class: 'empty' }, canEdit ? 'No destination yet.' : 'The room owner has not set a destination yet.');
    }
    const links = externalNavLinks(destination);
    return h('div', { class: 'dest-current' },
      h('div', { class: 'dest-current__head' }, icon('flag'), h('strong', {}, destination.name)),
      destination.address ? h('p', { class: 'muted small dest-addr' }, destination.address) : null,
      h('p', { class: 'mono small' }, formatLatLng(destination.latitude, destination.longitude)),
      h('div', { class: 'dest-current__actions' },
        h('button', { class: 'btn btn--sm btn--accent', type: 'button', onclick: () => openExternal(links.google) }, icon('external'), 'Open in Maps'),
        h('button', { class: 'btn btn--sm', type: 'button', onclick: async () => toast(await copyText(formatLatLng(destination.latitude, destination.longitude, 6)) ? 'Coordinates copied.' : 'Could not copy.', { type: 'info' }) }, icon('copy'), 'Copy'),
        canEdit ? h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: async (e) => {
          try { await withBusy(e.currentTarget, () => onClear()); } catch (err) { toast(err.message || 'Could not clear.', { type: 'error' }); }
        } }, 'Clear') : null));
  }

  /* ---------------- assemble ---------------- */
  const head = h('div', { class: 'dest-panel__head' },
    h('h2', {}, 'Destination'),
    h('button', { class: 'btn btn--icon btn--sm btn--cancel', type: 'button', 'aria-label': 'Close destination panel', onclick: () => close() }, icon('close')));

  body.append(
    currentBlock(),
    canEdit ? tabs : h('div', { class: 'banner banner--info' }, icon('info'),
      h('div', { class: 'banner__body' }, opts.policy === 'members' ? 'Destination changes are open to all members.' : 'Only the room owner can change the destination.')),
    canEdit ? modeBox : null,
    canEdit ? previewBox : null);
  panel.append(head, body);
  host.append(panel);
  if (canEdit) showMode('search');

  function close() {
    if (closed) return;
    closed = true;
    searchController?.abort();
    map.previewDestination(null);
    panel.remove();
    onClose();
  }

  return {
    close,
    /** Called by the touring view when the user taps the map while the panel is open. */
    handleMapClick({ lat, lng }) {
      if (!canEdit || mode !== 'pick') return false;
      const parsed = validateLatLng(lat, lng);
      if (!parsed.ok) return false;
      setCandidate({
        name: formatLatLng(parsed.latitude, parsed.longitude),
        address: '',
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        source: 'map'
      }, { pan: false });
      return true;
    },
    update(next) {
      destination = next;
      const first = body.firstElementChild;
      if (first) first.replaceWith(currentBlock());
    }
  };
}
