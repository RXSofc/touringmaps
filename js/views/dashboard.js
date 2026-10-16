import { h, icon, toast, withBusy, mountInto, clear, avatarImg, confirmDialog, formatDate } from '../ui.js';
import { getUser, logout } from '../auth.js';
import { ensureProfile } from '../profile.js';
import {
  createRoom, previewInvite, joinRoom, listMyRooms, forgetRoomEntry, canAccessRoom,
  leaveRoomById, normalizeCode
} from '../rooms.js';
import { validateDiscordUrl } from '../discord.js';
import { onConnectionChange } from '../presence.js';
import { navigate } from '../router.js';
import { APP } from '../config.js';

export function dashboardView() {
  let offConn = null;
  let alive = true;

  return {
    async mount(root) {
      const user = getUser();
      mountInto(root, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Loading…'));

      let profile;
      try { profile = await ensureProfile(user); }
      catch (err) {
        console.error(err);
        mountInto(root, h('div', { class: 'auth-shell' }, h('div', { class: 'card' },
          h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('div', { class: 'banner__body' }, 'Could not load your profile. Check your connection.')),
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => navigate('/dashboard') }, 'Retry'))));
        return;
      }
      if (!alive) return;

      const connChip = h('span', { class: 'chip chip--muted', role: 'status' }, h('span', { class: 'dot' }), 'Connecting');
      offConn = onConnectionChange((up) => {
        connChip.className = `chip ${up ? 'chip--success' : 'chip--warning'}`;
        mountInto(connChip, h('span', { class: `dot ${up ? 'dot--live' : 'dot--stale'}` }), up ? 'Online' : 'Offline');
      });

      const roomsBox = h('div', { class: 'card', 'aria-labelledby': 'rooms-title' });
      const join = joinCard();
      const create = createCard(profile);

      mountInto(root, h('div', { class: 'page' },
        h('header', { class: 'page__head' },
          h('div', { class: 'page__brand' }, icon('pin'), h('span', {}, 'VEXLANE')),
          h('div', { class: 'page__actions' },
            connChip,
            h('a', { class: 'btn btn--sm', href: '#/profile', 'aria-label': 'Profile and account' }, icon('user'), h('span', { class: 'hide-sm' }, 'Profile')),
            h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'aria-label': 'Sign out', onclick: async (e) => {
              await withBusy(e.currentTarget, () => logout().catch((err) => toast(err.message, { type: 'error' })));
            } }, icon('logout')))),
        h('section', { class: 'welcome panel' },
          avatarImg(profile, user.uid, 'avatar avatar--lg'),
          h('div', {},
            h('p', { class: 'tag' }, 'Welcome back'),
            h('h1', {}, profile.displayName || 'Rider'),
            h('p', { class: 'muted' }, profile.motorcycle ? `Riding: ${profile.motorcycle}` : 'Set your bike in your profile.'))),
        h('div', { class: 'grid-2' }, create, join),
        roomsBox));

      await renderRooms(roomsBox, user.uid);
    },

    unmount() {
      alive = false;
      if (offConn) offConn();
    }
  };
}

/* ----------------------------------------------------------- Create room */

function createCard(profile) {
  const user = getUser();
  const name = h('input', { class: 'input', id: 'room-name', maxlength: APP.limits.roomName, placeholder: 'Sunday ride to Kawah Putih', autocomplete: 'off' });
  const discord = h('input', { class: 'input', id: 'room-discord', type: 'url', inputmode: 'url', placeholder: 'https://discord.gg/yourInvite', autocomplete: 'off' });
  const discordMsg = h('div', { class: 'field__hint', id: 'room-discord-msg' }, 'Optional. You can add it later.');
  const error = h('div', { class: 'banner banner--danger', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('plus'), 'Create room');

  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    const url = discord.value.trim();
    if (url) {
      const v = validateDiscordUrl(url);
      if (!v.ok) { discordMsg.className = 'field__error'; discordMsg.textContent = v.error; discord.setAttribute('aria-invalid', 'true'); return; }
    }
    discordMsg.className = 'field__hint'; discordMsg.textContent = 'Optional. You can add it later.'; discord.removeAttribute('aria-invalid');
    try {
      const { roomId } = await withBusy(submit, () => createRoom({ uid: user.uid, profile, name: name.value, discordUrl: url }));
      try { sessionStorage.setItem('tt.justCreated', roomId); } catch { /* storage may be blocked */ }
      navigate(`/room/${roomId}`);
    } catch (err) {
      error.textContent = err.message || 'Could not create the room.';
      error.hidden = false;
    }
  } },
  error,
  h('div', { class: 'field' }, h('label', { for: 'room-name' }, 'Room name'), name),
  h('div', { class: 'field' }, h('label', { for: 'room-discord' }, 'Discord voice link'), discord, discordMsg),
  submit);

  return h('section', { class: 'card', 'aria-labelledby': 'create-title' },
    h('h2', { class: 'card__title', id: 'create-title' }, icon('flag'), 'Create a touring room'),
    h('p', { class: 'muted small' }, `Private. Up to ${APP.limits.maxMembers} riders, joined only with your invite code.`),
    form);
}

