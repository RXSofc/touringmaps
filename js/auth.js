import {
  auth, db, ref, set, serverTimestamp,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile
} from './firebase.js';
import { APP } from './config.js';
import { cleanText } from './ui.js';

let currentUser = null;
const authListeners = new Set();
const beforeLogoutHooks = new Set();
let pendingRegistration = Promise.resolve();

/** Resolves when an in-progress registration has finished writing the user's profile. */
export const whenRegistrationSettled = () => pendingRegistration.catch(() => {});

/** Resolves with the restored user (or null) once Firebase has read the persisted session. */
export function initAuth() {
  return new Promise((resolve) => {
    let first = true;
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      authListeners.forEach((fn) => { try { fn(user); } catch (e) { console.error(e); } });
      if (first) { first = false; resolve(user); }
    });
  });
}

export const getUser = () => currentUser;

export function onAuth(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

/** Register cleanup that must run while still signed in (stop GPS, mark offline…). */
export function onBeforeLogout(fn) {
  beforeLogoutHooks.add(fn);
  return () => beforeLogoutHooks.delete(fn);
}

export function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email).trim());
}

export function validatePassword(password) {
  if (String(password).length < APP.limits.password) return `Use at least ${APP.limits.password} characters.`;
  return null;
}

export function register({ email, password, displayName }) {
  const name = cleanText(displayName, APP.limits.displayName);
  if (!name) return Promise.reject(friendlyError({ code: 'app/missing-name' }));
  const run = (async () => {
    try {
      // Firebase signs the user in (and the router leaves this screen) as soon as the
      // account exists, so the profile write below must be awaited by anyone who reads it.
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: name }).catch(() => {});
      await set(ref(db, `users/${cred.user.uid}`), {
        displayName: name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return cred.user;
    } catch (err) {
      throw friendlyError(err);
    }
  })();
  pendingRegistration = run;
  return run;
}

export async function login({ email, password }) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return cred.user;
  } catch (err) {
    throw friendlyError(err);
  }
}

export async function logout() {
  for (const hook of [...beforeLogoutHooks]) {
    try { await hook(); } catch (e) { console.warn('logout hook failed', e); }
  }
  await signOut(auth);
}

export async function requestPasswordReset(email) {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    // Don't reveal whether an address has an account.
    if (err?.code === 'auth/user-not-found' || err?.code === 'auth/invalid-email') return;
    throw friendlyError(err);
  }
}

const MESSAGES = {
  'auth/invalid-email': 'That email address does not look valid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
  'auth/weak-password': `Password is too weak. Use at least ${APP.limits.password} characters.`,
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': 'Email/password sign-in is not enabled in this Firebase project.',
  'auth/unauthorized-domain': 'This website address is not in Firebase “Authorized domains”.',
  'auth/invalid-api-key': 'The apiKey in js/config.js is not valid. Copy it again from Firebase → Project settings → Your apps.',
  'auth/configuration-not-found': 'Firebase Authentication is not set up yet. In the Firebase console open Authentication, click “Get started”, then enable Email/Password.',
  'auth/app-not-authorized': 'This app is not allowed to use this Firebase project. Check apiKey and appId in js/config.js.',
  'auth/internal-error': 'Firebase had an internal error. Check js/config.js values and try again.',
  'PERMISSION_DENIED': 'The database rules blocked this. Publish firebase/database.rules.json in Realtime Database → Rules.',
  'app/missing-name': 'Enter a display name.'
};

export function friendlyError(err) {
  const code = err?.code || '';
  let message = MESSAGES[code];
  if (!message && code.startsWith('auth/requests-from')) message = 'The API key blocks requests from this website. In Google Cloud → APIs & Services → Credentials, allow your GitHub Pages domain.';
  if (!message && /permission[_ ]denied/i.test(`${code} ${err?.message}`)) message = MESSAGES.PERMISSION_DENIED;
  if (!message) {
    // Show the real reason so setup problems can be diagnosed on a phone.
    const detail = (code || String(err?.message || 'unknown error')).slice(0, 90);
    message = `Something went wrong (${detail}). Please try again.`;
  }
  const e = new Error(message);
  e.code = err?.code;
  e.cause = err;
  if (!MESSAGES[err?.code]) console.error(err);
  return e;
}
