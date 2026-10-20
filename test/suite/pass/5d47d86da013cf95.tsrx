export const data = import('./data.json', { with: { type: 'json' } },);
export const bare = import('./a.js',);
export const lazy = import.defer('./lazy.js', { with: { type: 'json' } },);
