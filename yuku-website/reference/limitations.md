---
title: Limitations
description: Check the package's semantic, codegen, dialect, and host boundaries before integrating it.
---

# Limitations

These notes cover the current `@tsrx/yuku` API, known TSRX gaps, and the website's browser host. Rendering, reactivity, keyed updates, and style scoping are supplied by the framework compiler and runtime.

## Per-file semantics and project analysis

`analyze` builds scopes, binds declarations, classifies references by declaration space and write status, and collects module records. These support compiler passes, refactoring, and lint rules. It does not infer TypeScript types or check assignability.

The [upstream analyzer](https://yuku.fyi/analyzer/) additionally exposes project linking and higher-level queries. Those APIs are not exported by `@tsrx/yuku`: there is no project `Analyzer`, module resolver, `capturesOf`, or `module.walk`. Import/export tables here describe one source file; they do not resolve imported files or follow re-exports. [Analyze](/guide/analyze) shows a capture calculation using the available tables.

The model is a snapshot. AST edits do not update scope or reference tables, and row IDs are only meaningful within that analysis result. Print and re-analyze when you need semantics after a transform.

## TSRX semantic boundaries

The second `@catch` parameter (`reset`) is parsed and printed, but the semantic adapter does not register it as a binding. For `@catch (error, reset) { <button onClick={reset}>{error}</button> }`, analysis resolves `error` to the catch binding while the use of `reset` is unresolved when no outer binding has that name.

An unresolved reference has `symbolId: null`. That alone is not an error: environment-supplied globals can also be unresolved. The missing catch binding is a separate, known analyzer gap.

Style contents and raw `<script>` contents are retained as template data, not analyzed as JavaScript. The CSS scanner exposes structure useful for a later style transform; it is not a CSS validator or scoping compiler.

## The browser build is a separate host

The playground uses a website-specific WebAssembly host. It is not an automatic fallback for the npm package, and it is not the upstream `@yuku-*/wasm` packages.

| Feature | Node package | Website browser host |
| --- | --- | --- |
| Calls | Synchronous | Asynchronous; use `await` |
| Language default | `js` | `tsx` |
| Filename inference | `parseModule` and `analyze` | Use explicit parser options |
| Semantic tables | Returned by `analyze` | Returned by `analyze` |
| Codegen input | `generate(program, options)` | `generate(source, parseOptions, generateOptions)` |
| Codegen result | `{ code, errors, map }` | `{ code, errors, ms }` |
| Source maps | `sourceMaps` option | Unsupported |
| `minify` option | Boolean or per-feature object | Boolean; objects do not select individual features |
| Comment filter | String or boolean shorthand | String mode |

The browser generator reparses the source string; it does not print an edited JavaScript AST. Choose `format` separately for compact browser output. Code examples importing `@tsrx/yuku` use Node. Interactive figures use the browser host. Consult the [API reference](/reference/api) when moving an example into a project.

## Syntax and recovery

Lazy declarations and assignments **are supported in C-style loops**: `for (let &{ x } = obj; ready; step()) {}` and `for (&{ x } = obj; ready; step()) {}` both parse and print. A bare pattern followed immediately by `;`, as in `for (&{ x }; ; ) {}`, is rejected with `A lazy pattern needs 'of' or 'in' after it`.

A call inside a dynamic tag name, such as `<{makeTag()} />`, is rejected by the current tag validator. Assign the result to a variable first: `const Tag = makeTag(); const view = <{Tag} />;`.

Recovery may produce an incomplete tree. Check diagnostics before transforming. With `semanticErrors: true`, the `parse` path downgrades the `Identifier '…' has already been declared` diagnostic family to warnings; `analyze` retains errors. Legal repeated `var` declarations are accepted. See [Diagnostics and recovery](/guide/diagnostics).

## Printing and stripping

`generate` prints JSX and TSRX as JSX and TSRX. Removing type annotations does not lower templates into runnable JavaScript.

Non-ambient TypeScript constructs such as `enum E { A }` and `namespace N { export const x = 1; }` require a lowering pass. With `strip: true`, each produces a codegen error and is omitted from the output. Ambient forms such as `declare enum E { A }` are erased without an error. Check `errors` before using stripped code.

`quotes: "shortest"` needs syntax minification. In this implementation, stripping takes precedence over syntax minification when both are enabled; compact whitespace can still apply. See [Generate](/guide/generate) for supported combinations.
