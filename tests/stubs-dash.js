// Stubs so js/views/dashboard.js can be mounted for real without Firebase.
export const getUser = () => ({ uid: 'u1' });
export const logout = async () => { window.__loggedOut = true; };
export const ensureProfile = async () => ({ displayName: 'ARIQ3GP', motorcycle: 'Beat Deluxe 140cc' });
export const onConnectionChange = (cb) => { setTimeout(() => cb(true), 20); return () => {}; };
export const navigate = (p) => { window.__nav = p; };
export const normalizeCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const createRoom = async (o) => { window.__created = o; return { roomId: 'room12345678', code: 'AAAAABBBBB' }; };
export const previewInvite = async (code) => ({ roomId: 'r2', roomName: 'Preview room', expiresAt: Date.now() + 864e5, capacity: 15 });
export const joinRoom = async () => 'r2';
export const listMyRooms = async () => ({ currentRoomId: 'r1', rooms: [{ id: 'r2', name: 'Touring Pangandaran', role: 'member', joinedAt: 1 }, { id: 'r1', name: 'Sunday ride to Kawah Putih Ciwidey', role: 'owner', joinedAt: 2 }] });
export const forgetRoomEntry = async () => {};
export const canAccessRoom = async () => true;
export const leaveRoomById = async () => {};
