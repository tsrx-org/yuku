const theme = <style>.dark { color: red; }</style>;
const x: string = theme.$class;
export function App() @{ <div class={theme.dark} /> }