import { expect, test } from "vitest";
import { analyze, parseModule } from "@tsrx/yuku";

// Regression tests for tsrx-org/oxc#140 (template text spans), #139 (lone
// surrogates) and #142 (the thrown error's shape and code), as they apply to
// yuku, and for a `@{ }` body with more than one render node. Every expected
// value below is what @tsrx/core 0.5.2's parseModule returns for the same
// source.

type Node = { type?: string; [key: string]: unknown };
type CoreError = Error & {
	code?: string;
	pos?: number;
	raisedAt?: number;
	end?: number;
	loc?: unknown;
	fileName?: string;
	type?: string;
};

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

// `[start, end, raw, cooked]` of each TemplateElement, in source order.
function quasis(source: string, filename: string) {
	return findAll(parseModule(source, filename), (node) => node.type === "TemplateElement")
		.map((node) => {
			const value = node.value as { raw: string; cooked: string | null };
			return [node.start, node.end, value.raw, value.cooked];
		})
		.sort((a, b) => (a[0] as number) - (b[0] as number));
}

function thrown(source: string, options?: object): CoreError | null {
	try {
		parseModule(source, "App.tsrx", options);
	} catch (error) {
		return error as CoreError;
	}
	return null;
}

const DIALECTS = ["App.js", "App.jsx", "App.ts", "App.tsx", "App.tsrx"];

test("#140: a TemplateElement spans its text alone, in every dialect", () => {
	for (const filename of DIALECTS) {
		expect(quasis("const t = `a${x}b`;", filename), filename).toEqual([
			[11, 12, "a", "a"],
			[16, 17, "b", "b"],
		]);
	}
	// a tagged template's invalid escape has no cooked value
	expect(quasis("const t = tag`\\u{${x}\\n`;", "App.tsx")).toEqual([
		[14, 17, "\\u{", null],
		[21, 23, "\\n", "\n"],
	]);
	// nested and empty text, a template in an attribute, and a CRLF read as LF
	expect(
		quasis(
			"export function App({ x }) @{\n\tconst s = `a${`b${x}`}`;\n\t<p title={`c${x}\r\nd`}>{s}</p>\n}",
			"App.tsrx",
		),
	).toEqual([
		[42, 43, "a", "a"],
		[46, 47, "b", "b"],
		[51, 51, "", ""],
		[53, 53, "", ""],
		[68, 69, "c", "c"],
		[73, 76, "\nd", "\nd"],
	]);
});

test("#140: a lone surrogate keeps the delimiters out of the text and its span", () => {
	for (const filename of DIALECTS) {
		expect(quasis("const t = `a\ud800${x}b`;", filename), filename).toEqual([
			[11, 13, "a\ud800", "a\ud800"],
			[17, 18, "b", "b"],
		]);
	}
	// a lone low surrogate after a pair
	expect(quasis("const t = `😀${x}\udc00`;", "App.js")).toEqual([
		[11, 13, "😀", "😀"],
		[17, 18, "\udc00", "\udc00"],
	]);
});

test("#139: a lone surrogate stays as written in every value and raw", () => {
	const source =
		"const s = 'a\ud800b';\nconst x = <p title=\"a\ud800b\">a\ud800b</p>;\nconst r = /a\ud800/;";
	for (const filename of ["App.tsx", "App.tsrx", "App.jsx"]) {
		const program = parseModule(source, filename);
		const values = findAll(program, (node) => node.type === "Literal" || node.type === "JSXText")
			.map(({ type, start, end, raw }) => [type, start, end, raw])
			.sort((a, b) => (a[1] as number) - (b[1] as number));
		expect(values, filename).toEqual([
			["Literal", 10, 15, "'a\ud800b'"],
			["Literal", 36, 41, '"a\ud800b"'],
			["JSXText", 42, 45, "a\ud800b"],
			["Literal", 61, 65, "/a\ud800/"],
		]);
		const [regex] = findAll(program, (node) => node.type === "Literal" && "regex" in node);
		expect((regex.regex as { pattern: string }).pattern, filename).toBe("a\ud800");
	}
});

