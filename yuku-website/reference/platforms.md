---
title: Platforms and versions
description: See why there are two prebuilt packages and how to add another platform.
---

# Platforms and versions

## Why are there only two platforms?

The package you install is native code. It must be compiled separately for every operating system and CPU, and each one must be built on a matching machine in CI. CI uses macOS on Apple Silicon and Linux on x64. That produces the two packages below. On any other platform, the import throws an error instead of silently running something slower.

## How can I get another platform?

You can [build from source anywhere Zig runs](/guide/build-from-source), or [open an issue](https://github.com/tsrx-org/yuku/issues). Adding a prebuilt platform means adding one more CI machine and choosing a CPU floor.

## Packages and CPU floors

<!-- widget:platforms-table -->

A CPU floor makes sure the addon runs on the oldest CPU of that family that we support, not only on the CI machine that built it.

## Versions

The two binding packages are pinned to the exact version of `@tsrx/yuku` you install, so they never drift. Use Node 22 or newer.
