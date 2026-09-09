---
title: Analyze
description: Build compiler passes with scopes, binding identity, runtime references, and module records.
---

# Analyze

A compiler needs more than the shape of a template. Before moving an expression into a generated function, it needs to know which outer bindings that function will capture. Before rewriting an imported helper, it needs to distinguish calls to that import from calls to a local variable with the same name. A lint rule needs to distinguish a runtime use from a type annotation.

`analyze` supplies the semantic information behind those decisions. Yuku builds lexical scopes, binds declarations, resolves references in TypeScript's declaration spaces, and checks scope-dependent early errors in Zig. The JavaScript result includes the AST and tables for scopes, symbols, references, imports, and exports.

A **symbol** identifies a binding, even when other bindings have the same spelling. A **reference** records a use, its resolved symbol, its declaration space, and whether it writes to the binding. A **scope** records the lexical environment and its parent.

## Analyze a TSRX module

```js
import { analyze } from "@tsrx/yuku";

const source = `let count = 0;
const step = 2;
function Counter() @{
  count += step;
  <p>{count}</p>
}`;
const result = analyze(source, "Counter.tsrx");
if (result.diagnostics.some((d) => d.severity === "error")) {
  throw new Error(result.diagnostics.map((d) => d.message).join("\n"));
}
const { scope, symbol, reference } = result.semantic;
```

The filename selects the language; it doesn't read a file. An explicit `lang` overrides filename inference. `analyze(source, { lang: "tsx" })` is also supported. Without either, the Node package defaults to JavaScript in module mode.

## Identify captured bindings

Continue the example above. `Counter` uses `count` and `step` from outside its function scope. The resolved reference table lets a compiler collect those bindings without rebuilding JavaScript's binding rules:

```js
const counter = result.program.body[2];
const functionScope = result.semantic.nodeScope(result.indexOf(counter));
const isInside = (id) => {
  for (; id !== null; id = scope.parentId(id)) {
    if (id === functionScope) return true;
  }
  return false;
};

const captures = new Map();
for (let r = 0; r < reference.count; r++) {
  const s = reference.symbolId(r);
  if (s === null || reference.inTypePosition(r)) continue;
  if (!isInside(reference.scopeId(r)) || isInside(symbol.scopeId(s))) continue;
  captures.set(s, (captures.get(s) ?? false) || reference.isWrite(r));
}
for (const [s, written] of captures) {
  console.log(symbol.name(s), written ? "written" : "read only");
}
// count written
// step read only
```

This example collects resolved outer bindings, including uses in nested functions. It excludes local bindings and type-only references. Unresolved globals, `this`, and implicit `arguments` need separate treatment. A write to `count.value` is a property mutation, not a reassignment of `count`; `isWrite` describes the binding itself.

These are inputs to your compiler's transformation. They do not determine a framework's reactivity, effect scheduling, or serialization rules.

## Inspect the semantic model

Edit the source and select a symbol to highlight its declaration and references. The scope tree shows which environment owns each binding. Try adding a local `count` inside `Counter` and see how its references change.

<!-- symbol-explorer -->
```tsrx
let count = 0;
const step = 2;
function Counter() @{
  count += step;
  <p>{count}</p>
}
```

## Use the model in a compiler pass

| Task | Information to use |
| --- | --- |
| Rewrite an imported helper without touching a shadowing local | The import's `symbolId`, then matching resolved references |
| Collect a function's captured bindings | Reference scopes, symbol scopes, and the scope parent chain |
| Separate type-only uses from runtime uses | `reference.space(r)` and `reference.inTypePosition(r)` |
| Inspect reassignment | `reference.isWrite(r)`; a declaration initializer is not a write reference |
| Build dependency and export metadata | The `import` and `export` tables and `moduleFlags` |
| Rewrite a binding and its uses | `symbol.declNode(s, i)` and `reference.node(r)` for that symbol |

Tables use numeric row IDs from `0` through `count - 1`. One symbol can have multiple declarations when the language permits merging. `symbolId: null` means a reference has no matching binding in its declaration space; an environment-supplied global such as `console` is one example.

Nodes reached through semantic queries are the same memoized objects reached through `result.program`. You can edit those nodes and pass the program to [`generate`](/guide/generate). For a rename, check for collisions and preserve property keys, import names, and exported names as required by the transformation.

The tables describe the source at analysis time. Editing the AST does not refresh them. Generate and re-analyze the output when a later pass needs the transformed program's semantics. IDs and node objects belong to one result and must not be reused across analyses.

## Relationship to upstream Yuku

[Yuku's analyzer](https://yuku.fyi/analyzer/) also provides a project-level `Analyzer`, object-oriented `Module` queries, `capturesOf`, semantic visitor contexts, and import/re-export linking across files. This package currently exports the lower-level per-file `AnalyzeResult`; it does **not** export those convenience or project APIs. The capture example above uses this package's actual table accessors.

Import/export records are available, but `@tsrx/yuku` does not load dependencies or link a project. Semantic analysis also does not infer types or check assignability. See [Yuku's semantic model](https://yuku.fyi/parser/semantic/) for the underlying concepts and the [API reference](/reference/api) for the API shipped here.

The current TSRX adapter does not bind the second `@catch` parameter, `reset`. CSS and raw script text in templates are not analyzed as JavaScript. See [Limitations](/reference/limitations) before building a pass that depends on these cases.
