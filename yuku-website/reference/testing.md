---
title: Testing and correctness
description: Understand the evidence behind this fork's parser, semantic, codegen, and documentation behavior.
---

# Testing and correctness

A successful parse is only one part of a compiler integration. The tree must preserve syntax, semantic facts must describe the intended bindings, and generated code must preserve the transformation you made.

## What the local checks cover

After [building from source](/guide/build-from-source), run these from the repository root:

| Command | Coverage |
| --- | --- |
| `zig build test` | Native unit, parser-control, and production-binding checks |
| `zig build test-m4-surfaces` | Native TSRX semantic and codegen behavior |
| `pnpm test` | JavaScript API, AST fixtures, decoder parity, diagnostics, options, and generation checks |
| `pnpm run check:generated` | Generated encoders and decoders agree with their inputs |
| `node tools/wasm-smoke.mjs --fences` | Eligible TSRX examples in the documentation parse in WASM |
| `pnpm run docs:verify-playground` | Built-site interactions, loading, and navigation in Chromium |

`test/m4.test.ts` includes binding resolution through template scopes, exclusion of stylesheet text from references, generated-code reparsing, and Node/browser option differences. `test/analyze-lang.test.ts` checks the filename and option rules. Tests of parse → print → parse compare tree structure while allowing source positions to change.

The code-fence check does not execute JavaScript API examples. Run those examples against the built package as well. A passing website build alone cannot establish that an explanation or API example is correct.

## How upstream is tested

[Yuku’s testing page](https://yuku.fyi/testing/) describes its ECMAScript, TypeScript, and Babel-derived corpus, independent AST snapshots, semantic-error cases, codegen and source-map checks, and fuzzing. Those results concern the upstream revision and packages that ran the suites.

This fork pins a separate dependency revision and adds TSRX behavior and hosts. Do not treat an upstream conformance percentage or test count as a result for this checkout. Use local test output and [the checks workflow](https://github.com/tsrx-org/yuku/blob/main/.github/workflows/checks.yml) when evaluating a change here.

A regression should exercise the layer it affects: syntax acceptance, AST fields, semantic resolution, generation, or host behavior. The [contribution guide](/guide/contributing) lists the files and commands for each change.
