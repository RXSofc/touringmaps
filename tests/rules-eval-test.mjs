import assert from 'node:assert';
import { check, apply, RULES } from './rules-eval.mjs';
let n = 0; const ok = (m) => console.log('PASS', m, ++n);
const HASH = 'a'.repeat(64), HASH2 = 'b'.repeat(64);
const U = 'ownerUid0000000000000000001', B = 'riderB000000000000000000002', C = 'riderC000000000000000000003';
const ROOM = '-Oabcdefghij1234567';
const now = Date.now();
const member = (role, slot, extra = {}) => ({ role, slot, joinedAt: now, displayName: 'Rider', ...extra });

function createOps({ uid = U, cap, legacy = false, roomId = ROOM, hash = HASH }) {
  const room = {
    name: 'test', ownerUid: uid, status: 'open', inviteCodeHash: hash, createdAt: now, updatedAt: now, invite: { code: 'ABCDEFGH23' },
    members: { [uid]: member('owner', '0') }, slots: { 0: uid }, settings: { destinationPolicy: 'owner', updatedAt: now }
  };
  const invite = { roomId, roomName: 'test', createdBy: uid, status: 'open', expiresAt: now + 86400000 };
  if (!legacy) { room.capacity = cap; room.slotsAllowed = Object.fromEntries(Array.from({ length: cap }, (_, i) => [String(i), true])); invite.capacity = cap; }
  return [
    { path: ['rooms', roomId], value: room }, { path: ['inviteCodes', hash], value: invite },
    { path: ['users', uid, 'rooms', roomId], value: { name: 'test', role: 'owner', joinedAt: now } }, { path: ['users', uid, 'currentRoomId'], value: roomId }
  ];
}
const joinOps = (uid, slot, hash = HASH) => [
  { path: ['rooms', ROOM, 'slots', String(slot)], value: uid },
  { path: ['rooms', ROOM, 'members', uid], value: member('member', String(slot), { inviteHash: hash }) },
  { path: ['users', uid, 'rooms', ROOM], value: { name: 'test', role: 'member', joinedAt: now } }, { path: ['users', uid, 'currentRoomId'], value: ROOM }
];
const withProfile = (root, uid) => apply(root, [{ path: ['users', uid], value: { displayName: 'X', createdAt: now } }]);
const show = (r) => (r.ok ? 'allowed' : r.why);

// ---- creating a room with the current app (capacity fields) against the CURRENT rules file
for (const cap of [2, 6, 7, 12, 30]) {
  const r = check({}, createOps({ cap }), { uid: U }); assert.ok(r.ok, `create cap ${cap}: ${show(r)}`);
}
ok('create room with capacity 2, 6, 7, 12 and 30 is allowed');
for (const cap of [1, 31, 99]) assert.ok(!check({}, createOps({ cap }), { uid: U }).ok, `cap ${cap} must be refused`);
ok('capacity 1, 31 and 99 are refused');
assert.ok(check({}, createOps({ cap: 6, legacy: true }), { uid: U }).ok); ok('legacy rooms (no capacity fields) can still be created');
assert.ok(!check({}, createOps({ cap: 6, uid: B }), { uid: U }).ok); ok('cannot create a room owned by someone else');

// ---- the same app against OLD rules (no capacity / slotsAllowed rules): this is what "permission denied" was
const saved = structuredClone(RULES);
delete RULES.rooms.$roomId.capacity; delete RULES.rooms.$roomId.slotsAllowed; delete RULES.inviteCodes.$hash.capacity;
const old = check({}, createOps({ cap: 6 }), { uid: U });
assert.ok(!old.ok, 'old rules must reject the new fields'); ok('with the OLD rules the new app is refused: ' + old.why);
assert.ok(check({}, createOps({ cap: 6, legacy: true }), { uid: U }).ok); ok('with the OLD rules a legacy-format room is accepted (what the fallback uses)');
Object.assign(RULES.rooms.$roomId, { capacity: saved.rooms.$roomId.capacity, slotsAllowed: saved.rooms.$roomId.slotsAllowed }); RULES.inviteCodes.$hash.capacity = saved.inviteCodes.$hash.capacity;

