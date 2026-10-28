/**
 * In-app push-to-talk voice (WebRTC), designed to cost almost nothing while idle.
 *
 *  - The microphone is opened only when the talk button is pressed, kept "warm"
 *    for a few seconds afterwards (so repeated presses are instant), then released.
 *  - Nothing is connected until somebody talks. The first press makes one
 *    sender-only audio connection to each rider who is online; they are closed
 *    again after a minute of silence.
 *  - Every connection carries audio one way only (talker -> listener), so two
 *    riders talking at once are simply two independent connections: there is no
 *    "who calls whom" negotiation to get wrong.
 *  - Audio is mono Opus at ~24 kbps and flows only while the button is held.
 *  - Signalling (offers, answers, ICE, "who is talking") goes through js/signaling.js:
 *    Supabase Realtime Broadcast when configured, otherwise Firebase. Audio itself
 *    never touches either.
 *
 * Honest limits: a web page is suspended with the screen lock, the WebView must
 * grant the microphone, and riders behind strict mobile-carrier NAT need a TURN
 * server (APP.voice.iceServers). See README → Voice.
 */
import { APP } from './config.js';
import { serverNow } from './presence.js';
import { createSignaling } from './signaling.js';

const CFG = APP.voice;
// Entries still holding YOUR_… placeholders are ignored, never sent to the browser as real servers.
const ICE_SERVERS = (CFG.iceServers || []).filter((x) => !/YOUR_/i.test(JSON.stringify(x)));
export const TURN_CONFIGURED = ICE_SERVERS.some((x) => [].concat(x.urls).some((u) => /^turns?:/i.test(u)));

/** Summarise one RTCPeerConnection for the diagnostics sheet. Never throws. */
async function describePc(pc, extra) {
  const o = { ...extra, connection: pc.connectionState, ice: pc.iceConnectionState, gathering: pc.iceGatheringState, signaling: pc.signalingState };
  try {
    const stats = await pc.getStats();
    const local = {}; let pair = null; const byId = new Map();
    stats.forEach((r) => byId.set(r.id, r));
    stats.forEach((r) => {
      if (r.type === 'local-candidate') local[r.candidateType] = (local[r.candidateType] || 0) + 1;
      if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId.get(r.selectedCandidatePairId);
      if (r.type === 'outbound-rtp' && r.kind === 'audio') { o.bytesSent = r.bytesSent; o.packetsSent = r.packetsSent; }
      if (r.type === 'inbound-rtp' && r.kind === 'audio') { o.bytesReceived = r.bytesReceived; o.packetsReceived = r.packetsReceived; o.packetsLost = r.packetsLost; o.jitterMs = Math.round((r.jitter || 0) * 1000); o.audioEnergy = r.totalAudioEnergy; }
    });
    if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    o.localCandidates = local;
    if (pair) {
      o.pair = `${byId.get(pair.localCandidateId)?.candidateType || '?'} -> ${byId.get(pair.remoteCandidateId)?.candidateType || '?'} (${byId.get(pair.localCandidateId)?.protocol || '?'})`;
      o.rttMs = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
    }
  } catch (e) { o.statsError = String(e?.message || e); }
  return o;
}

export const VOICE_SUPPORTED = typeof RTCPeerConnection === 'function'
  && !!navigator.mediaDevices?.getUserMedia
  && typeof window !== 'undefined' && window.isSecureContext !== false;

const rid = (n = 12) => {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(n);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return [...bytes].map((b) => a[b % a.length]).join('');
};

/** Ask Opus for voice-friendly settings: mono, in-band FEC, DTX, capped bitrate. */
export function tuneOpus(sdp, bitrate) {
  const m = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp);
  if (!m) return sdp;
  const pt = m[1];
  const want = { minptime: 20, useinbandfec: 1, usedtx: 1, stereo: 0, 'sprop-stereo': 0, maxaveragebitrate: bitrate };
  const lines = sdp.split('\r\n');
  const fmtpAt = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
  if (fmtpAt >= 0) {
    const have = Object.fromEntries(lines[fmtpAt].slice(`a=fmtp:${pt} `.length).split(';').filter(Boolean).map((kv) => {
      const i = kv.indexOf('=');
      return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)];
    }));
    Object.assign(have, want);
    lines[fmtpAt] = `a=fmtp:${pt} ` + Object.entries(have).map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join(';');
  } else {
    const rtpAt = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
    lines.splice(rtpAt + 1, 0, `a=fmtp:${pt} ` + Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';'));
  }
  return lines.join('\r\n');
}

