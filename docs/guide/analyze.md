---
title: Analyze
description: Find where each name is declared and used.
---

# Analyze

Find where each name is declared and used.

```js
import { analyze } from "@tsrx/yuku";

const { semantic } = analyze(source, "Cart.tsrx");
const ref = semantic.reference;
for (let i = 0; i < ref.count; i++) {
  console.log(ref.name(i), "->", ref.symbolId(i));
}
```

Focus `reset` and watch the explorer report that it has no symbol.

<!-- symbol-explorer -->
```tsrx
export function Cart({ items }) {
  @{
    const total = items.length;
    const label = total === 1 ? "item" : "items";
  }
  return (
    <ul class="cart">
      @try {
        @for (const item of items; index i; key item.id) {
          <li>{item.label}</li>
        }
      } @catch (error, reset) {
        <li><button onClick={reset}>{error.message}</button></li>
      }
    </ul>
  );
}
```

## Five tables answer five kinds of question

[Yuku's `analyze`](https://yuku.fyi) returns `program`, `comments`, and `diagnostics`, then adds `semantic`:

```ts
interface SemanticView {
  scope: SemanticScopeTable;
  symbol: SemanticSymbolTable;
  reference: SemanticReferenceTable;
  import: SemanticImportTable;
  export: SemanticExportTable;
  moduleFlags: SemanticModuleFlags;
  nodeScope(nodeIndex: NodeIndex): ScopeId;
}
```

Each table has a `count`. Pass a row id to its accessors, from `0` through `count - 1`.

Switch to Symbols, then focus a token to read its scope and symbol.

<!-- widget:symbol-table unresolved="reset" -->
```tsrx
import { format } from "./format";

export function Cart({ items }) {
  @{
    const total = items.length;
    const label = total === 1 ? "item" : "items";
  }
  return (
    <ul class="cart">
      @try {
        @for (const item of items; index i; key item.id) {
          <li>{format(item.label)}</li>
        }
      } @catch (error, reset) {
        <li><button onClick={reset}>{error.message}</button></li>
      }
    </ul>
  );
}
```

| Question | Read |
| --- | --- |
| Where is this name declared? | `reference.symbolId(r)`, then `symbol.declNode(s, 0)` |
| Which names belong together? | `symbol.scopeId(s)`, then `scope.parentId(id)` |
| What enters or leaves this file? | `import.specifier(i)`, `import.name(i)`, `export.name(e)` |
| Where does this node belong? | `semantic.nodeScope(result.indexOf(node))` |
| Does the file use Node globals or `import.meta`? | `moduleFlags` |

The first two scopes are always `global` and `module`. Function and block scopes follow as the analyzer encounters them.

## A missing declaration is `null`

The second name in `@catch (error, reset)` is not declared today. The `reset` used by `onClick` therefore has `symbolId: null`; `window` and `console` do too when the file never declares them.

That answer does not add a diagnostic. The same sample returns no diagnostics.

## The filename still chooses the language

```js
analyze(source, "Cart.tsrx");                 // tsx, from the extension
analyze(source, { lang: "tsx" });             // the 0.1.1 shape, still works
analyze(source, "Cart.tsrx", { lang: "js" }); // an explicit lang wins
analyze(source);                              // js: the first "<" is a diagnostic
```

Use a filename or pass `lang`. Without either, `analyze` uses JavaScript.

## Name errors are always errors here

```js
analyze("const a = 1; const a = 2; export { nope };", "x.tsrx").diagnostics;
// [error] Identifier 'a' has already been declared
// [error] Export 'nope' is not defined
```

`analyze` always checks names and keeps both entries at `error`. By contrast, `parse` checks them only with `semanticErrors: true` and changes the repeated declaration to `warning`.

## Use `walk` when you need a parent

```js
const view = analyze(source, "Cart.tsrx");
view.nodeOf(0);                 // the node at index 0 (an Identifier here)
view.indexOf(view.program);     // the last index: the Program is written last
view.semantic.nodeScope(12);    // scope id for node 12
view.str(0, 6);                 // "import": a slice by offset and byte length
```

In version 0.1.5, `parentIndex` throws when a program contains `@{}`, `@if`, `@for`, `@switch`, `@try`, or `<style>`. [Walk the tree](/guide/walk) and use the `parent` passed to your visitor instead.

Text inside `<style>` adds no names or references because it is CSS.

Next, print the tree back to source on [Generate](/guide/generate).
