---
title: Yuku parses this corpus in 0.29× the time
description: Compare one native parser run, check size scaling, and reproduce it.
---

# Yuku parses this corpus in 0.29× the time

See the measured result, check how parse time grows with file size, and reproduce the run.

| Package | Median parse time | Peak memory |
| --- | ---: | ---: |
| `@tsrx/yuku` | 29,666 ns | 264,740,864 bytes |
| [`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core) | 103,075 ns | 309,960,704 bytes |

On the same 224-file, 214,751-byte TSRX corpus, `@tsrx/yuku` took 0.29 times as long to parse and reached 0.85 times the peak memory of `@tsrx/core`. This is a parsing comparison from one Apple M5 Pro run, not a claim about every input, `analyze`, `generate`, or an entire build.

## How parse time grows

Choose a source size and run the parser to compare it with the five-point sweep.

<!-- widget:size-scaling sweep="16,64,128,256,512" max="1024" -->

## Reproduce the result

From the repository root, build the ReleaseFast addon, then run both parsers against the same corpus:

```sh
zig build -Doptimize=ReleaseFast --prefix zig-out/perf-baseline
LC_ALL=C node benchmarks/m6-performance.ts --phase baseline \
  --package-baseline zig-out/perf-baseline/npm/yuku-tsrx \
  --corpus benchmarks/m5-corpus.json \
  --output benchmarks/m6-baseline.json \
  --warmups 5 --samples 20 --iterations 25 --seed 6d362d7631
```

The command uses 5 warmups, 20 samples, 25 iterations per sample, and seed `6d362d7631`. Each sample runs each parser in a fresh child process; only the parse loop is timed. The runner verifies the corpus files against their SHA-256 manifest and writes `benchmarks/m6-baseline.json`. Peak-memory collection uses macOS's `/usr/bin/time -l`.
