---
title: Quick start
description: Install @tsrx/yuku, parse a component, find a binding, and print it back.
---

# Quick start

`@tsrx/yuku` is a fast [TSRX](https://tsrx.dev) parser, analyzer, and code generator, built on [Yuku](https://yuku.fyi).

## Install

<!-- pm-install -->
```sh
npm install @tsrx/yuku
```

It runs in Node.js 16.4 or newer, Bun, Deno, Workers, and browsers. The package is one WebAssembly module, so there is nothing to compile and no native addon to pick. See [Runtimes](/reference/runtimes).

## Parse, analyze, generate

```js
import { analyze, generate, parse } from "@tsrx/yuku";

const source = `export const List = ({ items }) => @{
  @for (const item of items; key item.id) {
    <li>{item.name}</li>
  } @empty {
    <p>Nothing yet</p>
  }
}`;

const { program, diagnostics } = parse(source);

analyze(source).rootScope.find("List");

generate(program).code;
```

- `parse` builds an ESTree program, with TSRX's node types as [`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core) names them. It never throws: errors are in `diagnostics`, each with the `TSRXnnnn` code `@tsrx/core` reports.
- `analyze` gives Yuku's semantic model: scopes, bindings, references, imports, and exports. `Analyzer` does the same for a project of files.
- `generate` prints a program, or any node in it, back to TSRX.

The arrow above renders a `JSXCodeBlock` whose output is a `JSXForExpression`. Paste it into the [playground](/playground) to see the whole tree.

## Where next

| To | Read |
| --- | --- |
| Read a file and walk its tree | [Parse](/guide/parse) |
| Resolve names, in one file or across files | [Analyze](/guide/analyze) |
| Print a changed tree, strip types, or emit a source map | [Generate](/guide/generate) |
| Show errors with their codes | [Diagnostics](/guide/diagnostics) |
| See why it's fast | [How it works](/architecture/how-it-works) |
