/**
 * Rooms: create, join (by invite code), leave, remove, close/delete,
 * settings, destination, and the live subscription used by the touring screen.
 *
 * Security model (enforced by firebase/database.rules.json, not by this file):
 *  - Only members can read a room. Room ids alone grant nothing.
 *  - A person can only add themselves, and only by presenting the room's current
 *    invite-code hash. Codes are 10 random symbols, hashed with SHA-256.
 *  - Capacity is a set of fixed "slots" (2 to 30, chosen by the owner when the room is
 *    created and listed in rooms/{id}/slotsAllowed, which cannot change afterwards; rooms
 *    created before this existed have slots 0-5). A member write must claim a free allowed
 *    slot in the same atomic update, so one member too many is impossible.
 *  - Only the owner edits settings, status, invite code, members' removal,
 *    and (by default) the destination.
 */
import { db, ref, get, set, update, onValue, serverTimestamp, push } from './firebase.js';
import { APP } from './config.js';
import { validateDiscordUrl } from './discord.js';
import { serverNow } from './presence.js';
import { cleanText } from './ui.js';
import { isValidLat, isValidLng, roundTo } from './geo.js';

export class RoomError extends Error {
  /** @param {string} code */
  constructor(code, message) { super(message); this.name = 'RoomError'; this.code = code; }
}

const isPermissionDenied = (err) => /permission[_ ]denied/i.test(`${err?.code || ''} ${err?.message || ''}`);

function mapDbError(err) {
  if (err instanceof RoomError) return err;
  if (isPermissionDenied(err)) return new RoomError('denied', 'You do not have permission to do that.');
  if (/offline|network|disconnected/i.test(`${err?.code || ''} ${err?.message || ''}`)) {
    return new RoomError('network', 'No connection to the server. Check your internet and try again.');
  }
  console.error(err);
  return new RoomError('unknown', 'Something went wrong. Please try again.');
}

/* ------------------------------------------------------------ Invite codes */

