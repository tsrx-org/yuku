---
title: Diagnostics and recovery
description: Read each problem and underline the right characters.
---

# Diagnostics and recovery

Read each problem and underline the right characters.

```js
import { parse } from "@tsrx/yuku";

const { diagnostics } = parse("@if (x) <b/>", { lang: "tsx" });
diagnostics[0].severity; // "error"
diagnostics[0].message;  // "Expected '{' after TSRX control-flow directive"
diagnostics[0].help;     // "TSRX control-flow bodies are written with braces."
diagnostics[0].start;    // 8
diagnostics[0].end;      // 9
```

This error points at the `<` where the parser expected `{`. Each diagnostic also has `labels` for related spans and a `help` string or `null`.

## Errors stop `parseModule`; warnings do not

The package returns `error` and `warning` today. Syntax problems are errors. A repeated declaration is the only warning when `parse` runs with `semanticErrors: true`.

`parseModule` throws on the first error. With `collect` or `loose`, it returns the program and adds errors to your `errors` array; warnings always return the program. [`parse` never throws](/guide/parse#parsemodule-chooses-defaults-and-throws).

## The gallery shows every common refusal

Focus an underline to read its message, then allow recovery for the unclosed element.

<!-- widget:diagnostics-gallery -->

The first group covers malformed directives and blocks. The next group covers markup problems. The final two appear when name checking is on.

Some errors leave a node in the tree. A forbidden `break` inside `@case`, for example, reports the error and keeps the `JSXSwitchExpression`; stop before using a tree whenever it carries an error.

## `loose` repairs one unfinished closing tag

With the default settings, `<a><b>text</a>` reports a mismatched closing tag and returns an empty body. With `loose: true`, the parser closes `<b>` where `</a>` starts, keeps both elements, and reports no error.

Other errors stay errors. `@if (x) <b/>` still needs braces with `loose` enabled.

## Put the underline on the full closing tag

```js
import { authoredDiagnosticSpan, sourcePosition } from "@tsrx/yuku";

authoredDiagnosticSpan({ start: 18, end: 19 }, source); // { start: 16, end: 19 }, the "</a"
sourcePosition(source, 16);                              // { line: 1, column: 16 }
```

For `const v = <a><b></a>;`, `parse` points at the `a` in `</a>`. `authoredDiagnosticSpan` expands that span to the whole closing tag; `parseModule` applies it before throwing or collecting.

Use `sourcePosition` for one offset or `sourceLocation` for both ends. Lines start at 1, columns at 0, and offsets outside the source are clamped.

## Malformed constructs report where parsing breaks

```tsrx no-playground
const before = 1;
const view = @for (const item of items) <li>{item}</li>;
const after = 2;
```

The underline covers `<li>{item}</li>`, with `Expected '{' after TSRX control-flow directive`. This case used to shorten the module without reporting anything; now `parse` returns an error and `parseModule` throws.

A malformed for-of tail, a bare statement inside `@switch`, an unclosed dynamic tag, and a lazy marker without a pattern report at the place parsing stopped too. Treat any error as a rejected module; recovery exists to place the underline, not to make the tree safe to compile.

Next, connect each name to its declaration on [Analyze](/guide/analyze).
