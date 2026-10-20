---
title: Runtimes
description: Node.js 16.4 or newer, Bun, Deno, Workers, and browsers, from one WebAssembly package.
---

# Runtimes

`@tsrx/yuku` is one WebAssembly module and a little JavaScript, the same on every platform and CPU. There are no native addons and no install scripts.

| Runtime | |
| --- | --- |
| [Node.js](https://nodejs.org) | 16.4 or newer, the first with the WebAssembly SIMD the module uses. CI parses a source on 16.4.0 |
| [Bun](https://bun.sh "brand:bun") | As installed from npm |
| [Deno](https://deno.com "brand:deno") | `import { parse } from "npm:@tsrx/yuku"` |
| Cloudflare Workers | The `workerd` export condition imports the `.wasm` file, since workerd can't compile WebAssembly from bytes |
| Browsers | Through a bundler, which takes the module inlined in the package |

The package is an ES module. The module's bytes are inlined in its JavaScript, so in Node.js, Bun, Deno, and browsers it loads without reading a file or making a request.

## In the browser

Bundle it like any ES module. The [playground](/playground) on this site runs the published package in your tab, with its `.wasm` served as a file next to the bundle instead of inlined.
