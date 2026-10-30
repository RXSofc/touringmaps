/**
 * Room sheet: invite code, riders (owner can remove), owner settings, device
 * options, leave/delete. The sheet re-renders when room data changes, unless
 * the user is typing in it.
 */
import { h, icon, openSheet, mountInto, withBusy, toast, copyText, confirmDialog, avatarImg } from '../ui.js';
import { formatCode as fmtCode, roomCapacity } from '../rooms.js';
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

  /** Re-drawing replaces every node, which used to throw the sheet back to the top and drop focus. Keep both. */
  function render() {
    const body = sheet.body;
    const scrollTop = body.scrollTop;
    const active = document.activeElement;
    const focusKey = active && content.contains(active) ? focusPath(active) : null;
    draw();
    body.scrollTop = scrollTop;
    if (focusKey !== null) {
      const next = content.querySelectorAll('input, select, button, textarea')[focusKey];
      if (next) next.focus({ preventScroll: true });
    }
    body.scrollTop = scrollTop;
  }
  const focusPath = (el) => [...content.querySelectorAll('input, select, button, textarea')].indexOf(el);

  function draw() {
    const s = getState();
    const code = s.meta.inviteCode;
    const shareText = `Join my VEXLANE ride "${s.meta.name}" with code ${fmtCode(code || '')}`;
    const members = Object.entries(s.members).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

    const block = (title, ic, ...kids) => h('section', { class: 'rs' },
      h('header', { class: 'rs__head' }, icon(ic), h('h3', {}, title)),
      h('div', { class: 'rs__body' }, ...kids));
    const setting = (title, desc, checked, onchange) => h('label', { class: 'switch setting' },
      h('span', { class: 'setting__text' }, h('strong', {}, title), h('span', { class: 'setting__desc' }, desc)),
      h('input', { type: 'checkbox', checked, onchange }),
      h('span', { class: 'switch__track', 'aria-hidden': 'true' }));

    /* ---- invite ---- */
    const cap = roomCapacity(s.meta);
    const slots = h('div', { class: 'slots', role: 'img', 'aria-label': `${s.memberCount} of ${cap} riders` },
      Array.from({ length: cap }, (_, i) => h('span', { class: `slots__cell${i < s.memberCount ? ' is-full' : ''}` })));
    const invite = block('Invite code', 'users',
      code ? h('code', { class: 'code-display', 'aria-label': `Invite code ${fmtCode(code).split('').join(' ')}` }, fmtCode(code)) : h('div', { class: 'empty' }, 'Code unavailable.'),
      s.meta.status === 'closed' ? h('div', { class: 'banner banner--warning' }, icon('alert'), h('div', { class: 'banner__body' }, 'This room is closed. Nobody new can join and location sharing is paused.')) : null,
      h('div', { class: 'btn-grid' },
        h('button', { class: 'btn btn--primary', type: 'button', disabled: !code, onclick: async () => toast(await copyText(shareText) ? 'Invitation copied.' : 'Could not copy.', { type: 'info' }) }, icon('copy'), 'Copy invitation'),
        navigator.share ? h('button', { class: 'btn', type: 'button', disabled: !code, onclick: () => navigator.share({ title: 'VEXLANE', text: shareText }).catch(() => {}) }, icon('share'), 'Share') : null),
      h('div', { class: 'slots-wrap' },
        h('div', { class: 'slots-wrap__row' }, h('strong', {}, `${s.memberCount} of ${cap} riders`), h('span', {}, s.memberCount >= cap ? 'Room is full' : `${cap - s.memberCount} open`)),
        slots),
      h('p', { class: 'rs__note' }, 'Anyone with this code can join until the room is full or you issue a new code.'));

    /* ---- riders ---- */
    const riders = block('Riders', 'route',
      h('ul', { class: 'list rs__riders' }, members.map(([uid, m]) => h('li', { class: 'row' },
        avatarImg(m, uid, 'avatar avatar--sm'),
        h('div', { class: 'row__main' },
          h('div', { class: 'row__title' }, m.displayName, uid === s.uid ? ' (you)' : ''),
          h('div', { class: 'row__sub' }, [m.role === 'owner' ? 'Owner' : 'Rider', m.motorcycle].filter(Boolean).join(' · '))),
        s.isOwner && uid !== s.uid ? h('button', { class: 'btn btn--sm btn--danger', type: 'button', 'aria-label': `Remove ${m.displayName}`, onclick: async () => {
          const yes = await confirmDialog({ title: 'Remove rider?', message: `${m.displayName} will lose access and cannot rejoin unless you allow it again.`, confirmLabel: 'Remove', danger: true });
          if (yes) await actions.removeMember(uid, m);
        } }, 'Remove') : null))),
      s.isOwner && Object.keys(s.banned).length ? h('div', { class: 'rs__banned' },
        h('p', { class: 'rs__sub' }, 'Removed riders'),
        h('ul', { class: 'list' }, Object.entries(s.banned).map(([uid, b]) => h('li', { class: 'row' },
          h('div', { class: 'row__main' }, h('div', { class: 'row__title' }, b.name || 'Rider')),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: () => actions.allowRejoin(uid) }, 'Allow rejoin'))))) : null);

    /* ---- Discord (owner edit / member view) ---- */
    const url = s.settings.discordInviteUrl || '';
    const discordInput = h('input', { class: 'input', id: 'rs-discord', type: 'url', inputmode: 'url', value: url, placeholder: 'https://discord.gg/yourInvite', autocomplete: 'off', 'aria-describedby': 'rs-discord-msg' });
    const discordMsg = h('div', { class: 'field__hint', id: 'rs-discord-msg' }, 'Only discord.gg and discord.com links are accepted.');
    const discordSave = h('button', { class: 'btn btn--accent', type: 'submit' }, 'Save');
    const discord = block('Discord voice (backup)', 'mic',
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
        h('div', { class: 'field' }, h('label', { for: 'rs-discord' }, 'Invite or channel link'), h('div', { class: 'input-row' }, discordInput, discordSave), discordMsg))
        : h('p', { class: 'rs__note' }, url ? h('span', { class: 'mono' }, url) : 'The owner has not added a Discord link yet.'),
      h('p', { class: 'rs__note' }, 'Hold the mic button on the touring screen for in-app voice. The Discord button opens Discord (or your browser) as a backup; push-to-talk and mute are set inside Discord.'));

    /* ---- owner settings ---- */
    const owner = s.isOwner ? block('Owner controls', 'flag',
      setting('Let every rider change the destination', 'Off: only you can.', s.settings.destinationPolicy === 'members', (e) => actions.setPolicy(e.currentTarget.checked ? 'members' : 'owner')),
      h('div', { class: 'btn-grid' },
        h('button', { class: 'btn', type: 'button', onclick: async (e) => {
          const yes = await confirmDialog({ title: 'Issue a new code?', message: 'The old code stops working immediately. Riders already in the room are not affected.', confirmLabel: 'New code' });
          if (yes) await withBusy(e.currentTarget, () => actions.rotateInvite());
        } }, icon('refresh'), 'New code'),
        h('button', { class: 'btn btn--warning', type: 'button', onclick: async (e) => {
          const closing = s.meta.status !== 'closed';
          const yes = await confirmDialog({ title: closing ? 'Close room?' : 'Reopen room?', message: closing ? 'Nobody new can join and live location sharing stops for everyone. You can reopen it later.' : 'Riders can join and share locations again.', confirmLabel: closing ? 'Close room' : 'Reopen', danger: closing });
          if (yes) await withBusy(e.currentTarget, () => actions.setStatus(closing ? 'closed' : 'open'));
        } }, s.meta.status === 'closed' ? 'Reopen room' : 'Close room')),
      h('div', { class: 'danger-zone' },
        h('p', {}, 'Deleting removes the room, its destination and everyone’s shared locations for good.'),
        h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: async () => {
          const yes = await confirmDialog({ title: 'Delete room?', message: 'This removes the room, its destination and everyone’s shared locations for good.', confirmLabel: 'Delete room', danger: true });
          if (yes) { sheet.close(); await actions.deleteRoom(); }
        } }, icon('trash'), 'Delete room'))) : null;

    /* ---- this device ---- */
    const device = block('This device', 'user',
      h('div', { class: 'settings' },
        WakeLock.supported
          ? setting('Keep screen on', 'A locked screen pauses GPS sharing in browsers and WebViews. Uses more battery.', s.keepAwake, (e) => actions.setKeepAwake(e.currentTarget.checked))
          : h('p', { class: 'rs__note' }, 'This browser cannot keep the screen on. Keep the app in the foreground while riding.'),
        s.voiceSupported
          ? setting('Tap to talk', 'Off: hold the mic button while you speak. On: tap once to start, tap again to stop.', s.voiceMode === 'toggle', (e) => actions.setVoiceMode(e.currentTarget.checked ? 'toggle' : 'hold'))
          : null,
        s.guidanceSupported
          ? setting('Turn alerts', 'A popup and vibration before turns, roundabouts and the destination. The voice is a separate switch below. Works only while the screen is on.', s.guidance, (e) => actions.setGuidance(e.currentTarget.checked))
          : null,
        s.speech?.supported
          ? setting('Spoken navigation', 'Reads the turns, warnings and arrival out loud with the phone’s own text-to-speech. Works only while the screen is on, and needs Turn alerts on. The same button is on the map.', s.speech.enabled, (e) => actions.setSpeech(e.currentTarget.checked))
          : null,
        s.speech?.supported && s.speech.enabled
          ? h('div', { class: 'speech-opts' },
            h('div', { class: 'field' }, h('label', { for: 'sp-voice' }, 'Voice'),
              h('select', { class: 'input', id: 'sp-voice', onchange: (e) => actions.setSpeechVoice(e.currentTarget.value) },
                h('option', { value: '', selected: !s.speech.voiceName }, s.speech.voices.length ? 'Automatic (female if found)' : 'Phone default (no Indonesian voice found)'),
                ...s.speech.voices.map((v) => h('option', { value: v.name, selected: v.name === s.speech.voiceName }, `${v.name} (${v.lang})`)))),
            h('div', { class: 'field' }, h('label', { for: 'sp-rate' }, 'Speed'),
              h('select', { class: 'input', id: 'sp-rate', onchange: (e) => actions.setSpeechRate(e.currentTarget.value) },
                ...[['0.9', 'Slow'], ['1', 'Normal'], ['1.15', 'Fast'], ['1.3', 'Very fast']].map(([val, label]) => h('option', { value: val, selected: Number(val) === s.speech.rate }, label)))),
            h('button', { class: 'btn btn--block', type: 'button', onclick: () => actions.testSpeech() }, icon('volume'), 'Test voice'))
          : null,
        s.regionSupported
          ? setting('Region alerts', 'A short popup with the weather shortly before you enter another kabupaten or kota. Needs internet.', s.regionAlerts, (e) => actions.setRegionAlerts(e.currentTarget.checked))
          : null),
      s.voiceSupported ? h('button', { class: 'btn btn--block', type: 'button', onclick: () => { sheet.close(); actions.openVoiceDiag(); } }, 'Voice diagnostics') : null,
      !s.isOwner ? h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: async () => {
        const yes = await confirmDialog({ title: 'Leave room?', message: 'Your shared location is removed and you need a new invite to return.', confirmLabel: 'Leave', danger: true });
        if (yes) { sheet.close(); await actions.leave(); }
      } }, 'Leave room') : null);

    mountInto(content, invite, riders, discord, owner, device);
  }

  let lastSig = '';
  const signature = () => { try { return JSON.stringify(getState()); } catch { return String(Math.random()); } };
  render(); lastSig = signature();
  return {
    close: sheet.close,
    update() {
      const sig = signature();
      if (sig === lastSig) return;          // nothing changed: leave the sheet alone (no flicker, no jump)
      // Don't clobber a field the person is typing in (the change is drawn on the next update).
      if (sheet.sheet.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox') return;
      lastSig = sig;
      render();
    }
  };
}

