# Migrating from 0.7

`@tsrx/yuku` 0.8.0 is a new implementation, [Arshad Yaseen](https://github.com/arshad-yaseen)'s [yuku-tsrx](https://github.com/arshad-yaseen/yuku-tsrx), with a new API. The 0.7 code stays on the [`legacy-0.7`](https://github.com/tsrx-org/yuku/tree/legacy-0.7) branch and the [`v0.7.0`](https://github.com/tsrx-org/yuku/tree/v0.7.0) tag.

## Install

There are no native addons anymore: the package is one WebAssembly module, inlined, so `@tsrx/yuku-darwin-arm64` and `@tsrx/yuku-linux-x64-gnu` are no longer installed or published. It runs on Node.js 16.4 or newer (0.7 needed 22), Bun, Deno, Workers, and browsers, on every platform.

## Parsing

`parseModule(source, filename, options)` is now `parse(source, { path })`, and it never throws. It returns the program with every diagnostic, where 0.7 threw a `SyntaxError` at the first error unless `collect` was set.

```ts
// 0.7
import { parseModule } from "@tsrx/yuku";
const errors = [];
const program = parseModule(source, "App.tsrx", { collect: true, errors });

// 0.8
import { parse } from "@tsrx/yuku";
const { program, comments, diagnostics } = parse(source, { path: "App.tsrx" });
```

A diagnostic is `{ severity, message, path, start, end, labels, help }`, with `start` and `end` as UTF-16 offsets into `source`. Nodes have `start` and `end` and no `loc`. TSRX errors keep their `TSRXnnnn` code at the start of the message, as `@tsrx/core` words them.

The options are Yuku's: `path`, `sourceType`, `preserveParens`, `semanticErrors`, `attachComments`, and `tokens`. `preserveParens` defaults to `false`, as in `@tsrx/core`, so `(a)` reads as `a`.

## The tree

The tree is ESTree with TSRX's node types, as `@tsrx/core` names them. What differs from 0.7:

- `@else if` is an `IfStatement` in the `alternate` of the `JSXIfExpression`, as in `@tsrx/core`. 0.7 nested another `JSXIfExpression`.
- `<script>` is a plain `JSXElement` whose body is one `JSXText`, kept as written. 0.7 had a `JSXScriptElement`.
- `<style>` is a `JSXStyleElement` whose `children` are the CSS as one `JSXText`, kept as written. 0.7 gave it a `css` string and a `StyleSheet` child with `CssRule`, `CssAtrule`, and `CssSelector` nodes for scoping.
- A code block renders a single node, and its code comes before its output, as in `@tsrx/core`: two nodes, or text, need a fragment (`TSRX2011`), and a statement after the output is an error (`TSRX2012`).

The node types are in `@tsrx/yuku`'s types, which extend Yuku's `yuku/types`.

## Walking, analysis and printing

The 0.7 helpers are gone. Their replacements:

| 0.7 | 0.8 |
| --- | --- |
| `walk` | `walk` from `yuku/ast` |
| `analyze` | `analyze(source, { path })`, Yuku's semantic model |
| `generate` | `generate(node)`, which prints TSRX back |
| `normalizeProgram` | not needed: the tree already has `@tsrx/core`'s node types |
| `sourceLocation`, `sourcePosition` | compute lines from `start` and `end` |
| `duplicateBindings`, `duplicateBindingDiagnostics` | `parse(source, { semanticErrors: true })` |
| `isEventAttribute`, `normalizeEventName` | `isEventAttribute` and `normalizeEventName` from `@tsrx/core` |
| `encode`, `decode`, `parseWire`, `decodeAnalyzer` | none: the tree crosses from WebAssembly in one buffer, decoded on read |
