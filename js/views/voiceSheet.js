/**
 * Voice diagnostics: why a rider can or cannot hear another. Open from Room menu →
 * "Voice diagnostics". "Copy report" puts a plain-text report on the clipboard so
 * it can be pasted when something does not connect. Contains no audio and no
 * personal data beyond shortened rider ids.
 */
import { h, openSheet, mountInto, toast, copyText } from '../ui.js';

const yn = (v) => (v ? 'yes' : 'no');

function pcLines(c, dir) {
  const lines = [`${dir === 'tx' ? 'SEND to' : 'RECEIVE from'} ${c.to || c.from}: ${c.connection} (ice ${c.ice}, gathering ${c.gathering}, signalling ${c.signaling})`];
  if (c.pair) lines.push(`  path: ${c.pair}${c.rttMs != null ? `, rtt ${c.rttMs} ms` : ''}`);
  else lines.push('  path: none selected yet');
  lines.push(`  candidates gathered: ${Object.entries(c.localCandidates || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  if (dir === 'tx') lines.push(`  offer sent: ${yn(c.offerSent)}, queued ICE: ${c.queuedIce}, track: ${c.track}, packets sent: ${c.packetsSent ?? '–'}${c.failed ? ', FAILED' : ''}`);
  else lines.push(`  audio element: ${c.audioEl}, packets received: ${c.packetsReceived ?? '–'}, lost: ${c.packetsLost ?? '–'}, jitter ${c.jitterMs ?? '–'} ms, energy ${c.audioEnergy != null ? c.audioEnergy.toFixed(3) : '–'}`);
  if (c.statsError) lines.push(`  stats error: ${c.statsError}`);
  return lines;
}

export function reportText(d, ctx) {
  const out = [
    `TouringTogether voice report (${ctx.version})`,
    `device: ${navigator.userAgent}`,
    `network: ${navigator.connection ? `${navigator.connection.effectiveType || '?'} / type ${navigator.connection.type || '?'}` : 'unknown'}, online ${yn(navigator.onLine)}`,
    `signalling: ${d.signalling}   TURN: ${d.turn}`,
    `mic: ${d.mic}   audio blocked: ${yn(d.audioBlocked)}   transmitting: ${yn(d.transmitting)}`,
    `riders online (I would send to): ${d.onlinePeers.join(', ') || 'none'}`,
    ''
  ];
  if (!d.tx.length && !d.rx.length) out.push('No audio connections right now (they open when someone presses talk).');
  for (const c of d.tx) out.push(...pcLines(c, 'tx'));
  for (const c of d.rx) out.push(...pcLines(c, 'rx'));
  out.push('', 'recent events:', ...d.events.slice(-40));
  return out.join('\n');
}

export function openVoiceSheet({ voice, getContext, onClose }) {
  const body = h('div', { class: 'voice-diag' });
  const timer = { id: null, busy: false, last: null };

  async function refresh() {
    if (timer.busy) return;
    timer.busy = true;
    try {
      const d = voice ? await voice.diagnose() : null;
      timer.last = d;
      render(d);
    } finally { timer.busy = false; }
  }

  function render(d) {
    if (!d) { mountInto(body, h('p', {}, 'Voice is not running on this device.')); return; }
    const ctx = getContext();
    const hints = [];
    if (d.mic.startsWith('error')) hints.push('The microphone is not available. Allow microphone access for the app (Android Settings → Apps → permissions).');
    if (d.audioBlocked) hints.push('This device blocked audio playback. Tap anywhere on the screen.');
    if (d.turn.startsWith('NOT')) hints.push('No TURN server is configured. On mobile data (carrier NAT) audio may not get through. Add one in js/config.js (see README → Voice).');
    for (const c of d.tx) if (c.connection === 'failed' || c.failed) hints.push(`Sending to ${c.to} failed. The network between the two phones blocked the direct audio path.`);
    for (const c of d.rx) if (c.audioEl === 'PAUSED') hints.push(`Audio from ${c.from} arrives but playback is paused.`);
    for (const c of d.rx) if (c.connection === 'connected' && (c.packetsReceived || 0) === 0) hints.push(`Connected to ${c.from} but no audio packets yet.`);
    mountInto(body,
      h('dl', { class: 'kv' },
        h('dt', {}, 'Signalling'), h('dd', { class: 'mono' }, d.signalling),
        h('dt', {}, 'TURN relay'), h('dd', { class: 'mono' }, d.turn),
        h('dt', {}, 'Microphone'), h('dd', { class: 'mono' }, d.mic),
        h('dt', {}, 'Audio blocked'), h('dd', { class: 'mono' }, yn(d.audioBlocked)),
        h('dt', {}, 'Riders online'), h('dd', { class: 'mono' }, d.onlinePeers.join(', ') || 'none')),
      hints.length ? h('div', { class: 'banner banner--warning' }, h('div', { class: 'banner__body' }, hints.map((t) => h('div', {}, t)))) : null,
      h('pre', { class: 'mono small', style: 'white-space:pre-wrap;word-break:break-word;margin:0' }, reportText(d, ctx).split('\n').slice(6).join('\n')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--accent', type: 'button', onclick: async () => {
          const ok = await copyText(reportText(timer.last || d, ctx));
          toast(ok ? 'Report copied.' : 'Could not copy.', { type: ok ? 'success' : 'error' });
        } }, 'Copy report')));
  }

  const sheet = openSheet({ title: 'Voice diagnostics', content: body, onClose: () => { clearInterval(timer.id); onClose?.(); } });
  refresh();
  timer.id = setInterval(refresh, 1500);
  return { close: sheet.close };
}
