---
title: Platforms and versions
description: Check whether your machine gets a prebuilt addon.
---

# Platforms and versions

Check whether npm has a native addon for your machine.

<!-- pm-install -->
```sh
npm install @tsrx/yuku
```

Focus a row to see whether its addon matches your machine.

<!-- widget:platforms-table -->

## Why there are two bindings

The parser is native code, so each operating-system and CPU pair needs its own compiled file. The package ships addons for macOS arm64 and glibc Linux x64.

The JavaScript package has no platform restriction. On Linux musl, Windows, macOS x64, and Linux arm64, [build from source](/guide/build-from-source) before importing it.

## What the CPU floor means

The Linux addon targets `x86_64_v2`: it requires SSE4.2 but not AVX. The macOS addon targets `apple_m1`. A machine must meet its addon's CPU floor.

## Node

Use Node 22 or newer. The JavaScript package and both addons declare the same minimum.

## Versions

The JavaScript package pins both optional addons to its exact version. Installing `@tsrx/yuku` keeps the loader and native code together.

Before you depend on the addon in a build, read its [current limitations](/reference/limitations).
