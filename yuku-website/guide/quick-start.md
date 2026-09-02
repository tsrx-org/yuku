---
title: Quick start
description: Install it, parse one file, then see what real compilers do with the result.
---

# Quick start

Install it, parse one file, then see what real compilers do with the result.

<!-- pm-install -->
```sh
npm install @tsrx/yuku
```

```js
// list.mjs
import { parseModule } from "@tsrx/yuku";

const source = `<ul>@for (const item of items; key item.id) { <li>{item.label}</li> }</ul>`;
const program = parseModule(source, "list.tsrx");
const list = program.body[0].expression;
console.log(list.children.map((child) => child.type));
```

<!-- terminal-demo:getting-started-first-parse -->

`parseModule` sees `.tsrx` and picks the TSX grammar. The `<ul>` comes back as a `JSXElement`; its `@for` child comes back as a `JSXForExpression`, named after what you wrote. Prebuilt packages exist for macOS arm64 and Linux x64; anything else needs the [source build](/guide/build-from-source).

## Some examples

### Parsing: key every loop before it ships

Every `@for` needs a key before it ships. This adds one to each loop that lacks it, from the tree, not from regex.

<!-- widget:keyed-loops -->
```tsrx
export function Results({ rows, cards, users }) @{
  <section>
    @for (const row of rows) { <p>{row.name}</p> }
    @for (const card of cards; key card.id) { <p>{card.title}</p> }
    @for (const user of users) { <p>{user.name}</p> }
  </section>
}
```

The [Parse guide](/guide/parse) shows how to walk the rest of the tree and handle diagnostics.

### Analysis: rename only one symbol

Rename a variable and only its real references follow; the inner `count` that shadows it stays.

<!-- widget:safe-rename -->
```tsrx
export function Counter() @{
  let count = 1;
  const doubled = count * 2;
  const label = () => count + " clicks";
  const preview = (count) => count + 1;
  <button>{count} / {doubled} / {label()} / {preview(3)}</button>
}
```

The [Analyze guide](/guide/analyze) shows what every semantic table answers.

### Codegen: format in either direction

Paste any TSRX and get it printed clean; flip Minify to go the other way.

<!-- widget:format -->
```tsrx
export function Card({title,ready}) @{
const label='Ready'; @if(ready){<article class = 'card'><h2>{ title }</h2><p>{label}</p></article>}@else{<p>Waiting</p>} }
```

The [Generate guide](/guide/generate) shows every printer option in a larger live diff.

Not sure this is the right engine for your job? [Oxc or Yuku?](/guide/oxc-or-yuku) is one screen.
