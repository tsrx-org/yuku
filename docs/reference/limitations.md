---
title: Limitations
description: Known failures to design around before shipping.
---

# Limitations

These are the failures you need to design around before shipping.

**`@for` does not support `for...in`.** The parser reports the whole loop binding as an error. Iterate over `Object.entries(value)` with `for...of` instead.

**A catch annotation is one type name.** Destructured and lazy `@catch` bindings work, but a type annotation such as `ErrorInfo` must be a single identifier.

**A lazy pattern cannot initialize a C-style loop.** `for (&{ bit }; test; update)` reports `A lazy pattern needs 'of' or 'in' after it`. Use the pattern in a `for...of` or `for...in` binding.

**A bare `@` in JSX text is a syntax error.** `<p>mail @ home</p>` fails because `@` begins a [TSRX](https://tsrx.dev) construct. Put that text in an expression instead.

**A dynamic tag accepts only an identifier, member expression, or string literal.** Calls, template literals, conditionals, and logical expressions are rejected. Assign the result to a variable first, then use `<{tag}>`.

**The browser build exposes only `parse`, `analyze`, and `generate`.** It has no `parseModule` filename inference, first-error throwing, diagnostic-span rewriting, or source maps. Create Source Map V3 output through the npm package.

See [Diagnostics and recovery](/guide/diagnostics) for safe parsing patterns and [Generate](/guide/generate) for supported printer options.
