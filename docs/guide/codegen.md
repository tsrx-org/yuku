---
title: Code Generator
description: generate turns a Program back into source text, with options for stripping types, minifying, indentation, quotes, and comments.
---

# Code Generator

`generate` is the parser run backwards. Give it a `Program` and it gives you
source text.

```ts
generate(program: Program, options?: GenerateOptions): GenerateResult
```

```js
import { generate, parse } from "yuku-tsrx";

const { program } = parse(source, { lang: "tsx" });
const { code, errors, map } = generate(program);
```

The tree does not have to be the one you just parsed. You can walk it, change
it, and print the result, which is what a codemod does.

## What it accepts

The first argument has to be a `Program` node from this parser. `generate`
checks that before doing anything and throws a `TypeError` reading
`Expected a Program node from yuku-tsrx` otherwise. It is not a printer for
arbitrary ESTree.

Internally the tree goes back across the native boundary the same way it came:
`generate` calls [`encode`](/guide/parser#the-wire-format-underneath) on the
program and hands the buffer to the addon. The generator itself is
`src/dialect/codegen.zig`.

## `GenerateOptions`

```ts
export interface GenerateOptions {
  strip?: boolean;
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; quotes?: boolean };
  format?: "pretty" | "compact";
  indent?: number;
  quotes?: "preserve" | "double" | "single" | "shortest";
  comments?: boolean | "all" | "some" | "none" | "line" | "block";
}
```

| Option | What it does |
| --- | --- |
| `strip` | Emit without the TypeScript-only syntax. |
| `minify` | Size-reducing output. `true` means all three modes; an object turns them on one at a time. |
| `format` | `pretty` is indented, with spaces around operators and after commas. `compact` emits no discretionary whitespace, only what the grammar requires. |
| `indent` | Spaces per indentation level. Used only when `format` is `pretty`. |
| `quotes` | `preserve` keeps each literal's original quote style, `double` and `single` force one, `shortest` picks the one that needs fewer escapes. |
| `comments` | Which comments survive. |

One current limitation: `quotes: "shortest"` only exists inside `minify`. The
`Quotes` enum in `src/dialect/codegen.zig` has `preserve`, `double`, and
`single`; the minifying printer ignores it and always picks the quote that needs
fewer escapes, which is what `minify: true` and `minify: { syntax: true }` give
you. Asking for `quotes: "shortest"` (or `minify: { quotes: true }`) without the
`syntax` mode throws a `TypeError` that says so, in Node and in the browser
alike. When `strip` and `minify` are both set, `strip` wins.

Every option in the table is a control below, and the output is what the
generator in your browser returns for the settings you pick.

<!-- codegen-walkthrough -->
```tsrx
import type { Item } from "./item";
import { format } from './format';

/* The cart list, one row per item. */
export function Cart({ items }: { items: Item[] }) {
  // total is read by the attribute below
  @{ const total = items.length; }
  return (
    <ul class="cart" data-empty={total === 0}>
      @for (const item of items; key item.id) {
        <li>{format(item.label)}</li>
      }
    </ul>
  );
}
```

The figure parses with `attachComments: true`, because the `comments` option can
only act on comments the parse kept.

### `comments`

`none` drops all comments, `all` emits every one, `line` emits only `// ...`,
`block` emits only `/* ... */`, and `some` emits legal headers, JSDoc, and
tree-shaking annotations such as `__PURE__` and `__NO_SIDE_EFFECTS__`. A boolean
is accepted as a shorthand: `true` becomes `all` and `false` becomes `none`.
Without the option, the generator's own default applies, which is `some`.

### `minify` is three switches, not one

`minify: true` is shorthand for `{ whitespace: true, syntax: true, quotes: true }`,
and `npm/yuku-tsrx/index.js` expands each of the three into the option it
actually controls:

| Mode | Effect |
| --- | --- |
| `syntax` | Turns on the print-time size-reducing substitutions, which include picking the shortest quote. |
| `whitespace` | Sets `format` to `compact`. |
| `quotes` | Sets `quotes` to `shortest`, which only the `syntax` printer can honour. |

So `{ minify: { whitespace: true } }` gives you compact output with ordinary
syntax and ordinary quotes, and `{ minify: true }` gives you all three. Setting
`format` or `quotes` yourself alongside a `minify` mode that also sets them
means the mode wins.

### `sourceMaps`

`sourceMaps: { source, file?, sourceFileName?, sourceRoot?, sourcesContent? }`
puts a Source Map V3 object on `GenerateResult.map`. `source` is the text the
program was parsed from: node positions index into it, so the generator needs
it to turn them into lines and columns. `file` becomes the map's `file`,
`sourceFileName` its single `sources` entry, and `sourcesContent: true` embeds
`source`. Without the option, `map` is `null`. The browser build has no source
maps and throws the same kind of `TypeError` when asked.

## `GenerateResult`

```ts
export interface GenerateResult {
  code: string;
  errors: Array<{ message: string; start: number; end: number }>;
  map: unknown | null;
}
```

`code` is the source text. `errors` is empty when codegen ran cleanly; an entry
is a problem the generator found in the tree you handed it, with the offsets of
the node it found it on. `map` is a Source Map V3 object, and it is `null`
unless source maps were requested.

## Round-tripping

Printing a parsed tree and parsing the result again should give you the same
structure back. That is the property the repository's own tests hold the
generator to, across every valid fixture in `test/parser/misc/tsrx/`:

```js
import { analyze, generate, parse } from "yuku-tsrx";

const analysis = analyze(source, { lang: "tsx" });
const generated = generate(analysis.program);
const reparsed = parse(generated.code, { lang: "tsx" });
// reparsed.diagnostics is empty, and the structure matches
```

This is the check that keeps TSRX from quietly degrading on the way out. A
generator that printed a `JSXCodeBlock` as an ordinary expression would produce
text that still parses, just not into the same tree, so "it parses" is not the
bar. See [TSRX Syntax Support](/guide/tsrx-syntax) for the constructs that have
to survive the trip.
