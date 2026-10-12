import { auth, db, ref, get, set, update, serverTimestamp, updateProfile } from './firebase.js';
import { APP } from './config.js';
import { cleanText } from './ui.js';
import { whenRegistrationSettled } from './auth.js';

const MAX_AVATAR_CHARS = 15000;              // matches database.rules.json
const UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function getProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  return snap.exists() ? snap.val() : null;
}

/**
 * Returns the stored profile, creating a minimal one if the account has none yet.
 * Errors (offline, permission) propagate: we must never "create" a profile
 * just because a read failed, or we could overwrite an existing one.
 */
export async function ensureProfile(user) {
  await whenRegistrationSettled();
  const snap = await get(ref(db, `users/${user.uid}`));
  if (snap.exists()) return snap.val();
  const displayName = cleanText(user.displayName || user.email?.split('@')[0] || 'Rider', APP.limits.displayName) || 'Rider';
  await set(ref(db, `users/${user.uid}`), { displayName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return { displayName };
}

export function validateProfileInput({ displayName, motorcycle, avatarUrl }) {
  const errors = {};
  const name = cleanText(displayName, APP.limits.displayName);
  if (!name) errors.displayName = 'Display name is required.';
  if (cleanText(motorcycle, APP.limits.motorcycle + 1).length > APP.limits.motorcycle) errors.motorcycle = `Keep it under ${APP.limits.motorcycle} characters.`;
  if (avatarUrl) {
    const v = validateAvatarValue(avatarUrl);
    if (!v.ok) errors.avatarUrl = v.error;
  }
  return errors;
}

/** Accepts an https image URL or a data:image/(jpeg|png|webp) URL produced by resizeImageFile(). */
export function validateAvatarValue(value) {
  const v = String(value).trim();
  if (v.length > MAX_AVATAR_CHARS) return { ok: false, error: 'Image data is too large.' };
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) return { ok: true, value: v };
  let url;
  try { url = new URL(v); } catch { return { ok: false, error: 'Enter a full image link starting with https://' }; }
  if (url.protocol !== 'https:') return { ok: false, error: 'Avatar links must use https://' };
  if (url.username || url.password) return { ok: false, error: 'Remove the username/password from the link.' };
  if (/\s/.test(v)) return { ok: false, error: 'The link cannot contain spaces.' };
  return { ok: true, value: url.toString() };
}

/** Confirms the URL really loads as an image (guards against pages, PDFs, dead links). */
export function testImageUrl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0 && img.naturalHeight > 0); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

/**
 * Turns an uploaded photo into a small square JPEG data URL (~3–8 KB) that is
 * stored in the database. This avoids Firebase Storage, which now needs a
 * billing plan. Throws a user-readable Error on bad input.
 */
export async function resizeImageFile(file, size = 96) {
  if (!file) throw new Error('No file selected.');
  if (!UPLOAD_MIME.includes(file.type)) throw new Error('Choose a JPEG, PNG, WebP or GIF image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is larger than 8 MB.');

  const bitmap = await loadBitmap(file).catch(() => { throw new Error('That image could not be read.'); });
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) / 2;

  for (const [px, quality] of [[size, 0.82], [size, 0.65], [Math.round(size * 0.75), 0.6], [64, 0.55]]) {
    const canvas = document.createElement('canvas');
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, px, px);
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, px, px);
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= MAX_AVATAR_CHARS) return out;
  }
  throw new Error('Could not shrink that image enough. Try a simpler picture.');
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall back */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Saves the profile and mirrors the public bits into every room the user belongs to. */
export async function saveProfile(uid, { displayName, motorcycle, avatarUrl }) {
  const name = cleanText(displayName, APP.limits.displayName);
  const moto = cleanText(motorcycle, APP.limits.motorcycle);
  const avatar = avatarUrl ? validateAvatarValue(avatarUrl).value : null;

  await update(ref(db, `users/${uid}`), {
    displayName: name,
    motorcycle: moto || null,
    avatarUrl: avatar || null,
    updatedAt: serverTimestamp()
  });
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name }).catch(() => {});

  const roomsSnap = await get(ref(db, `users/${uid}/rooms`));
  const roomIds = roomsSnap.exists() ? Object.keys(roomsSnap.val()) : [];
  // Best effort: rooms we have since been removed from simply reject the write.
  await Promise.allSettled(roomIds.map((id) =>
    update(ref(db, `rooms/${id}/members/${uid}`), { displayName: name, motorcycle: moto || null, avatarUrl: avatar || null })
  ));
  return { displayName: name, motorcycle: moto, avatarUrl: avatar };
}
