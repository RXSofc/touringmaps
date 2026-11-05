// Stand-in for js/auth.js: always logged in as u1abc. Names match every import of auth.js in js/.
export const getUser = () => ({ uid: 'u1abc', email: 'rider@example.com', metadata: { creationTime: 'Mon, 05 Oct 2026 10:00:00 GMT' } });
export const onAuth = (cb) => { cb?.(getUser()); return () => {}; };
export const initAuth = async () => getUser();
export const onBeforeLogout = () => () => {};
export const logout = async () => { window.__loggedOut = true; };
export const requestPasswordReset = async () => {};
export const whenRegistrationSettled = async () => {};
export const login = async () => {}; export const register = async () => {};
export const validateEmail = () => ({}); export const validatePassword = () => ({});
