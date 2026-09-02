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

The official Yuku integration for TSRX. It gives you three tools for `.tsrx`
files, from one JavaScript API:

- a **parser**, which reads a file into a tree your own tools can work with
- an **analyzer**, which finds every scope, symbol, and reference in that tree
- a **code generator**, which turns a tree back into source text

A `.tsrx` file is TypeScript with HTML-like markup in it, plus blocks like `@if`
and `@for` for showing something only sometimes, or once per item in a list.
[Yuku](https://github.com/yuku-toolchain/yuku) is a fast JavaScript and
TypeScript parser written in Zig. This package teaches it to read `.tsrx` too,
as a compile-time dialect: Yuku does all the JavaScript and TypeScript work and
this package owns only the TSRX rules. Nothing is forked or patched.

_Yuku for TSRX is the official Yuku integration maintained by the TSRX project._

[**Docs**](https://yuku.tsrx.dev) &nbsp;·&nbsp; [**Getting started**](https://yuku.tsrx.dev/guide/quick-start) &nbsp;·&nbsp; [**Playground**](https://yuku.tsrx.dev/playground)

## Install

```sh
npm install @tsrx/yuku@latest
```

You do not need Zig. Installing downloads one ready-built addon for your
computer, one of two: macOS on Apple Silicon, or Linux x64 with glibc. Anything
else has to build from source. [Platforms](https://yuku.tsrx.dev/reference/platforms)
has both, and what building from source takes. You need Node.js 22 or newer.

## Usage

Save this as `src/Cart.tsrx`. It has the three things a `.tsrx` file adds to
TypeScript: an `@{ }` block around the body, `@if` and `@for` with their
`@else` and `@empty` branches, and a `<style>` element holding plain CSS.

```tsx
export function Cart({ items }): unknown @{
  const total = items.length;

  <section className="cart">
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

`parseModule` hands back a `Program` in the ESTree shape most JavaScript tools
already read, with `start` and `end` offsets on every node. The TSRX parts keep
their own names rather than being lowered to something else: `JSXCodeBlock`,
`JSXIfExpression`, `JSXForExpression`, `JSXSwitchExpression`,
`JSXTryExpression`, `JSXStyleElement`, and `TSRXExpression`. It takes the same
arguments as `parseModule` from `@tsrx/core`, so it drops into code written
for that. A file it cannot read throws a `SyntaxError` naming the line; `parse`
returns the diagnostics instead of throwing. [Parse](https://yuku.tsrx.dev/guide/parse)
has the full shape.

## What it does

**Parse.** `parse` and `parseModule` read `@{ }` blocks in statement,
expression, and function-body position, `@if` / `@else if` / `@else`, `@for`
with `; index`, `; key`, and `@empty`, `@switch` / `@case` / `@default`, `@try`
/ `@pending` / `@catch`, tags whose name is an expression, `<{expression}>`,
`<style>` blocks holding CSS (with the rules and selectors inside them read
into the tree), lazy `&{ }` destructuring patterns, submodule imports, and text
entities. Ordinary `.js`, `.ts`, `.jsx`, and `.tsx` go to Yuku unchanged.

**Analyze.** `analyze(source, "Cart.tsrx")` parses and then links the file:
you get the same tree plus a `semantic` view of every scope, symbol, reference,
import, and export, and which symbol each reference resolves to.
[Analyze](https://yuku.tsrx.dev/guide/analyze) shows how to ask it questions.

**Generate.** `generate(program)` prints a tree back out as source, with
options for stripping types, minifying, indentation, quotes, and comments, and
a source map. Every fixture in the test suite parses, prints, and parses again
to the same tree. [Generate](https://yuku.tsrx.dev/guide/generate) lists the
options; two of them, `minify: true` and `quotes: "shortest"`, are not accepted
by the native code generator yet.

**This package compiles nothing.** It never builds or runs your app. Turning
`.tsrx` into something a browser can run belongs to your framework's TSRX
plugin. See [tsrx.dev/getting-started](https://tsrx.dev/getting-started).

One measurement, on one machine and one corpus of 224 files
([`benchmarks/m6-baseline.json`](./benchmarks/m6-baseline.json)): a median of
29.7 microseconds per parse against 103.1 for `@tsrx/core`, and peak resident
memory 0.85 times `@tsrx/core`'s. [Benchmarks](https://yuku.tsrx.dev/reference/benchmarks)
has the protocol and what the number does not say.

## Platforms

`@tsrx/yuku` is platform-neutral JavaScript. It lists two addon packages in
`optionalDependencies`, pinned to its own version, and your package manager
installs the one for your machine. You never name one yourself.

| Package                     | Runs on                    | Built for            |
| --------------------------- | -------------------------- | -------------------- |
| `@tsrx/yuku-darwin-arm64`   | macOS on Apple Silicon     | Apple M1 and newer   |
| `@tsrx/yuku-linux-x64-gnu`  | Linux x64 with glibc       | x86-64-v2 (SSE4.2)   |

There is no musl, Windows, x64 macOS, or arm64 Linux package yet. On those,
`import "@tsrx/yuku"` throws on the first call rather than falling back to
anything slower.

Building from source needs Zig 0.16, pnpm, and a checkout of the Yuku branch
from [yuku-toolchain/yuku#164](https://github.com/yuku-toolchain/yuku/pull/164)
in a sibling directory named `yuku-minimal-seam`. That branch has since merged
and shipped in Yuku 0.9.1 with a reworked extension surface; this package still
builds against the branch until it moves to the released one.
[Getting started](https://yuku.tsrx.dev/guide/quick-start) has the rest.

```sh
zig build            # writes the package to zig-out/npm/yuku/
zig build test       # the Zig test suite
pnpm test            # the JavaScript test suite
```

## Contributing

Issues and pull requests are welcome at [the issue
tracker](https://github.com/tsrx-org/yuku/issues). Before changing the
dialect, read [`goal.md`](./goal.md) for the boundary it keeps: plain
JavaScript and TypeScript belong to Yuku. [How the dialect
works](https://yuku.tsrx.dev/architecture/dialect) describes the extension
points and the file layout. Run `zig build test` and `pnpm test` first.

Join the [TSRX Discord community](https://discord.gg/HCYpT5QHQR).

## License

[MIT](LICENSE).
