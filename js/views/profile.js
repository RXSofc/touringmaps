import { h, icon, toast, withBusy, mountInto, avatarImg, defaultAvatar, formatDate } from '../ui.js';
import { getUser, logout, requestPasswordReset } from '../auth.js';
import {
  ensureProfile, saveProfile, validateProfileInput, validateAvatarValue, testImageUrl, resizeImageFile
} from '../profile.js';
import { APP } from '../config.js';
import { getBackdrop, setBackdrop } from '../router.js';

/** Small stable hash (FNV-1a) so a rider always gets the same number and barcode. */
function hashUid(uid) {
  let h32 = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) { h32 ^= uid.charCodeAt(i); h32 = Math.imul(h32, 0x01000193) >>> 0; }
  return h32 >>> 0;
}
const riderNumber = (uid) => hashUid(uid).toString(36).toUpperCase().padStart(6, '0').slice(-6);
/** Barcode-style strip drawn from the uid: decorative, but it is the same for the same rider every time. */
function barcodeSvg(uid) {
  let seed = hashUid(uid) || 1; const next = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
  let x = 0; let rects = '';
  while (x < 236) { const w = 2 + (next() % 4); const gap = 2 + (next() % 3); if (x + w > 240) break; rects += `<rect x="${x}" y="0" width="${w}" height="30"/>`; x += w + gap; }
  return `<svg viewBox="0 0 240 30" preserveAspectRatio="none" aria-hidden="true" focusable="false" fill="currentColor">${rects}</svg>`;
}

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
      const preview = h('img', { class: 'avatar avatar--lg', alt: 'Your photo', width: 112, height: 112 });
      const showPreview = () => { preview.src = avatarValue || defaultAvatar(nameInput.value || profile.displayName, user.uid); if (removeBtn) removeBtn.hidden = !avatarValue; };
      let removeBtn = null;

      const nameInput = h('input', { class: 'input idcard__name', id: 'p-name', value: profile.displayName || '', maxlength: APP.limits.displayName, autocomplete: 'nickname', required: true });
      const motoInput = h('input', { class: 'input idcard__bike', id: 'p-moto', value: profile.motorcycle || '', maxlength: APP.limits.motorcycle, placeholder: 'Honda CB500X', autocomplete: 'off' });
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

      removeBtn = h('button', { class: 'idcard__remove', type: 'button', onclick: () => { avatarValue = ''; urlInput.value = ''; showPreview(); } }, 'Remove photo');
      removeBtn.hidden = !avatarValue;
      const save = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, icon('check'), 'Save profile');
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
      h('div', { class: 'idcard__row' },
        h('div', { class: 'idcard__photobox' },
          h('label', { class: 'idcard__photo', for: 'p-avatar-file', title: 'Change photo' }, preview, h('span', { class: 'idcard__change' }, icon('plus'), 'Change')),
          removeBtn,
          fileInput),
        h('div', { class: 'idcard__fields' },
          h('div', { class: 'field' }, h('label', { for: 'p-name' }, 'Name'), nameInput, errors.displayName),
          h('div', { class: 'field' }, h('label', { for: 'p-moto' }, 'Bike'), h('div', { class: 'idcard__plate' }, motoInput), errors.motorcycle))),
      h('p', { class: 'idcard__hint' }, 'JPEG, PNG, WebP or GIF. A GIF is shrunk and keeps moving.'),
      h('details', { class: 'idcard__more' },
        h('summary', {}, 'Use a photo link instead'),
        h('div', { class: 'field' }, h('label', { for: 'p-avatar-url' }, 'Photo link (https)'), urlInput),
        h('p', { class: 'idcard__hint' }, 'A link is fetched by other riders’ devices, so the image host can see their IP addresses. Uploading a photo avoids that.')),
      errors.avatarUrl,
      h('div', { class: 'idcard__tear' }, save));

      const resetBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: async (e) => {
        try { await withBusy(e.currentTarget, () => requestPasswordReset(user.email)); toast('Password reset email sent.', { type: 'success' }); }
        catch (err) { toast(err.message, { type: 'error' }); }
      } }, 'Email me a reset link');

      const bgBtn = (value, label) => {
        const b = h('button', { class: 'seg__btn', type: 'button', 'aria-pressed': String(getBackdrop() === value), onclick: () => {
          setBackdrop(value);
          for (const x of bgSeg.querySelectorAll('.seg__btn')) x.setAttribute('aria-pressed', String(x === b));
        } }, label);
        return b;
      };
      const bgSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Background' }, bgBtn('road', 'Road'), bgBtn('contour', 'Contour'));

      const barcode = h('div', { class: 'idcard__bars' });
      barcode.innerHTML = barcodeSvg(user.uid);
      const joined = formatDate(Date.parse(user.metadata?.creationTime));

      mountInto(root, h('div', { class: 'page prof' },
        h('header', { class: 'page__head' },
          h('a', { class: 'btn btn--sm btn--cancel', href: '#/dashboard' }, icon('back'), 'Back'),
          h('h1', { class: 'page__title' }, 'Profile')),
        h('div', { class: 'prof__grid' },
          h('section', { class: 'idcard', 'aria-labelledby': 'prof-title' },
            h('header', { class: 'idcard__top' },
              h('span', { class: 'idcard__brand' }, icon('pin'), 'VEXLANE'),
              h('h2', { class: 'idcard__title', id: 'prof-title' }, 'Rider ID')),
            h('div', { class: 'idcard__no' }, h('span', {}, 'No.'), h('strong', {}, riderNumber(user.uid))),
            h('div', { class: 'idcard__body' }, form),
            h('footer', { class: 'idcard__foot' }, barcode, h('span', {}, `Member since ${joined}`))),
          h('section', { class: 'idback', 'aria-labelledby': 'acct-title' },
            h('h2', { class: 'idback__title', id: 'acct-title' }, icon('settings'), 'Account'),
            h('div', { class: 'idback__row' }, h('span', { class: 'idback__k' }, 'Email'), h('span', { class: 'idback__v mono' }, user.email || '–')),
            h('div', { class: 'idback__row' }, h('span', { class: 'idback__k' }, 'Joined'), h('span', { class: 'idback__v' }, joined)),
            h('div', { class: 'idback__row' }, h('span', { class: 'idback__k' }, 'Password'), resetBtn),
            h('div', { class: 'idback__row' }, h('span', { class: 'idback__k' }, 'Background'), bgSeg),
            h('p', { class: 'idback__note' }, 'Your email is private: other riders only see your name, photo and bike.'),
            h('button', { class: 'btn btn--danger btn--block', type: 'button', onclick: async (e) => {
              await withBusy(e.currentTarget, () => logout().catch((err) => toast(err.message, { type: 'error' })));
            } }, icon('logout'), 'Sign out')))));
    }
  };
}
