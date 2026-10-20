const a = <style>.a { color: red; }</style>;
const b = <style>.b { color: blue; }</style>;
export const bundle = <style apply={[a, b]} />;
const x: string = bundle.$class;