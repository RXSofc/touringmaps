/**
 * Room sheet: invite code, riders (owner can remove), owner settings, device
 * options, leave/delete. The sheet re-renders when room data changes, unless
 * the user is typing in it.
 */
import { h, icon, openSheet, mountInto, withBusy, toast, copyText, confirmDialog, avatarImg } from '../ui.js';
import { formatCode as fmtCode } from '../rooms.js';
import { validateDiscordUrl } from '../discord.js';
import { WakeLock } from '../permissions.js';
import { APP } from '../config.js';

/**
 * @param {{getState:()=>object, actions:object, onClose:()=>void}} opts
 * state: {uid, isOwner, meta, members, banned, settings, memberCount, keepAwake}
 */
export function openRoomSheet({ getState, actions, onClose }) {
  const content = h('div', { class: 'room-sheet' });
  const sheet = openSheet({ title: 'Room', content, onClose });

  function render() {
    const s = getState();
    const code = s.meta.inviteCode;
    const shareText = `Join my TouringTogether ride "${s.meta.name}" with code ${fmtCode(code || '')}`;
    const members = Object.entries(s.members).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

    /* ---- invite ---- */
    const invite = h('section', { class: 'sheet__section' },
      h('h3', {}, 'Invite code'),
      code ? h('code', { class: 'code-display', 'aria-label': `Invite code ${fmtCode(code).split('').join(' ')}` }, fmtCode(code)) : h('div', { class: 'empty' }, 'Code unavailable.'),
      s.meta.status === 'closed' ? h('div', { class: 'banner banner--warning' }, icon('alert'), h('div', { class: 'banner__body' }, 'This room is closed. Nobody new can join and location sharing is paused.')) : null,
      h('p', { class: 'muted small' }, `${s.memberCount} of ${APP.limits.maxMembers} riders. Anyone with this code can join until the room is full or you issue a new code.`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn--primary', type: 'button', disabled: !code, onclick: async () => toast(await copyText(shareText) ? 'Invitation copied.' : 'Could not copy.', { type: 'info' }) }, icon('copy'), 'Copy invitation'),
        navigator.share ? h('button', { class: 'btn', type: 'button', disabled: !code, onclick: () => navigator.share({ title: 'TouringTogether', text: shareText }).catch(() => {}) }, icon('share'), 'Share') : null));

    /* ---- riders ---- */
    const riders = h('section', { class: 'sheet__section' },
      h('h3', {}, 'Riders'),
      h('ul', { class: 'list' }, members.map(([uid, m]) => h('li', { class: 'row' },
        avatarImg(m, uid, 'avatar avatar--sm'),
        h('div', { class: 'row__main' },
          h('div', { class: 'row__title' }, m.displayName, uid === s.uid ? ' (you)' : ''),
          h('div', { class: 'row__sub' }, [m.role === 'owner' ? 'Owner' : 'Rider', m.motorcycle].filter(Boolean).join(' · '))),
        s.isOwner && uid !== s.uid ? h('button', { class: 'btn btn--sm btn--danger', type: 'button', 'aria-label': `Remove ${m.displayName}`, onclick: async () => {
          const yes = await confirmDialog({ title: 'Remove rider?', message: `${m.displayName} will lose access and cannot rejoin unless you allow it again.`, confirmLabel: 'Remove', danger: true });
          if (yes) await actions.removeMember(uid, m);
        } }, 'Remove') : null))),
      s.isOwner && Object.keys(s.banned).length ? h('div', {},
        h('p', { class: 'label' }, 'Removed riders'),
        h('ul', { class: 'list' }, Object.entries(s.banned).map(([uid, b]) => h('li', { class: 'row' },
          h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, b.name || 'Rider')),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => actions.allowRejoin(uid) }, 'Allow rejoin'))))) : null);

    /* ---- Discord (owner edit / member view) ---- */
    const url = s.settings.discordInviteUrl || '';
    const discordInput = h('input', { class: 'input', id: 'rs-discord', type: 'url', inputmode: 'url', value: url, placeholder: 'https://discord.gg/yourInvite', autocomplete: 'off', 'aria-describedby': 'rs-discord-msg' });
    const discordMsg = h('div', { class: 'field__hint', id: 'rs-discord-msg' }, 'Only discord.gg and discord.com links are accepted.');
    const discordSave = h('button', { class: 'btn btn--accent', type: 'submit' }, 'Save link');
    const discord = h('section', { class: 'sheet__section' },
      h('h3', {}, 'Discord voice (backup)'),
      s.isOwner
        ? h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
          e.preventDefault();
          const value = discordInput.value.trim();
          if (value) {
            const v = validateDiscordUrl(value);
            if (!v.ok) { discordMsg.className = 'field__error'; discordMsg.textContent = v.error; discordInput.setAttribute('aria-invalid', 'true'); return; }
          }
          discordInput.removeAttribute('aria-invalid');
          discordMsg.className = 'field__hint'; discordMsg.textContent = 'Only discord.gg and discord.com links are accepted.';
          try { await withBusy(discordSave, () => actions.saveDiscord(value)); toast(value ? 'Discord link saved.' : 'Discord link removed.', { type: 'success' }); }
          catch (err) { discordMsg.className = 'field__error'; discordMsg.textContent = err.message; }
        } },
        h('div', { class: 'field' }, h('label', { for: 'rs-discord' }, 'Invite or channel link'), discordInput, discordMsg), discordSave)
        : h('p', {}, url ? h('span', { class: 'mono small' }, url) : 'The owner has not added a Discord link yet.'),
      h('p', { class: 'muted small' }, 'Hold the mic button on the touring screen for in-app voice. The Discord button opens Discord (or your browser) as a backup; push-to-talk and mute are set inside Discord.'));

    /* ---- owner settings ---- */
    const owner = s.isOwner ? h('section', { class: 'sheet__section' },
      h('h3', {}, 'Owner controls'),
      h('label', { class: 'switch' },
        h('span', {}, h('strong', {}, 'Let every rider change the destination'), h('br'), h('span', { class: 'muted small' }, 'Off: only you can.')),
        h('input', { type: 'checkbox', checked: s.settings.destinationPolicy === 'members', onchange: (e) => actions.setPolicy(e.currentTarget.checked ? 'members' : 'owner') }),
        h('span', { class: 'switch__track', 'aria-hidden': 'true' })),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onclick: async (e) => {
          const yes = await confirmDialog({ title: 'Issue a new code?', message: 'The old code stops working immediately. Riders already in the room are not affected.', confirmLabel: 'New code' });
          if (yes) await withBusy(e.currentTarget, () => actions.rotateInvite());
        } }, icon('refresh'), 'New invite code'),
        h('button', { class: 'btn btn--warning', type: 'button', onclick: async (e) => {
          const closing = s.meta.status !== 'closed';
          const yes = await confirmDialog({ title: closing ? 'Close room?' : 'Reopen room?', message: closing ? 'Nobody new can join and live location sharing stops for everyone. You can reopen it later.' : 'Riders can join and share locations again.', confirmLabel: closing ? 'Close room' : 'Reopen', danger: closing });
          if (yes) await withBusy(e.currentTarget, () => actions.setStatus(closing ? 'closed' : 'open'));
        } }, s.meta.status === 'closed' ? 'Reopen room' : 'Close room'),
        h('button', { class: 'btn btn--danger', type: 'button', onclick: async () => {
          const yes = await confirmDialog({ title: 'Delete room?', message: 'This removes the room, its destination and everyone’s shared locations for good.', confirmLabel: 'Delete room', danger: true });
          if (yes) { sheet.close(); await actions.deleteRoom(); }
        } }, icon('trash'), 'Delete room'))) : null;

    /* ---- this device ---- */
    const device = h('section', { class: 'sheet__section' },
      h('h3', {}, 'This device'),
      WakeLock.supported
        ? h('label', { class: 'switch' },
          h('span', {}, h('strong', {}, 'Keep screen on'), h('br'), h('span', { class: 'muted small' }, 'A locked screen pauses GPS sharing in browsers and WebViews. Uses more battery.')),
          h('input', { type: 'checkbox', checked: s.keepAwake, onchange: (e) => actions.setKeepAwake(e.currentTarget.checked) }),
          h('span', { class: 'switch__track', 'aria-hidden': 'true' }))
        : h('p', { class: 'muted small' }, 'This browser cannot keep the screen on. Keep the app in the foreground while riding.'),
      s.voiceSupported
        ? h('label', { class: 'switch' },
          h('span', {}, h('strong', {}, 'Tap to talk'), h('br'), h('span', { class: 'muted small' }, 'Off: hold the mic button while you speak. On: tap once to start, tap again to stop.')),
          h('input', { type: 'checkbox', checked: s.voiceMode === 'toggle', onchange: (e) => actions.setVoiceMode(e.currentTarget.checked ? 'toggle' : 'hold') }),
          h('span', { class: 'switch__track', 'aria-hidden': 'true' }))
        : null,
      s.voiceSupported ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => { sheet.close(); actions.openVoiceDiag(); } }, 'Voice diagnostics') : null,
      s.guidanceSupported
        ? h('label', { class: 'switch' },
          h('span', {}, h('strong', {}, 'Turn alerts'), h('br'), h('span', { class: 'muted small' }, 'A popup and vibration before turns, roundabouts and the destination. No sound. Works only while the screen is on.')),
          h('input', { type: 'checkbox', checked: s.guidance, onchange: (e) => actions.setGuidance(e.currentTarget.checked) }),
          h('span', { class: 'switch__track', 'aria-hidden': 'true' }))
        : null,
      !s.isOwner ? h('button', { class: 'btn btn--danger', type: 'button', onclick: async () => {
        const yes = await confirmDialog({ title: 'Leave room?', message: 'Your shared location is removed and you need a new invite to return.', confirmLabel: 'Leave', danger: true });
        if (yes) { sheet.close(); await actions.leave(); }
      } }, 'Leave room') : null);

    mountInto(content, invite, riders, discord, owner, device);
  }

  render();
  return {
    close: sheet.close,
    update() {
      // Don't clobber a field the person is typing in.
      if (sheet.sheet.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
      render();
    }
  };
}

