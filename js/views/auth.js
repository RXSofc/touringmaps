import { h, icon, withBusy, mountInto } from '../ui.js';
import { login, register, requestPasswordReset, validateEmail, validatePassword } from '../auth.js';
import { APP } from '../config.js';
import { parseHash } from '../router.js';

function field({ id, label, type = 'text', autocomplete, hint, required = true, value = '', inputmode, maxlength }) {
  const input = h('input', { class: 'input', id, name: id, type, autocomplete, required, value, inputmode, maxlength, 'aria-describedby': `${id}-msg` });
  const msg = h('div', { class: 'field__hint', id: `${id}-msg` }, hint || '');
  const root = h('div', { class: 'field' }, h('label', { for: id }, label), input, msg);
  return {
    root, input,
    error(text) {
      root.classList.toggle('field--error', !!text);
      msg.className = text ? 'field__error' : 'field__hint';
      msg.textContent = text || hint || '';
      input.setAttribute('aria-invalid', text ? 'true' : 'false');
    }
  };
}

function shell(title, kicker, ...body) {
  return h('div', { class: 'auth-shell' },
    h('header', { class: 'auth-hero' },
      h('div', { class: 'auth-hero__mark' }, icon('pin')),
      h('p', { class: 'tag' }, kicker),
      h('h1', {}, 'VEX', h('br'), 'LANE'),
      h('p', { class: 'auth-hero__copy' }, 'Live positions, one shared destination and a Discord voice line for your riding group.')),
    h('section', { class: 'card auth-card', 'aria-labelledby': 'auth-title' },
      h('h2', { id: 'auth-title' }, title), ...body),
    h('p', { class: 'muted small mono' }, `build ${APP.version}`));
}

function formError() {
  const box = h('div', { class: 'banner banner--danger', role: 'alert', hidden: true }, icon('alert'), h('div', { class: 'banner__body' }));
  return {
    box,
    show(text) { box.querySelector('.banner__body').textContent = text; box.hidden = false; },
    hide() { box.hidden = true; }
  };
}

export function loginView() {
  return {
    mount(root) {
      const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', inputmode: 'email' });
      const password = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' });
      const err = formError();
      const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Sign in');

      const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        email.error(validateEmail(email.input.value) ? '' : 'Enter a valid email address.');
        password.error(password.input.value ? '' : 'Enter your password.');
        if (!validateEmail(email.input.value) || !password.input.value) return;
        try {
          await withBusy(submit, () => login({ email: email.input.value, password: password.input.value }));
          // the router reacts to the auth change and navigates
        } catch (error) { err.show(error.message); }
      } }, err.box, email.root, password.root, submit);

      mountInto(root, shell('Sign in', 'Riders only', form,
        h('div', { class: 'auth-links' },
          h('a', { href: '#/reset' }, 'Forgot password?'),
          h('a', { href: `#/register${location.hash.includes('next=') ? `?next=${encodeURIComponent(parseHash().query.get('next') || '')}` : ''}` }, 'Create an account'))));
      email.input.focus();
    }
  };
}

export function registerView() {
  return {
    mount(root) {
      const name = field({ id: 'name', label: 'Display name', autocomplete: 'nickname', hint: 'Shown to your riding group.', maxlength: APP.limits.displayName });
      const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', inputmode: 'email', hint: 'Used only to sign in. Other riders never see it.' });
      const password = field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: `At least ${APP.limits.password} characters.` });
      const err = formError();
      const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Create account');

      const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        err.hide();
        const nameOk = name.input.value.trim().length > 0;
        const emailOk = validateEmail(email.input.value);
        const pwMsg = validatePassword(password.input.value);
        name.error(nameOk ? '' : 'Enter a display name.');
        email.error(emailOk ? '' : 'Enter a valid email address.');
        password.error(pwMsg || '');
        if (!nameOk || !emailOk || pwMsg) return;
        try {
          await withBusy(submit, () => register({ email: email.input.value, password: password.input.value, displayName: name.input.value }));
        } catch (error) { err.show(error.message); }
      } }, err.box, name.root, email.root, password.root, submit);

      mountInto(root, shell('Create account', 'Join the ride', form,
        h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, 'I already have an account'))));
      name.input.focus();
    }
  };
}

export function resetView() {
  return {
    mount(root) {
      const email = field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email', inputmode: 'email' });
      const err = formError();
      const done = h('div', { class: 'banner banner--success', role: 'status', hidden: true }, icon('check'),
        h('div', { class: 'banner__body' }, 'If an account exists for that address, a reset link is on its way. Check your spam folder too.'));
      const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, 'Send reset link');

      const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        err.hide(); done.hidden = true;
        if (!validateEmail(email.input.value)) { email.error('Enter a valid email address.'); return; }
        email.error('');
        try {
          await withBusy(submit, () => requestPasswordReset(email.input.value));
          done.hidden = false;
        } catch (error) { err.show(error.message); }
      } }, err.box, done, email.root, submit);

      mountInto(root, shell('Reset password', 'No stress', form,
        h('div', { class: 'auth-links' }, h('a', { href: '#/login' }, 'Back to sign in'))));
      email.input.focus();
    }
  };
}
