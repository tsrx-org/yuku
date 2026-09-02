---
title: API
description: Search every exported function, option, and node type.
---

# API

Search every export, signature, option, and node type.

```js
import { parseModule, analyze, generate, walk } from "@tsrx/yuku";
```

This reference is generated from `index.d.ts` during the docs build. The build also checks its declared functions against `index.js`, so a mismatch fails instead of publishing stale signatures.

## How to read it

Filter by a name or any word in its signature. Each function has a Try link that opens a matching playground example. Option rows show the addon's defaults and the combinations that throw.

## `parse` or `parseModule`

`parse` returns `{ program, comments, diagnostics }` and never throws. It defaults to `lang: "js"`, so pass `lang: "tsx"` for [TSRX](https://tsrx.dev).

`parseModule(source, filename)` infers the language, forces module mode, enables semantic errors, and adjusts each error span to the authored construct. It throws on the first error unless you pass `collect` or `loose`. Use it in a build tool; use `parse` when you want to handle diagnostics yourself.

`generate` strips and minifies through both hosts. Its `sourceMaps` option returns Source Map V3 through npm; the browser build has no source maps.

Filter the exports by name, then open one to read its signature.

<!-- widget:api-from-dts -->

Whether the addon those functions call exists for your machine: [Platforms and versions](/reference/platforms).
