import { h, mountInto, icon } from '../ui.js';

export function renderSetup(root) {
  mountInto(root, h('div', { class: 'auth-shell' },
    h('div', { class: 'card setup-card' },
      h('span', { class: 'tag' }, 'Setup needed'),
      h('h1', {}, 'Connect Firebase'),
      h('p', {}, 'VEXLANE is installed, but js/config.js still contains placeholder Firebase settings.'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Create a Firebase project and enable Email/Password sign-in.'),
        h('li', {}, 'Create a Realtime Database and paste firebase/database.rules.json into its Rules tab.'),
        h('li', {}, 'Copy your web app config into js/config.js.'),
        h('li', {}, 'Add your GitHub Pages domain under Authentication → Settings → Authorized domains.')
      ),
      h('p', { class: 'muted small' }, 'Full instructions are in README.md and firebase/README.md.')
    )));
}

export function renderFatal(root, err) {
  mountInto(root, h('div', { class: 'auth-shell' },
    h('div', { class: 'card setup-card' },
      h('div', { class: 'banner banner--danger', role: 'alert' }, icon('alert'),
        h('div', { class: 'banner__body' }, h('strong', {}, 'The app could not start.'), h('div', {}, err?.message || 'Unknown error'))),
      h('p', { class: 'muted' }, 'This is usually a network problem (the Firebase SDK is loaded from Google’s CDN) or an invalid configuration.'),
      h('button', { type: 'button', class: 'btn btn--primary', onclick: () => location.reload() }, icon('refresh'), 'Reload')
    )));
}
