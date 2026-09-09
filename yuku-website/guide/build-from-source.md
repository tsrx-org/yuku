---
title: Build from source
description: Build the native addon with the same Yuku dependency used in CI.
---

# Build from source

Build locally when you want to change the parser or test the native addon. If you're only editing this website, the [docs contribution path](/guide/contributing#edit-the-docs) is quicker.

## Get the tools and repositories

Use Node.js 24, pnpm 10.33.2, Git, and Zig 0.16.0 to match this repository's CI. The published package itself needs Node.js 22 or newer.

Clone this repository and its Yuku dependency side by side:

```sh
git clone https://github.com/tsrx-org/yuku.git yuku
git clone https://github.com/thejackshelton/yuku.git yuku-minimal-seam
git -C yuku-minimal-seam checkout 0aac786cdda22d06e8669abe198d6d1d6bd72183
cd yuku
pnpm install --frozen-lockfile --ignore-scripts
```

Already have this repository? Clone only the missing sibling from its parent directory. `build.zig.zon` expects the exact path `../yuku-minimal-seam`.

This is the TSRX dialect build. The `zig fetch` command and Bun test commands on yuku.fyi build upstream Yuku; they do not replace this repository’s sibling dependency or pnpm workflow.

The commit above is the `SEAM_REF` in [the checks workflow](https://github.com/tsrx-org/yuku/blob/main/.github/workflows/checks.yml). Use that workflow's pin when working on a different revision; a newer upstream checkout may have different extension APIs.

## Build and check the addon

From the repository root:

```sh
zig build
zig build test
zig build test-m4-surfaces
pnpm test
```

Press **Play** to follow a recorded build and test run:

<!-- terminal-demo:getting-started-build -->

`zig build` writes the JavaScript package and native addon to `zig-out/npm/yuku/`. The other commands check parser behavior, semantic and printing support, and the JavaScript API.

The tested prebuilt targets are macOS arm64 and Linux x64 with glibc. A local build on another target may need additional porting work; Zig's availability alone doesn't guarantee addon support.

## Use the build in another project

If your application is a sibling of the `yuku` checkout, use this dependency and run your package manager's install command:

```json
{
  "dependencies": {
    "@tsrx/yuku": "link:../yuku/zig-out/npm/yuku"
  }
}
```

Run `zig build` again after changing native code. The link keeps pointing at the rebuilt package; restart the Node process to load the new addon.

## Build the browser parser

```sh
pnpm run docs:wasm
pnpm run docs:build
pnpm run docs:serve
```

The browser build and its smoke check look like this:

<!-- terminal-demo:getting-started-wasm -->

Open `http://127.0.0.1:4519/`. The WASM command builds the browser parser, smoke-tests it, and writes the stamp checked by the site build.

If you're deliberately testing uncommitted changes in `src/`, rebuild WASM and use `pnpm run docs:build -- --allow-dirty`. Normal builds require a clean source stamp.

Next, use [Contribute](/guide/contributing) to find the files and checks for your change.