const stateOf = (pc) => pc.connectionState || pc.iceConnectionState;
const isUp = (pc) => { const s = stateOf(pc); return s === 'connected' || s === 'completed'; };

export class VoiceChat {
  /**
   * @param {{roomId:string, uid:string,
   *          getPeers:()=>Array<{uid:string, epoch:any}>,   // other riders who are online
   *          isMember:(uid:string)=>boolean,                // only room members may signal us
   *          onChange:()=>void,
   *          onProblem:(peerUid:string, kind:string)=>void}} opts
   */
  constructor({ roomId, uid, getPeers, isMember, onChange, onProblem }) {
    this.roomId = roomId;
    this.uid = uid;
    this.getPeers = getPeers;
    this.isMember = isMember || (() => true);
    this.onChange = onChange || (() => {});
    this.onProblem = onProblem || (() => {});

    this.destroyed = false;
    this.holding = false;        // finger is on the button
    this.transmitting = false;   // mic is live and being sent
    this.pressSeq = 0;
    this.micError = null;        // 'denied' | 'nomic' | 'unsupported' | 'error'
    this.audioBlocked = false;   // autoplay refused; retried on the next tap

    this.mic = null;             // {stream, track}
    this.micTimer = null;
    this.idleTimer = null;
    this.holdTimer = null;

    this.tx = new Map();         // peerUid -> {pc, sid, peer, epoch, sender, offerSent, queued, timer, problem}
    this.rx = new Map();         // sid -> {pc, from, audio, timer}
    this.bySid = new Map();      // sid -> {kind:'tx'|'rx', entry}
    this.pendingIce = new Map(); // sid -> RTCIceCandidateInit[]
    this.sig = null;             // signalling transport
    this.flags = {};             // uid -> {at}
    this.unsubs = [];
    this.audioHost = null;
    this.events = [];            // short diagnostic log (newest last)
  }

  ev(msg) { this.events.push(`${new Date().toLocaleTimeString('en-GB')} ${msg}`); if (this.events.length > 80) this.events.shift(); }

  /* ----------------------------------------------------------------- setup */
  start() {
    if (!VOICE_SUPPORTED || this.destroyed) return;
    this.sig = createSignaling({
      roomId: this.roomId,
      uid: this.uid,
      onSignal: (from, m) => {
        if (!this.isMember(from)) return;   // the channel is not secret; membership is the gate
        this.handle(from, m).catch((err) => console.warn('voice signal error', err));
      },
      onTalk: (flags) => { this.flags = flags; this.emit(); }
    });
    this.ev(`signalling: ${this.sig.kind}`);
    Promise.resolve(this.sig.start()).catch((err) => { console.warn('voice signalling failed to start', err); this.onProblem('', 'signaling'); });
    const unlock = () => { if (this.audioBlocked) this.playAll(); };
    document.addEventListener('pointerdown', unlock, true);
    this.unsubs.push(() => document.removeEventListener('pointerdown', unlock, true));
  }

  emit() { if (!this.destroyed) try { this.onChange(); } catch (e) { console.error(e); } }

  /* ---------------------------------------------------------------- queries */
  /** Riders currently holding their talk button (stale flags are ignored). */
  talkers() {
    const now = serverNow();
    const out = [];
    for (const [id, f] of Object.entries(this.flags)) {
      if (id === this.uid || !f || f.talking !== true || !this.isMember(id)) continue;
      if (typeof f.at === 'number' && now - f.at > CFG.maxTalkMs + 8000) continue;
      out.push(id);
    }
    return out;
  }

  /** 'idle' | 'starting' | 'connecting' | 'live' */
  phase() {
    if (this.holding && !this.transmitting) return 'starting';
    if (!this.transmitting) return 'idle';
    for (const t of this.tx.values()) if (isUp(t.pc)) return 'live';
    return 'connecting';
  }

