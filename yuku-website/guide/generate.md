---
title: Generate
description: Print a syntax tree back to code, with optional formatting and source maps.
---

# Generate

`generate` is the emission step of a source-to-source tool: it prints the AST you give it, including edits made by your compiler or codemod. It controls formatting, attached comments, TypeScript syntax stripping, and source maps. It does not choose a framework runtime or lower templates for you.

```js
import { generate, parseModule } from "@tsrx/yuku";

const source = "export const answer: number = 42;";
const program = parseModule(source, "answer.ts");
const { code, errors } = generate(program, { strip: true });

if (errors.length > 0) throw new Error(errors[0].message);
console.log(code); // export const answer = 42;
```

`strip: true` removes TypeScript types. TSRX and JSX remain in the output: printing a template doesn't make it runnable JavaScript. A compiler must transform those constructs too.

## Check stripping errors

Type annotations, interfaces, and other erasable syntax can be removed. TypeScript constructs that need generated runtime code—such as non-ambient enums, namespaces, parameter properties, and import/export assignments—need a separate lowering pass. Stripping reports unsupported constructs in `errors` and continues emitting the rest. Do not publish that partial output as a successful build.

```js
import { generate, parseModule } from "@tsrx/yuku";

const program = parseModule("enum Mode { On }", "mode.ts");
const result = generate(program, { strip: true });
console.log(result.errors[0].message);
// TypeScript enums cannot be stripped to JavaScript
console.log(result.code); // empty: the enum was omitted
```

[Yuku’s codegen guide](https://yuku.fyi/parser/codegen/) explains the distinction between stripping and transpilation. The options below use this package’s spellings and behavior.

## Try the printer

Edit `count` in **Source**, or turn on **Strip types**. **Generated code** updates automatically; it is read-only.

<!-- codegen-walkthrough -->
```tsrx
// A small counter.
const count: number = 2;
const view = <p>{count}</p>;
```

## Keep the options you need

| Option | Default | Effect |
| --- | --- | --- |
| `strip` | `false` | Removes TypeScript types. |
| `format` | `"pretty"` | Use `"compact"` to remove optional whitespace. |
| `indent` | `2` | Spaces per indent in pretty output. |
| `quotes` | `"preserve"` | Use `"single"` or `"double"` to choose a quote style. |
| `comments` | `"some"` | Keeps selected comments such as legal headers and JSDoc. Use `"all"` or `"none"` to be explicit. |
| `minify` | `false` | Enables whitespace, syntax, and quote minification. |

To keep comments, attach them while parsing:

```js
import { generate, parseModule } from "@tsrx/yuku";

const source = "// Keep this note.\nconst count = 1;";
const program = parseModule(source, "count.ts", { attachComments: true });
const { code } = generate(program, { comments: "all" });
```

To minify whitespace alone, use `minify: { whitespace: true }`. Shortest quotes require syntax minification: use `minify: { syntax: true }`. `quotes: "shortest"` or `minify: { quotes: true }` on its own throws.

When `strip` and syntax minification are combined, stripping takes priority; whitespace minification still applies. See the [API reference](/reference/api) for every option.

## Add a source map in Node

A source map connects positions in generated code to the original file. Pass the exact source text you parsed:

```js
import { generate, parseModule } from "@tsrx/yuku";

const source = "export const answer: number = 42;";
const program = parseModule(source, "answer.ts");
const { code, map } = generate(program, {
  strip: true,
  sourceMaps: {
    source,
    file: "answer.js",
    sourceFileName: "answer.ts",
    sourcesContent: true,
  },
});

console.log(map.version); // 3
```

`map` is a Source Map V3 object, or `null` when no map was requested. `sourcesContent: true` includes the original text. The browser build doesn't support source maps. This package calls the Node option `sourceMaps` (plural); the upstream `yuku-codegen` example uses `sourceMap`.

## Transform before printing

Printing preserves TSRX and JSX. To compile a template for a framework, first transform its nodes, then pass the resulting tree to `generate`.

[Walk and transform](/guide/walk) shows how to visit and change nodes.
