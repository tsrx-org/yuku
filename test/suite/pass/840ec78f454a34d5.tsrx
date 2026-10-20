const a = (<style>.a { color: red; }</style>);
const themes = ({ b: (<style>.b { color: blue; }</style>) });
export function App() @{ <><style apply={([(a), (themes).b])} /><div /></> }