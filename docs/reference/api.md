---
title: API
description: Every export of the yuku-tsrx package, with its signature, grouped by what it does.
---

# API

Everything the package exports, straight from
[`npm/yuku-tsrx/index.d.ts`](https://github.com/compiled-run/yuku-tsrx/blob/main/npm/yuku-tsrx/index.d.ts).
The package is ESM.

```js
import {
  analyze,
  decode,
  decodeAnalyzer,
  encode,
  generate,
  isEventAttribute,
  normalizeEventName,
  parse,
  parseModule,
  parseWire,
  walk,
} from "yuku-tsrx";
```

Eleven functions. Nothing else is exported at runtime; the rest of the file is
types.

| Function | Group |
| --- | --- |
| `parse` | [Parsing](#parsing) |
| `parseModule` | [Parsing](#parsing) |
| `parseWire` | [Parsing](#parsing) |
| `analyze` | [Analysis](#analysis) |
| `generate` | [Generation](#generation) |
| `decode` | [Wire and decoders](#wire-and-decoders) |
| `decodeAnalyzer` | [Wire and decoders](#wire-and-decoders) |
| `encode` | [Wire and decoders](#wire-and-decoders) |
| `walk` | [walk](#walk) |
| `isEventAttribute` | [Helpers](#helpers) |
| `normalizeEventName` | [Helpers](#helpers) |

## Parsing

```ts
export function parse(source: string | Uint8Array, options?: ParseOptions): ParseResult;
```

Parses `source` and returns the program, its comments, and its diagnostics. It
does not throw for bad source; problems come back as diagnostics.

```ts
export function parseModule(
	source: string | Uint8Array,
	filename: string,
	options?: ParseModuleOptions,
): Program;
```

Parses `source` as a module and returns the `Program`. The language is inferred
from `filename`, `sourceType` is `"module"`, and `semanticErrors` defaults to
`true`. Throws a `SyntaxError` on the first diagnostic of severity `"error"`,
unless `collect` or `loose` is set, in which case the fatal diagnostics are
pushed into the `errors` array you passed and the program is returned anyway.

```ts
export function parseWire(source: string | Uint8Array, options?: ParseOptions): ArrayBuffer;
```

Parses `source` and returns the raw transfer buffer, undecoded.

### `ParseOptions`

```ts
export type SourceLang = "js" | "jsx" | "ts" | "tsx" | "dts";
export type SourceType = "script" | "module" | "commonjs";

export interface ParseOptions {
	lang?: SourceLang;
	sourceType?: SourceType;
	preserveParens?: boolean;
	semanticErrors?: boolean;
	attachComments?: boolean;
	loose?: boolean;
}
```

### `ParseModuleOptions`

```ts
export interface ParseModuleOptions extends Omit<ParseOptions, "sourceType"> {
	collect?: boolean;
	errors?: Diagnostic[];
	comments?: Comment[];
}
```

### `ParseResult`

```ts
export interface ParseResult {
	program: Program;
	comments: BaseNode[];
	diagnostics: Diagnostic[];
}
```

### `Diagnostic`

```ts
export interface DiagnosticLabel {
	message?: string;
	start?: number;
	end?: number;
}

export interface Diagnostic {
	severity: "error" | "warning" | "hint" | "info";
	message: string;
	start: number;
	end: number;
	help: string | null;
	labels: DiagnosticLabel[];
}
```

[Parser](/guide/parser) has what each option does and how diagnostics are split
between fatal and recoverable.

## Analysis

```ts
export function analyze(source: string | Uint8Array, options?: ParseOptions): AnalyzeResult;
```

Parses `source` and resolves its scopes, symbols, and references.

```ts
export interface AnalyzeResult extends ParseResult {
	readonly semantic: SemanticView;
}

export interface SemanticView {
	reference: { count: number; name(index: number): string; symbolId(index: number): number | null };
	scope: { count: number; kind(index: number): string };
	symbol: { count: number; name(index: number): string };
}
```

[Analyzer](/guide/analyzer) has the details.

## Generation

```ts
export function generate(program: Program, options?: GenerateOptions): GenerateResult;
```

Prints `program` back to source. Throws a `TypeError` if the argument is not a
`Program` node from this parser.

```ts
export interface GenerateOptions {
	strip?: boolean;
	minify?: boolean | { whitespace?: boolean; syntax?: boolean; quotes?: boolean };
	format?: "pretty" | "compact";
	indent?: number;
	quotes?: "preserve" | "double" | "single" | "shortest";
	comments?: boolean | "all" | "some" | "none" | "line" | "block";
	sourceMaps?: SourceMapOptions;
}

export interface SourceMapOptions {
	source: string;
	file?: string;
	sourceFileName?: string;
	sourceRoot?: string;
	sourcesContent?: boolean;
}

export interface SourceMap {
	version: 3;
	file: string | null;
	sourceRoot: string | null;
	sources: string[];
	sourcesContent: Array<string | null> | null;
	names: string[];
	mappings: string;
}

export interface GenerateResult {
	code: string;
	errors: Array<{ message: string; start: number; end: number }>;
	map: SourceMap | null;
}
```

[Code Generator](/guide/codegen) has what each option does.

## Wire and decoders

The native addon returns a buffer. These three are the boundary between that
buffer and JavaScript objects.

```ts
export function decode(buffer: ArrayBuffer, source: string): ParseResult;
```

Decodes a buffer from `parseWire`. `source` is the text the buffer was produced
from; node positions index into it.

```ts
export function decodeAnalyzer(buffer: ArrayBuffer, source: string): unknown;
```

Decodes an analyzer buffer. Typed `unknown` because the analyzer buffer carries
more than the `SemanticView` interface promises. `analyze` uses it internally and
gives you the typed result.

```ts
export function encode(program: Program): ArrayBuffer;
```

Encodes a program into a buffer the native side can read. `generate` uses it on
the way in.

## `walk`

```ts
export type WalkVisitor = (
	node: BaseNode,
	context: { parent: BaseNode | null; state: unknown },
) => void;

export type Visitors = Record<
	string,
	WalkVisitor | { enter?: WalkVisitor; leave?: WalkVisitor }
> & {
	enter?: WalkVisitor;
	leave?: WalkVisitor;
};

export function walk<T extends BaseNode>(root: T, visitors: Visitors, state?: unknown): T;
```

Visits every node under `root` and returns `root`. A key is a node `type`, or
`enter` / `leave` for every node. It descends into every property except
`comments`.

## Helpers

Two string functions for JSX event attributes. Neither one touches the AST.

```ts
export function isEventAttribute(attribute: string): boolean;
```

`true` when the attribute name starts with `on`, is longer than two characters,
and has an uppercase third character. So `onClick` is an event attribute and
`once` is not.

```ts
export function normalizeEventName(attribute: string): string;
```

Drops the leading `on`, drops a trailing `Capture`, and lowercases the rest.
`onClick` gives `click` and `onClickCapture` gives `click`. Two names keep their
suffix because it is part of the event name rather than a capture marker:
`onGotPointerCapture` gives `gotpointercapture` and `onLostPointerCapture`
gives `lostpointercapture`.

## Node types

Every node has `type`, `start`, and `end`. `start` and `end` are offsets into the
source string you passed in.

```ts
export interface BaseNode {
	type: string;
	start: number;
	end: number;
}
```

### TSRX nodes

```ts
export interface JSXCodeBlock extends Expression {
	type: "JSXCodeBlock";
	body: Statement[];
	render: Expression | TSRXExpression | null;
}

export interface JSXIfExpression extends Expression {
	type: "JSXIfExpression";
	test: Expression;
	consequent: BlockStatement;
	alternate: JSXIfExpression | BlockStatement | null;
}

export interface JSXForExpression extends Expression {
	type: "JSXForExpression";
	statement: ForOfStatement | ForStatement;
	empty: BlockStatement | null;
}

export interface JSXSwitchExpression extends Expression {
	type: "JSXSwitchExpression";
	statement: SwitchStatement;
}

export interface JSXTryExpression extends Expression {
	type: "JSXTryExpression";
	statement: TryStatement;
	pending: BlockStatement | null;
}

export interface TSRXExpression extends Expression {
	type: "TSRXExpression";
	expression: Expression;
}

export interface StyleSheet extends BaseNode {
	type: "StyleSheet";
	source: string;
}

export interface JSXStyleElement extends Expression {
	type: "JSXStyleElement";
	openingElement: TSRXJSXOpeningElement;
	children: StyleSheet[];
	closingElement: TSRXJSXClosingElement;
	css: string;
}
```

### Ordinary nodes with TSRX fields

`ForOfStatement` gains `index` and `key` for the `; index` and `; key` tail
clauses:

```ts
export interface ForOfStatement extends Statement {
	type: "ForOfStatement";
	left: VariableDeclaration | Pattern;
	right: Expression;
	body: Statement;
	await: boolean;
	index: Expression | undefined;
	key: Expression | undefined;
}
```

`Program` and `BlockStatement` admit TSRX expressions and JSX directly in their
bodies:

```ts
export interface Program extends BaseNode {
	type: "Program";
	body: Array<Statement | TSRXExpression | TSRXJSXElement | TSRXJSXFragment>;
	sourceType: "script" | "module";
	hashbang?: string | null;
}
```

`TSRXJSXElement` and `TSRXJSXFragment` are the ordinary JSX nodes, still typed
`"JSXElement"` and `"JSXFragment"`, widened to admit TSRX children:

```ts
export type TSRXJSXChild = BaseNode | TSRXExpression | JSXStyleElement;

export interface TSRXJSXElement extends Expression {
	type: "JSXElement";
	openingElement: TSRXJSXOpeningElement;
	children: TSRXJSXChild[];
	closingElement: TSRXJSXClosingElement | null;
}
```

The rest of the node types, `VariableDeclaration`, `SwitchStatement`,
`TryStatement`, `CatchClause`, the JSX opening and closing elements, and
`Comment`, are the ordinary ones and are all in `index.d.ts`.
