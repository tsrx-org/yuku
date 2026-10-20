---
title: Generate
description: Print a TSRX program, or any node, back to source, with type stripping, minification, and source maps.
---

# Generate

`generate` prints a program, or any node in one, back to TSRX. It is [Yuku's code generator](https://yuku.fyi/parser/codegen/) with printers for TSRX's nodes, so an edited tree prints as TSRX again.

```js
import { generate, parse } from "@tsrx/yuku";

const source = `export function Greeting({ name }: { name: string }) @{
  <p>Hello, {name}</p>
}`;

const { program } = parse(source, { path: "Greeting.tsrx" });

generate(program).code;
// export function Greeting({ name }: {
//   name: string;
// }) @{
//   <p>Hello, {name}</p>
// }

generate(program, { strip: true }).code;
// export function Greeting({ name }) @{
//   <p>Hello, {name}</p>
// }
```

It returns `{ code, diagnostics, map }`. The test suite prints every source that parses, parses the output again, and checks that it prints the same code.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `strip` | `false` | Drop TypeScript-only syntax. What has no JavaScript form, such as an `enum`, is reported in `diagnostics` and left out. |
| `minify` | `false` | `true` for every minification, or `{ whitespace, syntax, quotes }` to pick. |
| `format` | `"pretty"` | `"pretty"` or `"compact"`. |
| `indent` | `2` | Spaces per level in the pretty format. |
| `quotes` | `"preserve"` | `"preserve"`, `"double"`, `"single"`, or `"shortest"`. |
| `comments` | `"some"` | Which comments to print: `"some"` keeps legal headers, JSDoc, and annotations. `"all"`, `"none"`, `"line"`, or `"block"`. |
| `sourceMap` | none | `{ source, file, sourceFileName }` to also return a source map in `map`. |

## Edit and print

Nodes are plain objects. Change one and print it, or print any node on its own.

```js
const fn = program.body[0].declaration;
fn.id.name = "Hello";

generate(fn).code; // function Hello({ name }: { ...
```

Comments print from each node's `comments`, so parse with `attachComments: true` to keep them with their nodes as you move them.

## Source maps

```js
const { code, map } = generate(program, {
  sourceMap: { source, file: "Greeting.js", sourceFileName: "Greeting.tsrx" },
});
```

`map` is a version 3 source map, with `sources`, `mappings`, and `names`.