test("#142: a thrown SyntaxError has acorn's shape: (line:column), loc, pos, raisedAt", () => {
	const cases: [string, object][] = [
		[
			"export function App() @{\n\t<p />\n\t@if\n}",
			{ code: "TS1359", pos: 34, raisedAt: 38, loc: { line: 3, column: 2 }, suffix: "(3:2)" },
		],
		[
			"export function App({ value }) @{\n\t@switch (value) { @case 'x': { <span>x</span> } @ }\n}",
			{ code: "TS1012", pos: 83, raisedAt: 84, loc: { line: 2, column: 49 }, suffix: "(2:49)" },
		],
		[
			"const = 1;",
			{ code: "TS1012", pos: 6, raisedAt: 7, loc: { line: 1, column: 6 }, suffix: "(1:6)" },
		],
		// acorn's line breaks: a CRLF is one
		[
			"const a = 1;\r\nconst = 2;",
			{ code: "TS1012", pos: 20, raisedAt: 21, loc: { line: 2, column: 6 }, suffix: "(2:6)" },
		],
	];
	for (const [source, expected] of cases) {
		const error = thrown(source);
		expect(error, source).toBeInstanceOf(SyntaxError);
		const { code, pos, raisedAt, loc } = error!;
		const suffix = /\(\d+:\d+\)$/.exec(error!.message)?.[0];
		expect({ code, pos, raisedAt, loc, suffix }, source).toEqual(expected);
		expect(error, source).not.toHaveProperty("end");
	}

	// an element a template ends is reported unclosed where the template ends
	const unclosed = thrown("export function App() @{\n\t<div>\n}");
	expect(unclosed).toBeInstanceOf(SyntaxError);
	expect(unclosed?.message).toBe(
		"Unclosed tag '<div>'. Expected '</div>' before end of template. (3:0)",
	);
	expect([unclosed?.code, unclosed?.pos, unclosed?.raisedAt]).toEqual(["TSRX1001", 32, 33]);
	expect(unclosed?.loc).toEqual({ line: 3, column: 0 });
});

test("#142: every malformed directive throws core's code at core's position", () => {
	// [body, code, pos, the message's (line:column)]
	const cases: [string, string, number, string][] = [
		["@if", "TS1359", 42, "(2:2)"],
		["@if x {}", "TS1359", 42, "(2:2)"],
		["@if () {}", "TS1012", 46, "(2:6)"],
		["@if (a {}", "TS1012", 48, "(2:8)"],
		["@if (a) {} @else", "TSRX1008", 58, "(3:0)"],
		["@if (a) {} @elsx {}", "TS1206", 58, "(2:18)"],
		["@x", "TS1206", 44, "(3:0)"],
		["@for", "TS1359", 42, "(2:2)"],
		["@for x {}", "TS1359", 42, "(2:2)"],
		["@switch", "TS1359", 42, "(2:2)"],
		["@switch x {}", "TS1359", 42, "(2:2)"],
		["@switch () {}", "TS1012", 50, "(2:10)"],
		["@switch (v) { @ }", "TS1012", 55, "(2:15)"],
		["@switch (v) { x }", "TS1012", 55, "(2:15)"],
		["@switch (v) { @case }", "TS1012", 61, "(2:21)"],
		["@switch (v) { @case 1 }", "TS1012", 63, "(2:23)"],
		["@try", "TS1359", 42, "(2:2)"],
		["@try x", "TS1359", 42, "(2:2)"],
		["@try {} @x {}", "TSRX1010", 42, "(2:2)"],
		["@try {} @catch", "TS1012", 56, "(3:0)"],
		["@try {} @catch (e)", "TS1012", 60, "(3:0)"],
		["@try {} @pending", "TS1012", 58, "(3:0)"],
		["@for (const i of items) {} @empty", "TSRX1008", 75, "(3:0)"],
		["@while (a) {}", "TS1359", 42, "(2:2)"],
	];
	for (const [body, code, pos, suffix] of cases) {
		const error = thrown(`export function App({ v, a, items }) @{\n\t${body}\n}`);
		expect(error, body).toBeInstanceOf(SyntaxError);
		expect([error?.code, error?.pos, /\(\d+:\d+\)$/.exec(error!.message)?.[0]], body).toEqual([
			code,
			pos,
			suffix,
		]);
	}
});

