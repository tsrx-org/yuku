---
title: Benchmarks
description: Reproduce the parser benchmark and read its limits.
---

# Benchmarks

Reproduce the parser benchmark, then see exactly what the result covers.

```sh
zig build -Doptimize=ReleaseFast --prefix zig-out/perf-baseline
LC_ALL=C node benchmarks/m6-performance.ts --phase baseline \
  --package-baseline zig-out/perf-baseline/npm/yuku-tsrx \
  --corpus benchmarks/m5-corpus.json \
  --output benchmarks/m6-baseline.json \
  --warmups 5 --samples 20 --iterations 25 --seed 6d362d7631
```

These commands build the ReleaseFast addon, run it against [`@tsrx/core`](https://www.npmjs.com/package/@tsrx/core) on the same 224-file [TSRX](https://tsrx.dev) corpus, and write `benchmarks/m6-baseline.json`. Every number below comes from that file.

## The number

| Measure | `@tsrx/yuku` | `@tsrx/core` | Ratio |
| --- | --- | --- | --- |
| Median ns per parse | 29,666 | 103,075 | 0.288 |
| p95 ns per parse | 30,307 | 106,421 | |
| Median parses per second | 33,708 | 9,702 | |
| Median peak resident memory | 264,740,864 bytes | 309,960,704 bytes | 0.854 |

In this run, the median parse took 0.29 of `@tsrx/core`'s time and used 0.85 of its peak memory. The harness marked the report valid after checking its noise limits.

## What was measured

| | |
| --- | --- |
| Input | 224 component files, 214,751 bytes |
| Protocol | 5 warmups, 20 samples, 25 iterations per sample, seed `6d362d7631` |
| Isolation | one fresh child process per parser per sample, in a seeded order, no forced garbage collection |
| Timed | the parse loop only, `collect: false`, `loose: false` |
| Peak memory | the child's maximum resident set size, read from `/usr/bin/time -l` |
| Machine | Apple M5 Pro, 18 cores, 51,539,607,552 bytes, darwin arm64 |
| Toolchain | Node v24.15.0, pnpm 10.33.2, Zig 0.16.0, `LC_ALL=C` |
| Source revisions | parser `d65db5d`, parser integration `872758e`, control `bf03e14` |

## Reproduce the report

Run both commands from the repository root. The first creates the addon that the second command measures.

The runner accepts only the warmups, samples, iterations, seed, and `LC_ALL=C` shown above. It reads the files from a sibling checkout and verifies every SHA-256 against the corpus manifest. Peak-memory measurement uses macOS's `/usr/bin/time -l`, so this command does not run unchanged on Linux.

Do not add `--check` to this baseline command. That mode also requires baseline, attribution, and optimized reports; the repository does not include the optimized report.

Expect the exact ratio to move with the machine and its workload. Compare reports made with the same protocol and input files.

## Does it scale with size?

Drag to a source size, run the parser, and compare the new point with the landing sweep.

<!-- widget:size-scaling sweep="16,64,128,256,512" max="1024" -->

A straight line through the points means time grows linearly with bytes. This measures the WebAssembly build plus JavaScript decoding, so compare the shape of the line, not its slope, with the native result above.

## Watch the parser work

Read the landing run, then choose a sample and run length to measure again.

<!-- bench-live -->

## What it does not prove

One input set and one machine cannot predict every workload. Longer files, deeper markup, or more types can produce a different ratio.

It measures parse time and peak memory. Nothing here says anything about `analyze`, `generate`, or the time a build takes end to end.

This is a reproducible report, not a continuous performance test or a release gate.

The interactive figures run WebAssembly in your tab. The table measures the native addon in fresh child processes; do not compare their raw times.

Every export the addon exposes, with signatures read from the type declarations: [API](/reference/api).
