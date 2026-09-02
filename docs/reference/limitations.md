---
title: Three browser build limits
description: Plan around three browser limits and two parser rules.
---

# Three browser build limits

Know the three browser limits and two syntax rules.

## What the browser build leaves out

The browser build exposes only `parse`, `analyze`, and `generate`; call `parse` with an explicit `lang` instead of relying on `parseModule` filename inference.

The browser build returns diagnostics instead of throwing the first error; check them before using the program.

The browser build generates code without source maps; use the npm package when a map is required.

## TSRX rules this parser enforces

- A lazy pattern cannot start a C-style `for` loop; use it in a `for...of` or `for...in` binding.

- A call expression cannot be a dynamic tag name; assign its result to a variable first.

Every other [TSRX](https://tsrx.dev) construct parses.

See [Diagnostics and recovery](/guide/diagnostics).
