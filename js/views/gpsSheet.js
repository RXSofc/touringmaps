/**
 * GPS details: what the phone reported vs what the app uses and shares.
 * Tap the GPS chip to open it. Meant for tuning on a real ride: "Copy log"
 * puts a CSV of recent fixes on the clipboard so it can be analysed afterwards.
 */
import { h, openSheet, mountInto, toast, copyText, formatAge } from '../ui.js';

const fmt = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');

export function openGpsSheet({ stats, getState, onClose }) {
  const body = h('div', { class: 'gps-sheet' });
  const timer = { id: null };

  function rate() {
    const log = stats.log;
    if (log.length < 3) return null;
    const span = (log[log.length - 1].t - log[0].t) / 1000;
    return span > 0 ? (log.length - 1) / span : null;
  }

  function render() {
    const s = getState();
    const last = stats.log[stats.log.length - 1];
    const hz = rate();
    const rows = [
      ['Reported accuracy (raw)', last ? `±${fmt(last.rawAcc, 0)} m` : '–'],
      ['Used accuracy (filtered)', last && !last.rejected ? `±${fmt(last.acc, 1)} m` : '–'],
      ['Speed', s.myFix && Number.isFinite(s.myFix.speed) ? `${fmt(s.myFix.speed * 3.6, 0)} km/h` : '–'],
      ['Heading', s.myFix && Number.isFinite(s.myFix.heading) ? `${fmt(s.myFix.heading, 0)}°` : '–'],
      ['Last fix', s.myFix ? (Date.now() - s.myFix.timestamp < 2000 ? 'just now' : `${formatAge(Date.now() - s.myFix.timestamp)} ago`) : '–'],
      ['Fix rate', hz ? `${fmt(hz, 2)} per second` : '–'],
      ['Fixes received', String(stats.received)],
      ['GPS jumps ignored', String(stats.rejected)],
      ['Shared with group', String(stats.published)],
      ['Not shared: poor accuracy', String(stats.skippedAccuracy)],
      ['Device speed/heading', stats.deviceDoppler === null ? '–' : stats.deviceDoppler ? 'reported by device' : 'not reported (estimated)']
    ];
    mountInto(body,
      h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', { class: 'mono' }, v)])),
      h('p', { class: 'muted small' }, 'Raw accuracy is what the phone claims. The app smooths fixes, ignores impossible jumps and shares only fixes better than ±100 m. For tuning, ride a loop and copy the log.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--accent', type: 'button', onclick: async () => {
          const ok = await copyText(csv());
          toast(ok ? `Copied ${stats.log.length} fixes.` : 'Could not copy.', { type: ok ? 'success' : 'error' });
        } }, 'Copy log (CSV)'),
        h('button', { class: 'btn', type: 'button', onclick: () => { stats.log.length = 0; stats.received = 0; stats.rejected = 0; stats.published = 0; stats.skippedAccuracy = 0; render(); } }, 'Reset')));
  }

  function csv() {
    const head = 'time_ms,raw_lat,raw_lng,raw_acc_m,lat,lng,acc_m,speed_mps,heading_deg,rejected';
    const lines = stats.log.map((r) => [r.t, r.rawLat, r.rawLng, fmt(r.rawAcc, 1), r.lat ?? '', r.lng ?? '', r.acc != null ? fmt(r.acc, 1) : '', r.speed != null ? fmt(r.speed, 2) : '', r.heading != null ? fmt(r.heading, 0) : '', r.rejected || ''].join(','));
    return [head, ...lines].join('\n');
  }

  const sheet = openSheet({ title: 'GPS details', content: body, onClose: () => { clearInterval(timer.id); onClose?.(); } });
  render();
  timer.id = setInterval(render, 1000);
  return { close: sheet.close };
}
