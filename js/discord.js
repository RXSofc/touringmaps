/**
 * Discord voice integration = a validated link that opens in Discord (or the
 * browser). TouringTogether never sees Discord credentials or tokens and does
 * not embed Discord. Joining a specific voice channel, push-to-talk and mute
 * are controlled entirely by Discord.
 */
import { APP } from './config.js';

const HOSTS = new Set(APP.discord.allowedHosts);
const INVITE_PATH = /^\/[A-Za-z0-9-]{2,}$/;                                   // discord.gg/<code>
const WEB_INVITE_PATH = /^\/invite\/[A-Za-z0-9-]{2,}$/;                       // discord.com/invite/<code>
const CHANNEL_PATH = /^\/channels\/(\d{5,25}|@me)\/\d{5,25}(\/\d{5,25})?$/;   // discord.com/channels/<guild>/<channel>

/**
 * Validates and normalises a Discord link. Only https links on Discord's own
 * domains pass; query strings and fragments are dropped.
 * @returns {{ok:true,url:string}|{ok:false,error:string}}
 */
export function validateDiscordUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, error: 'Paste a Discord invite or channel link.' };
  if (raw.length > 200) return { ok: false, error: 'That link is too long.' };
  if (/\s/.test(raw)) return { ok: false, error: 'The link cannot contain spaces.' };

  let url;
  try { url = new URL(raw); } catch { return { ok: false, error: 'That does not look like a valid link.' }; }

  if (url.protocol !== 'https:') return { ok: false, error: 'Discord links must start with https://' };
  if (url.username || url.password || url.port) return { ok: false, error: 'That link has unsupported parts.' };

  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return { ok: false, error: 'Only discord.gg and discord.com links are allowed.' };

  const path = url.pathname.replace(/\/+$/, '');
  const okPath = host === 'discord.gg'
    ? INVITE_PATH.test(path)
    : WEB_INVITE_PATH.test(path) || CHANNEL_PATH.test(path);
  if (!okPath) return { ok: false, error: 'Use an invite (discord.gg/…) or channel link (discord.com/channels/…).' };

  return { ok: true, url: `https://${host}${path}` };
}

/**
 * Opens a link outside the app. A real <a target="_blank"> click is used
 * because Android WebView wrappers (AppMint etc.) route those through their
 * external-link handler, which lets Android offer the Discord app; plain
 * browsers simply open a new tab.
 */
export function openExternal(url) {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
}

/** Opens the room's Discord link if it is valid. @returns {'opened'|'missing'|'invalid'} */
export function openDiscord(url) {
  if (!url) return 'missing';
  const v = validateDiscordUrl(url);
  if (!v.ok) return 'invalid';
  openExternal(v.url);
  return 'opened';
}
