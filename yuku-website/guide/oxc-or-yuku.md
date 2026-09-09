---
title: Oxc or Yuku?
description: Choose the TSRX linting and formatting toolchain or the compiler APIs your project needs.
---

# Oxc or Yuku?

Use [Oxc for TSRX](https://oxc.tsrx.dev) for the existing linting, formatting, and editor integrations around `.tsrx` files. Use `@tsrx/yuku` when building a compiler or another tool that needs a TSRX AST, native semantic analysis, and code generation from JavaScript or TypeScript.

The two can serve different parts of the same project: Oxc for the lint and format workflow, Yuku inside the framework compiler. Yuku’s `generate` is an AST printer; it does not replace a configurable project formatter.

## What Yuku gives a compiler

- A tree with dedicated TSRX node types, suitable for structural transforms.
- Per-file scopes, binding identity, type/value references, write information, and module records for semantic compiler passes.
- Code generation with formatting, type stripping, and Node source maps.

[Analyze](/guide/analyze) shows how a pass uses that model to collect captured bindings. The package currently exposes per-file tables; the project-level `Analyzer` documented on [yuku.fyi](https://yuku.fyi/analyzer/) is a separate upstream API.

## Read performance numbers in context

[Yuku’s upstream introduction](https://yuku.fyi/) separates native parsing from npm calls that obtain a JavaScript AST. Its npm benchmark includes AST transfer and decoding. Yuku’s compact transfer format is designed to keep that boundary inexpensive; a native-only parser benchmark measures different work.

The figures below are saved upstream npm benchmark results for JavaScript inputs. They are not measurements of TSRX compilation, linting, or your application. See [Benchmarks](/reference/benchmarks) for this repository’s separate TSRX corpus and reproduction command.

<figure>
  <img src="/assets/benchmarks/parse-react.png" alt="Parse time for react.js, 0.07 MB: Yuku 0.30 ms, Acorn 0.88 ms, Babel 1.35 ms, Oxc 1.50 ms, SWC 2.78 ms" width="1500" height="430" loading="lazy">
  <figcaption>react.js, 0.07 MB. Median parse time from <a href="https://github.com/yuku-toolchain/ecmascript-parser-benchmark-js">Yuku's npm benchmark</a>.</figcaption>
</figure>

<figure>
  <img src="/assets/benchmarks/parse-typescript.png" alt="Parse time for typescript.js, 7.83 MB: Yuku 46.06 ms, Acorn 138.05 ms, Babel 188.32 ms, Oxc 263.65 ms, SWC 508.10 ms" width="1500" height="430" loading="lazy">
  <figcaption>typescript.js, 7.83 MB. Same benchmark.</figcaption>
</figure>

Start with the [quick start](/guide/quick-start) to try the compiler APIs.
