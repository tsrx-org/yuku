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

### Parsing: rewrite links at build time

Edit the `href` and watch the rewritten output change.

<!-- widget:link-rewrite rewritten=2 -->
```tsrx
const user = { id: "42" };
const post = { slug: "hello" };
const nav = (
  <nav>
    <Link href="/users/:id" params={{ id: user.id }}>Profile</Link>
    <Link href="/posts/:slug" params={{ slug: post.slug }}>Post</Link>
    <Link href="/pricing">Pricing</Link>
    <a href="/about">About</a>
  </nav>
);
```

The [Parse guide](/guide/parse) shows how to walk the rest of the tree and handle diagnostics.

### Semantic analysis: catch a name that will be missing at runtime

Focus the underlined `reset` name and read why it resolves to nothing.

<!-- widget:symbol-table unresolved="reset" mode=runtime -->
```tsrx
import { format } from "./format";
type Label = string;

export function Cart({ items }) {
  return (
    <section>
      @{
        const total = items.length;
        const label = (total === 1 ? "item" : "items") as Label;
        <p>{label}</p>
      }
      <p>{items.map(format)} {reset}</p>
    </section>
  );
}
```

The [Analyze guide](/guide/analyze) shows what every semantic table answers.

### Codegen: print the module you will ship

Compare output A with Strip types on output B, then toggle either side.

<!-- widget:generate-diff a-strip=false b-strip=true b-comments=all -->
```tsrx
import type { Item } from "./item";

// Keep this comment in the shipped module.
export function label(item: Item): string {
  return item.name;
}
```

The [Generate guide](/guide/generate) lets you combine every printer option in a larger live diff.

Not sure this is the right engine for your job? [Oxc or Yuku?](/guide/oxc-or-yuku) is one screen.
