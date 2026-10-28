export const getUser = () => ({ uid: 'u1abc', email: 'ariqmontana@gmail.com', metadata: { creationTime: 'Mon, 05 Oct 2026 10:00:00 GMT' } });
export const logout = async () => { window.__loggedOut = true; };
export const requestPasswordReset = async () => { window.__reset = true; };
export const ensureProfile = async () => ({ displayName: 'ARIQ3GP', motorcycle: 'Beat Deluxe 140cc', avatarUrl: new URLSearchParams(location.search).get('avatar') || undefined });
export const saveProfile = async (uid, i) => { window.__saved = i; };
export const validateProfileInput = (i) => (i.displayName.trim() ? {} : { displayName: 'Name is required.' });
export const validateAvatarValue = (v) => ({ value: v });
export const testImageUrl = async () => true;
export const resizeImageFile = async () => 'data:image/jpeg;base64,/9j/4AAQ';
