---
title: Walk and transform
description: Visit the nodes you care about, change them and print the result: a codemod in a few lines.
---

# Walk and transform

Visit the nodes you care about, change them and print the result: a codemod in a few lines.

```js
import { parse, walk } from "@tsrx/yuku";

const { program } = parse(source, { lang: "tsx" });
walk(program, {
  JSXIfExpression(node) {
    console.log("@if at", node.start, node.end);
  },
});
```

Pick a node type, then focus a match to see its source span.

<!-- widget:visitor type="JSXIfExpression" -->
```tsrx
export function Badge({ count, label }) @{
  <span class="badge">
    @if (count > 99) {
      <b>99+</b>
    } @else if (count > 0) {
      <b>{count}</b>
    }
    @if (label) {
      <small>{label}</small>
    }
  </span>
}
```

## Each node type gets its own visitor

`walk(root, visitors, state?)` visits every object with a string `type`, including objects in arrays. It skips `comments`.

```js
walk(program, {
  JSXForExpression: {
    enter(node, { parent, state }) { state.depth += 1; },
    leave(node, { parent, state }) { state.depth -= 1; },
  },
  enter(node) { /* every node, after its own enter */ },
  leave(node) { /* every node, after its own leave */ },
}, { depth: 0 });
```

A function runs when `walk` enters a matching node. Use `{ enter, leave }` when you need both directions. Each call receives `{ parent, state }`, and `walk` returns the original root.

## Change a field, then generate the file

This codemod renames every `class` attribute to `className`:

```js
import { readFile, writeFile } from "node:fs/promises";
import { generate, parseModule, walk } from "@tsrx/yuku";

const file = process.argv[2];
const source = await readFile(file, "utf8");
const program = parseModule(source, file);

let renamed = 0;
walk(program, {
  JSXAttribute(node) {
    if (node.name.type !== "JSXIdentifier" || node.name.name !== "class") return;
    node.name.name = "className";
    renamed += 1;
  },
});

const { code, errors } = generate(program);
if (errors.length > 0) throw new Error(errors[0].message);
await writeFile(file, `${code}\n`);
console.log(`${file}: renamed ${renamed} attribute${renamed === 1 ? "" : "s"}`);
```

```sh
node class-to-classname.mjs Cart.tsrx
# Cart.tsrx: renamed 3 attributes
```

`parseModule` stops a broken file before it can be rewritten. `generate` formats the whole file, so the output may not keep your original spacing.

To keep comments, pass a `comments` array to `parseModule`, then use `comments: "all"` with `generate`.

## Normalize fields before using generic tooling

```js
const { program } = parse("const v = @for (const item of items; key item.id) { <li/> };", { lang: "tsx" });
const loop = program.body[0].declarations[0].init;
loop.type;            // "JSXForExpression"
loop.left;            // undefined
loop.statement.type;  // "ForOfStatement"
loop.statement.key;   // the item.id MemberExpression
```

The loop fields start under `statement`. `normalizeProgram` adds familiar aliases without changing JSON output:

```js
import { normalizeProgram } from "@tsrx/yuku";

normalizeProgram(program);
loop.left.type;                        // "VariableDeclaration"
loop.body.type;                        // "BlockStatement"
JSON.stringify(loop).includes("left"); // false: the alias is invisible to serialisers
```

It adds loop fields such as `left`, `right`, `body`, `index`, and `key`; switch nodes get `discriminant` and `cases`; try nodes get `block`, `handler`, and `finalizer`.

## Find repeated variables in one block

```js
import { duplicateBindings } from "@tsrx/yuku";

const source = "let a = 1;\nlet a = 2;\nvar b;\nvar b;\n";
duplicateBindings(parse(source, { lang: "ts" }).program, source);
// [{ name: "a", declaration: { start: 4, end: 5 }, redeclaration: { start: 15, end: 16 } }]
```

Two `var` declarations with the same name are allowed. Other repeated variable declarations in the same statement list are returned; functions, classes, imports, parameters, and catch bindings are not checked.

`duplicateBindingDiagnostics(program, source)` returns the same findings as diagnostics.

## Turn offsets into line and column

```js
import { sourceLocation, sourcePosition } from "@tsrx/yuku";

sourcePosition("ab\ncd", 4);      // { line: 2, column: 1 }
sourceLocation("ab\ncd", 1, 4);   // { start: { line: 1, column: 1 }, end: { line: 2, column: 1 } }
```

Lines start at 1, columns at 0, and out-of-range offsets are clamped.

Next, see how these nodes are parsed on [How the dialect works](/architecture/dialect).
