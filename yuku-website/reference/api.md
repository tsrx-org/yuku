---
title: API reference
description: Find exported functions, options, and node types.
---

# API reference

Use this page when you know the function or type you need. If you're learning the package, start with the [quick start](/guide/quick-start).

| I want to… | Function | Example |
| --- | --- | --- |
| Parse a module and stop on errors | `parseModule` | [Parse](/guide/parse) |
| Read a tree and diagnostics separately | `parse` | [Diagnostics](/guide/diagnostics) |
| Obtain the semantic model for compiler and lint passes | `analyze` | [Analyze](/guide/analyze) |
| Visit or edit nodes | `walk` | [Walk and transform](/guide/walk) |
| Print a tree | `generate` | [Generate](/guide/generate) |

## Package boundary

These signatures describe `@tsrx/yuku`, not the separate upstream `yuku-parser`, `yuku-analyzer`, and `yuku-codegen` packages. In particular:

- `analyze` returns a per-file `AnalyzeResult` with table accessors. There is no exported project `Analyzer`, `Module`, `capturesOf`, or `SymbolFlags` API.
- `walk` callbacks receive `{ parent, state }`, without upstream analyzer visitor methods.
- Node source-map options are named `sourceMaps`; `generate` returns `{ code, errors, map }`.
- `parseModule` is this package’s module-oriented convenience wrapper.

## Find a signature

Filter by a function, option, or node name, then open a row for its signature. The **Try** links open related playground examples.

Signatures come from the package's `index.d.ts`. The build checks declared functions against `index.js` to catch export mismatches.

<!-- widget:api-from-dts -->

The npm package and this site's browser build expose different surfaces. See [Limitations](/reference/limitations) before using a playground example outside the site.