// ---- joining
for (const cap of [6, 10]) {
  let db = withProfile(withProfile(apply({}, createOps({ cap })), B), C);
  for (const slot of Array.from({ length: cap - 1 }, (_, i) => i + 1)) {
    const uid = `rider${String(slot).padStart(2, '0')}${'x'.repeat(18)}`; db = withProfile(db, uid);
    const r = check(db, joinOps(uid, slot), { uid }); assert.ok(r.ok, `cap ${cap} slot ${slot}: ${show(r)}`); db = apply(db, joinOps(uid, slot));
  }
  assert.ok(!check(db, joinOps(B, cap), { uid: B }).ok, `slot ${cap} must be refused in a room of ${cap}`);
  assert.ok(!check(db, joinOps(B, 1), { uid: B }).ok, 'a taken slot must be refused');
}
ok('riders can fill slots 1..cap-1 (cap 6 and 10) and slot cap is refused; a taken slot is refused');
{ let db = withProfile(apply({}, createOps({ cap: 6, legacy: true })), B);
  assert.ok(check(db, joinOps(B, 5), { uid: B }).ok); assert.ok(!check(db, joinOps(B, 6), { uid: B }).ok); }
ok('legacy rooms keep slots 0-5 only');
{ const db = withProfile(apply({}, createOps({ cap: 10 })), B);
  const wrongHash = joinOps(B, 1, HASH2); assert.ok(!check(db, wrongHash, { uid: B }).ok); }
ok('joining with a wrong invite hash is refused');
{ const db = withProfile(apply({}, createOps({ cap: 10 })), B);
  assert.ok(check(db, [{ path: ['rooms', ROOM], value: null }], { uid: U }).ok); assert.ok(!check(db, [{ path: ['rooms', ROOM], value: null }], { uid: B }).ok); }
ok('only the owner can delete the room');

// ---- avatars: stills stay small, animated GIFs get a bigger (still bounded) allowance
{ const b64 = (n) => 'A'.repeat(n);
  const set = (url, uid = U) => [{ path: ['users', uid, 'avatarUrl'], value: url }];
  const base = withProfile({}, U);
  assert.ok(check(base, set('https://example.com/me.jpg'), { uid: U }).ok); 
  assert.ok(check(base, set('data:image/jpeg;base64,' + b64(9000)), { uid: U }).ok);
  assert.ok(!check(base, set('data:image/jpeg;base64,' + b64(20000)), { uid: U }).ok, 'a big still must be refused');
  assert.ok(check(base, set('data:image/gif;base64,' + b64(35000)), { uid: U }).ok, 'a GIF up to 40000 chars is allowed');
  assert.ok(!check(base, set('data:image/gif;base64,' + b64(41000)), { uid: U }).ok, 'a GIF over 40000 chars is refused');
  assert.ok(!check(base, set('data:image/svg+xml;base64,' + b64(200)), { uid: U }).ok, 'svg data urls are refused');
  assert.ok(!check(base, set('data:image/gif;base64,<script>'), { uid: U }).ok, 'non-base64 gif is refused');
  // the copy kept in a room the rider belongs to follows the same rule
  const room = apply({}, createOps({ cap: 6 }));
  const mem = (url) => [{ path: ['rooms', ROOM, 'members', U, 'avatarUrl'], value: url }];
  assert.ok(check(room, mem('data:image/gif;base64,' + b64(35000)), { uid: U }).ok, 'member copy: GIF allowed');
  assert.ok(!check(room, mem('data:image/gif;base64,' + b64(41000)), { uid: U }).ok, 'member copy: oversize GIF refused');
  assert.ok(!check(room, mem('data:image/png;base64,' + b64(20000)), { uid: U }).ok, 'member copy: big still refused'); }
ok('avatar rules: stills <= 15000 chars, GIFs <= 40000 chars, nothing else');
console.log(`\n${n} passed`);
