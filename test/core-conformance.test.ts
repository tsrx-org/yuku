import { expect, test } from "vitest";
import { generate, parse, parseModule } from "@tsrx/yuku";

// Regression tests for the @tsrx/core 0.5.0 rules reported against tsrx-org/oxc
// (#110, #112, #113, #114, #115, #116). Every expected value below is what
// @tsrx/core 0.5.0 (tsrx main at c70964d) returns for the same source, so a
// difference here is a difference from the reference parser. Offsets are
// yuku's `start`/`end`, which core calls `pos`/`end`.

type Node = { type?: string; [key: string]: unknown };
type Diagnostic = { message: string; start: number; pos: number; end: number; code?: string };
type CoreError = SyntaxError & { code?: string; pos?: number; end?: number };

function findAll(root: unknown, predicate: (node: Node) => boolean): Node[] {
	const found: Node[] = [];
	const visit = (value: unknown) => {
		if (value === null || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		const node = value as Node;
		if (predicate(node)) found.push(node);
		for (const [key, child] of Object.entries(node)) {
			if (key === "loc" || key.endsWith("Comments")) continue;
			visit(child);
		}
	};
	visit(root);
	return found;
}

// yuku keeps layout-only text that core drops, so compare the rest.
const texts = (ast: unknown) =>
	findAll(ast, (node) => node.type === "JSXText")
		.filter(({ value }) => String(value).trim() !== "" || String(value).includes("\u00a0"))
		.map(({ value, raw, start, end }) => ({ value, raw, start, end }));

const script = (ast: unknown) =>
	findAll(ast, (node) => node.type === "JSXScriptElement")[0] as {
		content: string;
		children: unknown[];
		closingElement: { start: number; end: number };
	};

function collected(source: string, mode: "collect" | "loose" = "collect"): Diagnostic[] {
	const errors: Diagnostic[] = [];
	parseModule(source, "App.tsrx", { [mode]: true, errors });
	return errors;
}

function thrown(source: string, options?: object): CoreError | null {
	try {
		parseModule(source, "App.tsrx", options);
	} catch (error) {
		return error as CoreError;
	}
	return null;
}

// `[message, pos, end]` of each recorded error, as core's collect mode records them.
const recorded = (source: string, mode: "collect" | "loose" = "collect") =>
	collected(source, mode).map(({ message, pos, end }) => [message, pos, end]);

test("#110: a // line and a block comment in JSX text are left out of value and raw", () => {
	const cases: [string, object[]][] = [
		[
			"export function App() @{\n\t<p>\n\t\ta\n\t\t// note\n\t\tb\n\t</p>\n}",
			[{ value: "\n\t\ta\n\t\t\n\t\tb\n\t", raw: "\n\t\ta\n\t\t\n\t\tb\n\t", start: 29, end: 49 }],
		],
		[
			"export function App({ c }) @{\n\t<main>{c && <b>\n\t\ta\n\t\t// note\n\t\tb\n\t</b>}</main>\n}",
			[{ value: "\n\t\ta\n\t\t\n\t\tb\n\t", raw: "\n\t\ta\n\t\t\n\t\tb\n\t", start: 46, end: 66 }],
		],
		[
			"export function App() {\n\treturn (\n\t\t<p>\n\t\t\ta\n\t\t\t// note\n\t\t\tb\n\t\t</p>\n\t);\n}",
			[
				{
					value: "\n\t\t\ta\n\t\t\t\n\t\t\tb\n\t\t",
					raw: "\n\t\t\ta\n\t\t\t\n\t\t\tb\n\t\t",
					start: 39,
					end: 63,
				},
			],
		],
		[
			"export function App() {\n\treturn <p>a /* note */ b</p>;\n}",
			[{ value: "a  b", raw: "a  b", start: 35, end: 49 }],
		],
		[
			"export function App() @{\n\t<p>a /* note */ b</p>\n}",
			[{ value: "a  b", raw: "a  b", start: 29, end: 43 }],
		],
		// A `//` after other text on its line is text.
		[
			"export function App() @{\n\t<p>a // note</p>\n}",
			[{ value: "a // note", raw: "a // note", start: 29, end: 38 }],
		],
		[
			"export function App() {\n\treturn <p>a // note\n b</p>;\n}",
			[{ value: "a // note\n b", raw: "a // note\n b", start: 35, end: 47 }],
		],
		// A comment hides the markup in it.
		[
			"export function App({ a }) @{\n\t<div>\n\t\t// <b>x</b> {a}\n\t\t<i>y</i>\n\t</div>\n}",
			[{ value: "y", raw: "y", start: 60, end: 61 }],
		],
		[
			"export function App({ a }) {\n\treturn <div>\n\t\t/* <b>x</b>\n\t\t{a} */\n\t\t<i>y</i>\n\t</div>;\n}",
			[{ value: "y", raw: "y", start: 71, end: 72 }],
		],
		[
			"export function App() {\n\treturn <div>a /* } */ b</div>;\n}",
			[{ value: "a  b", raw: "a  b", start: 37, end: 48 }],
		],
	];
	for (const [source, expected] of cases) {
		expect(texts(parseModule(source, "App.tsrx")), source).toEqual(expected);
	}

	// An escaped opener is text, not a comment. (Its entities are decoded, which
	// is #111's change and not core 0.5.0's.)
	const escaped = parseModule(
		"export function App() @{\n\t<p>a &#47;* note *&#47; b</p>\n}",
		"App.tsrx",
	);
	expect(texts(escaped).map(({ start, end }) => [start, end])).toEqual([[29, 51]]);
});

test("#112: a non-breaking space next to a line break is text, not layout", () => {
	const cases: [string, object[]][] = [
		[
			"export function App() @{\n\t<p>\u00a0\n\t\t<b /></p>\n}",
			[{ value: "\u00a0\n\t\t", raw: "\u00a0\n\t\t", start: 29, end: 33 }],
		],
		[
			"export function App() @{\n\t<p><b />\n\t\t\u00a0</p>\n}",
			[{ value: "\n\t\t\u00a0", raw: "\n\t\t\u00a0", start: 34, end: 38 }],
		],
		[
			"export function App() {\n\treturn <p>\u00a0\n\t\t<b /></p>;\n}",
			[{ value: "\u00a0\n\t\t", raw: "\u00a0\n\t\t", start: 35, end: 39 }],
		],
	];
	for (const [source, expected] of cases) {
		expect(texts(parseModule(source, "App.tsrx")), JSON.stringify(source)).toEqual(expected);
	}
});

test("#114: a <script> body is raw text on content, with no children", () => {
	const cases: [string, string][] = [
		["export function App({ code }) @{\n\t<div><script>{code}</script></div>\n}", "{code}"],
		["export function App({ code }) {\n\treturn <div><script>{code}</script></div>;\n}", "{code}"],
		[
			"export function App({ code }) {\n\treturn <div><script>run(); {code}</script></div>;\n}",
			"run(); {code}",
		],
		[
			"export function App() {\n\treturn (\n\t\t<script>\n\t\t\t// c\n\t\t\trun();\n\t\t</script>\n\t);\n}",
			"\n\t\t\t// c\n\t\t\trun();\n\t\t",
		],
		["export function App() {\n\treturn <script></script>;\n}", ""],
		["export function App() {\n\treturn <script>if (a) { go(); }</script>;\n}", "if (a) { go(); }"],
		[
			'export function App() {\n\treturn <script type="application/json">{"a": 1}</script>;\n}',
			'{"a": 1}',
		],
		["export function App() {\n\treturn <script>if (a < b) go();</script>;\n}", "if (a < b) go();"],
		[
			"export function App() {\n\treturn <script>items.forEach((i) => log(i));</script>;\n}",
			"items.forEach((i) => log(i));",
		],
	];
	for (const [source, content] of cases) {
		const element = script(parseModule(source, "App.tsrx"));
		expect(element.content, source).toBe(content);
		expect(element.children, source).toEqual([]);
		const closeStart = source.lastIndexOf("</script>");
		expect([element.closingElement.start, element.closingElement.end], source).toEqual([
			closeStart,
			closeStart + 9,
		]);
	}
});

test("#114: a self-closing <script /> has no content, and still prints", () => {
	const source =
		'export function App() {\n\treturn <div><script src="x" /><script></script></div>;\n}';
	const [selfClosing, empty] = findAll(
		parseModule(source, "App.tsrx"),
		(node) => node.type === "JSXScriptElement",
	);
	expect("content" in selfClosing).toBe(false);
	expect(empty.content).toBe("");
	const program = parseModule(source, "App.tsrx");
	expect(generate(program).code).toContain('<script src="x" /><script></script>');
	expect("content" in findAll(program, (node) => node.type === "JSXScriptElement")[0]).toBe(false);
});

test("#110: only a .tsrx file reads comments in JSX text; in .tsx and .jsx they are text", () => {
	const source =
		"export function App() {\n\treturn <div>\n\t\t// x <b>y</b>\n\t\ta /* c */ b\n\t</div>;\n}";
	const values = (filename: string) =>
		findAll(parseModule(source, filename), (node) => node.type === "JSXText")
			.map(({ value }) => String(value).trim())
			.filter(Boolean);
	expect(values("App.tsrx")).toEqual(["a  b"]);
	for (const filename of ["App.tsx", "App.jsx"]) {
		expect(values(filename), filename).toEqual(["// x", "y", "a /* c */ b"]);
	}
	expect(values("App.tsx").length).toBe(3);
	// the option overrides the filename
	const tsrx = findAll(
		parseModule(source, "App.tsx", { tsrx: true }),
		(node) => node.type === "JSXText",
	);
	expect(tsrx.map(({ value }) => String(value).trim()).filter(Boolean)).toEqual(["a  b"]);
	// `parse` reads standard JSX unless `tsrx` is set
	const plain = (options: object) =>
		findAll(
			parse("const v = <div>// x</div>;", options).program,
			(node) => node.type === "JSXText",
		).map(({ value }) => value);
	expect(plain({ lang: "tsx" })).toEqual(["// x"]);
	expect(plain({ lang: "tsx", tsrx: true })).toEqual([]);
});

test("#116: a script body ends at </script, HTML whitespace, and >", () => {
	const cases: [string, number, number][] = [
		["export function App() @{\n\t<div><script>go();</script ></div>\n}", 44, 54],
		["export function App() @{\n\t<div><script>go();</script\n\t></div>\n}", 44, 55],
		["export function App() @{\n\t<div><script>go();</script\f></div>\n}", 44, 54],
		["export function App() {\n\treturn <script>go();</script >;\n}", 45, 55],
	];
	for (const [source, start, end] of cases) {
		for (const mode of [undefined, "collect", "loose"] as const) {
			const errors: Diagnostic[] = [];
			const element = script(parseModule(source, "App.tsrx", mode ? { [mode]: true, errors } : {}));
			expect(element.content, source).toBe("go();");
			expect([element.closingElement.start, element.closingElement.end], source).toEqual([
				start,
				end,
			]);
			expect(errors, source).toEqual([]);
		}
	}
});

test("#116: any other </script in a script body is tsrx-script-end-tag-in-body", () => {
	const message = (written: string) =>
		`'${written}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/${written.slice(2)}' instead.`;
	const cases: [string, string][] = [
		["</SCRIPT>", "</SCRIPT"],
		["</script/>", "</script"],
		["</scripts>", "</script"],
		["</Script >", "</Script"],
	];
	for (const [inner, written] of cases) {
		const source = `export function App() @{\n\t<div><script>a = 1;${inner}b = 2;</script></div>\n}`;

		const error = thrown(source);
		expect(error?.message, source).toBe(`${message(written)} (45:53)`);
		expect(error?.code, source).toBe("tsrx-script-end-tag-in-body");

		for (const mode of ["collect", "loose"] as const) {
			const errors: Diagnostic[] = [];
			const element = script(parseModule(source, "App.tsrx", { [mode]: true, errors }));
			expect(element.content, `${mode}: ${source}`).toBe(`a = 1;${inner}b = 2;`);
			expect(element.children).toEqual([]);
			expect(
				errors.map(({ message, code, start, end }) => ({ message, code, start, end })),
				`${mode}: ${source}`,
			).toEqual([
				{ message: message(written), code: "tsrx-script-end-tag-in-body", start: 45, end: 53 },
			]);
		}
	}

	// A `</script` outside a script body is not reported.
	const outside =
		'export function App() {\n\tconst s = "</SCRIPT>";\n\treturn <script>a</script>;\n}';
	expect(script(parseModule(outside, "App.tsrx")).content).toBe("a");
});

const DYNAMIC_TAG_MESSAGE =
	"A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";
const DYNAMIC_TAG_CODE = "tsrx-dynamic-tag-expression";

const dynamicTagSource = (tag: string) =>
	`export function App({ tag, props, registry, name, c, A, B, Tag, getTag, getName, level, items, a }) @{\n\t<div>\n\t\t<{${tag}} />\n\t</div>\n}`;

test("#115: identifiers, member chains, and string literals are dynamic tags", () => {
	for (const tag of [
		"tag",
		"props.as",
		"registry[name]",
		"'section'",
		"this.tag",
		"items[0]",
		"a.b[name][0].c",
	]) {
		const source = dynamicTagSource(tag);
		expect(thrown(source), tag).toBeNull();
		expect(collected(source), tag).toEqual([]);
	}
});

test("#115: any other dynamic tag expression is reported at the part core reports", () => {
	// [tag, the part @tsrx/core 0.5.0 reports]
	const cases: [string, string][] = [
		["c ? A : B", "c ? A : B"],
		["props.as ?? 'div'", "props.as ?? 'div'"],
		["(tag)", "(tag)"],
		["(a).b", "(a)"],
		["tag as any", "tag as any"],
		["tag!", "tag!"],
		["c && Tag", "c && Tag"],
		["props?.as", "props?.as"],
		["registry[getName()]", "getName()"],
		["registry[(name)]", "(name)"],
		["undefined", "undefined"],
		["null", "null"],
		["() => <b>x</b>", "() => <b>x</b>"],
		["c || <b>x</b>", "c || <b>x</b>"],
		["`div`", "`div`"],
		["getTag()", "getTag()"],
		["'h' + level", "'h' + level"],
	];
	for (const [tag, part] of cases) {
		const source = dynamicTagSource(tag);
		const start = source.indexOf(part, source.indexOf("<{"));
		const end = start + part.length;
		const error = thrown(source);
		expect(error?.message, tag).toBe(`${DYNAMIC_TAG_MESSAGE} (${start}:${end})`);
		expect(error?.code, tag).toBe(DYNAMIC_TAG_CODE);
		for (const mode of ["collect", "loose"] as const) {
			const errors = collected(source, mode);
			expect(
				errors.map(({ message, code, start, end }) => [message, code, start, end]),
				`${mode} ${tag}`,
			).toEqual([[DYNAMIC_TAG_MESSAGE, DYNAMIC_TAG_CODE, start, end]]);
		}
	}
});

test("#115: a paired element is reported once, at its opening tag", () => {
	const paired =
		"export function App({ c, A, B }) @{\n\t<div><{c ? A : B}>x</{c ? A : B}></div>\n}";
	expect(collected(paired).map(({ start, end }) => [start, end])).toEqual([[44, 53]]);
});

test("#115: a spread or an empty dynamic tag is no expression", () => {
	const cases: [string, number][] = [
		["export function App({ a }) @{\n\t<div><{...a} /></div>\n}", 37],
		["export function App() @{\n\t<div><{} /></div>\n}", 33],
	];
	for (const [source, pos] of cases) {
		// Core raises these as plain syntax errors, without the code, in every mode.
		for (const options of [undefined, { collect: true, errors: [] }, { loose: true, errors: [] }]) {
			const error = thrown(source, options);
			expect(error, source).toBeInstanceOf(SyntaxError);
			expect(error?.message.startsWith(DYNAMIC_TAG_MESSAGE), source).toBe(true);
			expect(error?.code, source).toBeUndefined();
			expect(error?.pos, source).toBe(pos);
			expect(options?.errors ?? [], source).toEqual([]);
		}
	}
});

test("#115: a dynamic tag nested in a tag expression is reported first, in core's order", () => {
	const at = (source: string) =>
		collected(source).map(({ start, end }) => `${source.slice(start, end)}@${start}`);
	const nested = "export function A() @{ const x=<{() => <{a()}/>}>x</{() => <{a()}/>}>; }";
	expect(at(nested)).toEqual(["a()@41", "() => <{a()}/>@33", "a()@61"]);
	expect(thrown(nested)?.pos).toBe(41);
	const children = "export function A() { return <{c || <{d()}>{<{e()}/>}</{d()}>} />; }";
	expect(at(children)).toEqual(["d()@38", "e()@46", "c || <{d()}>{<{e()}/>}</{d()}>@31"]);
});

test("#113: scope errors throw core's message, and collect and loose record it", () => {
	const cases: [string, string, number][] = [
		[
			"export function f() {\n\tlet count = 0;\n\tlet count = 1;\n\treturn count;\n}",
			"Identifier 'count' has already been declared",
			43,
		],
		[
			"export function f() {\n\tconst count = 0;\n\t{\n\t\tvar count = 1;\n\t}\n\treturn count;\n}",
			"Identifier 'count' has already been declared",
			49,
		],
		[
			"export function App({ ready }) @{\n\tconst count = 0;\n\t<div>@{\n\t\tif (ready) { var count = 1; }\n\t\t<span>{count}</span>\n\t}</div>\n}",
			"Identifier 'count' has already been declared",
			80,
		],
		[
			"export function App({ ready }) @{\n\tconst count = 0;\n\t<div>@if (ready) {\n\t\tvar count = 1;\n\t\t<span>{count}</span>\n\t}</div>\n}",
			"Identifier 'count' has already been declared",
			78,
		],
		["import { a } from 'x';\nconst a = 1;", "Identifier 'a' has already been declared", 29],
		["function g() {}\nlet g = 1;", "Identifier 'g' has already been declared", 20],
		["class A {}\nclass A {}", "Identifier 'A' has already been declared", 17],
		["try {} catch (e) {\n\tlet e = 1;\n}", "Identifier 'e' has already been declared", 24],
		[
			"export function f(a) { let a = 1; return a; }",
			"Identifier 'a' has already been declared",
			27,
		],
		["type A = 1;\ntype A = 2;", "type 'A' has already been declared.", 17],
		["export { missing };", "Export 'missing' is not defined", 9],
	];
	for (const [source, message, pos] of cases) {
		const error = thrown(source);
		expect(error?.message.startsWith(`${message} (${pos}:`), source).toBe(true);
		// core reports the one character at the name's start
		expect([error?.pos, error?.end], source).toEqual([pos, pos + 1]);
		for (const mode of ["collect", "loose"] as const) {
			expect(recorded(source, mode), `${mode}: ${source}`).toEqual([[message, pos, pos + 1]]);
		}
	}
});

test("#113: redeclarations TypeScript merges but core reports are reported", () => {
	const cases: [string, [string, number, number][]][] = [
		["function g() {} function g() {}", [["Identifier 'g' has already been declared", 25, 26]]],
		[
			"function g() {}\nfunction g() {}\nfunction g() {}",
			[
				["Identifier 'g' has already been declared", 25, 26],
				["Identifier 'g' has already been declared", 41, 42],
			],
		],
		["function g() {} var g;", [["Identifier 'g' has already been declared", 20, 21]]],
		["declare const a: number;\nlet a;", [["Identifier 'a' has already been declared", 29, 30]]],
		["declare class A {}\nclass A {}", [["Identifier 'A' has already been declared", 25, 26]]],
		[
			"export function App() @{\n\t<div>@try { <b /> } @catch (e, e) { <i /> }</div>\n}",
			[["Identifier 'e' has already been declared", 57, 58]],
		],
		[
			"export function App() @{\n\tconst y = 1;\n\t<div>@try { <b /> } @pending { var y = 2; <p /> }</div>\n}",
			[["Identifier 'y' has already been declared", 75, 76]],
		],
		["function f(): void;\nexport { f };", [["Export 'f' is not defined", 29, 30]]],
		["export { missing };", [["Export 'missing' is not defined", 9, 10]]],
	];
	for (const [source, expected] of cases) {
		expect(thrown(source)?.pos, source).toBe(expected[0][1]);
		expect(recorded(source), source).toEqual(expected);
		expect(recorded(source, "loose"), source).toEqual(expected);
	}
});

test("#113: errors are recorded in core's order", () => {
	// a function's own name is declared after its body
	expect(recorded("let f;\nfunction f() { let a; let a; }")).toEqual([
		["Identifier 'a' has already been declared", 33, 34],
		["Identifier 'f' has already been declared", 16, 17],
	]);
	expect(recorded("const a = 1; function f(b, b) {} let a;")).toEqual([
		["Argument name clash", 24, 25],
		["Argument name clash", 27, 28],
		["Identifier 'a' has already been declared", 37, 38],
	]);
});

test("#113: a duplicate parameter throws at the second, and collect records both", () => {
	const cases: [string, number, number[]][] = [
		["export function f(a, a) {}", 21, [18, 21]],
		['export function f(a, a) { "use strict"; return a; }', 21, [18, 21]],
		["function f(a, b, a, b) {}", 17, [11, 17, 14, 20]],
		["const f = (a, a) => a;", 14, [11, 14]],
		["export function App(a, a) @{\n\t<div />\n}", 23, [20, 23]],
	];
	for (const [source, strict, recorded] of cases) {
		expect(thrown(source)?.message.startsWith(`Argument name clash (${strict}:`), source).toBe(
			true,
		);
		for (const mode of ["collect", "loose"] as const) {
			const errors = collected(source, mode);
			expect(new Set(errors.map(({ message }) => message)), source).toEqual(
				new Set(["Argument name clash"]),
			);
			expect(
				errors.map(({ start }) => start),
				`${mode}: ${source}`,
			).toEqual(recorded);
		}
	}
});

test("#113: merging, shadowing, overloads, and template scopes core accepts stay valid", () => {
	for (const source of [
		"function f() { var a; var a; }",
		"let a; { let a; }",
		"try {} catch (e) { var e = 1; }",
		"function f(a) { var a; }",
		"export { a };\nconst a = 1;",
		"import { a } from 'x';\nexport { a };",
		"function f(a: string): void;\nfunction f(a: number): void;\nfunction f(a: any) {}",
		"interface A {}\ninterface A {}",
		"type A = 1;\ninterface A {}",
		"import type { A } from 'x';\ninterface A {}",
		"declare function f(a, a): void;",
		"function f(a, a): void;\nfunction f() {}",
		"abstract class C { abstract m(a, a): void; }",
		"export function App({ a }) @{\n\tconst a = 1;\n\t<div>{a}</div>\n}",
		"export function App({ a }) @{\n\t<div>@if (a) { const x = 1; <b>{x}</b> } @else { const x = 2; <i>{x}</i> }</div>\n}",
		"export function App({ items }) @{\n\tconst x = 0;\n\t<ul>@for (const x of items) { <li>{x}</li> }</ul>\n}",
		"export function App({ k }) @{\n\t<div>@switch (k) { @case 1: { const x = 1; <b>{x}</b> } @case 2: { const x = 2; <i>{x}</i> } }</div>\n}",
		"export function App() @{\n\t<div>@{ const x = 1; <b>{x}</b> }<span>@{ const x = 2; <i>{x}</i> }</span></div>\n}",
		"export function App() @{\n\tconst x = 1;\n\t<button onClick={() => { var x = 2; }} />\n}",
		"function f() { function g() {} function g() {} var g; }",
		"export function f(a: string): void;\nexport function f(a: any) {}",
		"declare function f(): void;\nexport { f };",
		"declare var a: number;\ndeclare var a: number;",
		"class C {}\nnamespace C {}",
	]) {
		expect(thrown(source), source).toBeNull();
		expect(collected(source), source).toEqual([]);
		expect(collected(source, "loose"), source).toEqual([]);
	}
});
