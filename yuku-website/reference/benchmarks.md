---
title: Benchmarks
description: Read the recorded parsing result and measure a workload of your own.
---

# Benchmarks

In the repository's recorded 224-file TSRX benchmark, Yuku took about **29% as long to parse** as `@tsrx/core`.

| Package | Median parse time | Peak process memory |
| --- | ---: | ---: |
| `@tsrx/yuku` | 29,666 ns | 264,740,864 bytes |
| `@tsrx/core` | 103,075 ns | 309,960,704 bytes |

These are results from `benchmarks/m6-baseline.json`: one Apple M5 Pro run over 214,751 bytes of source. Peak memory covers the whole child process, not just parser allocations. The result doesn't measure analysis, printing, or an entire application build, and isn't a measurement of each new package release.

## Upstream measurements

[Yuku’s introduction](https://yuku.fyi/) reports separate native parsing and npm AST-transfer benchmarks for JavaScript inputs. Native parse time and the cost of obtaining a JavaScript AST measure different work. Neither is this TSRX corpus result, and neither establishes the cost of a complete compiler pipeline.

## Try a size comparison

Choose a source size and run the browser parser. This shows scaling on your machine; it isn't the native package benchmark above.

<!-- widget:size-scaling sweep="16,64,128,256,512" max="1024" -->

## Run the native benchmark

Follow [Build from source](/guide/build-from-source) first. The runner also needs the corpus files listed in `benchmarks/m5-corpus.json`; its paths are relative to a Markless checkout. Pass that checkout with `--markless-root /path/to/checkout`. A fresh clone of this repository alone doesn't provide those files.

From the repository root:

```sh
zig build -Doptimize=ReleaseFast --prefix zig-out/perf-baseline
LC_ALL=C node benchmarks/m6-performance.ts --phase baseline \
  --markless-root /path/to/checkout \
  --package-baseline zig-out/perf-baseline/npm/yuku \
  --corpus benchmarks/m5-corpus.json \
  --output zig-out/m6-local.json \
  --warmups 5 --samples 20 --iterations 25 --seed 6d362d7631
```

Each sample runs a parser in a fresh child process. Only the parse loop is timed, and the runner checks each input file against the corpus manifest's SHA-256 hash. The command keeps your result separate from the committed report.

Peak-memory collection uses macOS's `/usr/bin/time -l`. To compare an older result exactly, use its recorded source and package revisions as well as its inputs and sampling settings.
