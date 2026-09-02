---
title: Parse
description: Read a .tsrx file into a tree your tools can walk: a position on every node, the comments kept, and problems returned as a list instead of a thrown error.
---

# Parse

Read a `.tsrx` file into a tree your tools can walk: a position on every node, the comments kept, and problems returned as a list instead of a thrown error.

```js
import { parse } from "@tsrx/yuku";

const result = parse(source, { lang: "tsx" });
result.program;     // the tree, a Program node
result.comments;    // every comment, flat
result.diagnostics; // every problem, errors and warnings alike
```

[Yuku's `parse`](https://yuku.fyi) returns the tree it could build and every diagnostic it found. Bad source never makes this call throw.

## `parseModule` chooses defaults and throws on errors

```js
import { parseModule } from "@tsrx/yuku";

const program = parseModule(source, "Cart.tsrx");
```

The filename selects the language: `.tsrx` and `.tsx` use `tsx`, `.jsx` uses `jsx`, `.d.ts` uses `dts`, and `.ts` uses `ts`. Everything else uses `js`; an explicit `lang` wins.

`parseModule` also checks names and treats the file as a module. It throws a `SyntaxError` on the first error, while warnings return a program.

```js
const errors = [];
const program = parseModule(source, "Cart.tsrx", { collect: true, errors });
// program is always a Program here; errors holds every error, in order.
```

`collect: true` returns the program and fills `errors`. `loose: true` does the same, then recovers one unfinished closing-tag shape shown on [Diagnostics and recovery](/guide/diagnostics).

## Every node points back to your source

Hover or focus an AST row and watch its source range light up.

<!-- ast-explorer -->
```tsrx
export function Cart({ items }) @{
  const total = items.length;
  <ul class="cart">
    @for (const item of items; key item.id) {
      <li>{item.label}</li>
    }
  </ul>
}
```

Every node has a `type`, `start`, and `end`. `source.slice(node.start, node.end)` returns the exact text for that node; the `@for` above is a `JSXForExpression`, and its loop is in `statement`.

## The TSRX node types and why the names are exact

Constructs sit directly where you wrote them. A top-level `@if` is a `JSXIfExpression` in `Program.body`, and an `@for` inside markup is a `JSXForExpression` in the element's `children`.

## Six options change what you get back

Read the clean TSX result, then switch to JavaScript and focus the new underline.

<!-- widget:options-strip -->
```tsrx
export function Badge({ open }: { open: boolean }) @{
  // one comment, so attachComments has something to attach
  const label = open ? "open" : "closed";
  <span class="badge">{label}</span>
}

// declared twice on purpose: flip semanticErrors
const Badge = 1;
```

| Option | Default | Result |
| --- | --- | --- |
| `lang` | `js` | Chooses `js`, `jsx`, `ts`, `tsx`, or `dts`. Markup needs `jsx` or `tsx`; types need `ts` or `tsx`. |
| `sourceType` | `module` | Chooses `script`, `module`, or `commonjs`. |
| `preserveParens` | `true` | Keeps `ParenthesizedExpression` around `(1)`. |
| `semanticErrors` | `false` | Checks for problems such as a repeated name or missing export. |
| `attachComments` | `false` | Adds comments to their nodes. `result.comments` is filled either way. |
| `loose` | `false` | Recovers an element closed by an ancestor's tag. |

Pass `lang: "tsx"` when calling `parse` on a `.tsrx` file. Without it, the first `<` produces `Unexpected token '<'`.

## The wire format underneath

```ts
parseWire(source, options): ArrayBuffer
decode(buffer, source): ParseResult
encode(program): ArrayBuffer
```

`parse` combines the first two calls. `encode` turns a program back into the buffer that [`generate`](/guide/generate) accepts.

Next, learn which problems stop a file on [Diagnostics and recovery](/guide/diagnostics).
