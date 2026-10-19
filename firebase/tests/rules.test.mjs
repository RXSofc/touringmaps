// Security-rule tests. Run from firebase/tests:  npm install && npm test
// (needs Java for the Firebase emulator). NOTE: written alongside the rules but
// not executed in the environment where they were authored: run them before going live.
import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';

const roomId = 'room_abcdefghij';
const HASH = 'a'.repeat(64);
const now = { '.sv': 'timestamp' };
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'tt-test',
    database: { host: '127.0.0.1', port: 9000, rules: readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8') }
  });
});
after(() => env.cleanup());

const db = (uid) => env.authenticatedContext(uid).database();

async function seed() {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.database();
    for (const uid of ['owner', 'a', 'b', 'c', 'd', 'e', 'f', 'mallory']) {
      await d.ref(`users/${uid}`).set({ displayName: uid, createdAt: Date.now() });
    }
  });
  await assertSucceeds(db('owner').ref().update({
    [`rooms/${roomId}`]: {
      name: 'Test', ownerUid: 'owner', status: 'open', inviteCodeHash: HASH, createdAt: now, updatedAt: now,
      invite: { code: 'ABCDEFGHJK' },
      members: { owner: { role: 'owner', slot: '0', joinedAt: now, displayName: 'Owner' } },
      slots: { 0: 'owner' },
      settings: { destinationPolicy: 'owner', updatedAt: now }
    },
    [`inviteCodes/${HASH}`]: { roomId, roomName: 'Test', createdBy: 'owner', status: 'open', expiresAt: Date.now() + 86400000 },
    [`users/owner/rooms/${roomId}`]: { name: 'Test', role: 'owner', joinedAt: now }
  }));
}

const joinUpdate = (uid, slot, hash = HASH) => ({
  [`rooms/${roomId}/slots/${slot}`]: uid,
  [`rooms/${roomId}/members/${uid}`]: { role: 'member', slot: String(slot), joinedAt: now, displayName: uid, inviteHash: hash },
  [`users/${uid}/rooms/${roomId}`]: { name: 'Test', role: 'member', joinedAt: now }
});

beforeEach(seed);

test('non-members cannot read a room or its locations', async () => {
  await assertFails(db('mallory').ref(`rooms/${roomId}`).get());
  await assertFails(db('mallory').ref(`rooms/${roomId}/locations`).get());
  await assertFails(db('mallory').ref('rooms').get());
});

test('joining requires the room\'s current invite hash', async () => {
  await assertFails(db('a').ref().update(joinUpdate('a', 1, 'b'.repeat(64))));
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertSucceeds(db('a').ref(`rooms/${roomId}/members`).get());
});

test('a forged invite entry cannot be used to join', async () => {
  await assertSucceeds(db('mallory').ref(`inviteCodes/${'c'.repeat(64)}`).set({ roomId, roomName: 'x', createdBy: 'mallory', status: 'open', expiresAt: Date.now() + 1e6 }));
  await assertFails(db('mallory').ref().update(joinUpdate('mallory', 1, 'c'.repeat(64))));
});

test('cannot join as someone else, or without claiming the matching slot', async () => {
  await assertFails(db('mallory').ref().update(joinUpdate('a', 1)));
  const noSlot = joinUpdate('a', 1); delete noSlot[`rooms/${roomId}/slots/1`];
  await assertFails(db('a').ref().update(noSlot));
});

test('rooms created before sizes existed (no slotsAllowed) still hold six riders', async () => {
  for (const [i, uid] of ['a', 'b', 'c', 'd', 'e'].entries()) await assertSucceeds(db(uid).ref().update(joinUpdate(uid, i + 1)));
  for (let s = 0; s < 6; s++) await assertFails(db('f').ref().update(joinUpdate('f', s)));
});