  /* ------------------------------------------------------------ talk button */
  /** Start talking. Resolves {ok:true} or {ok:false, reason}. */
  async press() {
    if (this.destroyed || this.holding) return { ok: true };
    if (!VOICE_SUPPORTED) { this.micError = 'unsupported'; this.emit(); return { ok: false, reason: 'unsupported' }; }
    this.holding = true;
    this.ev('press');
    const seq = ++this.pressSeq;
    this.emit();

    try {
      await this.ensureMic();
    } catch (err) {
      this.holding = false;
      this.ev(`mic error: ${err?.name || err}`);
      this.micError = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied'
        : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' ? 'nomic' : 'error';
      this.emit();
      return { ok: false, reason: this.micError };
    }
    this.micError = null;
    // Released (or destroyed) while the permission prompt / mic start-up was pending:
    // keep the mic warm but do not transmit anything.
    if (this.destroyed || !this.holding || seq !== this.pressSeq) { this.emit(); return { ok: true, late: true }; }

    clearTimeout(this.idleTimer);
    clearTimeout(this.micTimer);
    this.transmitting = true;
    this.mic.track.enabled = true;
    this.holdTimer = setTimeout(() => this.release(), CFG.maxTalkMs);
    this.ev(`mic live, peers online: ${this.getPeers().length}`);
    this.announce(true);
    this.syncPeers();
    this.emit();
    return { ok: true };
  }

