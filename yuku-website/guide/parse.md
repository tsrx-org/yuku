---
title: Parse
description: Turn source text into a tree, inspect nodes, and choose how to handle errors.
---

# Parse

`@tsrx/yuku` turns TSRX source into an abstract syntax tree (AST), with dedicated nodes for template constructs such as `@if` and `@for`. Use the tree to build compiler transforms, codemods, and lint rules. JavaScript and TypeScript are supported too. Add [semantic analysis](/guide/analyze) when a decision depends on bindings or scopes.

Start with a small template:

```js
import { parseModule } from "@tsrx/yuku";

const source = "const view = <h1>Hello</h1>;";
const program = parseModule(source, "hello.tsrx");
const heading = program.body[0].declarations[0].init;

console.log(heading.type); // "JSXElement"
console.log(source.slice(heading.start, heading.end)); // "<h1>Hello</h1>"
```

`Program` is the root of the tree. Its `body` contains the file's top-level statements. Here, the first statement declares `view`, whose initial value is our heading.

You rarely need to follow that whole path by hand. [`walk`](/guide/walk) finds nodes by type anywhere in the tree.

## Choose how errors reach you

| Function | Returns | On a source error |
| --- | --- | --- |
| `parseModule(source, filename)` | A `Program` | Throws `SyntaxError` |
| `parse(source, options)` | `{ program, comments, diagnostics }` | Returns diagnostics |

Use `parseModule` in a build tool that should stop on invalid input. Use `parse` in an editor or error reporter that needs to inspect problems:

```js
import { parse } from "@tsrx/yuku";

const source = "const view = <h1>Hello</h1>;";
const result = parse(source, { lang: "tsx" });

console.log(result.diagnostics); // []
```

Pass `lang: "tsx"` for TSRX. `parse` defaults to JavaScript and doesn't infer a language from your source.

`parseModule` infers the language from the filename: `.tsrx` and `.tsx` select `tsx`, `.jsx` selects `jsx`, `.d.ts` selects `dts`, and `.ts` selects `ts`. Other extensions select `js`. An explicit `lang` overrides this choice. It also uses module mode and enables scope-dependent early-error checks. Unlike the current upstream filename helpers, this wrapper does not infer CommonJS from `.cjs` or `.cts`, or TypeScript from `.mts` / `.cts`. For these files, use `parse` with explicit `lang` and `sourceType`.

## Explore the tree

Edit the source to update the tree. Select a node in the read-only AST to highlight the source it came from.

<!-- ast-explorer -->
```tsrx
<ul>
  @for (const item of items) {
    <li>{item.label}</li>
  }
</ul>
```

`type` tells you what a node represents. In the JavaScript API, `start` and `end` count UTF-16 code units in the source string; `end` is exclusive, just like `slice`. Native Zig spans count UTF-8 bytes. The transfer decoder converts positions for JavaScript consumers.

[Yuku’s native AST](https://yuku.fyi/parser/ast/) stores nodes in flat arrays with integer references. The JavaScript decoder exposes object nodes. Zig field names and native node tags are not the JavaScript API: for example, use `Program.body` and `node.type` here, not `tree.extra` or `tree.data`.

TSRX constructs keep their own node types. The `@for` above is a `JSXForExpression` with its loop in `statement`. The [node guide](/architecture/dialect#recognize-tsrx-nodes) maps the other constructs.

## Parser options

Pass these options as the second argument to `parse`.

| Option | `parse` default | When to change it |
| --- | --- | --- |
| `lang` | `"js"` | Use `"tsx"` for TSRX. Also accepts `jsx`, `ts`, and `dts`. |
| `sourceType` | `"module"` | Read a `script` or `commonjs` file. |
| `preserveParens` | `true` | Set to `false` to omit `ParenthesizedExpression` wrappers. |
| `semanticErrors` | `false` | Run scope-dependent early-error checks, such as invalid redeclarations and exports without a local binding. This does not return the semantic tables. |
| `attachComments` | `false` | Attach comments to nodes so the printer can keep them. The flat `comments` list is returned either way. |
| `loose` | `false` | Recover some unfinished markup in an editor. |

For error collection and recovery examples, continue to [Diagnostics](/guide/diagnostics). Detailed signatures, including the low-level `parseWire`, `decode`, and `encode` functions, live in the [API reference](/reference/api).
