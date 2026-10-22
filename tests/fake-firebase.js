// In-memory stand-in for js/firebase.js: just enough Realtime Database for rooms.js.
const tree = {}; const listeners = new Set();
const parts = (p) => String(p || '').split('/').filter(Boolean);
const read = (p) => parts(p).reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), tree);
const write = (p, v) => {
  const ks = parts(p); if (!ks.length) return;
  let n = tree; for (const k of ks.slice(0, -1)) { if (typeof n[k] !== 'object' || n[k] === null) n[k] = {}; n = n[k]; }
  if (v === null || v === undefined) delete n[ks.at(-1)]; else n[ks.at(-1)] = JSON.parse(JSON.stringify(v));
};
const notify = () => queueMicrotask(() => listeners.forEach((l) => l()));
const snap = (p) => ({ val: () => { const v = read(p); return v === undefined ? null : JSON.parse(JSON.stringify(v)); }, exists: () => read(p) !== undefined, key: parts(p).at(-1) });
export const db = {};
export const serverTimestamp = () => Date.now();
export const ref = (_db, path = '') => ({ path });
export const push = (r) => ({ key: `-N${Math.random().toString(36).slice(2, 14)}`, path: r.path });
export const set = async (r, v) => { write(r.path, v); notify(); };
export const update = async (r, obj) => { for (const [k, v] of Object.entries(obj)) write(`${r.path ? r.path + '/' : ''}${k}`, v); notify(); };
export const remove = async (r) => { write(r.path, null); notify(); };
export const get = async (r) => snap(r.path);
export const onValue = (r, cb) => { const run = () => cb(snap(r.path)); listeners.add(run); queueMicrotask(run); return () => listeners.delete(run); };
export const onDisconnect = () => ({ set: async () => {}, remove: async () => {}, cancel: async () => {} });
export const app = {}; export const auth = { currentUser: null };
export const initFirebase = () => {};
for (const n of ['onAuthStateChanged', 'createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signOut', 'sendPasswordResetEmail', 'updateProfile']) { /* not needed here */ }
export const onAuthStateChanged = () => () => {};
export const createUserWithEmailAndPassword = async () => {};
export const signInWithEmailAndPassword = async () => {};
export const signOut = async () => {};
export const sendPasswordResetEmail = async () => {};
export const updateProfile = async () => {};
export const __tree = tree;
