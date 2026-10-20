---
title: API
description: Every export of @tsrx/yuku, with its signature and the TSRX node types.
---

# API

```ts
import { Analyzer, BindingFlags, analyze, generate, parse } from "@tsrx/yuku";
```

| Export | Signature |
| --- | --- |
| `parse` | `parse(source: string, options?: ParseOptions): ParseResult` |
| `analyze` | `analyze(source: string, options?: AnalyzeOptions): Module` |
| `Analyzer` | `new Analyzer(options?: AnalyzerOptions)`, with `setFile`, `deleteFile`, `module`, `modules`, `diagnostics`, and `link` |
| `generate` | `generate(node: Node, options?: GenerateOptions): GenerateResult` |
| `BindingFlags` | The flags of a `Binding`, for `binding.has(BindingFlags.Const)` |

The options are Yuku's, without `lang` and `wasm`, and `parse` defaults `preserveParens` to `false`. The guides cover each: [Parse](/guide/parse), [Analyze](/guide/analyze), and [Generate](/guide/generate). `generate` takes every option of Yuku's but `print`, which `@tsrx/yuku` sets to its TSRX printers.

## Types

`@tsrx/yuku` exports Yuku's types, `yuku/types` for the tree and `yuku/analyzer` for the semantic model, and its own for TSRX. It adds TSRX's nodes to Yuku's `DialectNodes`, so `Node`, `node.type` checks, and visitors know them.

<!-- block:tsrx-types -->

These are read from [`src/ast.ts`](https://github.com/tsrx-org/yuku/blob/main/src/ast.ts). The `statementType` of each directive names the standard statement it reads like.
