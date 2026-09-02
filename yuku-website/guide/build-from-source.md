---
title: Build from source
description: One Zig command builds the addon for any platform the prebuilt packages skip, ready to link into your project.
---

# Build from source

One Zig command builds the addon for any platform the prebuilt packages skip, ready to link into your project.

The source build needs the sibling checkout referenced by `build.zig.zon`:

```zig
.yuku = .{ .path = "../yuku-minimal-seam" },
```


`zig build` writes the package to `zig-out/npm/yuku-tsrx/`. A `link:` dependency picks up each rebuild:

```json
{
  "dependencies": {
    "@tsrx/yuku": "link:../yuku-tsrx/zig-out/npm/yuku-tsrx"
  }
}
```

Run `zig build test` for the Zig suite and `pnpm test` for JavaScript. The recording omits `pnpm test` because two machine-specific checks failed when it was captured.

This site uses the WebAssembly build:

<!-- terminal-demo:getting-started-wasm -->

The native package build prints this:

<!-- terminal-demo:getting-started-build -->

If a prebuilt package fits your machine, [Quick start](/guide/quick-start) is faster; [Platforms and versions](/reference/platforms) lists the two it covers.
