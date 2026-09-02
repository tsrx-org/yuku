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

### Analysis: see what re-renders

Click a name and see everything on screen that would change with it, through the constants in between. A compiler uses exactly this to decide what to re-render.

<!-- widget:what-rerenders -->
```tsrx
export function Cart({ items, user }) @{
  const total = items.length;
  const label = total === 1 ? "item" : "items";
  const name = user.name;
  <section><h2>{name}</h2><p>{total} {label}</p><ul>@for (const item of items; key item.id) { <li>{item.title}</li> }</ul></section>
}
```

The [Analyze guide](/guide/analyze) shows what every semantic table answers.

### Codegen: lower TSRX to plain TSX

Every TSRX construct has a plain-TSX meaning. This rewrites the tree and lets the printer say it.

<!-- widget:lower-to-tsx -->
```tsrx
export function Results({ items, ready }) @{
  const heading = "Results";
  const count = items.length;
  <section>
    <h2>{heading}</h2>
    @if (ready) { <p>{count} ready</p> } @else { <p>Loading</p> }
    <ul>@for (const item of items; key item.id) { <li>{item.title}</li> }</ul>
  </section>
}
```

The [Generate guide](/guide/generate) shows every printer option in a larger live diff.

Not sure this is the right engine for your job? [Oxc or Yuku?](/guide/oxc-or-yuku) is one screen.
