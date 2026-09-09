---
title: How the dialect works
description: Follow a TSRX construct from parser extension to JavaScript tree.
---

# How the dialect works

Yuku supplies the JavaScript and TypeScript parser. This repository adds TSRX syntax through a **dialect**: a set of extensions selected when the parser is compiled.

That boundary is the useful starting point for a contribution. You don't need to understand the whole TypeScript grammar to fix a TSRX loop.

## Follow one construct

Consider `@for (const item of items) { <li/> }`:

1. Yuku reaches a grammar point where an extension can recognize syntax.
2. The TSRX parser extension recognizes `@for` and parses its loop and template body.
3. The dialect stores a `JSXForExpression` associated with an ordinary loop statement.
4. The transfer code and JavaScript decoder expose it as a node with `type`, source offsets, and a `statement` field.
5. The semantic adapter exposes the loop to Yuku’s scope and binding pass. A compiler can use the resulting references and scopes to plan its transform.
6. Code generation reads the dialect record and prints it back as `@for`.

The parser preserves the construct. A framework compiler decides how that loop should run.

## Find the relevant code

| Part | File |
| --- | --- |
| Parser extension entry points | `src/dialect/parser_extension.zig` |
| `@if`, `@for`, `@switch`, and `@try` parsing | `src/dialect/control_flow.zig` |
| TSRX node records and added fields | `src/dialect/schema.zig` |
| Tree transfer to and from JavaScript | `src/dialect/transfer.zig` |
| Semantic adapter and table transfer | `src/dialect/semantic.zig` and `src/dialect/semantic_transfer.zig` |
| Printing | `src/dialect/codegen.zig` |
| Public JavaScript functions and types | `npm/yuku/index.js` and `npm/yuku/index.d.ts` |

A new construct can touch several of these parts. Test its tree shape, name resolution, and printed output as well as whether it parses.

## Recognize TSRX nodes

A record introduces a new node type, such as `JSXForExpression`. An overlay adds fields to an existing type, such as `lazy: true` on an `ObjectPattern`.

| Construct | Node type | Where it can appear |
| --- | --- | --- |
| `@{ ... }` | `JSXCodeBlock` | At the top level, as a value, as a JSX child, or as a function or arrow body |
| `@if` | `JSXIfExpression` | At the top level, as a value, or as a JSX child |
| `@for` | `JSXForExpression` | At the top level, as a value, or as a JSX child |
| `@switch` | `JSXSwitchExpression` | At the top level, as a value, or as a JSX child |
| `@try` | `JSXTryExpression` | At the top level, as a value, or as a JSX child |
| `&{ ... }` | `ObjectPattern` with `lazy: true` | In a declaration, parameter, assignment, loop head, or catch parameter |
| `&[ ... ]` | `ArrayPattern` with `lazy: true` | In a declaration, parameter, assignment, loop head, or catch parameter |
| `; index ...` or `; key ...` | `ForOfStatement` with `index` or `key` | In an `@for` or TypeScript `for...of` loop |
| `import { x } from server` | `Identifier` for `server` | As an import source |
| `<{tag}>...</{tag}>` | `JSXElement` with a `JSXExpressionContainer` name | Anywhere a JSX element can appear |
| `<style>...</style>` | `JSXStyleElement` with a `StyleSheet` child | As a JSX child or a standalone JSX value |
| `<script>...</script>` | `JSXScriptElement` with raw `JSXText` | Raw template contents, retained without parsing as JavaScript |

The generated [API reference](/reference/api) lists each node's fields.

## Connect the native tree to semantic analysis

[Yuku’s AST](https://yuku.fyi/parser/ast/) uses flat node storage, child indices, and pooled strings. The dialect adds records and overlays associated with nodes in that tree. The transfer layer encodes these additions; the JavaScript decoder exposes the TSRX node shapes listed above. Native spans count bytes, while decoded JavaScript positions count UTF-16 code units.

For analysis, `src/dialect/semantic.zig` temporarily presents dialect constructs through ordinary node shapes that Yuku’s binder understands, calls the native semantic pass, then restores the original nodes. A `JSXCodeBlock`, for example, supplies a block containing its statements and render expression. This is an internal analysis adapter; the returned AST still contains TSRX.

The semantic tables and AST share node indices. That lets a transform join scope and reference facts to the same JavaScript nodes it will edit and print. CSS and raw script bodies remain data, and the `reset` catch-parameter gap is documented in [Limitations](/reference/limitations).

## Understand the dependency boundary

The extension hooks are selected at compile time. For syntax they don't handle, Yuku continues with its own grammar.

This repository depends on a pinned sibling checkout containing the Yuku extension hooks through `build.zig.zon`; upstream upgrades are explicit work, not automatic. The docs at [yuku.fyi](https://yuku.fyi/) describe current upstream Yuku, which can have APIs and behavior newer than this pin. The public contract here is `npm/yuku/index.js`, its declarations, the host implementations, and this fork’s tests. [Build from source](/guide/build-from-source) shows how to get the matching revision.
