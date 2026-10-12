/**
 * Single entry point for Firebase. Every other module imports Firebase symbols
 * from here, so the SDK version is pinned in one place.
 * SDK files are loaded as ES modules from Google's CDN (no bundler needed).
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';
import { firebaseConfig } from './config.js';

export {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

export {
  ref,
  set,
  update,
  get,
  onValue,
  remove,
  push,
  serverTimestamp,
  onDisconnect
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

/** @type {import('firebase/app').FirebaseApp | null} */
export let app = null;
export let auth = null;
export let db = null;

export function initFirebase() {
  if (app) return;
  app = initializeApp(firebaseConfig);
  // getAuth() on the web persists the session (IndexedDB → localStorage → session)
  // so users stay signed in across reloads and WebView restarts.
  auth = getAuth(app);
  db = getDatabase(app, firebaseConfig.databaseURL);
}
