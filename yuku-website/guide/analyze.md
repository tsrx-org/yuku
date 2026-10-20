---
title: Analyze
description: Scopes, bindings, references, imports, and exports for a TSRX file, or across a project.
---

# Analyze

`analyze` parses a file and resolves its names with [Yuku's semantic model](https://yuku.fyi/parser/semantic/): scopes, bindings, references, imports, and exports. TSRX's nodes take part like any other: an `@for` declares its item in its own block scope, and a name inside a template resolves to the binding around it.

```js
import { analyze } from "@tsrx/yuku";

const source = `export function List({ items }) @{
  <ul>
    @for (const item of items; key item.id) {
      <li>{item.name}</li>
    }
  </ul>
}`;

const module = analyze(source, { path: "List.tsrx" });

module.bindings.map((binding) => binding.name); // ["List", "items", "item"]

const item = module.bindings.find((binding) => binding.name === "item");
item.scope.kind;         // "block"
item.references.length;  // 2, in the key and in <li>
```

`analyze` takes `path`, `sourceType`, `preserveParens`, `attachComments`, and `tokens`, and its `diagnostics` already hold the semantic errors. Unlike `parse`, it keeps `ParenthesizedExpression` nodes unless `preserveParens` is `false`, as Yuku's `analyze` does.

## What a module holds

| Member | Is |
| --- | --- |
| `ast`, `comments`, `diagnostics` | The program, as `parse` returns it, and every diagnostic |
| `rootScope`, `scopes` | The module scope and every scope inside it. `scope.find(name)` looks a name up |
| `bindings`, `references`, `unresolvedReferences` | Every declared name, every use of one, and the uses that resolve to nothing, such as globals |
| `imports`, `exports` | The module's records, with their kind, name, and specifier |
| `bindingOf(node)`, `referenceOf(node)`, `scopeOf(node)` | The semantic fact for a node of `ast` |
| `walk(visitors)` | A walk whose context knows the scope, binding, and reference at each node |

A binding has a `name`, `flags`, its `scope`, its `declarations`, and its `references`. Test flags with `binding.has(BindingFlags.Const)`, where `BindingFlags` is exported by `@tsrx/yuku`. The [semantic docs](https://yuku.fyi/parser/semantic/#javascript) on yuku.fyi cover every member.

## A project

`Analyzer` analyzes a set of files and links their imports and exports, so a reference can be followed to its definition in another file.

```js
import { Analyzer } from "@tsrx/yuku";

const project = new Analyzer();
project.setFile("/src/Button.tsrx", `export function Button({ label }) @{ <button>{label}</button> }`);
const app = project.setFile(
  "/src/App.tsrx",
  `import { Button } from "./Button.tsrx";\nexport function App() @{ <Button label="Save" /> }`,
);

const definition = app.rootScope.find("Button").definition();
definition.module.path;   // "/src/Button.tsrx"
definition.binding.name;  // "Button"
```

`setFile` replaces a file and `deleteFile` removes one, so an editor or a watcher can keep one `Analyzer` open. `project.diagnostics` has every file's diagnostics, and the imports that do not resolve. Pass `resolve(specifier, importer)` to map specifiers your own way.
