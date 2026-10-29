export const getBackdrop = () => document.body.dataset.bg || 'road';
export const setBackdrop = (v) => { document.body.dataset.bg = v; window.__bg = v; };
export const navigate = () => {}; export const parseHash = () => ({ path: '/', query: new URLSearchParams() });
