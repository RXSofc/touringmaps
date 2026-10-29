/**
 * Browser text-to-speech for the navigation voice (speechSynthesis). No server, no key.
 *
 * Reality check: browsers give no "gender" for a voice, so the female voice is picked by name hints and the rider
 * can choose another one in the room settings. Whether a voice exists at all depends on the phone's speech engine.
 */
const FEMALE = /\bfemale\b|wanita|perempuan|gadis|damayanti|[-_ ]ida[-_ ]|[-_]idc[-_]|\bina\b|indah|\bayu\b|dewi|siti|google bahasa indonesia|google indonesian/i;
const MALE = /\bmale\b|laki|pria|andika|\bardi\b|[-_]idd[-_]|[-_]ide[-_]|\bbudi\b/i;
const isId = (v) => /^(id|in)([-_]|$)/i.test(v.lang || '');

/** Higher = better. Indonesian first, then female-sounding names, then on-device voices (they work offline). */
export function scoreVoice(v) {
  let s = 0;
  if (isId(v)) s += 100;
  if (FEMALE.test(`${v.name} ${v.voiceURI || ''}`)) s += 20;
  if (MALE.test(`${v.name} ${v.voiceURI || ''}`)) s -= 40;
  if (v.localService) s += 5;
  if (v.default) s += 1;
  return s;
}
export function pickVoice(voices, preferredName) {
  const list = voices || [];
  const chosen = preferredName && list.find((v) => v.name === preferredName);
  if (chosen) return chosen;
  const id = list.filter(isId);
  if (!id.length) return null;
  return id.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

export class SpeechGuide {
  constructor({ synth = globalThis.speechSynthesis, Utter = globalThis.SpeechSynthesisUtterance, now = () => Date.now(), lang = 'id-ID' } = {}) {
    this.synth = synth; this.Utter = Utter; this.now = now; this.lang = lang;
    this.enabled = false;
    this.rate = 1; this.pitch = 1.1; this.voiceName = '';
    this.cur = null; this.pending = null; this.lastKey = new Map();
    this.isBlocked = null;       // () => true while someone talks on the group voice
  }
  get supported() { return !!(this.synth && this.Utter); }
  voices() { try { return (this.synth?.getVoices?.() || []).filter(isId); } catch { return []; } }
  /** True when a voice that speaks Indonesian is installed. */
  hasIndonesian() { return this.voices().length > 0; }
  onVoices(cb) { try { this.synth?.addEventListener?.('voiceschanged', cb); return () => this.synth?.removeEventListener?.('voiceschanged', cb); } catch { return () => {}; } }
  setEnabled(on) { this.enabled = !!on && this.supported; if (!this.enabled) this.cancel(); return this.enabled; }
  cancel() { this.pending = null; this.cur = null; clearTimeout(this.guard); try { this.synth?.cancel?.(); } catch { /* ignore */ } }

  /**
   * @param {string} text
   * @param {{urgent?:boolean, key?:string, gapMs?:number}} opts
   *   urgent: interrupts what is being said. Otherwise it waits (only the newest waiting sentence is kept).
   *   key + gapMs: do not say the same kind of thing more often than this.
   */
  say(text, { urgent = false, key = '', gapMs = 0 } = {}) {
    if (!this.enabled || !this.supported || !text) return false;
    const t = this.now();
    if (key && gapMs && t - (this.lastKey.get(key) || 0) < gapMs) return false;
    if (!urgent && this.isBlocked?.()) return false;      // do not talk over a rider on the group voice
    if (key) this.lastKey.set(key, t);
    if (urgent) {
      this.pending = null;
      if (this.cur) { try { this.synth.cancel(); } catch { /* ignore */ } }
      this.start(text);
      return true;
    }
    if (this.cur) { this.pending = { text, at: t }; return true; }
    this.start(text);
    return true;
  }

  start(text) {
    let u;
    try { u = new this.Utter(text); } catch { return; }
    const voice = pickVoice(this.voices(), this.voiceName);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = this.lang;
    u.rate = this.rate; u.pitch = this.pitch; u.volume = 1;
    this.cur = u;                                  // keep a reference: some engines drop an utterance that is garbage-collected
    clearTimeout(this.guard);
    const done = () => {
      if (this.cur !== u) return;
      this.cur = null; clearTimeout(this.guard);
      const p = this.pending; this.pending = null;
      if (p && this.now() - p.at < 8000) this.start(p.text);
    };
    u.onend = done; u.onerror = done;
    this.guard = setTimeout(done, 12000);         // an engine that never reports the end must not block the voice for good
    try { this.synth.speak(u); } catch { done(); }
  }
}
