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

// ---- quick messages: one slot per rider, fixed kinds, members only, rate-limited by the rules
{ let db = withProfile(withProfile(apply({}, createOps({ cap: 6 })), B), C);
  db = apply(db, joinOps(B, 1));
  const sig = (uid, v) => [{ path: ['rooms', ROOM, 'signals', uid], value: v }];
  const t = Date.now();
  assert.ok(check(db, sig(B, { k: 'stop', at: t }), { uid: B }).ok, 'a member can send a quick message');
  assert.ok(check(db, sig(U, { k: 'fuel', at: t }), { uid: U }).ok, 'the owner too');
  assert.ok(!check(db, sig(B, { k: 'insult', at: t }), { uid: B }).ok, 'only the fixed kinds are accepted');
  assert.ok(!check(db, sig(B, { k: 'stop', at: t, text: 'hi' }), { uid: B }).ok, 'no extra fields (no free text)');
  assert.ok(!check(db, sig(B, { k: 'stop' }), { uid: B }).ok, 'at is required');
  assert.ok(!check(db, sig(B, { k: 'stop', at: t + 60000 }), { uid: B }).ok, 'a time in the future is refused');
  assert.ok(!check(db, sig(B, { k: 'stop', at: 'now' }), { uid: B }).ok, 'at must be a number');
  assert.ok(!check(db, sig(B, { k: 'stop', at: t }), { uid: C }).ok, 'cannot write to someone else\'s slot');
  assert.ok(!check(db, sig(C, { k: 'stop', at: t }), { uid: C }).ok, 'a non-member cannot send');
  const sent = apply(db, sig(B, { k: 'stop', at: t - 10000 }));
  assert.ok(check(sent, sig(B, { k: 'go', at: t }), { uid: B }).ok, 'sending again after a pause is fine');
  assert.ok(!check(sent, sig(B, { k: 'go', at: t - 9000 }), { uid: B }).ok, 'sending again within 2 seconds is refused (spam backstop)');
  assert.ok(check(sent, sig(B, null), { uid: B }).ok, 'a rider can clear their own message');
  const closed = apply(db, [{ path: ['rooms', ROOM, 'status'], value: 'closed' }]);
  assert.ok(!check(closed, sig(B, { k: 'stop', at: t }), { uid: B }).ok, 'closed rooms accept no messages');
  const fresh = createOps({ cap: 6 }); fresh[0].value.signals = { [U]: { k: 'stop', at: t } };
  assert.ok(!check({}, fresh, { uid: U }).ok, 'a new room cannot be created with messages already inside'); }
ok('quick message rules: members only, fixed kinds, no free text, own slot, 2 s gap, open rooms');
// ---- stops on the way (destination.via)
{ let db = withProfile(withProfile(apply({}, createOps({ cap: 6 })), B), C);
  db = apply(db, joinOps(B, 1));
  const dest = { name: 'Jogja', latitude: -7.79, longitude: 110.36, source: 'map', updatedAt: now, updatedBy: U };
  db = apply(db, [{ path: ['rooms', ROOM, 'destination'], value: dest }]);
  const viaOps = (uid, via, extra = {}) => [
    { path: ['rooms', ROOM, 'destination', 'via'], value: via },
    { path: ['rooms', ROOM, 'destination', 'updatedAt'], value: extra.at ?? now + 1 },
    { path: ['rooms', ROOM, 'destination', 'updatedBy'], value: extra.by ?? uid }
  ];
  const P = (la, ln, more = {}) => ({ latitude: la, longitude: ln, ...more });
  assert.ok(check(db, viaOps(U, { 0: P(-6.9, 107.6) }), { uid: U }).ok, 'owner sets one stop');
  assert.ok(check(db, viaOps(U, { 0: P(-6.9, 107.6), 1: P(-7.2, 109), 2: P(-7.5, 110) }), { uid: U }).ok, 'owner sets three stops');
  assert.ok(!check(db, viaOps(U, { 0: P(-6.9, 107.6), 1: P(-7.2, 109), 2: P(-7.5, 110), 3: P(-7.6, 110.1) }), { uid: U }).ok, 'a 4th stop is refused'); 
  assert.ok(!check(db, viaOps(U, { 0: P(99, 107.6) }), { uid: U }).ok, 'latitude out of range is refused');
  assert.ok(!check(db, viaOps(U, { 0: P(-6.9, 181) }), { uid: U }).ok, 'longitude out of range is refused');
  assert.ok(!check(db, viaOps(U, { 0: P(-6.9, 107.6, { note: 'x' }) }), { uid: U }).ok, 'extra fields on a stop are refused');
  assert.ok(!check(db, viaOps(U, { 0: { latitude: -6.9 } }), { uid: U }).ok, 'a stop needs both coordinates');
  assert.ok(!check(db, viaOps(U, { x: P(-6.9, 107.6) }), { uid: U }).ok, 'stop keys must be 0..2');
  assert.ok(!check(db, viaOps(U, { 0: P(-6.9, 107.6) }, { by: B }), { uid: U }).ok, 'updatedBy must be the writer');
  assert.ok(!check(db, viaOps(B, { 0: P(-6.9, 107.6) }), { uid: B }).ok, 'a plain member cannot set stops while only the owner edits the destination');
  const open = apply(db, [{ path: ['rooms', ROOM, 'settings', 'destinationPolicy'], value: 'members' }]);
  assert.ok(check(open, viaOps(B, { 0: P(-6.9, 107.6) }), { uid: B }).ok, 'a member can when the room lets members set the destination');
  assert.ok(!check(db, viaOps(C, { 0: P(-6.9, 107.6) }), { uid: C }).ok, 'a non-member can never');
  const withVia = apply(db, viaOps(U, { 0: P(-6.9, 107.6) }));
  assert.ok(check(withVia, [{ path: ['rooms', ROOM, 'destination', 'via'], value: null }, { path: ['rooms', ROOM, 'destination', 'updatedAt'], value: now + 2 }, { path: ['rooms', ROOM, 'destination', 'updatedBy'], value: U }], { uid: U }).ok, 'the stops can be removed again');
  assert.ok(check(withVia, [{ path: ['rooms', ROOM, 'destination'], value: { ...dest, name: 'Lain', updatedAt: now + 3 } }], { uid: U }).ok, 'saving a new destination (without stops) replaces the old record'); }
ok('destination stops: max 3, valid coordinates only, keys 0..2, same permission as the destination itself');
console.log(`\n${n} passed`);
