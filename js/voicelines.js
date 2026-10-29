/**
 * What the voice says. Everything the navigation voice can say lives in this one file, so changing a line is a
 * one-line edit. Casual, rude-friendly Indonesian on purpose (the rider asked for it); no formal tone.
 *
 * Placeholders are filled by the functions below. `pick()` rotates through variants so the same sentence is not
 * read twice in a row.
 */
let rand = Math.random;
/** For tests: make the variant choice deterministic. */
export function setRandom(fn) { rand = fn; }
const lastPick = new Map();
function pick(key, variants) {
  if (variants.length === 1) return variants[0];
  let i = Math.floor(rand() * variants.length);
  if (i === lastPick.get(key)) i = (i + 1) % variants.length;
  lastPick.set(key, i);
  return variants[i];
}

const NUM = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh'];
const ORD = ['', 'pertama', 'kedua', 'ketiga', 'keempat', 'kelima', 'keenam', 'ketujuh', 'kedelapan', 'kesembilan'];

/** "Jl. Raya Cihampelas" -> "Jalan Raya Cihampelas": abbreviations are read badly by speech engines. */
export function speakName(name) {
  if (!name) return '';
  return String(name)
    .replace(/\bJl?n?\.?\s+/gi, 'Jalan ').replace(/\bGg\.?\s+/gi, 'Gang ').replace(/\bDs\.?\s+/gi, 'Desa ')
    .replace(/\bKec\.?\s+/gi, 'Kecamatan ').replace(/\bKab\.?\s+/gi, 'Kabupaten ').replace(/\bBy\s?pass\b/gi, 'Bypass')
    .replace(/\bSt\.?\s+/g, 'Santo ').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
}
const to = (road) => (road ? ` ke ${speakName(road)}` : '');
const into = (road) => (road ? ` masuk ${speakName(road)}` : '');

/** "Setengah kilo", "Satu kilo", "Dua ratus meter": for the far warning. */
export function distanceWords(d) {
  if (d >= 850) return 'Satu kilo';
  if (d >= 400) return 'Setengah kilo';
  const n = Math.min(NUM.length - 1, Math.max(1, Math.floor(d / 100)));
  return `${NUM[n][0].toUpperCase()}${NUM[n].slice(1)} ratus meter`;
}
/** Kilometres said the way people say them: "satu setengah kilo", "tiga kilo". */
export function kmWords(m) {
  const half = Math.round(m / 500) / 2;
  if (half < 1) return 'setengah kilo';
  const whole = Math.floor(half);
  const rest = half - whole ? ' setengah' : '';
  return `${NUM[Math.min(whole, 10)] ?? whole}${rest} kilo`;
}

const sideOf = (modifier) => (/left/.test(modifier || '') ? 'kiri' : /right/.test(modifier || '') ? 'kanan' : '');

/** Which family of line a maneuver belongs to. */
export function familyOf(step) {
  const m = step.modifier || '';
  switch (step.type) {
    case 'arrive': return 'arrive';
    case 'roundabout': case 'rotary': return 'roundabout';
    case 'fork': return 'fork';
    case 'merge': return 'merge';
    case 'on ramp': return step.toll ? 'tollIn' : 'rampIn';
    case 'off ramp': return step.toll ? 'tollOut' : 'rampOut';
    case 'continue': return m === 'uturn' ? 'uturn' : 'turn';
    default:
      if (m === 'uturn') return 'uturn';
      if (/^slight/.test(m)) return 'fork';
      return 'turn';
  }
}

/**
 * The sentence for one maneuver at one stage.
 * @param {object} step OSRM-style step {type, modifier, exit, name, toll}
 * @param {'far'|'near'|'now'} stage
 * @param {number} d metres to the maneuver (used by the far warning)
 */
