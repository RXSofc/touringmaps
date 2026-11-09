/**
 * "SPBU terdekat": the fuel stations around the rider, in any direction, no route needed.
 * Pure view: the touring screen passes the position, the search, the wording and the Maps link.
 * States: loading, no GPS yet, failed (retry), nothing within the widest radius, and the list.
 */
import { h, openSheet, mountInto, formatDistance } from '../ui.js';

const roundTo10 = (m) => (m >= 1000 ? m : Math.max(10, Math.round(m / 10) * 10));

/**
 * @param {{getFix:()=>({latitude:number,longitude:number,heading?:number,speed?:number}|null),
 *          search:(fix:object, opts:{force?:boolean})=>Promise<{stations:object[], radiusM:number}>,
 *          directionOf:(station:object, fix:object)=>string, mapsLink:(station:object)=>string,
 *          onResult?:(res:object, fix:object)=>void, onClose?:()=>void}} o
 */
export function openNearbyFuelSheet({ getFix, search, directionOf, mapsLink, onResult, onClose }) {
  const body = h('div', { class: 'nearby' });
  let token = 0;

  const message = (text, retry) => mountInto(body,
    h('p', { class: 'nearby__msg', role: 'status' }, text),
    retry ? h('button', { class: 'btn', type: 'button', onclick: () => load(true) }, 'Coba lagi') : null);

  function renderList(res, fix) {
    const rows = res.stations.map((st, i) => h('li', { class: 'nearby__row' },
      h('span', { class: 'nearby__n', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', { class: 'nearby__info' },
        h('strong', { class: 'nearby__name' }, st.name),
        h('span', { class: 'nearby__meta' }, `± ${formatDistance(roundTo10(st.distanceM))} · ${directionOf(st, fix)}`)),
      h('a', { class: 'btn btn--sm nearby__maps', href: mapsLink(st), target: '_blank', rel: 'noopener noreferrer' }, 'Buka di Maps')));
    mountInto(body,
      h('ol', { class: 'nearby__list' }, ...rows),
      h('p', { class: 'nearby__note' }, `Jarak garis lurus (±) dalam radius ${res.radiusM / 1000} km. Data OpenStreetMap: SPBU kecil bisa belum terdata, dan jam buka tidak diketahui.`));
  }

  async function load(force = false) {
    const mine = ++token;
    const fix = getFix();
    if (!fix) { message('Belum ada posisi GPS. Tunggu sampai titik lo muncul di peta, lalu coba lagi.', true); return; }
    message('Mencari SPBU terdekat…');
    try {
      const res = await search(fix, { force });
      if (mine !== token) return;
      onResult?.(res, fix);
      if (!res.stations.length) { message(`Tidak ada SPBU dalam ${res.radiusM / 1000} km dari posisi lo. Data OpenStreetMap bisa belum lengkap di daerah ini.`, true); return; }
      renderList(res, fix);
    } catch {
      if (mine !== token) return;
      message('Gagal mencari SPBU. Cek koneksi internet, lalu coba lagi.', true);
    }
  }

  const sheet = openSheet({ title: 'SPBU terdekat', content: body, onClose: () => { token++; onClose?.(); } });
  load();
  return { close: () => sheet.close(), reload: () => load(true) };
}
