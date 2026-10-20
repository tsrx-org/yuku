---
title: Benchmarks
description: Parse times against @tsrx/core and 0.7, on the TSRX test suite and the pages of tsrx.dev.
---

# Benchmarks

`@tsrx/yuku` against the official parser, [`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core), both building an ESTree AST. The numbers on this page are read from the repository when the site is built: the chart from [`bench/chart.svg`](https://github.com/tsrx-org/yuku/blob/main/bench/chart.svg) and the table from the [README](https://github.com/tsrx-org/yuku#benchmark).

## The test suite

Parsing the {{suiteFiles}} TSRX sources of the [test suite](https://github.com/tsrx-org/yuku/tree/main/test/suite) that parse.

<!-- block:suite-chart -->

{{suiteYuku}} a file against {{suiteCore}}: {{suiteSpeedup}}x faster. Median time per file over 3 runs, each in a fresh Node.js 24 process on an Apple M5 Pro.

## The pages of tsrx.dev

The pages of [tsrx.dev](https://tsrx.dev), 319 kB in all, in milliseconds, the same way over 5 runs. "throws" is a page 0.7 can't parse.

<!-- block:pages-table -->

{{pagesSpeedup}}x faster than `@tsrx/core` in all, {{pagesYuku}} against {{pagesCore}}, and {{legacySpeedup}}x faster than 0.7 on the {{legacyPages}} pages 0.7 parses.

## Run them

```sh
git clone https://github.com/tsrx-org/yuku
cd yuku
bun install
bun run bench
```

It needs Zig 0.17, Bun, and Node.js 24, as [Work on it](/architecture/how-it-works#work-on-it) describes. `bun run bench` builds the package, then times each parser over every source of `test/suite/pass` with [tinybench](https://github.com/tinylibs/tinybench), each run in a fresh Node.js process, and writes `bench/chart.svg` with the median. Run it on a quiet machine. A change that makes parsing slower needs these numbers before and after.

## Yuku

The parser underneath is [Yuku](https://yuku.fyi). Its own benchmarks, natively and on npm, against Oxc, SWC, Babel, and Acorn, are on [yuku.fyi](https://yuku.fyi/#performance).
