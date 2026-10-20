---
title: Diagnostics
description: The shape of a diagnostic, and the TSRX error codes, as @tsrx/core reports them.
---

# Diagnostics

`parse` never throws. Every error it finds is in `diagnostics`, and the program holds everything it could read around them.

```js
import { parse } from "@tsrx/yuku";

const { diagnostics } = parse(`export function Pair() @{ <h1>Title</h1> <p>Body</p> }`, { path: "Pair.tsrx" });

diagnostics[0];
// {
//   severity: "error",
//   message: "TSRX2011: A code block renders a single node; wrap multiple nodes or text in a fragment '<>…</>'.",
//   path: "Pair.tsrx",
//   start: 41,
//   end: 42,
//   labels: [],
//   help: null
// }
```

| Field | Is |
| --- | --- |
| `severity` | `"error"`, `"warning"`, `"hint"`, or `"info"` |
| `message` | What went wrong. A TSRX error starts with its code, worded as `@tsrx/core` words it |
| `path` | The `path` option, or `null` |
| `start`, `end` | UTF-16 offsets into the source, like the offsets of nodes |
| `labels` | Related spans, each `{ start, end, message }` |
| `help` | A hint, or `null` |

Errors in the JavaScript and TypeScript around TSRX are Yuku's, without a code. `semanticErrors: true` also reports the early errors that need scopes, such as a `let` declared twice.

## TSRX codes

Each code is the one `@tsrx/core` reports for the same mistake. The examples below are parsed when this site is built, and the build fails if one stops reporting its code.

| Code | Means |
| --- | --- |
| `TSRX1004` | A `<script>` body holds `</script`, which would end it in HTML |
| `TSRX1005` | A namespaced element, such as `<svg:rect>` |
| `TSRX1008` | A control-flow directive without its `{` |
| `TSRX1009` | A clause written without its `@`, such as `else` after an `@if` block |
| `TSRX1010` | An `@try` with neither `@pending` nor `@catch` |
| `TSRX2008` | A `break` inside an `@case` |
| `TSRX2009` | A `return` inside an `@case` |
| `TSRX2011` | A code block that renders more than one node |
| `TSRX2012` | A statement after a code block's output |
| `TSRX2014` | A dynamic tag that is not an identifier, a member access, or a string |
| `TSRX2015` | An `@for` that is not a `for...of` |

```tsrx error=TSRX1009
export function Toggle({ on }) @{
  @if (on) { <b>On</b> } else { <i>Off</i> }
}
```

```tsrx error=TSRX2011
export function Pair() @{
  <h1>Title</h1>
  <p>Body</p>
}
```

Wrap the two in a fragment, and the code block renders one node:

```tsrx
export function Pair() @{
  <>
    <h1>Title</h1>
    <p>Body</p>
  </>
}
```

```tsrx error=TSRX2012
export function Late() @{
  <p>Ready</p>
  const ready = true;
}
```

```tsrx error=TSRX2015
export function Keys({ object }) @{
  @for (const key in object) { <li>{key}</li> }
}
```

## Show them

A diagnostic's offsets are UTF-16, as JavaScript strings index, so `source.slice(start, end)` is the code it points at. A line and column come from the text before it:

```js
for (const { message, start } of diagnostics) {
  const before = source.slice(0, start);
  const line = before.split("\n").length;
  const column = start - before.lastIndexOf("\n");
  console.log(`${line}:${column} ${message}`);
}
```
