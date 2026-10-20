# Changelog

## 0.8.0

A new implementation and a new API. `@tsrx/yuku` is now [Arshad Yaseen](https://github.com/arshad-yaseen)'s [yuku-tsrx](https://github.com/arshad-yaseen/yuku-tsrx): TSRX as a [Yuku dialect](https://yuku.fyi/parser/dialect/), one Zig file compiled into Yuku's WebAssembly. The 0.7 implementation stays on the [`legacy-0.7`](https://github.com/tsrx-org/yuku/tree/legacy-0.7) branch and the [`v0.7.0`](https://github.com/tsrx-org/yuku/tree/v0.7.0) tag. [docs/migrating-from-0.7.md](docs/migrating-from-0.7.md) has the steps.

- `parse`, `analyze`, `Analyzer` and `generate` replace `parseModule` and the 0.7 helpers. `parse` returns `{ program, comments, diagnostics }` and never throws.
- The tree matches `@tsrx/core` 0.5.5 on every TSRX source of its repository and tests: `@else if` is an `IfStatement`, `<script>` is a plain `JSXElement`, `<style>` keeps its CSS as one `JSXText`, `preserveParens` defaults to `false`, and a code block renders a single node, after its code (`TSRX2011`, `TSRX2012`).
- One WebAssembly package for every platform, with no native addons: Node.js 16.4 or newer, Bun, Deno, Workers, and browsers.
- 4.8x faster than `@tsrx/core` on the pages of tsrx.dev, and 9.2x on its test suite.
