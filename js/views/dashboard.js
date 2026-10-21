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

      const connChip = h('span', { class: 'status', role: 'status' }, h('span', { class: 'status__dot' }), 'Connecting');
      offConn = onConnectionChange((up) => {
        connChip.className = `status ${up ? 'status--up' : 'status--down'}`;
        mountInto(connChip, h('span', { class: 'status__dot' }), up ? 'Online' : 'Offline');
      });

      const roomsBox = h('section', { class: 'dcard dcard--rooms', 'aria-labelledby': 'rooms-title' });
      const join = joinCard();
      const create = createCard(profile);

      mountInto(root, h('div', { class: 'page dash' },
        h('header', { class: 'page__head' },
          h('div', { class: 'page__brand' }, icon('pin'), h('span', {}, 'VEXLANE')),
          h('div', { class: 'page__actions' },
            connChip,
            h('button', { class: 'btn btn--icon btn--sm', type: 'button', 'aria-label': 'Sign out', title: 'Sign out', onclick: async (e) => {
              await withBusy(e.currentTarget, () => logout().catch((err) => toast(err.message, { type: 'error' })));
            } }, icon('logout')))),
        h('section', { class: 'rider', 'aria-label': 'Your rider card' },
          h('a', { class: 'rider__photo', href: '#/profile', 'aria-label': 'Open your profile' },
            avatarImg(profile, user.uid, 'avatar avatar--lg')),
          h('div', { class: 'rider__body' },
            h('p', { class: 'rider__hello' }, 'Welcome back,'),
            h('h1', { class: `rider__name${(profile.displayName || '').length > 12 ? ' rider__name--long' : ''}` }, profile.displayName || 'Rider'),
            profile.motorcycle
              ? h('p', { class: 'rider__bike' }, h('span', { class: 'plate', title: 'Your motorcycle' }, profile.motorcycle))
              : h('p', { class: 'rider__bike' }, h('a', { class: 'plate plate--empty', href: '#/profile' }, 'Add your bike')),
            h('a', { class: 'rider__edit', href: '#/profile' }, 'Profile and account', icon('arrow-right'))),
          h('span', { class: 'rider__flag', 'aria-hidden': 'true' })),
        roomsBox,
        h('div', { class: 'grid-2' }, create, join)));

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
  const size = h('input', { class: 'input stepper__input', id: 'room-size', type: 'number', inputmode: 'numeric', min: APP.limits.minRoomMembers, max: APP.limits.maxRoomMembers, step: 1, value: APP.limits.defaultMembers, autocomplete: 'off', 'aria-describedby': 'room-size-msg' });
  const sizeMsg = h('div', { class: 'field__hint', id: 'room-size-msg' });
  const sizeHint = () => {
    const n = Math.trunc(Number(size.value));
    const bad = !Number.isFinite(n) || n < APP.limits.minRoomMembers || n > APP.limits.maxRoomMembers;
    sizeMsg.className = bad ? 'field__error' : 'field__hint';
    sizeMsg.textContent = bad
      ? `Choose a number from ${APP.limits.minRoomMembers} to ${APP.limits.maxRoomMembers}.`
      : n > 12 ? 'Large room: every position goes to everyone, so it uses a lot more data. The size cannot be changed later.'
      : 'How many riders can join. It cannot be changed later.';
    if (bad) size.setAttribute('aria-invalid', 'true'); else size.removeAttribute('aria-invalid');
    return bad ? null : n;
  };
  size.addEventListener('input', sizeHint);
  sizeHint();
  const bump = (d) => {
    const n = Math.trunc(Number(size.value));
    const base = Number.isFinite(n) ? n : APP.limits.defaultMembers;
    size.value = Math.min(APP.limits.maxRoomMembers, Math.max(APP.limits.minRoomMembers, base + d));
    sizeHint();
  };
  const stepper = h('div', { class: 'stepper' },
    h('button', { class: 'btn stepper__btn', type: 'button', 'aria-label': 'Fewer riders', onclick: () => bump(-1) }, icon('minus')),
    size,
    h('button', { class: 'btn stepper__btn', type: 'button', 'aria-label': 'More riders', onclick: () => bump(1) }, icon('plus')));
  const error = h('div', { class: 'banner banner--danger', role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('plus'), 'Create room');

  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    const capacity = sizeHint();
    if (capacity === null) { size.focus(); return; }
    const url = discord.value.trim();
    if (url) {
      const v = validateDiscordUrl(url);
      if (!v.ok) { discordMsg.className = 'field__error'; discordMsg.textContent = v.error; discord.setAttribute('aria-invalid', 'true'); return; }
    }
    discordMsg.className = 'field__hint'; discordMsg.textContent = 'Optional. You can add it later.'; discord.removeAttribute('aria-invalid');
    try {
      const { roomId, legacyRules } = await withBusy(submit, () => createRoom({ uid: user.uid, profile, name: name.value, discordUrl: url, capacity }));
      try { sessionStorage.setItem('tt.justCreated', roomId); if (legacyRules) sessionStorage.setItem('tt.rulesOld', '1'); } catch { /* storage may be blocked */ }
      navigate(`/room/${roomId}`);
    } catch (err) {
      error.textContent = err.message || 'Could not create the room.';
      error.hidden = false;
    }
  } },
  error,
  h('div', { class: 'field' }, h('label', { for: 'room-name' }, 'Room name'), name),
  h('div', { class: 'field' }, h('label', { for: 'room-size' }, 'Maximum riders'), stepper, sizeMsg),
  h('div', { class: 'field' }, h('label', { for: 'room-discord' }, 'Discord voice link'), discord, discordMsg),
  submit);

  return h('section', { class: 'dcard', 'aria-labelledby': 'create-title' },
    h('header', { class: 'dcard__head' }, icon('flag'), h('h2', { id: 'create-title' }, 'Create a touring room')),
    h('div', { class: 'dcard__body' },
      h('p', { class: 'dcard__lead' }, `Private. Up to ${APP.limits.maxRoomMembers} riders, joined only with your invite code.`),
      form));
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
      h('p', { class: 'muted small' }, `Up to ${preview.capacity} riders. Invite valid until ${formatDate(preview.expiresAt)}`),
      confirm));
  } },
  h('div', { class: 'field' }, h('label', { for: 'join-code' }, 'Invite code'), input, msg),
  check, result);

  return h('section', { class: 'dcard', 'aria-labelledby': 'join-title' },
    h('header', { class: 'dcard__head' }, icon('users'), h('h2', { id: 'join-title' }, 'Join a room')),
    h('div', { class: 'dcard__body' },
      h('p', { class: 'dcard__lead' }, 'Got a code from the owner? Enter it to see the room first.'),
      form));
}