export function maneuverLine(step, stage, d = 0) {
  const fam = familyOf(step);
  const s = sideOf(step.modifier) || 'kanan';
  const sharp = /^sharp/.test(step.modifier || '') ? ' tajam' : '';
  const road = step.name;
  switch (fam) {
    case 'turn': {
      if (stage === 'far') {
        if (d >= 400) return `${distanceWords(d)} lagi belok ${s}${sharp}${to(road)} woi! Jangan ngelamun aja lu babi!`;
        return `${distanceWords(d)} lagi belok ${s}${sharp}${to(road)}! Siap-siap, jangan dadakan!`;
      }
      if (stage === 'near') return pick('turn-near', [
        `Depan siap-siap belok ${s}${sharp}! Nyalain sein dari sekarang goblog, jangan pas belok baru nyala!`,
        `Bentar lagi belok ${s}${sharp}! Pelanin motornya, sein dulu, jangan sok jago!`]);
      return s === 'kiri'
        ? pick('turn-left', ['Kiri woi kiri sekarang! Banting setir anjing!', 'Kiri sekarang woi! Jangan bengong, belok yang bener!'])
        : pick('turn-right', ['Kanan sekarang bangsat, gaskeun!', 'Kanan sekarang anjir! Jangan kelewatan lagi!']);
    }
    case 'fork':
      if (stage === 'far') return `${distanceWords(d)} lagi ada pecahan jalan, ambil serong ${s}${to(road)}! Jangan ngambil jalur orang!`;
      if (stage === 'near') return `Pecahan jalan depan lu ambil serong ${s}! Jangan ngambil jalur orang!`;
      return `Serong ${s} sekarang woi, ikutin jalurnya, jangan lurus aja!`;
    case 'merge':
      if (stage === 'far') return `${distanceWords(d)} lagi gabung ke lajur ${s}! Siap-siap, jangan nyelonong!`;
      return `Ambil lajur ${s} woi! Jangan menuh-menuhin jalan orang!`;
    case 'uturn':
      if (stage === 'far') return `${distanceWords(d)} lagi putar balik! Liat-liat spion, jangan asal motong jalan anjing.`;
      if (stage === 'near') return 'Siap-siap putar balik depan! Liat-liat spion, jangan asal motong jalan anjing.';
      return 'Kelewatan tolol! Muter balik sekarang buruan!';
    case 'roundabout': {
      const n = ORD[step.exit] || (step.exit ? `nomor ${step.exit}` : 'yang bener');
      if (stage === 'far' || stage === 'near') return `Di bunderan depan, lu ambil belokan ${n}. Jangan muter terus kayak orang bego!`;
      return `Masuk bunderan sekarang, ambil belokan ${n}. Itung bener-bener tolol, jangan sampe muter dua kali!`;
    }
    case 'tollIn':
      if (stage === 'now') return 'Masuk tol sekarang, gass yang kenceng tapi jangan sampe mati konyol!';
      return 'Bentar lagi masuk tol, siap-siap! Motor gak boleh masuk tol bangsat, cek lagi rutenya!';
    case 'tollOut':
      if (stage === 'now') return 'Keluar tol sekarang! Rem woi rem, jangan kebablasan!';
      return `Ambil lajur ${s} njing, bentar lagi keluar tol! Jangan bablas terus, aing males muternya!`;
    case 'rampIn':
      if (stage === 'now') return `Naik ke jalur ${s} sekarang woi!`;
      return `Depan naik ke jalur ${s}, siap-siap jangan ngelamun!`;
    case 'rampOut':
      if (stage === 'now') return `Keluar ke ${s} sekarang woi, jangan bablas!`;
      return `${stage === 'far' ? `${distanceWords(d)} lagi` : 'Depan'} ambil jalan keluar ke ${s}${to(road)}, jangan bablas!`;
    case 'arrive': {
      const side = sideOf(step.modifier);
      if (stage === 'now') {
        if (side === 'kiri') return 'Akhirnya nyampe juga kita. Tujuan lu di kiri tuh, turun gih, pegel pantat aing!';
        if (side === 'kanan') return 'Nyampe juga bangsat. Di kanan tuh tempatnya, buruan minggir parkir yang bener!';
        return 'Udah nyampe woi! Matiin mesinnya, jangan lupa kunci stang ntar motor lu dimaling!';
      }
      return `Dikit lagi nyampe woi, tujuan lu ${side ? `di ${side}` : 'tepat di depan'}. Pelan-pelan, jangan nyelonong!`;
    }
    default: return '';
  }
}

export const lines = {
  /** First words of the trip. */
  start: (road) => road
    ? `Gas anjing! Jalan lurus ke ${speakName(road)}, bawa motor yang bener, jangan kayak orang tolol.`
    : 'Gas anjing! Jalan lurus dulu, bawa motor yang bener, jangan kayak orang tolol.',
  straight: () => pick('straight', ['Lurus terus aja babi, ikutin jalan utama, gak usah belok-belok ntar nyungsep.',
    'Lurus terus woi, belum ada belokan. Jangan sok nyari jalan tikus, ntar nyasar.']),
  straightAgain: (m) => `Masih lurus terus, belokan berikutnya ${kmWords(m)} lagi. Jangan ngantuk woi, fokus!`,
  rbExit: () => 'Nah ini dia belokannya, keluar bunderan sekarang woi!',
  underpass: () => 'Depan turun ke underpass, jangan malah ambil jalur atas tolol!',
  offRoute: () => 'Bisa baca map gak sih sia? Nyasar kan jadinya bangsat, bentar aing itung ulang!',
  rerouted: () => 'Udah ketemu jalan baru. Ikutin yang bener kali ini babi, jangan nyasar lagi!',
  away: () => pick('away', ['Woi lu makin jauh dari tujuan! Puter balik anjir, jangan nyasar terus!',
    'Ini mah makin menjauh bangsat! Balik arah woi, tujuan lu bukan ke situ!']),
  toll: () => 'Rutenya kena tol, motor gak boleh masuk tol bangsat! Cari jalan lain dulu!',
  jam: () => 'Macet asu di depan, sabar dikit napa, jangan klakson-klakson doang!',
  speed: () => 'Woi anjing pelan-pelan! Lu mau mati konyol?! Bawa nyawa lu bukan bawa tahu bulat!',
  on: () => 'Suara udah nyala. Aing yang nuntun lu sekarang, dengerin baik-baik jangan ngelamun!',
  test: () => 'Tes suara. Kalo lu denger ini berarti aing udah siap nuntun lu, gas!'
};
