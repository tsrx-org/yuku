---
title: Yuku parses; this package answers a few questions
description: Yuku parses TypeScript; this package adds only the TSRX rules on top, so there is no fork to keep in sync.
---

# Yuku parses; this package answers a few questions

Yuku parses TypeScript; this package adds only the TSRX rules on top, so there is no fork to keep in sync.

## Yuku does the parsing

[Yuku](https://yuku.fyi) parses all the TypeScript in your file. At a handful of points in its grammar, it asks `@tsrx/yuku`, “Is this yours?” That question is a hook: a fixed place where Yuku lets this package recognize extra syntax.

The package answers yes only for [TSRX](https://tsrx.dev) syntax. For everything else, each hook answers no and Yuku continues normally. When a hook answers yes, it returns the parsed result and Yuku carries on with the rest of the file.

## What each construct returns

A node is one item in the structured result returned by the parser. These are the nodes your code can look for:

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

## Why this is safe to depend on

There is no forked TypeScript parser to drift behind. Yuku releases flow through, while this package remains responsible only for its hooks. To review that boundary, read the complete hook list in `src/dialect/parser_extension.zig`.

Next, see how parser speed is measured in [Benchmarks](/reference/benchmarks).
