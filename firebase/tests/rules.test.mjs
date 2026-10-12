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

test('capacity is six riders', async () => {
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
