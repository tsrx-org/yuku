---
title: How it works
description: TSRX as a Yuku dialect in one Zig file, compiled to WebAssembly, and a tree that crosses into JavaScript in one buffer.
---

# How it works

`@tsrx/yuku` is TSRX written as a [Yuku dialect](https://yuku.fyi/parser/dialect/). [Yuku](https://yuku.fyi) is a JavaScript and TypeScript compiler toolchain in Zig: a parser, a semantic analyzer, a traverser, and a code generator, with no dependencies. A dialect adds syntax to it. You write only the new syntax, in one Zig file, and Yuku parses, analyzes, walks, and prints the rest of the language, and your nodes with it.

## One Zig file

The grammar is [`src/tsrx.zig`](https://github.com/tsrx-org/yuku/blob/main/src/tsrx.zig), following the [TSRX specification](https://tsrx.dev/specification). It declares the files it reads, `.tsrx` as TSX, and its node kinds, each with the `type` and fields it has in JavaScript. Then it answers at Yuku's positions in the grammar:

| Position | What TSRX reads there |
| --- | --- |
| `statement` | A code block, a directive, or an element at the start of a statement, which needs no `;` before a tag |
| `expression` | `@{ }`, `@if`, `@for`, `@switch`, `@try`, or a `<style>` as a value |
| `operator` | A tag at the start of a line, or after output, which starts an element |
| `function_body` | `@{ }` as the body of a function, method, or arrow function |
| `jsx_child` | Template text with its comments, directives, and `<style>`, and the raw bodies of `<style>` and `<script>` |
| `jsx_attribute` | `{name}`, short for `name={name}` |
| `jsx_element_name` | `<{tag}>`, a tag chosen at runtime |
| `module_specifier` | A submodule named by an identifier, as in `import { load } from server` |

At each one the dialect parses its syntax or declines, and Yuku's own grammar goes on. A JavaScript expression inside an `@if` is parsed by Yuku, and TSRX inside that expression is asked for again, so the two nest to any depth. The shapes also tell Yuku's analyzer what each node means: an `@for` opens a block scope, declares its item there, and is a loop.

## Compiled into Yuku

[`build.zig`](https://github.com/tsrx-org/yuku/blob/main/build.zig) is five lines:

```zig
const std = @import("std");

pub fn build(b: *std.Build) void {
    const yuku = b.dependency("yuku", .{ .dialect = b.path("src/tsrx.zig") });
    b.installArtifact(@import("yuku").addWasm(b, yuku, "yuku-tsrx"));
}
```

`zig build` compiles Yuku with the dialect inside its parser, to one WebAssembly module, `yuku-tsrx.wasm`: 746 kB, about 221 kB gzipped. Standard code parses exactly as in Yuku, and the dialect costs a standard file one flag check at each position. The module uses WebAssembly SIMD, which is why Node.js needs 16.4.

The JavaScript is a thin layer over it, [`src/index.ts`](https://github.com/tsrx-org/yuku/blob/main/src/index.ts): `parse`, `analyze`, and `Analyzer` are Yuku's, passed the TSRX module, and `generate` is Yuku's code generator with printers for TSRX's nodes. The module's bytes are inlined in the package, so it loads with no file system and no fetch. In Cloudflare Workers, which can't compile WebAssembly from bytes, the `workerd` condition imports the `.wasm` file instead.

## A tree in one buffer

Every node that crosses from WebAssembly into JavaScript costs time, so Yuku keeps the crossing to one buffer. Its parser stores the tree flat, in arrays of fixed-size records, and the result crosses as one buffer: 48 bytes a node, then child lists, a string pool, comments, tokens, and diagnostics. JavaScript copies the buffer once.

A decoder turns it into ESTree objects. It is generated from Yuku's Zig layouts, so the two can't disagree, and it runs when you first read `program`, in one pass over the records. Names and literals are sliced straight from your source string, and only text that needs decoding, such as an escaped identifier, comes from the pool. Offsets are mapped from bytes to UTF-16 as it decodes, so a node's `start` indexes your string directly. The semantic model crosses the same way, as tables that `Scope`, `Binding`, and `Reference` read by index.

## Correct

The test suite is every `.tsrx` file of the [TSRX repository](https://github.com/tsrx-org/tsrx) and every case in the tests of `@tsrx/core`, synced at the release of the installed `@tsrx/core` by `bun run sync`: {{suiteFiles}} sources that must parse and {{suiteFailing}} that must fail, as the official parser parses them, except where it accepts what TypeScript rejects. Every source that parses is printed with `generate`, parsed again, and must print the same code.

## Fast

It parses the test suite {{suiteSpeedup}}x faster than `@tsrx/core`, and the pages of tsrx.dev {{pagesSpeedup}}x faster. [Benchmarks](/reference/benchmarks) has the numbers and how to run them.

## Next: CSS trees

Today a `<style>` keeps its CSS as one `JSXText`, as `@tsrx/core` does. Next, each `<style>` gets a CSS tree, parsed in the same pass by [yuku-css](https://github.com/thejackshelton/yuku-css), a CSS parser written in Zig the same way, which builds css-tree's AST. That needs a dialect to hand its own data to JavaScript, which [yuku#280](https://github.com/yuku-toolchain/yuku/pull/280) adds to Yuku. It ships once that lands.

## Work on it

Needs [Zig](https://ziglang.org) 0.17 and [Bun](https://bun.sh). `build.zig.zon` pins Yuku to the commit of the `yuku` version in `package.json`, and `zig build` fetches it.

```sh
bun install
bun run build      # zig build && tsdown
bun run typecheck
bun run test
bun run sync       # syncs test/suite with the TSRX repository at the release of @tsrx/core
bun run bench
```

To work on Yuku and the dialect together, check Yuku out next to this repository and set `.yuku = .{ .path = "../yuku" }` in `build.zig.zon` and `"yuku": "file:../yuku/packages/yuku"` in `package.json`. [Yuku's AGENTS.md](https://github.com/yuku-toolchain/yuku/blob/main/AGENTS.md) is the rulebook for changes.

## Credits

`@tsrx/yuku` is maintained by [Jack Shelton](https://github.com/thejackshelton), on [tsrx-org/yuku](https://github.com/tsrx-org/yuku). Thanks to [Arshad Yaseen](https://github.com/arshad-yaseen) for his help.
