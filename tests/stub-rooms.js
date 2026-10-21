export const formatCode = (c) => (c || '').replace(/^(.{5})(.*)$/, '$1-$2');
export const roomCapacity = (m) => m.capacity || 6;
