<p align="center">
  <a href="https://yuku.tsrx.dev"><img alt="Yuku for TSRX" width="600" src="https://raw.githubusercontent.com/tsrx-org/yuku/HEAD/.github/assets/readme-hero.png"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tsrx/yuku"><img alt="npm version" src="https://img.shields.io/npm/v/@tsrx/yuku"></a>
  <a href="https://nodejs.org/en/about/previous-releases"><img alt="supported Node.js versions" src="https://img.shields.io/node/v/@tsrx/yuku"></a>
  <a href="https://github.com/tsrx-org/yuku/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/tsrx-org/yuku/actions/workflows/ci.yml/badge.svg?branch=main"></a>
  <a href="https://discord.gg/HCYpT5QHQR"><img alt="Discord" src="https://img.shields.io/badge/Discord-Join%20the%20community-7289da?logo=discord&logoColor=white"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/@tsrx/yuku"></a>
</p>

Parse, analyze and print [TSRX](https://tsrx.dev) with the [Yuku](https://yuku.fyi) parser. One JavaScript API, three tools for `.tsrx` files:

- a **parser**, which reads a file into a tree your own tools can work with
- an **analyzer**, which links every scope, symbol and reference in that tree
- a **code generator**, which turns a tree back into source text

Yuku does all the JavaScript and TypeScript work; this package adds only the TSRX rules, as a dialect on top. Nothing is forked or patched.

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

`parseModule` hands back a `Program` in the ESTree shape most JavaScript tools already read, with `start` and `end` offsets on every node. The TSRX parts keep their own names instead of being rewritten into something else: `JSXCodeBlock`, `JSXIfExpression`, `JSXForExpression`, `JSXSwitchExpression`, `JSXTryExpression`, `JSXStyleElement` and `TSRXExpression`. It takes the same arguments as `parseModule` from `@tsrx/core`, so it drops into code written for that. A file it cannot read throws a `SyntaxError` naming the line; `parse` returns the diagnostics instead of throwing. [Parse](https://yuku.tsrx.dev/guide/parse) has the full shape.

## What it does

**Parse.** `parse` and `parseModule` read every TSRX construct where TSRX allows it, `<style>` blocks with the rules inside them read into the tree, lazy `&{ }` destructuring patterns, and tags whose name is an expression. Ordinary `.js`, `.ts`, `.jsx` and `.tsx` go to Yuku unchanged.

**Analyze.** `analyze(source, "Cart.tsrx")` parses and then links the file: the same tree plus a `semantic` view of every scope, symbol, reference, import and export, and which symbol each reference resolves to. [Analyze](https://yuku.tsrx.dev/guide/analyze) shows what each table answers.

**Generate.** `generate(program)` prints a tree back out as source: types kept or stripped, pretty or minified, comments kept or dropped, quotes as written, and a source map when you ask for one. Every fixture in the test suite parses, prints and parses again to the same tree. [Generate](https://yuku.tsrx.dev/guide/generate) has every option with a live diff.

**This package compiles nothing.** Turning `.tsrx` into something a browser runs belongs to your framework's TSRX plugin. See [tsrx.dev/getting-started](https://tsrx.dev/getting-started).

## Platforms

`@tsrx/yuku` is platform-neutral JavaScript. It lists two addon packages in `optionalDependencies`, pinned to its own version, and your package manager installs the one for your machine.

| Package                    | Runs on                | Built for          |
| -------------------------- | ---------------------- | ------------------ |
| `@tsrx/yuku-darwin-arm64`  | macOS on Apple Silicon | Apple M1 and newer |
| `@tsrx/yuku-linux-x64-gnu` | Linux x64 with glibc   | x86-64-v2 (SSE4.2) |

On any other platform `import "@tsrx/yuku"` throws on the first call rather than falling back to anything slower. [Build from source](https://yuku.tsrx.dev/guide/build-from-source) takes Zig 0.16 and pnpm:

```sh
zig build            # writes the package to zig-out/npm/yuku/
zig build test       # the parser test suite
pnpm test            # the JavaScript test suite
```

## Contributing

Issues and pull requests are welcome at [the issue tracker](https://github.com/tsrx-org/yuku/issues). Plain JavaScript and TypeScript belong to Yuku; this package owns only the TSRX rules. [How the dialect works](https://yuku.tsrx.dev/architecture/dialect) describes the extension points and the file layout. Run `zig build test` and `pnpm test` first.

Join the [TSRX Discord community](https://discord.gg/HCYpT5QHQR).

## License

[MIT](LICENSE).