const SINGLE_OUTPUT =
	"A code block renders a single node; wrap multiple nodes or text in a fragment '<>…</>'.";
const STATEMENT_AFTER_OUTPUT =
	"Code must be at the top of '@{ }'; statements cannot follow the rendered output.";

test("a second render node in a template body is TSRX2011, core's own Error", () => {
	const source = "export function App() @{ <div/> <img/> <button/> }";
	const error = thrown(source);
	expect(error?.constructor).toBe(Error);
	expect({ ...error, message: error?.message }).toEqual({
		message: SINGLE_OUTPUT,
		pos: 32,
		raisedAt: 38,
		fileName: "App.tsrx",
		code: "TSRX2011",
		end: 38,
		loc: { start: { line: 1, column: 32 }, end: { line: 1, column: 38 } },
		type: "fatal",
	});

	const recorded = [
		{
			code: "TSRX2011",
			pos: 32,
			raisedAt: 38,
			end: 38,
			loc: { start: { line: 1, column: 32 }, end: { line: 1, column: 38 } },
		},
		{
			code: "TSRX2011",
			pos: 39,
			raisedAt: 48,
			end: 48,
			loc: { start: { line: 1, column: 39 }, end: { line: 1, column: 48 } },
		},
	];
	for (const mode of ["collect", "loose"] as const) {
		const errors: CoreError[] = [];
		const program = parseModule(source, "App.tsrx", { [mode]: true, errors });
		expect(
			errors.map(({ code, pos, raisedAt, end, loc, message }) => ({
				code,
				pos,
				raisedAt,
				end,
				loc,
				message,
			})),
			mode,
		).toEqual(recorded.map((error) => ({ ...error, message: SINGLE_OUTPUT })));
		// the body is recovered: the earlier render nodes, bare, then the last
		const [block] = findAll(program, (node) => node.type === "JSXCodeBlock");
		expect(
			(block.body as Node[]).map(({ type, start, end }) => [type, start, end]),
			mode,
		).toEqual([
			["JSXElement", 25, 31],
			["JSXElement", 32, 38],
		]);
		const render = block.render as Node;
		expect([render.type, render.start, render.end], mode).toEqual(["JSXElement", 39, 48]);
	}
});

test("render nodes and statements after one, on one line or many, as core reports them", () => {
	// [source, [code, pos, end] of each error core records]
	const cases: [string, [string, number, number][]][] = [
		["export function App() @{\n\t<div/>\n\t<img/>\n}", [["TSRX2011", 34, 40]]],
		["export function App() @{ <div/>; <img/>; }", [["TSRX2011", 33, 39]]],
		["export function App() @{ <><div/></> <img/> }", [["TSRX2011", 37, 43]]],
		["export function App() @{ const a = 1; <div/> <p>{a}</p> }", [["TSRX2011", 45, 55]]],
		["export function App() @{ @if (a) { <a/> } <b/> }", [["TSRX2011", 42, 46]]],
		["export function App() @{ <b/> @if (a) { <a/> } }", [["TSRX2011", 30, 46]]],
		["export function App() @{ @if (a) { <a/> <b/> } }", [["TSRX2011", 40, 44]]],
		["export function App() @{ @{ <a/> } <b/> }", [["TSRX2011", 35, 39]]],
		["export function App() @{ <div/> text }", [["TSRX2012", 32, 36]]],
		["export function App() @{ <div/> {x} }", [["TSRX2012", 32, 35]]],
		["export function App() @{ <a/> + 1 }", [["TSRX2012", 30, 33]]],
		["export function App() @{ @if (a) { <a/> x; } }", [["TSRX2012", 40, 42]]],
	];
	for (const [source, expected] of cases) {
		const errors: CoreError[] = [];
		parseModule(source, "App.tsrx", { collect: true, errors });
		expect(
			errors.map(({ code, pos, end }) => [code, pos, end]),
			source,
		).toEqual(expected);
		const [code] = expected[0];
		const error = thrown(source);
		expect(error?.constructor, source).toBe(Error);
		expect(error?.message, source).toBe(
			code === "TSRX2011" ? SINGLE_OUTPUT : STATEMENT_AFTER_OUTPUT,
		);
	}

	// one render node, however it is written, is fine
	for (const source of [
		"export function App() @{ <div/>; }",
		"export function App() @{ const a = 1; <div>{a}</div> }",
		"export function App() @{ <div><p/> <b/></div> }",
		"class View {\n\trender() @{\n\t\tconst a = 1;\n\t\t<a>{a}</a>\n\t}\n}",
	]) {
		expect(thrown(source), source).toBeNull();
	}
	// analyze reports it too
	expect(
		analyze("export function App() @{ <a/> <b/> }", "App.tsrx").diagnostics.map(
			({ code, start, end }) => [code, start, end],
		),
	).toEqual([["TSRX2011", 30, 34]]);
});

