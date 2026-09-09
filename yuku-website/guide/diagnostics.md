---
title: Diagnostics and recovery
description: Report source errors and handle unfinished markup in an editor.
---

# Diagnostics and recovery

A diagnostic describes a problem and points to the source text involved. `parse` returns the diagnostics it finds alongside the tree it could build.

```js
import { parse } from "@tsrx/yuku";

const { diagnostics } = parse("@if (x) <b/>", { lang: "tsx" });
const problem = diagnostics[0];

console.log(problem.message); // Expected '{' after TSRX control-flow directive
console.log(problem.start, problem.end); // 8 9
```

The parser expected `{` and found `<`. The offsets identify that character. A diagnostic also has a `severity`, a `help` string or `null`, and `labels` for related source ranges.

## Stop a build, or collect errors for an editor

`parseModule` throws on the first error by default. To collect errors instead, provide an array and set `collect: true`:

```js
import { parseModule } from "@tsrx/yuku";

const source = "@if (x) <b/>";
const errors = [];
const program = parseModule(source, "example.tsrx", { collect: true, errors });

console.log(errors.length > 0); // true
```

The returned program may be incomplete. Collecting errors is useful for an editor; it doesn't make the input safe to compile. Likewise, when using `parse`, check for diagnostics whose `severity` is `"error"` before transforming the tree.

Warnings don't make `parseModule` throw. With `semanticErrors: true`, this fork’s `parse` path downgrades redeclaration diagnostics to warnings for editor recovery; [`analyze`](/guide/analyze) retains error severity. This is a local policy, not a general claim about upstream Yuku.

## Parsing errors and semantic early errors

A missing brace can be detected while parsing. Other errors require the surrounding scopes: `export { missing }` needs a local binding, and two `let` declarations cannot share one scope. `semanticErrors: true` adds those checks to `parse`; `analyze` runs them and also returns the semantic model. `parseModule` enables them by default.

These are language early errors, not TypeScript type checking. For example, `const n: number = "text"` is structurally valid and does not produce a type-mismatch diagnostic here. [Upstream semantic analysis](https://yuku.fyi/parser/semantic/) explains the distinction.

## Try common errors

Choose a case to see its message and highlighted range. The last two cases need the semantic early-error checks (`semanticErrors: true`).

<!-- widget:diagnostics-gallery -->

## Recover unfinished markup

An editor often sees code halfway through a change. `loose: true` handles one such case: an element closed by an ancestor's tag.

For `<a><b>text</a>`, normal parsing reports a mismatched closing tag. Loose parsing closes `<b>` where `</a>` starts, keeps both elements, and reports no error for this mismatch.

Other syntax rules still apply. `@if (x) <b/>` needs braces even in loose mode. On `parseModule`, `loose: true` also stops errors from throwing. Supply an `errors` array to read the remaining problems.

## Show a useful source location

```js
import { authoredDiagnosticSpan, sourcePosition } from "@tsrx/yuku";

const source = "const v = <a><b></a>;";
const span = authoredDiagnosticSpan({ start: 18, end: 19 }, source);

console.log(source.slice(span.start, span.end)); // </a
console.log(sourcePosition(source, span.start)); // { line: 1, column: 16 }
```

`authoredDiagnosticSpan` expands certain parser ranges to the markup the author wrote. `parseModule` applies this adjustment before throwing or collecting errors.

`sourcePosition` converts an offset to a line and column. `sourceLocation(source, start, end)` converts both ends of a range. Lines start at 1, columns at 0, and out-of-range offsets are clamped.
