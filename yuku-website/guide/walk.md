---
title: Walk and transform
description: Find nodes by type, edit a field, and print the result.
---

# Walk and transform

`walk` visits the JavaScript AST and calls handlers for the node types your pass cares about. Use it for structural rules and rewrites. When a transformation depends on what a reference means, first call [`analyze`](/guide/analyze) and use its semantic tables to plan the edit.

```js
import { parseModule, walk } from "@tsrx/yuku";

const source = "const view = @if (ready) { <p>Ready</p> };";
const program = parseModule(source, "example.tsrx");

walk(program, {
  JSXIfExpression(node) {
    console.log(source.slice(node.start, node.end));
  },
});
// @if (ready) { <p>Ready</p> }
```

`JSXIfExpression` is the visitor's name and the node's `type`. The callback runs once for each matching node, wherever it appears.

## Find a node in a template

Edit the source or choose a node type. The read-only visitor and match list update automatically.

<!-- widget:visitor type="JSXIfExpression" -->
```tsrx
<span>
  @if (count > 99) {
    <b>99+</b>
  } @else if (count > 0) {
    <b>{count}</b>
  }
  @if (label) {
    <small>{label}</small>
  }
</span>
```

## Make a small change

Let's rename `class` attributes to `className`. Save this as `class-to-classname.mjs`:

```js
import { readFile, writeFile } from "node:fs/promises";
import { generate, parseModule, walk } from "@tsrx/yuku";

const file = process.argv[2];
if (!file) throw new Error("Usage: node class-to-classname.mjs <file>");

const source = await readFile(file, "utf8");
const program = parseModule(source, file, { attachComments: true });

walk(program, {
  JSXAttribute(node) {
    if (node.name.type === "JSXIdentifier" && node.name.name === "class") {
      node.name.name = "className";
    }
  },
});

const { code, errors } = generate(program, { comments: "all" });
if (errors.length > 0) throw new Error(errors[0].message);
await writeFile(file, `${code}\n`);
```

Try it on a file containing `<div class="card" />`:

```sh
node class-to-classname.mjs Card.tsrx
```

The script rewrites `Card.tsrx` in place. Its output contains `<div className="card" />`; comments are kept, though formatting may change. `parseModule` stops invalid source before any file is written.

## Track parents and state

Each callback also receives `{ parent, state }`. To do work after visiting a node's children, use a `leave` callback:

```js
walk(program, {
  JSXForExpression: {
    enter(node, { state }) { state.depth += 1; },
    leave(node, { state }) { state.depth -= 1; },
  },
}, { depth: 0 });
```

Top-level `enter` and `leave` callbacks run for every node, after the corresponding type-specific callback. `walk` skips the `comments` field and returns the original root. Callbacks may edit fields in place; the context contains only `parent` and your `state`. There are no `skip`, `stop`, `replace`, or semantic-context methods on this walker.

[Upstream Yuku’s traverser](https://yuku.fyi/parser/traverse/) documents native Zig modes, and its analyzer has a separate `module.walk` API. Those are different from the small `walk` function exported here. In particular, do not copy their hook order or context methods into a callback for this package.

If you analyzed before editing, the semantic tables still describe the original source. Print and re-analyze before querying semantics for the changed tree.

## Use familiar loop fields

A TSRX loop stores its fields under `statement`: `loop.statement.left`, for example. `normalizeProgram` adds convenient aliases on the wrapper:

```js
import { normalizeProgram, parseModule } from "@tsrx/yuku";

const program = parseModule("@for (const item of items) { <li/> }", "list.tsrx");
const loop = program.body[0];
normalizeProgram(program);

console.log(loop.left === loop.statement.left); // true
console.log(Object.keys(loop).includes("left")); // false
```

The aliases are non-enumerable, so JSON output and tree walkers still see only the original fields. This doesn't make a TSRX tree compatible with every ESTree tool; visitors still need to recognize TSRX node types.

The [API reference](/reference/api) also covers `duplicateBindings` and `duplicateBindingDiagnostics`, helpers for finding repeated variable declarations within a statement list.
