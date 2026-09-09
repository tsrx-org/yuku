<p align="center">
  <a href="https://yuku.tsrx.dev"><img alt="Yuku for TSRX" width="600" src="https://raw.githubusercontent.com/tsrx-org/yuku/HEAD/.github/assets/readme-hero.png"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tsrx/yuku"><img alt="npm version" src="https://img.shields.io/npm/v/@tsrx/yuku"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img alt="supported Node.js versions" src="https://img.shields.io/node/v/@tsrx/yuku"></a>
  <a href="https://github.com/tsrx-org/yuku/actions/workflows/checks.yml"><img alt="CI status" src="https://github.com/tsrx-org/yuku/actions/workflows/checks.yml/badge.svg?branch=main"></a>
  <a href="https://discord.gg/HCYpT5QHQR"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-7289da?logo=discord&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@tsrx/yuku"></a>
</p>

Parse, analyze and print [TSRX](https://tsrx.dev) with the [Yuku](https://yuku.fyi) parser. One JavaScript API, three tools for `.tsrx` files:

- a **parser**, which reads a file into a tree your own tools can work with
- an **analyzer**, which supplies scopes, binding identity, reference classifications, and module records for compiler passes and lint rules
- a **code generator**, which turns a tree back into source text

Yuku supplies the JavaScript and TypeScript parser and semantic infrastructure. This repository adds a TSRX dialect, adapters, and JavaScript and WebAssembly hosts against a pinned Yuku dependency. See [how the dialect works](https://yuku.tsrx.dev/architecture/dialect) for that boundary.

[**Docs**](https://yuku.tsrx.dev) &nbsp;·&nbsp; [**Quick start**](https://yuku.tsrx.dev/guide/quick-start) &nbsp;·&nbsp; [**Playground**](https://yuku.tsrx.dev/playground)

## Install

```sh
npm install @tsrx/yuku
```

Installing downloads one ready-built addon for your machine: macOS on Apple Silicon, or Linux x64 with glibc. Node.js 22 or newer. Anything else [builds from source](https://yuku.tsrx.dev/guide/build-from-source).

## Usage

```tsx
// src/Cart.tsrx
export function Cart({ items }): unknown @{
  const total = items.length;

  <section class="cart">
    @if (total > 0) {
      @for (const item of items; index i; key item.id) {
        <span>{i}:{item.id}</span>
      } @empty {
        <span>empty</span>
      }
    } @else {
      <span>no cart</span>
    }
    <style>.cart { display: grid; }</style>
  </section>
}
```

```js
import { parseModule, walk } from "@tsrx/yuku";

const program = parseModule(source, "Cart.tsrx");
walk(program, {
  JSXCodeBlock(node) {
    // every @{ } block in the file
  },
});
```

`parseModule` hands back a `Program` in the ESTree shape most JavaScript tools already read, with `start` and `end` offsets on every node. The TSRX parts keep their own names instead of being rewritten into something else: `JSXCodeBlock`, `JSXIfExpression`, `JSXForExpression`, `JSXSwitchExpression`, `JSXTryExpression`, `JSXStyleElement` and `TSRXExpression`. It takes the same arguments as `parseModule` from `@tsrx/core`, so it drops into code written for that. A source error throws a `SyntaxError` containing source offsets; `parse` returns the diagnostics instead of throwing. [Parse](https://yuku.tsrx.dev/guide/parse) has the full shape.

## What it does

**Parse.** `parse` and `parseModule` support TSRX control flow, template blocks, style structure, lazy destructuring, and dynamic tags within the documented syntax boundaries. Yuku supplies the ordinary JavaScript and TypeScript grammar. See [Parse](https://yuku.tsrx.dev/guide/parse) and [Limitations](https://yuku.tsrx.dev/reference/limitations).

**Analyze.** `analyze(source, "Cart.tsrx")` parses and runs native semantic analysis, returning the tree plus scopes, symbols, references, import/export records, and early-error diagnostics. Use those facts to plan compiler transforms, collect captured bindings, distinguish runtime from type-only uses, or build lint rules. [Analyze](https://yuku.tsrx.dev/guide/analyze) contains a working compiler-pass example. This package exposes per-file tables; upstream Yuku’s project `Analyzer` and cross-file linking APIs are separate.

**Generate.** `generate(program)` prints a tree back out as source: types kept or stripped, pretty or minified, comments kept or dropped, quotes as written, and a source map when you ask for one. Fixture tests exercise parse/print/parse round trips. Check `errors` before using stripped output: runtime TypeScript constructs such as enums need a lowering pass. [Generate](https://yuku.tsrx.dev/guide/generate) explains the options and includes an editable source / read-only output example.

**Framework compilation.** These APIs are compiler building blocks. Your framework’s TSRX plugin supplies the transforms and runtime that turn `.tsrx` into code a browser can execute. See [tsrx.dev/getting-started](https://tsrx.dev/getting-started).

## Platforms

`@tsrx/yuku` is platform-neutral JavaScript. It lists two addon packages in `optionalDependencies`, pinned to its own version, and your package manager installs the one for your machine.

| Package                    | Runs on                | Built for          |
| -------------------------- | ---------------------- | ------------------ |
| `@tsrx/yuku-darwin-arm64`  | macOS on Apple Silicon | Apple M1 and newer |
| `@tsrx/yuku-linux-x64-gnu` | Linux x64 with glibc   | x86-64-v2 (SSE4.2) |

On other platforms, the npm package has no automatic JavaScript or WASM fallback. Loading the native binding fails unless you provide a compatible source build. [Build from source](https://yuku.tsrx.dev/guide/build-from-source) takes Zig 0.16 and pnpm:

```sh
zig build            # writes the package to zig-out/npm/yuku/
zig build test       # the parser test suite
pnpm test            # the JavaScript test suite
```

## Contributing

Start with the [contribution guide](yuku-website/guide/contributing.md) for docs edits, parser setup, and the checks to run. The [website README](yuku-website/README.md) covers local previews and interactive examples. Bug reports and larger proposals are welcome in [the issue tracker](https://github.com/tsrx-org/yuku/issues).

Join the [TSRX Discord community](https://discord.gg/HCYpT5QHQR).

## License

[MIT](LICENSE).
