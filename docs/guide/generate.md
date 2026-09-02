---
title: Generate
description: Print a tree and control its formatting.
---

# Generate

Print a tree and control its formatting.

```js
import { generate, parse } from "@tsrx/yuku";

const source = "export const answer: number = 42;";
const { program } = parse(source, { lang: "tsx" });
const { code, map } = generate(program, {
  strip: true,
  sourceMaps: {
    source,
    file: "answer.js",
    sourceFileName: "answer.tsrx",
    sourcesContent: true,
  },
});

map.version; // 3
```

`code` is now `export const answer = 42;`. The npm package returns a Source Map V3 object in `map`, ready to write beside the generated file.

Toggle Strip types and watch the generated module change.

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

## Formatting options do one job each

```ts
interface GenerateOptions {
  format?: "pretty" | "compact";
  indent?: number;
  quotes?: "preserve" | "double" | "single" | "shortest";
  comments?: boolean | "all" | "some" | "none" | "line" | "block";
  strip?: boolean;
  minify?: boolean | { whitespace?: boolean; syntax?: boolean; quotes?: boolean };
  sourceMaps?: SourceMapOptions;
}
```

`format` defaults to `pretty`; `compact` removes spaces the grammar does not need. `indent` defaults to two spaces and affects only pretty output.

`quotes` defaults to `preserve`. Choose `double` or `single` to force one style.

`comments` defaults to `some`, which keeps legal headers, JSDoc, and tree-shaking annotations. Choose `all`, `line`, `block`, or `none`; booleans mean `all` and `none`. Comments must be attached during parsing, as in the opening sample.

## The diff isolates each change

Compare the landing diff, then change one option on output B.

<!-- widget:generate-diff -->
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

The browser and npm package both apply `strip: true`, `minify: true`, and the syntax minification shown here. This widget runs the browser build; the opening example uses npm because the browser has no source maps.

## Minify can make three choices

```js
generate(program, { minify: true });
generate(program, { minify: { whitespace: true } });
generate(program, { minify: { syntax: true } });
```

`minify: true` enables whitespace, syntax, and quote shortening. The object form lets you choose; syntax minification also picks the quote that needs fewer escapes.

`strip` wins when you combine it with syntax minification, so types disappear instead of being tightened. Whitespace minification still applies.

Asking for `quotes: "shortest"` without syntax minification throws:

```
TypeError: yuku-tsrx generate: quotes "shortest" is not supported here; the codegen offers "preserve", "double" and "single", and minify picks the shortest quote itself
```

Use `minify: { syntax: true }` when you want shortest quotes. `minify: { quotes: true }` without `syntax` throws the same error.

## A source map needs the original text

```js
const result = generate(program, {
  sourceMaps: {
    source,
    file: "cart.js",
    sourceFileName: "cart.tsrx",
    sourceRoot: "/src",
    sourcesContent: true,
  },
});

result.map.sources; // ["cart.tsrx"]
```

`source` is required because mappings point back to the exact text you parsed. `file`, `sourceFileName`, and `sourceRoot` name the generated and authored locations; `sourcesContent: true` embeds the original text.

Without `sourceMaps`, `map` is `null`. The browser build carries no source-map support and throws if you pass this option, so create maps through the npm package.

## The result names code and printing errors

```ts
interface GenerateResult {
  code: string;
  errors: Array<{ message: string; start: number; end: number }>;
  map: SourceMap | null;
}
```

`errors` names anything [Yuku's printer](https://yuku.fyi) could not handle. Pass a `Program` from this parser; any other first argument throws `TypeError: Expected a Program node from yuku-tsrx`.

Generated code can use different spacing from the input. Parse it again and you get the same structure with no diagnostics; the repository checks that round trip across every valid fixture.

Next, change the tree before printing it on [Walk and transform](/guide/walk).
