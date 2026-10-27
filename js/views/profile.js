import { h, icon, toast, withBusy, mountInto, avatarImg, defaultAvatar, formatDate } from '../ui.js';
import { getUser, logout, requestPasswordReset } from '../auth.js';
import {
  ensureProfile, saveProfile, validateProfileInput, validateAvatarValue, testImageUrl, resizeImageFile
} from '../profile.js';
import { APP } from '../config.js';

export function profileView() {
  return {
    async mount(root) {
      const user = getUser();
      mountInto(root, h('div', { class: 'boot' }, h('span', { class: 'spinner' }), 'Loading…'));
      let profile;
      try { profile = await ensureProfile(user); }
      catch {
        mountInto(root, h('div', { class: 'auth-shell' }, h('div', { class: 'card' },
          h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'), h('div', { class: 'banner__body' }, 'Could not load your profile.')),
          h('a', { class: 'btn btn--cancel', href: '#/dashboard' }, 'Back'))));
        return;
      }

      let avatarValue = profile.avatarUrl || '';
      const preview = h('img', { class: 'avatar avatar--lg', alt: 'Avatar preview', width: 72, height: 72 });
      const showPreview = () => { preview.src = avatarValue || defaultAvatar(nameInput.value || profile.displayName, user.uid); };

      const nameInput = h('input', { class: 'input', id: 'p-name', value: profile.displayName || '', maxlength: APP.limits.displayName, autocomplete: 'nickname', required: true });
      const motoInput = h('input', { class: 'input', id: 'p-moto', value: profile.motorcycle || '', maxlength: APP.limits.motorcycle, placeholder: 'Honda CB500X', autocomplete: 'off' });
      const urlInput = h('input', { class: 'input', id: 'p-avatar-url', type: 'url', inputmode: 'url', placeholder: 'https://…/me.jpg', value: avatarValue.startsWith('data:') ? '' : avatarValue, autocomplete: 'off' });
      const fileInput = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', class: 'visually-hidden', id: 'p-avatar-file' });
      const errors = {
        displayName: h('div', { class: 'field__error', hidden: true }),
        motorcycle: h('div', { class: 'field__error', hidden: true }),
        avatarUrl: h('div', { class: 'field__error', hidden: true })
      };
      const showErrors = (errs) => {
        for (const key of Object.keys(errors)) {
          errors[key].hidden = !errs[key];
          errors[key].textContent = errs[key] || '';
        }
      };
      showPreview();

      nameInput.addEventListener('input', () => { if (!avatarValue) showPreview(); });
      urlInput.addEventListener('change', () => {
        avatarValue = urlInput.value.trim();
        showErrors({});
        showPreview();
      });
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          avatarValue = await resizeImageFile(file);
          urlInput.value = '';
          showErrors({});
          showPreview();
          toast('Photo ready. Save to apply.', { type: 'info' });
        } catch (err) {
          showErrors({ avatarUrl: err.message });
        } finally { fileInput.value = ''; }
      });
      preview.addEventListener('error', () => { preview.src = defaultAvatar(nameInput.value, user.uid); }, { once: false });

      const save = h('button', { class: 'btn btn--primary', type: 'submit' }, icon('check'), 'Save profile');
      const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        const input = { displayName: nameInput.value, motorcycle: motoInput.value, avatarUrl: avatarValue };
        const errs = validateProfileInput(input);
        showErrors(errs);
        if (Object.keys(errs).length) return;
        try {
          await withBusy(save, async () => {
            if (avatarValue && !avatarValue.startsWith('data:')) {
              const ok = await testImageUrl(validateAvatarValue(avatarValue).value);
              if (!ok) throw new Error('That link did not load as an image.');
            }
            await saveProfile(user.uid, input);
          });
          toast('Profile saved.', { type: 'success' });
        } catch (err) {
          if (/image/.test(err.message)) showErrors({ avatarUrl: err.message });
          else toast(err.message || 'Could not save.', { type: 'error' });
        }
      } },
      h('div', { class: 'avatar-editor' }, preview,
        h('div', { class: 'avatar-editor__buttons' },
          h('label', { class: 'btn btn--sm', for: 'p-avatar-file' }, icon('plus'), 'Upload photo'),
          avatarValue ? h('button', { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => { avatarValue = ''; urlInput.value = ''; showPreview(); } }, 'Remove') : null,
          h('p', { class: 'muted small avatar-editor__hint' }, 'JPEG, PNG, WebP or GIF. A GIF is shrunk and keeps moving.')),
        fileInput),
      h('div', { class: 'field' }, h('label', { for: 'p-avatar-url' }, 'Or avatar link (https)'), urlInput, errors.avatarUrl),
      h('div', { class: 'field' }, h('label', { for: 'p-name' }, 'Display name'), nameInput, errors.displayName),
      h('div', { class: 'field' }, h('label', { for: 'p-moto' }, 'Motorcycle (optional)'), motoInput, errors.motorcycle),
      save);

      const resetBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: async (e) => {
        try { await withBusy(e.currentTarget, () => requestPasswordReset(user.email)); toast('Password reset email sent.', { type: 'success' }); }
        catch (err) { toast(err.message, { type: 'error' }); }
      } }, 'Email me a reset link');

      mountInto(root, h('div', { class: 'page' },
        h('header', { class: 'page__head' },
          h('a', { class: 'btn btn--sm btn--cancel', href: '#/dashboard' }, icon('back'), 'Back'),
          h('h1', { class: 'page__title' }, 'Profile')),
        h('div', { class: 'grid-2' },
          h('section', { class: 'card', 'aria-labelledby': 'prof-title' }, h('h2', { class: 'card__title', id: 'prof-title' }, icon('user'), 'Rider profile'), form),
          h('section', { class: 'card', 'aria-labelledby': 'acct-title' },
            h('h2', { class: 'card__title', id: 'acct-title' }, icon('settings'), 'Account'),
            h('dl', { class: 'kv' },
              h('dt', {}, 'Email'), h('dd', { class: 'mono' }, user.email || '–'),
              h('dt', {}, 'Joined'), h('dd', {}, formatDate(Date.parse(user.metadata?.creationTime))),
              h('dt', {}, 'Password'), h('dd', {}, resetBtn)),
            h('p', { class: 'muted small' }, 'Your email is private: other riders only see your display name, photo and bike.'),
            h('hr', { class: 'rule' }),
            h('p', { class: 'muted small' }, 'Avatar links are fetched by other riders’ devices, so the image host can see their IP addresses. Uploading a photo avoids that.'),
            h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: async (e) => {
              await withBusy(e.currentTarget, () => logout().catch((err) => toast(err.message, { type: 'error' })));
            } }, icon('logout'), 'Sign out')))));
    }
  };
}