/* ------------------------------------------------------------- Join room */

function joinCard() {
  const user = getUser();
  const input = h('input', { class: 'input input--mono input--code', id: 'join-code', placeholder: 'XXXXX-XXXXX', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: 12, inputmode: 'text', 'aria-describedby': 'join-msg' });
  const msg = h('div', { class: 'field__hint', id: 'join-msg' }, 'Ask the room owner for the code.');
  const result = h('div', { 'aria-live': 'polite' });
  const check = h('button', { class: 'btn btn--accent btn--block', type: 'submit' }, icon('search'), 'Check code');

  input.addEventListener('input', () => {
    const code = normalizeCode(input.value).slice(0, APP.invite.length);
    input.value = code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
    clear(result);
  });

  const setError = (text) => { msg.className = 'field__error'; msg.textContent = text; input.setAttribute('aria-invalid', 'true'); };
  const resetMsg = () => { msg.className = 'field__hint'; msg.textContent = 'Ask the room owner for the code.'; input.removeAttribute('aria-invalid'); };

  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    clear(result); resetMsg();
    let preview;
    try { preview = await withBusy(check, () => previewInvite(input.value)); }
    catch (err) { setError(err.message); return; }

    const confirm = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, 'Join this room');
    confirm.addEventListener('click', async () => {
      try {
        const profile = await ensureProfile(user);
        const roomId = await withBusy(confirm, () => joinRoom(preview, { uid: user.uid, profile }));
        navigate(`/room/${roomId}`);
      } catch (err) { setError(err.message); clear(result); }
    });
    mountInto(result, h('div', { class: 'preview' },
      h('p', { class: 'tag' }, 'Room found'),
      h('h3', {}, preview.roomName),
      h('p', { class: 'muted small' }, `Invite valid until ${formatDate(preview.expiresAt)}`),
      confirm));
  } },
  h('div', { class: 'field' }, h('label', { for: 'join-code' }, 'Invite code'), input, msg),
  check, result);

  return h('section', { class: 'card', 'aria-labelledby': 'join-title' },
    h('h2', { class: 'card__title', id: 'join-title' }, icon('users'), 'Join a room'),
    form);
}

/* ------------------------------------------------------- Recent / current */

async function renderRooms(box, uid) {
  mountInto(box, h('h2', { class: 'card__title' }, icon('route'), 'Your rooms'), h('div', { class: 'boot' }, h('span', { class: 'spinner' })));
  let data;
  try { data = await listMyRooms(uid); }
  catch (err) {
    mountInto(box, h('h2', { class: 'card__title' }, icon('route'), 'Your rooms'),
      h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('div', { class: 'banner__body' }, 'Could not load your rooms.')));
    return;
  }

  // Drop entries for rooms we can no longer access (removed, deleted).
  const checks = await Promise.allSettled(data.rooms.map((r) => canAccessRoom(r.id, uid)));
  const rooms = [];
  for (let i = 0; i < data.rooms.length; i += 1) {
    const ok = checks[i].status === 'fulfilled' ? checks[i].value : true; // network error: keep it
    if (ok) rooms.push(data.rooms[i]);
    else forgetRoomEntry(uid, data.rooms[i].id).catch(() => {});
  }

  const current = rooms.find((r) => r.id === data.currentRoomId);
  const list = h('ul', { class: 'list' });
  for (const r of rooms) {
    const leaveBtn = r.role === 'owner' ? null : h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'aria-label': `Leave ${r.name}`, onclick: async (e) => {
      const yes = await confirmDialog({ title: 'Leave room?', message: `You will stop sharing your location with “${r.name}” and need a new invite to return.`, confirmLabel: 'Leave', danger: true });
      if (!yes) return;
      try {
        await withBusy(e.currentTarget, () => leaveRoomById(r.id, uid));
        toast('You left the room.', { type: 'success' });
        renderRooms(box, uid);
      } catch (err) { toast(err.message || 'Could not leave.', { type: 'error' }); }
    } }, 'Leave');
    list.append(h('li', { class: 'row' },
      h('div', { class: 'row__main' },
        h('div', { class: 'row__title' }, r.name, ' ', r.role === 'owner' ? h('span', { class: 'chip chip--info' }, 'Owner') : null),
        h('div', { class: 'row__sub' }, `Joined ${formatDate(r.joinedAt)}`)),
      leaveBtn,
      h('a', { class: 'btn btn--sm btn--primary', href: `#/room/${r.id}` }, 'Open')));
  }

  mountInto(box,
    h('h2', { class: 'card__title', id: 'rooms-title' }, icon('route'), 'Your rooms'),
    current ? h('div', { class: 'banner banner--success current-room' }, icon('pin'),
      h('div', { class: 'banner__body' }, h('strong', {}, 'Current room: '), current.name),
      h('a', { class: 'btn btn--sm btn--primary', href: `#/room/${current.id}` }, 'Resume')) : null,
    rooms.length ? list : h('div', { class: 'empty' }, 'No rooms yet. Create one or join with a code.'));
}