test('locations: own only, valid ranges, members only', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  const loc = { latitude: -7.79, longitude: 110.36, accuracy: 12, fixAt: Date.now(), updatedAt: now };
  await assertSucceeds(db('a').ref(`rooms/${roomId}/locations/a`).set(loc));
  await assertFails(db('a').ref(`rooms/${roomId}/locations/owner`).set(loc));
  await assertFails(db('a').ref(`rooms/${roomId}/locations/a`).set({ ...loc, latitude: 91 }));
  await assertFails(db('a').ref(`rooms/${roomId}/locations/a`).set({ ...loc, longitude: -181 }));
  await assertFails(db('mallory').ref(`rooms/${roomId}/locations/mallory`).set(loc));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/locations/a`).get());
});

test('destination: owner by default, members only when policy allows', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  const dest = { name: 'Malioboro', latitude: -7.79, longitude: 110.36, source: 'geocoding', updatedAt: now };
  await assertFails(db('a').ref(`rooms/${roomId}/destination`).set({ ...dest, updatedBy: 'a' }));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/destination`).set({ ...dest, updatedBy: 'owner' }));
  await assertFails(db('owner').ref(`rooms/${roomId}/destination`).set({ ...dest, latitude: 100, updatedBy: 'owner' }));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/settings/destinationPolicy`).set('members'));
  await assertSucceeds(db('a').ref(`rooms/${roomId}/destination`).set({ ...dest, name: 'Kawah Putih', updatedBy: 'a' }));
});

test('settings: owner only, Discord links restricted to discord domains', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertFails(db('a').ref(`rooms/${roomId}/settings/discordInviteUrl`).set('https://discord.gg/abc'));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/settings/discordInviteUrl`).set('https://discord.gg/abc'));
  await assertFails(db('owner').ref(`rooms/${roomId}/settings/discordInviteUrl`).set('https://evil.example/abc'));
  await assertFails(db('owner').ref(`rooms/${roomId}/settings/discordInviteUrl`).set('http://discord.gg/abc'));
});

test('owner can remove a rider, who is then locked out and cannot rejoin', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertFails(db('a').ref().update({ [`rooms/${roomId}/members/owner`]: null }));
  await assertSucceeds(db('owner').ref().update({
    [`rooms/${roomId}/members/a`]: null, [`rooms/${roomId}/slots/1`]: null,
    [`rooms/${roomId}/banned/a`]: { name: 'a', at: now }
  }));
  await assertFails(db('a').ref(`rooms/${roomId}/members`).get());
  await assertFails(db('a').ref().update(joinUpdate('a', 1)));
});

test('members can leave, the owner cannot', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertSucceeds(db('a').ref().update({ [`rooms/${roomId}/members/a`]: null, [`rooms/${roomId}/slots/1`]: null }));
  await assertFails(db('owner').ref().update({ [`rooms/${roomId}/members/owner`]: null, [`rooms/${roomId}/slots/0`]: null }));
});

test('only the owner can delete the room; closed rooms refuse joins and location writes', async () => {
  await assertFails(db('mallory').ref(`rooms/${roomId}`).remove());
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/status`).set('closed'));
  await assertFails(db('b').ref().update(joinUpdate('b', 2)));
  await assertFails(db('a').ref(`rooms/${roomId}/locations/a`).set({ latitude: 1, longitude: 1, accuracy: 5, fixAt: Date.now(), updatedAt: now }));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}`).remove());
});

test('users can only read and write their own profile', async () => {
  await assertSucceeds(db('a').ref('users/a').get());
  await assertFails(db('a').ref('users/b').get());
  await assertFails(db('a').ref('users/b/displayName').set('hacked'));
});

test('a new room can only contain its creator (no pre-filled members or slots)', async () => {
  const base = (extra) => ({
    name: 'X', ownerUid: 'a', status: 'open', inviteCodeHash: 'd'.repeat(64), createdAt: now, updatedAt: now,
    members: { a: { role: 'owner', slot: '0', joinedAt: now, displayName: 'A' }, ...(extra.members || {}) },
    slots: { 0: 'a', ...(extra.slots || {}) }
  });
  await assertSucceeds(db('a').ref('rooms/room_creator_ok1').set(base({})));
  await assertFails(db('a').ref('rooms/room_creator_bad1').set(base({ members: { b: { role: 'member', slot: '1', joinedAt: now, displayName: 'B' } } })));
  await assertFails(db('a').ref('rooms/room_creator_bad2').set(base({ slots: { 1: 'b' } })));
});

/* ---- room size chosen by the owner (2 to 30) ---- */
const bigRoom = (id, hash, cap, extra = {}) => ({
  [`rooms/${id}`]: {
    name: 'Big', ownerUid: 'owner', status: 'open', inviteCodeHash: hash, createdAt: now, updatedAt: now,
    capacity: cap, slotsAllowed: Object.fromEntries(Array.from({ length: cap }, (_, i) => [i, true])),
    members: { owner: { role: 'owner', slot: '0', joinedAt: now, displayName: 'Owner' } }, slots: { 0: 'owner' }, ...extra
  },
  [`inviteCodes/${hash}`]: { roomId: id, roomName: 'Big', createdBy: 'owner', status: 'open', expiresAt: Date.now() + 86400000, capacity: cap },
  [`users/owner/rooms/${id}`]: { name: 'Big', role: 'owner', joinedAt: now }
});

