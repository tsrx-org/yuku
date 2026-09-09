---
title: Contribute
description: Make a first docs change, find the relevant code, and check your contribution.
---

# Contribute

A clearer example, a smaller bug reproduction, or a fixed link is a useful contribution. Start with the path that matches your change.

## Edit the docs

You need Git, Node.js 24, and pnpm 10.33.2. You can use the prebuilt browser parser without installing Zig.

```sh
git clone https://github.com/tsrx-org/yuku.git yuku
cd yuku
pnpm install --frozen-lockfile --ignore-scripts
node scripts/fetch-docs-wasm.mjs
pnpm run docs:build
pnpm run docs:serve
```

Open `http://127.0.0.1:4519/`. Edit a Markdown file under `yuku-website/`, run `pnpm run docs:build` again, and refresh the page. The server serves the built files; it doesn't rebuild them for you.

For a first change, try explaining one unfamiliar term or adding the expected output to an example. To add a page, create its Markdown file and list its route in `yuku-website/site.config.mjs`. The sidebar determines which pages are built.

Before submitting:

```sh
node tools/wasm-smoke.mjs --fences
pnpm run docs:verify-playground
```

The first command checks TSRX code examples. The second opens the built site in Chromium and exercises its interactive examples. If no Chrome or Chromium is installed, run `pnpm exec playwright-core install chromium` first.

If the WASM download reports a stale pin, your checkout's parser source doesn't match the published artifact. Follow [Build from source](/guide/build-from-source) and run `pnpm run docs:wasm` to build the matching parser.

The [website README](https://github.com/tsrx-org/yuku/blob/main/yuku-website/README.md) explains widgets, generated files, and deployment.

## Change the parser or JavaScript API

First follow [Build from source](/guide/build-from-source). Then find the part that owns the behavior:

| Change | Start here |
| --- | --- |
| Recognize TSRX syntax | `src/dialect/parser_extension.zig` and its helper modules |
| Change a TSRX node's shape | `src/dialect/schema.zig` |
| Extend scope, binding, and reference analysis for TSRX | `src/dialect/semantic.zig` |
| Print TSRX | `src/dialect/codegen.zig` |
| Change the JavaScript API | `npm/yuku/index.js` and `npm/yuku/index.d.ts` |
| Add a syntax example or regression | `test/parser/misc/tsrx/` and `test/*.test.ts` |

[How the dialect works](/architecture/dialect) explains how these pieces connect. JavaScript and TypeScript parsing is provided by the Yuku dependency; this repository adds TSRX behavior.

For a bug fix, add a small regression case that fails before the fix. Run `zig build test`, `zig build test-m4-surfaces`, `zig build`, and `pnpm test`. CI also checks Zig formatting and JavaScript/TypeScript types, lint, and formatting; [checks.yml](https://github.com/tsrx-org/yuku/blob/main/.github/workflows/checks.yml) contains the exact commands.

If a schema change affects the generated encoders or decoders, run `pnpm run gen:npm`, then `pnpm run check:generated`. Edit the generator inputs, not the generated output by hand.

## Verify behavior against the right project

Read the relevant [upstream Yuku docs](https://yuku.fyi/) when changing parser, semantic, or codegen behavior, then check the pinned dependency and the APIs this package exports. Upstream’s high-level analyzer and WASM packages have different public surfaces. Keep examples executable against `@tsrx/yuku`; do not substitute upstream package names.

[Testing and correctness](/reference/testing) explains what this repository’s suites verify. Upstream security issues use the private reporting channel in [Yuku’s security policy](https://yuku.fyi/security/); that policy’s response commitments and release practices belong to upstream, not automatically to this fork.

## Open an issue or pull request

For a bug report, include the smallest source example, the call and options you used, what you expected, and what happened. Include the package version, Node version, operating system, and CPU architecture when the problem involves installation or native code.

For a pull request, explain the resulting behavior and list the checks you ran. Include a before-and-after example or screenshot when it helps someone review the change. Keep generated `yuku-website/dist/` and `zig-out/` files out of the commit.

[Open an issue](https://github.com/tsrx-org/yuku/issues) if you want to discuss a larger change before implementing it.