/** Cryptographically random invite code (rejection sampling, no modulo bias). */
export function generateInviteCode() {
  const { alphabet, length } = APP.invite;
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && out.length < length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

export const normalizeCode = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatCode = (code) => (code.length === APP.invite.length ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

export function isPlausibleCode(code) {
  return code.length === APP.invite.length && [...code].every((ch) => APP.invite.alphabet.includes(ch));
}

export async function hashCode(code) {
  if (!globalThis.crypto?.subtle) throw new RoomError('insecure', 'A secure (HTTPS) connection is required.');
  const data = new TextEncoder().encode(`touringtogether:v1:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* -------------------------------------------------------------- Create/join */

function memberRecord({ role, slot, profile, inviteHash }) {
  const rec = {
    role,
    slot,
    joinedAt: serverTimestamp(),
    displayName: cleanText(profile.displayName, APP.limits.displayName) || 'Rider'
  };
  if (profile.avatarUrl) rec.avatarUrl = profile.avatarUrl;
  if (profile.motorcycle) rec.motorcycle = profile.motorcycle;
  if (inviteHash) rec.inviteHash = inviteHash;
  return rec;
}

/** A usable room size: a whole number from the allowed range, or the default. */
export function clampCapacity(value) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return APP.limits.defaultMembers;
  return Math.min(Math.max(n, APP.limits.minRoomMembers), APP.limits.maxRoomMembers);
}

/** Capacity of a room record (rooms created before sizes existed hold six). */
export function roomCapacity(meta) {
  return Number.isInteger(meta?.capacity) ? clampCapacity(meta.capacity) : APP.limits.defaultMembers;
}

export async function createRoom({ uid, profile, name, discordUrl, capacity }) {
  try {
    const cap = clampCapacity(capacity);
    const slotsAllowed = {};
    for (let n = 0; n < cap; n += 1) slotsAllowed[n] = true;
    const roomName = cleanText(name, APP.limits.roomName) ||
      `Touring ${new Date().toLocaleDateString([], { day: 'numeric', month: 'short' })}`;

    let discord = null;
    if (discordUrl && discordUrl.trim()) {
      const v = validateDiscordUrl(discordUrl);
      if (!v.ok) throw new RoomError('invalid-discord', v.error);
      discord = v.url;
    }

    const roomId = push(ref(db, 'rooms')).key; // local id, nothing written yet
    const code = generateInviteCode();
    const hash = await hashCode(code);
    const expiresAt = Math.round(serverNow() + APP.invite.ttlDays * 86400000);
    const stamp = serverTimestamp();

    const settings = { destinationPolicy: 'owner', updatedAt: stamp };
    if (discord) settings.discordInviteUrl = discord;

    // The room (with its chosen size) and everything that points to it, in one atomic write.
    const write = (withCapacity) => {
      const room = {
        name: roomName,
        ownerUid: uid,
        status: 'open',
        inviteCodeHash: hash,
        createdAt: stamp,
        updatedAt: stamp,
        invite: { code },
        members: { [uid]: memberRecord({ role: 'owner', slot: '0', profile }) },
        slots: { 0: uid },
        settings
      };
      const invite = { roomId, roomName, createdBy: uid, status: 'open', expiresAt };
      if (withCapacity) { room.capacity = cap; room.slotsAllowed = slotsAllowed; invite.capacity = cap; }
      return update(ref(db), {
        [`rooms/${roomId}`]: room,
        [`inviteCodes/${hash}`]: invite,
        [`users/${uid}/rooms/${roomId}`]: { name: roomName, role: 'owner', joinedAt: stamp },
        [`users/${uid}/currentRoomId`]: roomId
      });
    };

    let legacyRules = false;
    try {
      await write(true);
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
      // Almost always: the Firebase rules have not been updated yet, so they refuse the size fields.
      // A default-size room can still be made in the old format (six slots); other sizes cannot.
      if (cap === APP.limits.defaultMembers) {
        try { await write(false); legacyRules = true; } catch { /* fall through to the explanation below */ }
      }
      if (!legacyRules) {
        throw new RoomError('rules-outdated', cap === APP.limits.defaultMembers
          ? 'The database refused this room. Most likely the Firebase rules were not published yet: open Firebase Console, Realtime Database, Rules, paste firebase/database.rules.json and Publish.'
          : 'The database refused this room size. The Firebase rules were most likely not published yet: open Firebase Console, Realtime Database, Rules, paste firebase/database.rules.json and Publish. Until then only rooms of 6 riders can be created.');
      }
    }
    return { roomId, code, legacyRules };
  } catch (err) {
    throw mapDbError(err);
  }
}

/** Looks up an invite code. Throws a RoomError with a user-ready message when unusable. */
export async function previewInvite(rawCode) {
  const code = normalizeCode(rawCode);
  if (!isPlausibleCode(code)) {
    throw new RoomError('invalid-code', `Invite codes have ${APP.invite.length} letters/numbers, like ABCDE-23456.`);
  }
  try {
    const hash = await hashCode(code);
    const snap = await get(ref(db, `inviteCodes/${hash}`));
    if (!snap.exists()) throw new RoomError('not-found', 'No room matches that code. Check it and try again.');
    const v = snap.val();
    if (v.status === 'closed') throw new RoomError('closed', 'This room has been closed by its owner.');
    if (!(v.expiresAt > serverNow())) throw new RoomError('expired', 'This invitation has expired. Ask the room owner for a new code.');
    return { code, hash, roomId: v.roomId, roomName: v.roomName, expiresAt: v.expiresAt, capacity: Number.isInteger(v.capacity) ? clampCapacity(v.capacity) : APP.limits.defaultMembers };
  } catch (err) {
    throw mapDbError(err);
  }
}

export async function joinRoom(preview, { uid, profile }) {
  const { roomId, hash, roomName } = preview;
  const capacity = Number.isInteger(preview.capacity) ? clampCapacity(preview.capacity) : APP.limits.defaultMembers;
  try {
    // Already a member? Just go in. (Non-members get permission-denied here, which is expected.)
    try {
      const mine = await get(ref(db, `rooms/${roomId}/members/${uid}`));
      if (mine.exists()) {
        await rememberRoom(uid, roomId, roomName, mine.val().role);
        return roomId;
      }
    } catch (err) {
      if (!isPermissionDenied(err)) throw err;
    }

    for (let n = 0; n < capacity; n += 1) {
      const slot = String(n);
      try {
        await update(ref(db), {
          [`rooms/${roomId}/slots/${slot}`]: uid,
          [`rooms/${roomId}/members/${uid}`]: memberRecord({ role: 'member', slot, profile, inviteHash: hash }),
          [`users/${uid}/rooms/${roomId}`]: { name: roomName, role: 'member', joinedAt: serverTimestamp() },
          [`users/${uid}/currentRoomId`]: roomId
        });
        return roomId;
      } catch (err) {
        if (!isPermissionDenied(err)) throw err;
        // slot taken (or join not allowed): try the next slot
      }
    }
    throw new RoomError('full', `Could not join. The room is full (${capacity} riders max), closed, or you were removed from it.`);
  } catch (err) {
    throw mapDbError(err);
  }
}

async function rememberRoom(uid, roomId, name, role) {
  await update(ref(db), {
    [`users/${uid}/rooms/${roomId}`]: { name, role, joinedAt: serverTimestamp() },
    [`users/${uid}/currentRoomId`]: roomId
  });
}

/* ------------------------------------------------------------- Leave/remove */

export async function leaveRoom(roomId, uid, myMember) {
  if (myMember?.role === 'owner') {
    throw new RoomError('owner-cannot-leave', 'The owner cannot leave. Close or delete the room instead.');
  }
  try {
    await update(ref(db), {
      [`rooms/${roomId}/members/${uid}`]: null,
      [`rooms/${roomId}/slots/${myMember.slot}`]: null,
      [`rooms/${roomId}/locations/${uid}`]: null,
      [`rooms/${roomId}/presence/${uid}`]: null,
      [`users/${uid}/rooms/${roomId}`]: null,
      [`users/${uid}/currentRoomId`]: null
    });
  } catch (err) { throw mapDbError(err); }
}

/** Leave using only the room id (reads my member record for the slot). */
export async function leaveRoomById(roomId, uid) {
  try {
    const snap = await get(ref(db, `rooms/${roomId}/members/${uid}`));
    if (!snap.exists()) {
      await forgetRoomEntry(uid, roomId);
      return;
    }
    await leaveRoom(roomId, uid, snap.val());
  } catch (err) { throw mapDbError(err); }
}

/** Owner removes a rider. The rider is also blocked from rejoining until allowed again. */
export async function removeMember(roomId, targetUid, member) {
  try {
    await update(ref(db), {
      [`rooms/${roomId}/members/${targetUid}`]: null,
      [`rooms/${roomId}/slots/${member.slot}`]: null,
      [`rooms/${roomId}/locations/${targetUid}`]: null,
      [`rooms/${roomId}/presence/${targetUid}`]: null,
      [`rooms/${roomId}/banned/${targetUid}`]: { name: cleanText(member.displayName, APP.limits.displayName) || 'Rider', at: serverTimestamp() }
    });
  } catch (err) { throw mapDbError(err); }
}

export async function allowRejoin(roomId, targetUid) {
  try { await set(ref(db, `rooms/${roomId}/banned/${targetUid}`), null); } catch (err) { throw mapDbError(err); }
}

/* --------------------------------------------------------- Owner operations */

export async function setRoomStatus(roomId, inviteHash, status) {
  try {
    await update(ref(db), {
      [`rooms/${roomId}/status`]: status,
      [`rooms/${roomId}/updatedAt`]: serverTimestamp(),
      [`inviteCodes/${inviteHash}/status`]: status
    });
  } catch (err) { throw mapDbError(err); }
}

export async function deleteRoom(roomId, inviteHash, uid) {
  try {
    await update(ref(db), {
      [`rooms/${roomId}`]: null,
      [`inviteCodes/${inviteHash}`]: null,
      [`users/${uid}/rooms/${roomId}`]: null,
      [`users/${uid}/currentRoomId`]: null
    });
  } catch (err) { throw mapDbError(err); }
}

/** Issues a fresh invite code and invalidates the old one. */
export async function rotateInvite(roomId, { oldHash, roomName, status, uid, capacity }) {
  try {
    const code = generateInviteCode();
    const hash = await hashCode(code);
    await update(ref(db), {
      [`rooms/${roomId}/inviteCodeHash`]: hash,
      [`rooms/${roomId}/invite/code`]: code,
      [`rooms/${roomId}/updatedAt`]: serverTimestamp(),
      [`inviteCodes/${oldHash}`]: null,
      [`inviteCodes/${hash}`]: {
        roomId, roomName, createdBy: uid, status: status || 'open',
        expiresAt: Math.round(serverNow() + APP.invite.ttlDays * 86400000),
        ...(Number.isInteger(capacity) ? { capacity: clampCapacity(capacity) } : {})
      }
    });
    return { code, hash };
  } catch (err) { throw mapDbError(err); }
}

export async function updateRoomName(roomId, inviteHash, name) {
  const clean = cleanText(name, APP.limits.roomName);
  if (!clean) throw new RoomError('invalid-name', 'Give the room a name.');
  try {
    await update(ref(db), {
      [`rooms/${roomId}/name`]: clean,
      [`rooms/${roomId}/updatedAt`]: serverTimestamp(),
      [`inviteCodes/${inviteHash}/roomName`]: clean
    });
  } catch (err) { throw mapDbError(err); }
}

/** @param {{discordInviteUrl?: string|null, destinationPolicy?: 'owner'|'members'}} patch */
export async function updateRoomSettings(roomId, patch) {
  const next = { updatedAt: serverTimestamp() };
  if ('discordInviteUrl' in patch) {
    if (patch.discordInviteUrl && patch.discordInviteUrl.trim()) {
      const v = validateDiscordUrl(patch.discordInviteUrl);
      if (!v.ok) throw new RoomError('invalid-discord', v.error);
      next.discordInviteUrl = v.url;
    } else {
      next.discordInviteUrl = null;
    }
  }
  if (patch.destinationPolicy) next.destinationPolicy = patch.destinationPolicy;
  try { await update(ref(db, `rooms/${roomId}/settings`), next); } catch (err) { throw mapDbError(err); }
}

/* -------------------------------------------------------------- Destination */

/** @param {{name:string,address?:string,latitude:number,longitude:number,source:'geocoding'|'coordinates'|'map'}} dest */
export async function saveDestination(roomId, uid, dest) {
  if (!isValidLat(dest.latitude) || !isValidLng(dest.longitude)) {
    throw new RoomError('invalid-destination', 'Those coordinates are not valid.');
  }
  const record = {
    name: cleanText(dest.name, 120) || `${roundTo(dest.latitude, 5)}, ${roundTo(dest.longitude, 5)}`,
    latitude: roundTo(dest.latitude, 6),
    longitude: roundTo(dest.longitude, 6),
    source: dest.source,
    updatedAt: serverTimestamp(),
    updatedBy: uid
  };
  const address = cleanText(dest.address, 300);
  if (address) record.address = address;
  try { await set(ref(db, `rooms/${roomId}/destination`), record); } catch (err) { throw mapDbError(err); }
}

export async function clearDestination(roomId) {
  try { await set(ref(db, `rooms/${roomId}/destination`), null); } catch (err) { throw mapDbError(err); }
}

/* --------------------------------------------------------- User's room list */

export async function listMyRooms(uid) {
  const [roomsSnap, currentSnap] = await Promise.all([
    get(ref(db, `users/${uid}/rooms`)),
    get(ref(db, `users/${uid}/currentRoomId`))
  ]);
  const rooms = roomsSnap.exists()
    ? Object.entries(roomsSnap.val()).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0))
    : [];
  return { rooms, currentRoomId: currentSnap.exists() ? currentSnap.val() : null };
}

export async function forgetRoomEntry(uid, roomId) {
  await update(ref(db), { [`users/${uid}/rooms/${roomId}`]: null });
}

export async function setCurrentRoom(uid, roomId) {
  try { await set(ref(db, `users/${uid}/currentRoomId`), roomId || null); } catch { /* non-critical */ }
}

/** Checks membership with a single cheap read. Non-members get a permission error → false. */
export async function canAccessRoom(roomId, uid) {
  try {
    const snap = await get(ref(db, `rooms/${roomId}/members/${uid}`));
    return snap.exists();
  } catch (err) {
    if (isPermissionDenied(err)) return false;
    throw mapDbError(err);
  }
}

/* ------------------------------------------------------------ Live listeners */

/**
 * Subscribes to everything the touring screen needs. Returns an unsubscribe fn.
 *
 * handlers: onMeta(meta), onMembers(map), onLocations(map), onPresence(map),
 *           onDestination(obj|null), onSettings(obj), onBanned(map),
 *           onReady(), onAccessLost('removed'|'deleted'), onError(err)
 */
export function subscribeRoom(roomId, uid, handlers) {
  const base = `rooms/${roomId}`;
  const unsubs = [];
  const meta = {};
  const ready = new Set();
  const CORE = ['members', 'name', 'status', 'ownerUid', 'inviteCodeHash', 'invite'];
  let readyFired = false;
  let lost = false;
  let hadMembership = false;

  const markReady = (key) => {
    ready.add(key);
    if (!readyFired && CORE.every((k) => ready.has(k))) { readyFired = true; handlers.onReady?.(); }
  };
  const lose = (reason) => {
    if (lost) return;
    lost = true;
    handlers.onAccessLost?.(reason);
  };
  const fail = (err) => {
    if (isPermissionDenied(err)) lose(hadMembership ? 'removed' : 'denied');
    else handlers.onError?.(mapDbError(err));
  };
  const listen = (path, cb) => {
    unsubs.push(onValue(ref(db, `${base}/${path}`), cb, fail));
  };
  const metaField = (key) => listen(key, (snap) => {
    meta[key] = snap.val();
    if (key === 'ownerUid' && snap.val() === null && readyFired) lose('deleted');
    markReady(key);
    if (readyFired) handlers.onMeta?.({ ...meta });
  });

  listen('members', (snap) => {
    const members = snap.val() || {};
    if (members[uid]) hadMembership = true;
    else if (hadMembership) { lose(Object.keys(members).length ? 'removed' : 'deleted'); return; }
    handlers.onMembers?.(members);
    markReady('members');
  });
  ['name', 'status', 'ownerUid', 'inviteCodeHash', 'createdAt', 'updatedAt', 'capacity'].forEach(metaField);
  listen('invite', (snap) => { meta.inviteCode = snap.val()?.code || null; markReady('invite'); if (readyFired) handlers.onMeta?.({ ...meta }); });
  listen('locations', (snap) => handlers.onLocations?.(snap.val() || {}));
  listen('presence', (snap) => handlers.onPresence?.(snap.val() || {}));
  listen('destination', (snap) => handlers.onDestination?.(snap.val() || null));
  listen('settings', (snap) => handlers.onSettings?.(snap.val() || {}));
  listen('banned', (snap) => handlers.onBanned?.(snap.val() || {}));

  return () => unsubs.forEach((off) => { try { off(); } catch { /* ignore */ } });
}