test('a 10-rider room takes ten, refuses the eleventh, and refuses slots outside its set', async () => {
  const big = 'room_bigroomxx1'; const H = 'b'.repeat(64);
  const uids = Array.from({ length: 12 }, (_, i) => `u${i}`);
  await env.withSecurityRulesDisabled(async (ctx) => { for (const u of uids) await ctx.database().ref(`users/${u}`).set({ displayName: u, createdAt: Date.now() }); });
  await assertSucceeds(db('owner').ref().update(bigRoom(big, H, 10)));
  const join = (uid, slot) => ({
    [`rooms/${big}/slots/${slot}`]: uid,
    [`rooms/${big}/members/${uid}`]: { role: 'member', slot: String(slot), joinedAt: now, displayName: uid, inviteHash: H },
    [`users/${uid}/rooms/${big}`]: { name: 'Big', role: 'member', joinedAt: now }
  });
  for (let i = 1; i < 10; i++) await assertSucceeds(db(`u${i}`).ref().update(join(`u${i}`, i)));
  for (let s = 0; s < 10; s++) await assertFails(db('u10').ref().update(join('u10', s)));   // every slot taken
  await assertFails(db('u10').ref().update(join('u10', 10)));                               // outside the room's slots
  await assertFails(db('u11').ref().update(join('u11', 29)));
});

test('a 30-rider room can use slot 29', async () => {
  const big = 'room_bigroomxx2'; const H = 'c'.repeat(64);
  await assertSucceeds(db('owner').ref().update(bigRoom(big, H, 30)));
  await assertSucceeds(db('a').ref().update({
    [`rooms/${big}/slots/29`]: 'a',
    [`rooms/${big}/members/a`]: { role: 'member', slot: '29', joinedAt: now, displayName: 'a', inviteHash: H },
    [`users/a/rooms/${big}`]: { name: 'Big', role: 'member', joinedAt: now }
  }));
});

test('room size must be 2 to 30 and cannot change afterwards', async () => {
  await assertFails(db('owner').ref().update(bigRoom('room_bigroomxx3', 'd'.repeat(64), 1)));
  await assertFails(db('owner').ref().update(bigRoom('room_bigroomxx4', 'e'.repeat(64), 31)));
  await assertFails(db('owner').ref(`rooms/${roomId}/capacity`).set(30));
  await assertFails(db('owner').ref(`rooms/${roomId}/slotsAllowed/6`).set(true));
  await assertFails(db('a').ref(`rooms/${roomId}/slotsAllowed/6`).set(true));
});

/* ---- voice signalling fallback (only used when Supabase is not configured) ---- */
const sig = (extra = {}) => ({ t: 'offer', sid: 'abcdefgh1234', d: '{"type":"offer","sdp":"v=0"}', at: now, ...extra });

test('voice: members signal each other; outsiders and spoofers cannot', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  const p = (to, from) => `rooms/${roomId}/rtc/${to}/${from}/-Nmsg1`;
  await assertSucceeds(db('a').ref(p('owner', 'a')).set(sig()));
  await assertFails(db('a').ref(p('owner', 'owner')).set(sig()));            // cannot write as someone else
  await assertFails(db('mallory').ref(p('owner', 'mallory')).set(sig()));    // not a member
  await assertFails(db('a').ref(p('mallory', 'a')).set(sig()));              // target is not a member
  await assertFails(db('a').ref(p('owner', 'a') + 'x').set(sig({ t: 'evil' })));
  await assertFails(db('a').ref(p('owner', 'a') + 'y').set(sig({ d: 'x'.repeat(8001) })));
  await assertFails(db('a').ref(p('owner', 'a') + 'z').set(sig({ extra: 1 })));
});

test('voice: the recipient (or sender) may delete a message; others may not', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  const path = `rooms/${roomId}/rtc/owner/a/-Nmsg2`;
  await assertSucceeds(db('a').ref(path).set(sig()));
  await assertFails(db('mallory').ref(path).remove());
  await assertSucceeds(db('owner').ref(path).remove());
});

test('voice: talking flag is writable only by that member for themselves', async () => {
  await assertSucceeds(db('a').ref().update(joinUpdate('a', 1)));
  await assertSucceeds(db('a').ref(`rooms/${roomId}/voice/a`).set({ talking: true, at: now }));
  await assertFails(db('a').ref(`rooms/${roomId}/voice/owner`).set({ talking: true, at: now }));
  await assertFails(db('mallory').ref(`rooms/${roomId}/voice/mallory`).set({ talking: true, at: now }));
  await assertFails(db('a').ref(`rooms/${roomId}/voice/a`).set({ talking: false, at: now }));
  await assertSucceeds(db('owner').ref(`rooms/${roomId}/voice/a`).get());
});
