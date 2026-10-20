# @tsrx/yuku

A fast [TSRX](https://tsrx.dev) parser, analyzer, and code generator, built on [Yuku](https://yuku.fyi). Written by [Arshad Yaseen](https://github.com/arshad-yaseen) as [yuku-tsrx](https://github.com/arshad-yaseen/yuku-tsrx).

```bash
npm install @tsrx/yuku
```

## Usage

```ts
import { analyze, generate, parse } from "@tsrx/yuku";

const source = `export const List = ({ items }) => @{
  @for (const item of items; key item.id) {
    <li>{item.name}</li>
  } @empty {
    <p>Nothing yet</p>
  }
}`;

const { program, diagnostics } = parse(source);

analyze(source).rootScope.find("List");

generate(program).code;
```

`parse` builds an ESTree program with TSRX's own nodes, as [`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core) names them, and never throws: errors are in `diagnostics`, with the `TSRXnnnn` code `@tsrx/core` reports. It takes Yuku's options, `path`, `sourceType`, `semanticErrors`, `attachComments`, and `tokens`, and `preserveParens`, which is `false` as in `@tsrx/core`.

`analyze` gives Yuku's semantic model, and `Analyzer` analyzes a project of files with their imports and exports. `generate` prints TSRX back.

It runs in Node.js 16.4 or newer, Bun, Deno, Workers, and browsers.

Coming from 0.7? See [docs/migrating-from-0.7.md](docs/migrating-from-0.7.md). 0.7 stays on the [`legacy-0.7`](https://github.com/tsrx-org/yuku/tree/legacy-0.7) branch.

## Benchmark

Parsing the 1,987 TSRX sources of the [test suite](test/suite) against the official parser, `@tsrx/core`, both building an ESTree AST.

![Time per file to parse with @tsrx/yuku and @tsrx/core](bench/chart.svg)

Median time per file over 3 runs, each in a fresh Node.js 24 process on an Apple M5 Pro. Run it with `bun run bench`.

The pages of [tsrx.dev](https://tsrx.dev), 319 kB in all, in milliseconds, the same way over 5 runs:

| page | @tsrx/yuku 0.8 | @tsrx/core 0.5.5 | @tsrx/yuku 0.7 |
| --- | ---: | ---: | ---: |
| specification | 0.554 | 1.949 | throws |
| getting-started | 0.431 | 2.059 | throws |
| features | 0.376 | 1.726 | throws |
| compiler-demo | 0.145 | 1.451 | 2.705 |
| blog-rethinking-tsrx | 0.094 | 0.396 | throws |
| blog-removing-lazy-destructuring | 0.084 | 0.301 | 1.512 |
| index | 0.083 | 0.385 | 1.696 |
| blog-simplifying-tsrx-after-feedback | 0.069 | 0.334 | 1.572 |
| blog | 0.028 | 0.127 | 0.548 |
| playground | 0.013 | 0.093 | 0.319 |
| layout | 0.006 | 0.176 | 0.384 |
| total | 1.883 | 8.998 | |

4.8x faster than `@tsrx/core` in all, and 20x faster than 0.7 on the seven pages 0.7 parses.

## Development

Needs [Zig](https://ziglang.org) 0.17 and [Bun](https://bun.sh). `build.zig.zon` pins [Yuku](https://github.com/yuku-toolchain/yuku) to the commit of the `yuku` version in `package.json`, and `zig build` fetches it. To work on both, check Yuku out next to this repository and set `.yuku = .{ .path = "../yuku" }` in `build.zig.zon` and `"yuku": "file:../yuku/packages/yuku"` in `package.json`.

```bash
bun install
bun run build      # zig build && tsdown
bun run typecheck
bun run test
bun run sync       # syncs test/suite with the TSRX repository at the release of @tsrx/core
```

The test suite is every `.tsrx` file of the [TSRX repository](https://github.com/tsrx-org/tsrx) and every case in the tests of `@tsrx/core`, each expected to parse, or fail, as the official parser parses it, except where it accepts what TypeScript rejects.

## License

MIT