test("a class method's template body reports as a function's does", () => {
	const adjacent = thrown("class View {\n\trender() @{\n\t\t<a /> <b />\n\t}\n}");
	expect([adjacent?.code, adjacent?.pos, adjacent?.end]).toEqual(["TSRX2011", 34, 39]);
	const unclosed = thrown("class View {\n\trender() @{\n\t\t<div />\n\t}");
	expect(unclosed).toBeInstanceOf(SyntaxError);
	expect([unclosed?.code, unclosed?.pos, unclosed?.raisedAt]).toEqual(["TS1005", 38, 38]);
	expect(unclosed?.message).toMatch(/ \(4:2\)$/);
});

test("a loose parse records no unclosed element, as core's doesn't", () => {
	const errors: CoreError[] = [];
	const program = parseModule("export function App() @{\n\t<div>\n}", "App.tsrx", {
		loose: true,
		errors,
	});
	expect(errors).toEqual([]);
	const [block] = findAll(program, (node) => node.type === "JSXCodeBlock");
	expect((block.render as Node).type).toBe("JSXElement");
	// collect records it, as core does
	const collected: CoreError[] = [];
	parseModule("export function App() @{\n\t<div>\n}", "App.tsrx", {
		collect: true,
		errors: collected,
	});
	expect(collected.map(({ code, pos, raisedAt, end }) => [code, pos, raisedAt, end])).toEqual([
		["TSRX1001", 32, 33, 33],
	]);
});

test("a JSX element that opens an expression in a template stays one expression", () => {
	// only a statement of the body is a render node; `<b/> || x` in a header,
	// a child container or an attribute is one expression, as in core
	for (const source of [
		"export function App({ x }) @{\n\t@if (<b/> || x) { <p/> }\n}",
		"export function App({ x }) @{\n\t@for (const i of <b/> || x) { <p/> }\n}",
		"export function App({ x }) @{\n\t<div>{<b/> && x}</div>\n}",
		"export function App({ x }) @{\n\t<div>{<b/> || <i/>}</div>\n}",
		"export function App({ x }) @{\n\t<div title={<b/> && x} />\n}",
	]) {
		expect(thrown(source), source).toBeNull();
	}
	const [test] = findAll(
		parseModule("export function App({ x }) @{\n\t@if (<b/> || x) { <p/> }\n}", "App.tsrx"),
		(node) => node.type === "JSXIfExpression",
	);
	const condition = test.test as Node;
	expect([condition.type, condition.start, condition.end]).toEqual(["LogicalExpression", 36, 45]);
});

test("a fragment a template ends is unclosed where the template ends, as an element is", () => {
	// [source, core's pos]
	for (const [source, pos] of [
		["export function App({ x }) @{\n\t<>\n}", 34],
		["export function App({ x }) @{\n\t<><p/>\n}", 38],
	] as const) {
		const error = thrown(source);
		expect(error, source).toBeInstanceOf(SyntaxError);
		expect(error?.message, source).toBe(
			"Unclosed tag '<>'. Expected '</>' before end of template. (3:0)",
		);
		expect([error?.code, error?.pos], source).toEqual(["TSRX1001", pos]);
		const errors: CoreError[] = [];
		parseModule(source, "App.tsrx", { collect: true, errors });
		expect(
			errors.map(({ code, pos }) => [code, pos]),
			source,
		).toEqual([["TSRX1001", pos]]);
		const loose: CoreError[] = [];
		parseModule(source, "App.tsrx", { loose: true, errors: loose });
		expect(loose, source).toEqual([]);
	}
});
