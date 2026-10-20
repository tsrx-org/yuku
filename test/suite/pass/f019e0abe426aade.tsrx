import module from './module.wasm' with { type: 'wasm' };
const later = import('./later.wasm', { with: { type: 'wasm' } });