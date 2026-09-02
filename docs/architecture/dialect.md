---
title: How the dialect works
description: See how Yuku hands extra syntax to a dialect.
---

# How the dialect works

See how Yuku and the dialect split one parse.

```tsrx
const panel = @if (open) {
  <Panel />
};
```

[Yuku](https://yuku.fyi) reads `const panel =`, reaches the `@`, and asks whether the dialect owns it. A dialect is a small set of extra parsing rules compiled into Yuku. Here, `@tsrx/yuku` returns a `JSXIfExpression`, and Yuku continues at the semicolon.

Those calls happen at fixed points in the grammar. A build without the dialect skips them entirely and remains plain Yuku.

## Yuku parses, the dialect answers

Step through the five panels: source, parsing rules, tree, transfer buffer, and public calls.

<!-- how-it-works -->

Yuku parses every identifier, type annotation, and ordinary JSX tag. The dialect adds twenty hooks—a hook is a function Yuku calls when extra syntax might begin—each declared as a `pub fn` in `src/dialect/parser_extension.zig`.

Each hook returns `unhandled` or `handled` with a node. A node is one item in the syntax tree. `unhandled` leaves the token untouched, while `handled` tells Yuku where parsing should continue.

## Every construct has a hook

`@{ }` can start a statement, expression, JSX child, or function body. Four hooks parse those positions; `function_body_starts` tells Yuku that `@{` after a parameter list opens the body.

`@if`, `@for`, `@switch`, and `@try` share one dispatcher, a function that chooses which construct follows `@`. Three hooks admit them as statements, expressions, and JSX children. `for_of_tail` adds `; index` and `; key` only to for-of loops.

`binding_pattern` parses `&{ }` and `&[ ]` in declarations, parameters, and loop heads. `lazy_assignment_pattern` handles the left side of `=`, while `can_start_binding` tells Yuku that `&` may begin a binding. `module_specifier` accepts a bare identifier in `import { x } from server`.

A dynamic tag `<{expr}>` uses three hooks: one parses the braces, one checks the expression, and one matches the closing tag. Two more read extended element and fragment children. The final pair ends JSX text at `@` and decodes entities.

Filter the table by area. Its file column is generated from the Zig source during the docs build.

<!-- hook-matrix -->

| Hook | Area | Where TSRX gets a say |
| --- | --- | --- |
| `statement_at_code_block` | Statement | A `@{ }` block where a statement may start |
| `statement_at_control_flow` | Statement | `@if`, `@for`, `@switch` or `@try` where a statement may start |
| `expression_at_code_block` | Expression | A `@{ }` block where an expression may start |
| `expression_at_control_flow` | Expression | The four directives where an expression may start |
| `lazy_assignment_pattern` | Pattern | `&{ }` and `&[ ]` on the left of `=` |
| `function_body` | Function | `function f() @{ }` and `() => @{ }` |
| `for_of_tail` | For-of | `; index x` and `; key y` after a for-of right operand |
| `binding_pattern` | Pattern | `&{ }` and `&[ ]` in declarations, parameters and for heads |
| `module_specifier` | Module | `import { x } from ident` |
| `jsx_child_at_code_block` | JSX | A `@{ }` block as a JSX child |
| `jsx_child_at_control_flow` | JSX | The four directives as JSX children |
| `jsx_element_name` | JSX | A `<{expr}>` tag name |
| `function_body_starts` | Function | Tells Yuku a `@{` begins a body |
| `can_start_binding` | Pattern | Tells Yuku a `&` begins a binding |
| `jsx_element_after_open` | JSX | `<style>` raw text; any element whose children hold a `@` or a literal `<` |
| `jsx_fragment_after_open` | JSX | The same for `<>...</>` |
| `validate_jsx_element_name` | JSX | Rejects a dynamic tag expression that cannot name an element |
| `jsx_names_match` | JSX | `<{a}>` closes with `</{a}>`, compared as text after trimming |
| `jsx_text_boundary` | Text | A `@` ends a JSX text run |
| `jsx_text_value` | Text | Entity decoding in JSX text |

## One dispatcher, every position

```tsrx
@if (open) { <a /> }
const v = @if (open) { <b /> };
const w = <ul>@if (open) { <li /> }</ul>;
```

The same `@if` parses as a statement, expression, or JSX child. All three hooks call the same dispatcher, which accepts `@if`, `@for`, `@switch`, and `@try`; `@{` uses its own parser. These constructs also work inside member tags such as `<select.content>` and inside fragments.

The `lang` option does not disable dialect hooks. It still controls the surrounding grammar, so pass `lang: "tsx"` or let `parseModule` infer it from a `.tsrx` filename.

## What lives where

`src/dialect/parser_extension.zig` connects the twenty hooks to seven focused files. `src/dialect/schema.zig` declares eight record types—records are the extra syntax-tree shapes added by the dialect—from `JSXCodeBlock` to `StyleSheet`. The parser keeps those shapes instead of lowering [TSRX](https://tsrx.dev) to TSX.

The native addon and the playground's WebAssembly module use the same parser source.
