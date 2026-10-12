import { initFirebase } from './firebase.js';
import { initAuth } from './auth.js';
import { initClock } from './presence.js';
import { addRoute, setNotFound, startRouter, navigate } from './router.js';
import { loginView, registerView, resetView } from './views/auth.js';
import { dashboardView } from './views/dashboard.js';
import { profileView } from './views/profile.js';
import { touringView } from './views/touring.js';
import { h, toast } from './ui.js';

export async function boot(container) {
  initFirebase();
  initClock();
  await initAuth(); // restores the session before the first route renders

  addRoute('/login', () => loginView(), { auth: 'guest' });
  addRoute('/register', () => registerView(), { auth: 'guest' });
  addRoute('/reset', () => resetView(), { auth: 'guest' });
  addRoute('/dashboard', () => dashboardView());
  addRoute('/profile', () => profileView());
  addRoute('/room/:roomId', ({ roomId }) => touringView(roomId));
  setNotFound(() => ({
    mount(root) {
      root.append(h('div', { class: 'auth-shell' },
        h('div', { class: 'card' },
          h('h1', {}, 'Lost?'),
          h('p', {}, 'That page does not exist.'),
          h('a', { class: 'btn btn--primary', href: '#/dashboard' }, 'Back to start'))));
    }
  }));

  startRouter(container);
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').catch((err) => console.info('Service worker not registered:', err.message));
}

export { navigate, toast };
