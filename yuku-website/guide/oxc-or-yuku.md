---
title: Oxc or Yuku?
description: Which TSRX engine fits the job you have.
---

# Oxc or Yuku?

Two engines parse TSRX. They are for different jobs.

Use [Oxc](https://oxc.tsrx.dev) when you need:

- Linting
- Formatting
- The same parser as your Vite plugins, in Rolldown

Use Yuku when you need:

- The fastest possible parsing speed in TypeScript
- Semantic analysis in TypeScript
- TypeScript codegen

Oxc fits consumers, and the maintenance side of framework work: one toolchain lints, formats and bundles the files you ship. Yuku fits framework authors doing compiler work: parse once, look up where every name is defined and used, print code back out, all from TypeScript and at the fastest parse time.

## Why Yuku parses faster

[Yuku](https://yuku.fyi)'s parser is built around a data-driven design, and that is where the speed comes from. Bringing that design into Oxc would mean breaking changes to the tree its whole ecosystem depends on, which is not a trade Oxc should make. That does not make Oxc the worse tool. It has its own jobs, especially inside the Vite ecosystem, where the same parser runs in Rolldown and its plugins.

<figure>
  <img src="/assets/benchmarks/parse-react.png" alt="Parse time for react.js, 0.07 MB: Yuku 0.30 ms, Acorn 0.88 ms, Babel 1.35 ms, Oxc 1.50 ms, SWC 2.78 ms" width="1500" height="430" loading="lazy">
  <figcaption>react.js, 0.07 MB. Median parse time from <a href="https://github.com/yuku-toolchain/ecmascript-parser-benchmark-js">Yuku's npm benchmark</a>.</figcaption>
</figure>

<figure>
  <img src="/assets/benchmarks/parse-typescript.png" alt="Parse time for typescript.js, 7.83 MB: Yuku 46.06 ms, Acorn 138.05 ms, Babel 188.32 ms, Oxc 263.65 ms, SWC 508.10 ms" width="1500" height="430" loading="lazy">
  <figcaption>typescript.js, 7.83 MB. Same benchmark.</figcaption>
</figure>

Picked Yuku? [Quick start](/guide/quick-start) is one install and one parse.