/* ------------------------------------------------------- Recent / current */

async function renderRooms(box, uid) {
  mountInto(box, h('header', { class: 'dcard__head' }, icon('route'), h('h2', { id: 'rooms-title' }, 'Your rooms')), h('div', { class: 'dcard__body' }, h('div', { class: 'boot' }, h('span', { class: 'spinner' }))));
  let data;
  try { data = await listMyRooms(uid); }
  catch (err) {
    mountInto(box, h('header', { class: 'dcard__head' }, icon('route'), h('h2', { id: 'rooms-title' }, 'Your rooms')),
      h('div', { class: 'dcard__body' }, h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('div', { class: 'banner__body' }, 'Could not load your rooms.'))));
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

  rooms.sort((x, y) => (y.id === data.currentRoomId) - (x.id === data.currentRoomId));
  box.classList.toggle('dcard--empty', !rooms.length);
  const head = h('header', { class: 'dcard__head' }, icon('route'), h('h2', { id: 'rooms-title' }, 'Your rooms'),
    rooms.length ? h('span', { class: 'dcard__count' }, String(rooms.length)) : null);
  const list = h('ul', { class: 'tickets' });
  for (const r of rooms) {
    const isCurrent = r.id === data.currentRoomId;
    const leaveBtn = r.role === 'owner' ? null : h('button', { class: 'btn btn--sm btn--ghost', type: 'button', 'aria-label': `Leave ${r.name}`, onclick: async (e) => {
      const yes = await confirmDialog({ title: 'Leave room?', message: `You will stop sharing your location with “${r.name}” and need a new invite to return.`, confirmLabel: 'Leave', danger: true });
      if (!yes) return;
      try {
        await withBusy(e.currentTarget, () => leaveRoomById(r.id, uid));
        toast('You left the room.', { type: 'success' });
        renderRooms(box, uid);
      } catch (err) { toast(err.message || 'Could not leave.', { type: 'error' }); }
    } }, 'Leave');
    list.append(h('li', { class: `ticket${isCurrent ? ' ticket--current' : ''}` },
      h('div', { class: 'ticket__main' },
        h('div', { class: 'ticket__name' }, r.name),
        h('div', { class: 'ticket__meta' },
          isCurrent ? h('span', { class: 'ticket__flag' }, h('span', { class: 'status__dot' }), 'Current') : null,
          r.role === 'owner' ? h('span', { class: 'ticket__flag ticket__flag--owner' }, 'Owner') : null,
          h('span', {}, `Joined ${formatDate(r.joinedAt)}`))),
      h('div', { class: 'ticket__acts' },
        leaveBtn,
        h('a', { class: `btn btn--sm ${isCurrent ? 'ticket__go' : 'btn--primary'}`, href: `#/room/${r.id}` }, isCurrent ? 'Resume' : 'Open'))));
  }

  mountInto(box, head,
    h('div', { class: 'dcard__body' },
      rooms.length ? list : h('p', { class: 'dcard__lead' }, 'No rooms yet. Create one or join with a code.')));
}
