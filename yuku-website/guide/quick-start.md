---
title: Quick start
description: Install the package, parse a small example, and find your next step.
---

# Quick start

`@tsrx/yuku` provides the parser, semantic analysis, and code generator for building tools around [TSRX](https://tsrx.dev). It extends [Yuku](https://yuku.fyi), the JavaScript and TypeScript toolchain written in Zig, with template syntax such as `@if`, `@for`, and `@{ ... }`.

A compiler can parse a module, use its semantic model to plan a transformation, rewrite the AST, and generate source with a map. Lints and codemods can use the same infrastructure. Your framework supplies the transformation from TSRX to its runtime.

## Install

Use Node.js 22 or newer on macOS with Apple Silicon or Linux x64 with glibc. Other setups need a [source build](/guide/build-from-source); see [platform support](/reference/platforms) before installing.

<!-- pm-install -->
```sh
npm install @tsrx/yuku
```

## Parse your first template

Save this as `example.mjs`:

```js
import { parseModule } from "@tsrx/yuku";

const source = `<ul>@for (const item of items) { <li>{item.label}</li> }</ul>`;
const program = parseModule(source, "list.tsrx");
const list = program.body[0].expression;

console.log(list.type);
console.log(list.children[0].type);
```

Run `node example.mjs`. Press **Play** to see the command and its output:

<!-- terminal-demo:getting-started-first-parse -->

The `<ul>` became a `JSXElement`. Its loop became a `JSXForExpression`. These objects are nodes in the **abstract syntax tree**, or AST.

`"list.tsrx"` tells the parser which grammar to use; this call reads the `source` string, not a file on disk. `parseModule` throws a `SyntaxError` if the source has an error.

## What would you like to build?

| Task | Next guide |
| --- | --- |
| Read a file and inspect its structure | [Parse](/guide/parse) |
| Change nodes in a codemod | [Walk and transform](/guide/walk) |
| Build compiler passes using bindings, captures, and module records | [Analyze](/guide/analyze) |
| Print a changed tree | [Generate](/guide/generate) |
| Improve these docs or the parser | [Contribute](/guide/contributing) |

You can also [try the playground](/playground) without installing anything.
