# Firebase setup & security model

## Deploy the rules

- **Console:** Realtime Database → Rules → paste `database.rules.json` → Publish.
- **CLI:** `firebase deploy --only database` (uses `../firebase.json`).

Use *Realtime Database*, not Firestore. Storage is **not** used (avatars are small data URLs).

## Data model

```
users/{uid}                    displayName, avatarUrl?, motorcycle?, createdAt, updatedAt, currentRoomId?
users/{uid}/rooms/{roomId}     name, role, joinedAt          (my "recent rooms" shortcut)

inviteCodes/{sha256(code)}     roomId, roomName, createdBy, status, expiresAt   (lookup only)

rooms/{roomId}
  name, ownerUid, status (open|closed), inviteCodeHash, createdAt, updatedAt
  invite/code                  plain code, readable by members so they can share it
  slots/{0..5}                 uid          ← capacity: exactly six keys exist
  members/{uid}                role, slot, joinedAt, displayName, avatarUrl?, motorcycle?, inviteHash?
  locations/{uid}              latitude, longitude, accuracy, heading?, speed?, fixAt, updatedAt
  presence/{uid}               connected, lastSeen
  destination                  name, address?, latitude, longitude, source, updatedAt, updatedBy
  settings                     discordInviteUrl?, destinationPolicy (owner|members), updatedAt
  banned/{uid}                 name, at
  voice/{uid}                  talking, at          (fallback signalling only)
  rtc/{to}/{from}/{msg}        t, sid, d, at        (fallback signalling only; deleted once read)
```

Email addresses are never copied into the database; other riders see only name, avatar and bike.

## How the rules enforce the product

| Requirement | Mechanism |
|---|---|
| Authenticated access only | Root is closed; every rule starts with `auth != null`. |
| Private rooms | `rooms/$roomId` is readable only if `members/{auth.uid}` exists. Guessing a room id grants nothing; `rooms` cannot be listed. |
| Join only with a valid code | A member record must carry `inviteHash` equal to the room's `inviteCodeHash`, and `inviteCodes/{hash}/expiresAt` must be in the future. Forged `inviteCodes` entries fail because the check is against the *room's* hash. |
| Max six members | Joining must claim one of six `slots/{0-5}` in the same atomic update; the slot must be free and match the member's `slot`. A 7th rider cannot find a free slot. |
| Locations / presence | Writable only by that member for their own uid, only while a member (locations also only while the room is `open`); lat/lng/accuracy range-validated; `fixAt` cannot be in the future. |
| Destination | Owner, or any member when `settings/destinationPolicy` is `members`; coordinates validated; `updatedBy` must be the writer. |
| Settings | Owner only. `discordInviteUrl` must match `https://discord.gg|discord.com|discordapp.com/…`. |
| Remove / leave | Owner can remove others (and ban); members can remove themselves; the owner cannot leave (must delete or close). |
| Delete room | Owner only. |

### Known limits of Realtime Database rules

- Rules cannot count children or rate-limit; capacity uses slots, abuse control needs **App Check**.
- Members can see the invite code and each other's `inviteHash`; this is intentional (they already belong), and the owner can rotate the code.
- A malicious but *authenticated* user can create junk `inviteCodes` entries (they cannot use them to enter rooms). Periodically clean up if this matters.
- Expiry compares to server `now` at write time; an old member record is not retroactively invalidated when a code expires.

## Test the rules

Needs Java and Node. These tests were written with the rules but **have not been run yet**; run them before launch:

```bash
cd firebase/tests
npm install
npm test        # starts the database emulator and runs rules.test.mjs
```