  release() {
    if (!this.holding && !this.transmitting) return;
    this.holding = false;
    this.pressSeq++;
    clearTimeout(this.holdTimer);
    if (this.transmitting) {
      this.transmitting = false;
      if (this.mic) this.mic.track.enabled = false;
      for (const t of this.tx.values()) t.sender?.replaceTrack(null).catch(() => {});
      this.announce(false);
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.closeAllTx('idle'), CFG.idleCloseMs);
      this.scheduleMicStop();
    }
    this.emit();
  }

  /** Page hidden / app backgrounded: stop transmitting and give the microphone back. */
  suspend() {
    this.release();
    clearTimeout(this.micTimer);
    this.stopMic();
    this.emit();
  }

  /* ------------------------------------------------------------- microphone */
  async ensureMic() {
    clearTimeout(this.micTimer);
    if (this.mic && this.mic.track.readyState === 'live') return;
    this.stopMic();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });
    const track = stream.getAudioTracks()[0];
    if (!track) { stream.getTracks().forEach((t) => t.stop()); throw Object.assign(new Error('no audio track'), { name: 'NotFoundError' }); }
    track.enabled = false; // silent until the button is actually held
    track.addEventListener('ended', () => { if (this.mic?.track === track) { this.mic = null; this.release(); } });
    this.mic = { stream, track };
  }

  scheduleMicStop() {
    clearTimeout(this.micTimer);
    if (!this.mic) return;
    if (CFG.micWarmMs <= 0) { this.stopMic(); return; }
    this.micTimer = setTimeout(() => { if (!this.transmitting && !this.holding) this.stopMic(); }, CFG.micWarmMs);
  }

  stopMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic = null;
  }

  /* ------------------------------------------------------- "who is talking" */
  announce(on) { this.sig?.talk(on); }

  /* ------------------------------------------------------------------ senders */
  /** Make sure there is a sending connection to every online rider (and none to riders who left). */
  syncPeers() {
    if (this.destroyed) return;
    const peers = new Map(this.getPeers().map((p) => [p.uid, p]));
    for (const [id, t] of this.tx) {
      const p = peers.get(id);
      const stale = !p || String(p.epoch) !== String(t.epoch) || ['failed', 'closed'].includes(stateOf(t.pc));
      if (stale) this.closeTx(id, 'peer-changed');
    }
    if (!this.transmitting) return;
    for (const [id, p] of peers) {
      const t = this.tx.get(id);
      if (!t) this.openTx(p);
      else if (this.mic && t.sender && t.sender.track !== this.mic.track) t.sender.replaceTrack(this.mic.track).catch(() => {});
    }
  }

  async openTx(peer) {
    if (!this.mic) return;
    const sid = rid();
    this.ev(`tx -> ${peer.uid.slice(0, 5)} opening`);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, sid, peer: peer.uid, epoch: peer.epoch, sender: null, offerSent: false, queued: [], timer: null, problem: false };
    this.tx.set(peer.uid, entry);
    this.bySid.set(sid, { kind: 'tx', entry });

    try {
      const transceiver = pc.addTransceiver(this.mic.track, { direction: 'sendonly' });
      entry.sender = transceiver.sender;
      this.capBitrate(entry.sender);
    } catch (err) { this.failTx(entry, 'error', err); return; }

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const data = JSON.stringify(e.candidate.toJSON());
      if (entry.offerSent) this.signal(peer.uid, 'ice', sid, data); else entry.queued.push(data);
    };
    pc.onconnectionstatechange = () => {
      const s = stateOf(pc);
      this.ev(`tx ${peer.uid.slice(0, 5)} ${s}`);
      if (s === 'connected') clearTimeout(entry.timer);
      if (s === 'failed') this.failTx(entry, 'blocked');
      this.emit();
    };
    entry.timer = setTimeout(() => { if (!isUp(pc)) this.failTx(entry, 'timeout'); }, CFG.connectTimeoutMs);

    try {
      const offer = await pc.createOffer();
      offer.sdp = tuneOpus(offer.sdp, CFG.bitrate);
      await pc.setLocalDescription(offer);
      if (this.destroyed || this.tx.get(peer.uid) !== entry) return;
      this.signal(peer.uid, 'offer', sid, JSON.stringify({ type: offer.type, sdp: offer.sdp }));
      entry.offerSent = true;
      this.ev(`tx ${peer.uid.slice(0, 5)} offer sent via ${this.sig?.kind}`);
      for (const data of entry.queued.splice(0)) this.signal(peer.uid, 'ice', sid, data);
    } catch (err) { this.failTx(entry, 'error', err); }
  }

  capBitrate(sender) {
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = CFG.bitrate;
      sender.setParameters(p).catch(() => {});
    } catch { /* optional */ }
  }

  failTx(entry, kind, err) {
    if (err) console.warn('voice:', kind, err);
    this.ev(`tx ${entry.peer.slice(0, 5)} FAILED: ${kind}${err ? ` (${err.message || err})` : ''}`);
    clearTimeout(entry.timer);
    if (!entry.problem) { entry.problem = true; this.onProblem(entry.peer, kind); }
    if (this.tx.get(entry.peer) === entry) this.closeTx(entry.peer, kind, { keepProblem: true });
    this.emit();
  }

  closeTx(peerUid, reason, { keepProblem = false } = {}) {
    const t = this.tx.get(peerUid);
    if (!t) return;
    this.tx.delete(peerUid);
    this.bySid.delete(t.sid);
    this.pendingIce.delete(t.sid);
    clearTimeout(t.timer);
    t.pc.onicecandidate = null;
    t.pc.onconnectionstatechange = null;
    try { t.pc.close(); } catch { /* already closed */ }
    if (t.offerSent && reason !== 'blocked' && reason !== 'timeout') this.signal(peerUid, 'bye', t.sid, '{}');
    void keepProblem;
  }

  closeAllTx(reason) {
    for (const id of [...this.tx.keys()]) this.closeTx(id, reason);
    this.emit();
  }

  /* ---------------------------------------------------------------- signalling */
  signal(to, t, sid, d) { this.sig?.send(to, t, sid, d); }

  async handle(from, m) {
    let data;
    try { data = JSON.parse(m.d); } catch { return; }
    switch (m.t) {
      case 'offer': return this.acceptOffer(from, m.sid, data);
      case 'answer': {
        const hit = this.bySid.get(m.sid);
        if (hit?.kind !== 'tx' || hit.entry.peer !== from) return;
        this.ev(`tx ${from.slice(0, 5)} answer received`);
        await hit.entry.pc.setRemoteDescription(data);
        return this.flushIce(m.sid, hit.entry.pc);
      }
      case 'ice': {
        const hit = this.bySid.get(m.sid);
        if (hit && hit.entry.pc.remoteDescription) { try { await hit.entry.pc.addIceCandidate(data); } catch { /* late or duplicate */ } return; }
        const q = this.pendingIce.get(m.sid) || [];
        q.push(data);
        this.pendingIce.set(m.sid, q.slice(-30));
        return;
      }
      case 'bye': {
        const hit = this.bySid.get(m.sid);
        if (hit?.kind === 'rx') this.closeRx(m.sid);
        return;
      }
      default:
    }
  }

  async flushIce(sid, pc) {
    const q = this.pendingIce.get(sid);
    if (!q) return;
    this.pendingIce.delete(sid);
    for (const c of q) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
  }

  /* ----------------------------------------------------------------- listeners */
  async acceptOffer(from, sid, offer) {
    if (this.destroyed || !offer?.sdp) return;
    this.ev(`rx offer from ${from.slice(0, 5)}`);
    for (const [oldSid, r] of this.rx) if (r.from === from) this.closeRx(oldSid); // one stream per talker

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, from, audio: null, timer: null };
    this.rx.set(sid, entry);
    this.bySid.set(sid, { kind: 'rx', entry });

    pc.onicecandidate = (e) => { if (e.candidate) this.signal(from, 'ice', sid, JSON.stringify(e.candidate.toJSON())); };
    pc.ontrack = (e) => this.attachAudio(entry, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const s = stateOf(pc);
      this.ev(`rx ${from.slice(0, 5)} ${s}`);
      if (s === 'failed' || s === 'closed') this.closeRx(sid);
      this.emit();
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await this.flushIce(sid, pc);
    const answer = await pc.createAnswer();
    answer.sdp = tuneOpus(answer.sdp, CFG.bitrate);
    await pc.setLocalDescription(answer);
    if (this.destroyed || this.rx.get(sid) !== entry) return;
    this.ev(`rx answer sent to ${from.slice(0, 5)}`);
    this.signal(from, 'answer', sid, JSON.stringify({ type: answer.type, sdp: answer.sdp }));
  }

  attachAudio(entry, stream) {
    if (!this.audioHost) {
      this.audioHost = document.createElement('div');
      this.audioHost.hidden = true;
      this.audioHost.setAttribute('aria-hidden', 'true');
      document.body.append(this.audioHost);
    }
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.srcObject = stream;
    this.ev('rx audio track arrived');
    this.audioHost.append(audio);
    entry.audio = audio;
    this.play(audio);
  }

  play(audio) {
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { this.ev('audio playing'); if (this.audioBlocked) { this.audioBlocked = false; this.emit(); } })
        .catch((e) => { this.ev(`audio BLOCKED: ${e?.name || e}`); this.audioBlocked = true; this.emit(); });
    }
  }

  playAll() { for (const r of this.rx.values()) if (r.audio) this.play(r.audio); }

  closeRx(sid) {
    const r = this.rx.get(sid);
    if (!r) return;
    this.rx.delete(sid);
    this.bySid.delete(sid);
    this.pendingIce.delete(sid);
    r.pc.onicecandidate = null; r.pc.onconnectionstatechange = null; r.pc.ontrack = null;
    try { r.pc.close(); } catch { /* already closed */ }
    if (r.audio) { r.audio.srcObject = null; r.audio.remove(); }
    this.emit();
  }

  /* -------------------------------------------------------------- diagnostics */
  /** A snapshot for the diagnostics sheet / "copy report". */
  async diagnose() {
    const m = this.mic?.track;
    const out = {
      signalling: this.sig?.kind || 'none',
      turn: TURN_CONFIGURED ? 'configured' : 'NOT configured (STUN only)',
      mic: this.micError ? `error: ${this.micError}` : m ? `${m.readyState}${m.enabled ? ', sending' : ', muted'}` : 'closed (opens on first press)',
      audioBlocked: this.audioBlocked,
      transmitting: this.transmitting,
      onlinePeers: this.getPeers().map((p) => p.uid.slice(0, 5)),
      tx: [], rx: [], events: [...this.events]
    };
    for (const t of this.tx.values()) {
      out.tx.push(await describePc(t.pc, { to: t.peer.slice(0, 5), offerSent: t.offerSent, queuedIce: t.queued.length, failed: t.problem, track: t.sender?.track ? `${t.sender.track.readyState}${t.sender.track.enabled ? '/on' : '/off'}` : 'none' }));
    }
    for (const r of this.rx.values()) {
      out.rx.push(await describePc(r.pc, { from: r.from.slice(0, 5), audioEl: r.audio ? (r.audio.paused ? 'PAUSED' : 'playing') : 'none' }));
    }
    return out;
  }

  /* ------------------------------------------------------------------ teardown */
  /** Release everything and clear my entries from the database. Safe to call twice. */
  async destroy() {
    if (this.destroyed) return;
    this.release();
    this.destroyed = true;
    clearTimeout(this.micTimer); clearTimeout(this.idleTimer); clearTimeout(this.holdTimer);
    this.stopMic();
    for (const id of [...this.tx.keys()]) this.closeTx(id, 'destroy');
    for (const sid of [...this.rx.keys()]) this.closeRx(sid);
    for (const u of this.unsubs.splice(0)) { try { u(); } catch { /* ignore */ } }
    this.audioHost?.remove(); this.audioHost = null;
    this.sig?.talk(false);
    await this.sig?.destroy();
  }
}
