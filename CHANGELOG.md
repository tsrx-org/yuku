# Changelog

## 0.8.0

TSRX as a [Yuku dialect](https://yuku.fyi/parser/dialect/): one Zig file compiled into Yuku's WebAssembly.

- `parse`, `analyze`, `Analyzer` and `generate`. `parse` returns `{ program, comments, diagnostics }` and never throws.
- Every TSRX source of the TSRX repository and of `@tsrx/core`'s tests parses, or fails, as `@tsrx/core` 0.5.5 parses it, and the tree has `@tsrx/core`'s node types: `@else if` is an `IfStatement`, `<script>` is a plain `JSXElement`, `<style>` keeps its CSS as one `JSXText`, `preserveParens` defaults to `false`, and a code block renders a single node, after its code (`TSRX2011`, `TSRX2012`).
- One WebAssembly package for every platform, with no native addons: Node.js 16.4 or newer, Bun, Deno, Workers, and browsers.
- 4.8x faster than `@tsrx/core` on the pages of tsrx.dev, and 9.2x on its test suite.
