import source module from './module.wasm' with { type: 'wasm' };

const later = import.source('./later.wasm', { with: { type: 'wasm' } });