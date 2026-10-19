/**
 * Turns a reverse-geocoding answer into "which kabupaten/kota, which area".
 * Pure functions (no network), so they are easy to test.
 *
 * The trigger level is the kabupaten / kota: riding from one into the next is what
 * counts as "entering another region". The kecamatan/area name is only shown.
 */
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const PREFIX_KAB = /^(kabupaten|kab\.?)\s+/i;
const PREFIX_KOTA = /^kota\s+/i;
const PREFIX_AREA = /^(kecamatan|kec\.?|kelurahan|kel\.?|desa)\s+/i;

/** "Kabupaten Bandung Barat" -> "Kab. Bandung Barat"; "Bandung" from a city field -> "Kota Bandung". */
export function cityLabel(raw, { isCity = false } = {}) {
  const name = clean(raw);
  if (!name) return '';
  if (PREFIX_KAB.test(name)) return `Kab. ${name.replace(PREFIX_KAB, '')}`;
  if (PREFIX_KOTA.test(name)) return name.replace(/^kota/i, 'Kota');
  return isCity ? `Kota ${name}` : `Kab. ${name}`;
}

function build(cityRaw, isCity, areaRaw, state) {
  const label = cityLabel(cityRaw, { isCity });
  if (!label) return null;
  let area = clean(areaRaw).replace(PREFIX_AREA, '');
  const bare = label.replace(/^(Kab\.|Kota)\s+/i, '');
  if (area.toLowerCase() === bare.toLowerCase()) area = '';       // "Kota Bandung, Bandung" adds nothing
  return { key: `${label.toLowerCase()}|${clean(state).toLowerCase()}`, label, area };
}

/** Nominatim `address` object (Indonesian OSM data uses city / regency / county / municipality …). */
export function regionFromNominatim(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const fromCity = clean(addr.city);
  const raw = fromCity || addr.regency || addr.county || addr.state_district;
  const area = addr.municipality || addr.city_district || addr.suburb || addr.town || addr.village || addr.hamlet;
  return build(raw, !!fromCity, area, addr.state);
}

/** Photon `properties` object. */
export function regionFromPhoton(props) {
  if (!props || typeof props !== 'object') return null;
  const fromCity = clean(props.city);
  const raw = fromCity || props.county;
  return build(raw, !!fromCity, props.district || props.locality, props.state);
}

/** The first line of the popup, e.g. "Kab. Bandung Barat, Cililin". */
export function regionName(r) {
  return r.area ? `${r.label}, ${r.area}` : r.label;
}
