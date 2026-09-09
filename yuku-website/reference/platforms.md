---
title: Platforms and versions
description: Check whether the native package supports your machine.
---

# Platforms and versions

`@tsrx/yuku` needs Node.js 22 or newer. It includes native code, so your operating system, CPU architecture, and (on Linux) C library must match a prebuilt addon.

## Supported prebuilt packages

The published targets are **macOS on Apple Silicon** and **Linux x64 with glibc**. The table below comes from the package manifests and release configuration.

<!-- widget:platforms-table -->

The CPU floor is the oldest instruction set the build targets. It keeps the addon from depending on features available only on the build machine.

The platform packages are pinned to the same version as `@tsrx/yuku`. Let your package manager select the matching optional dependency; don't install a different binding version manually.

## Upstream packages use separate distribution paths

The native and WASM packages listed on [yuku.fyi](https://yuku.fyi/parser/) belong to upstream Yuku. Their platforms and convenience APIs do not change the targets shipped by `@tsrx/yuku`. This site builds its own TSRX-capable WASM module; see the [host comparison](/reference/limitations#the-browser-build-is-a-separate-host).

## If installation or import fails

Check your Node version and architecture:

```sh
node --version
node -p "process.platform + ' ' + process.arch"
```

On a supported machine, make sure your install hasn't disabled optional dependencies. On Linux, check that the environment uses glibc rather than musl.

Other targets, including Windows, Intel macOS, and Alpine Linux, don't have a prebuilt addon in this repository. There is no automatic JavaScript or WASM fallback for the npm package.

You can investigate a [source build](/guide/build-from-source) or [request platform support](https://github.com/tsrx-org/yuku/issues). Adding a prebuilt target requires build and runtime verification for that platform.
