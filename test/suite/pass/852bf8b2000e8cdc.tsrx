import { base } from './base.js';
export const theme = <style apply={base}>.x { color: red; }</style>;
const x: string = theme.$class;
export function App() @{ <><style apply={theme} /><div class={theme.x} /></> }