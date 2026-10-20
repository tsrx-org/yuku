---
title: Parse
description: Parse TSRX into an ESTree program, with its options, its TSRX nodes, and how to walk it.
---

# Parse

```js
import { parse } from "@tsrx/yuku";

const { program, comments, diagnostics } = parse(source, { path: "App.tsrx" });
```

`parse` takes the source and returns the program, every comment in source order, and every diagnostic. It never throws on bad input: it recovers, and returns a tree of everything it could read. Nodes have `start` and `end`, UTF-16 offsets into `source`, and no `loc`.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `path` | none | Names the file in diagnostics. A path ending in `.tsrx`, or no path, reads TSRX. Any other path parses standard JavaScript or TypeScript, by its extension. |
| `sourceType` | `"module"` | `"module"`, `"script"`, or `"commonjs"`, which allows a top-level `return`. |
| `preserveParens` | `false` | Keep `ParenthesizedExpression` nodes. `false`, as in `@tsrx/core`, so `(a)` reads as `a`. |
| `semanticErrors` | `false` | Also report the early errors that need scopes, such as a redeclared `let`. |
| `attachComments` | `false` | Also give each comment to the node it belongs to, in `node.comments`. |
| `tokens` | `false` | Keep every token, in `tokens`. |

These are [Yuku's options](https://yuku.fyi/parser/#js-options), without `lang` and `wasm`: the TSRX build of Yuku is passed for you, and a `.tsrx` file is TSX with TSRX in it.

## The tree

The tree is ESTree, and TypeScript-ESTree for types, with TSRX's own node types, as `@tsrx/core` names them.

| TSRX | Node |
| --- | --- |
| `@{ statements output }` | `JSXCodeBlock`, with `body` and the one node it renders in `render` |
| `@if (test) { } @else { }` | `JSXIfExpression`. An `@else if` is an `IfStatement` in its `alternate` |
| `@for (const x of xs; index i; key k) { } @empty { }` | `JSXForExpression`, with `left`, `right`, `index`, `key`, `body`, and `empty` |
| `@switch (value) { @case a: { } @default: { } }` | `JSXSwitchExpression`, whose `cases` are standard `SwitchCase` nodes |
| `@try { } @pending { } @catch (error, reset) { }` | `JSXTryExpression`, with `block`, `pending`, and a `handler` with a `resetParam` |
| `<style>` | `JSXStyleElement`, its CSS kept as written in one `JSXText` |
| `<script>` | A plain `JSXElement`, its body kept as written in one `JSXText` |
| `<{tag}>` | A `JSXElement` whose name is a `JSXExpressionContainer` |

Everything else is the JavaScript, TypeScript, and JSX that Yuku parses. The types are exported: `import type { JSXForExpression } from "@tsrx/yuku"`.

```tsrx
export function List({ items }) @{
  <ul>
    @for (const item of items; index i; key item.id) {
      <li>{i + 1}. {item.name}</li>
    } @empty {
      <li>No items</li>
    }
  </ul>
}
```

The function's body is a `JSXCodeBlock` that renders the `<ul>`, and the loop is a `JSXForExpression` among its children, with `index` and `key` set.

<!-- details:CSS in <style> -->
In 0.8 a `<style>` keeps its CSS as text, as `@tsrx/core` does. 0.9 will add a CSS tree for each `<style>`, parsed in the same pass by [yuku-css](https://github.com/thejackshelton/yuku-css), once [yuku#280](https://github.com/yuku-toolchain/yuku/pull/280) lands in Yuku.
<!-- /details -->

## Walk the tree

`walk` from [`yuku/ast`](https://yuku.fyi/parser/ast/#js-walking) visits TSRX nodes by their fields, like any other. Its visitors can name TSRX types. `yuku` is a dependency of `@tsrx/yuku`; add it to your own to import it.

```js
import { parse } from "@tsrx/yuku";
import { walk } from "yuku/ast";

const { program } = parse(source, { path: "List.tsrx" });

walk(program, {
  JSXForExpression(node) {
    console.log(node.key?.type); // "MemberExpression"
  },
});
```

`yuku/ast` also builds and checks nodes. See [AST](https://yuku.fyi/parser/ast/) on yuku.fyi.

## Comments and tokens

`comments` lists every comment as `{ type, value, start, end }`, where `type` is `"Line"` or `"Block"`. With `attachComments: true` each comment is also in the `comments` of its node, which [`generate`](/guide/generate) prints. With `tokens: true`, `tokens` is a `TokenList`, as [Yuku's tokens](https://yuku.fyi/parser/#js-tokens) describe.
