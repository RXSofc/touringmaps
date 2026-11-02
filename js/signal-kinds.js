/** The fixed quick messages (no network code, so views and tests can import it freely). The database rules accept only these ids. */
export const SIGNALS = Object.freeze([
  { id: 'stop',    label: 'Berhenti dulu',   popup: 'minta berhenti dulu',          icon: 'pause' },
  { id: 'wait',    label: 'Tunggu gue',      popup: 'minta ditunggu',               icon: 'users' },
  { id: 'behind',  label: 'Gue ketinggalan', popup: 'ketinggalan di belakang',      icon: 'arrow-up' },
  { id: 'rest',    label: 'Istirahat',       popup: 'ngajak istirahat',             icon: 'sun' },
  { id: 'fuel',    label: 'Isi bensin',      popup: 'mau isi bensin',               icon: 'fuel' },
  { id: 'go',      label: 'Lanjut jalan',    popup: 'ngajak lanjut jalan',          icon: 'play' },
  { id: 'careful', label: 'Hati-hati',       popup: 'bilang hati-hati di depan',    icon: 'alert' },
  { id: 'trouble', label: 'Ada masalah',     popup: 'ada masalah sama motornya',    icon: 'info' }
]);
export const SIGNAL_IDS = Object.freeze(SIGNALS.map((s) => s.id));
export const signalById = (id) => SIGNALS.find((s) => s.id === id) || null;
/** The sender can send again after this long. The database rules enforce a slightly shorter gap as a backstop. */
export const SIGNAL_GAP_MS = 3000;

