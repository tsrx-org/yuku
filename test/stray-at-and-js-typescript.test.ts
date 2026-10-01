import { expect, test } from "vitest";
import { analyze, parse, parseModule } from "@tsrx/yuku";

// Every expected `code`, `pos`, `raisedAt` and `loc` below is what @tsrx/core
// 0.5.2's parseModule gives the same source. Messages keep yuku's wording, so
// only the `(line:column)` acorn puts after one is checked.

type Thrown = SyntaxError & { code?: string; pos?: number; raisedAt?: number; loc?: unknown };
type Expected = {
	code: string;
	pos: number;
	raisedAt: number;
	loc: { line: number; column: number };
};

function thrown(source: string, filename = "App.tsrx"): Thrown {
	try {
		parseModule(source, filename);
	} catch (error) {
		return error as Thrown;
	}
	throw new Error(`expected ${JSON.stringify(source)} to throw`);
}

function expectAcornError(source: string, expected: Expected) {
	const error = thrown(source);
	expect(error.constructor, source).toBe(SyntaxError);
	expect(
		{ code: error.code, pos: error.pos, raisedAt: error.raisedAt, loc: error.loc },
		source,
	).toEqual(expected);
	expect(error.message, source).toMatch(
		new RegExp(`\\(${expected.loc.line}:${expected.loc.column}\\)$`),
	);
}

// The spans of every TemplateElement under `root`, in source order.
function templateElements(root: unknown): [number, number][] {
	const spans: [number, number][] = [];
	const visit = (value: unknown) => {
		if (value === null || typeof value !== "object") return;
		const node = value as { type?: string; start?: number; end?: number };
		if (node.type === "TemplateElement") spans.push([node.start!, node.end!]);
		for (const [key, child] of Object.entries(value)) if (key !== "loc") visit(child);
	};
	visit(root);
	return spans.sort((a, b) => a[0] - b[0]);
}

const at = (code: string, pos: number, raisedAt: number, line: number, column: number) => ({
	code,
	pos,
	raisedAt,
	loc: { line, column },
});

test("a bare `@` fails at the token after it, before any later mistake (tsrx-org/oxc#175)", () => {
	const cases: [string, Expected][] = [
		// a later malformed `@switch` body doesn't hide the bare `@`
		[
			"export function App(v) @{\n\t@\n\t@switch (v) { @case 1: { <span/> } @ }\n}",
			at("TS1012", 30, 31, 3, 1),
		],
		// the `@` of `@if`, not the `}` after the `@if` the decorator swallowed
		["export function App() @{\n\t@\n\t@if (v) { <span/> }\n}", at("TS1012", 29, 30, 3, 1)],
		["export function App() @{\r\n\t@\r\n\t@if (v) { <span/> }\r\n}", at("TS1012", 31, 32, 3, 1)],
		["export function App() @{ @ @if (v) {} }", at("TS1012", 27, 28, 1, 27)],
		// the Markless drop-in source for tsrx-org/oxc#143
		[
			"export function App({ value, values }) @{\n\t@\n\t@if (value) { <span>{value}</span> } @\n\t@for (const item of values) { <span>{item}</span> } @\n\t@switch (value) { @case 'x': { <span>x</span> } @ }\n\t@try { <span>{value}</span> } @\n\tconst expression = value + @;\n}\n@",
			at("TS1012", 46, 47, 3, 1),
		],
		// comments between the `@` and the token are skipped
		["export function App() @{\n\t@ /* c */ @switch (v) { @ }\n}", at("TS1012", 36, 37, 2, 11)],
		["export function App() @{\n\t@ // c\n\t@if (a) {}\n}", at("TS1012", 34, 35, 3, 1)],
		// a block of a plain function, or of a directive
		["function f() {\n\t@\n\t@if (a) {}\n}", at("TS1012", 19, 20, 3, 1)],
		// the token acorn reads after the `@`, whole
		["export function App() @{\n\t@\n\t'x'\n}", at("TS1012", 29, 32, 3, 1)],
		["export function App() @{\n\t@\n\t123\n}", at("TS1012", 29, 32, 3, 1)],
		["export function App() @{\n\t@ #x\n}", at("TS1012", 28, 30, 2, 3)],
		["export function App() @{\n\t@ @\n}", at("TS1012", 28, 29, 2, 3)],
		["export function App() @{\n\t@ {}\n}", at("TS1012", 28, 29, 2, 3)],
		["export function App() @{\n\t@\n\t`t`\n}", at("TS1012", 29, 30, 3, 1)],
		// a keyword is read as the decorator's name, and acorn raises once it has read the next token
		["export function App() @{\n\t@\n\tconst x = 1; <p/>\n}", at("TS1359", 29, 36, 3, 1)],
		["export function App() @{\n\t@\n\tfunction f() {}\n}", at("TS1359", 29, 39, 3, 1)],
		["export function App() @{\n\t@ export\n}", at("TS1359", 28, 36, 2, 3)],
		["export function App() @{\n\t@\n\tlet y = 1;\n}", at("TS1212", 29, 34, 3, 1)],
		["export function App() @{\n\t@\n\tawait x\n}", at("TS1262", 29, 36, 3, 1)],
		["@\nconst x = 1;", at("TS1359", 2, 9, 2, 0)],
	];
	for (const [source, expected] of cases) expectAcornError(source, expected);
});

test("an `@` with a name or `(` after it stays a decorator, and an `@` in element text stays text", () => {
	expectAcornError("export function App() @{\n\t@ x\n}", at("TS1206", 30, 31, 3, 0));
	expectAcornError("export function App() @{\n\t@\n\t(a)\n}", at("TS1206", 33, 34, 4, 0));
	expectAcornError("export function App() @{\n\t@\n\tx\n}", at("TS1206", 31, 32, 4, 0));
	expect(() =>
		parseModule("export function App() @{\n\t<p>a @ b</p>\n}", "App.tsrx"),
	).not.toThrow();
	expect(() =>
		parseModule("export function App() @{\n\t<p>{a} @ </p>\n}", "App.tsrx"),
	).not.toThrow();
});

// Core throws here in every mode; a collecting parseModule records its errors
// instead, and records only the bare `@`, since core reads nothing after it.
test("a bare `@` is the one error a collecting parse records", () => {
	const errors: { code?: string; pos: number; raisedAt: number }[] = [];
	parseModule("export function App() @{\n\t@\n\t@if (v) { <span/> }\n}", "App.tsrx", {
		collect: true,
		errors,
	});
	expect(errors.map(({ code, pos, raisedAt }) => ({ code, pos, raisedAt }))).toEqual([
		{ code: "TS1012", pos: 29, raisedAt: 30 },
	]);
});

test("every malformed directive tsrx-org/oxc#176 checks throws core's code at core's position", () => {
	// [body, code, pos, raisedAt, line, column]
	const cases: [string, string, number, number, number, number][] = [
		["@if", "TS1359", 42, 46, 2, 2],
		["@if x {}", "TS1359", 42, 46, 2, 2],
		["@if () {}", "TS1012", 46, 47, 2, 6],
		["@if (a) x", "TSRX1008", 49, 50, 2, 9],
		["@if (a) {} @else", "TSRX1008", 58, 59, 3, 0],
		["@if (a) {} @else x", "TSRX1008", 58, 59, 2, 18],
		["@if (a) {} @else if x {}", "TS1012", 61, 62, 2, 21],
		["@if (a) {} else {}", "TSRX1009", 52, 56, 2, 12],
		["@if (a) {} @elsx {}", "TS1206", 58, 59, 2, 18],
		["@x", "TS1206", 44, 45, 3, 0],
		["@x()", "TS1206", 46, 47, 3, 0],
		["@x.y", "TS1206", 46, 47, 3, 0],
		["@x @y", "TS1206", 47, 48, 3, 0],
		["@for", "TS1359", 42, 47, 2, 2],
		["@for x {}", "TS1359", 42, 47, 2, 2],
		["@for (const i of items) {} @empty", "TSRX1008", 75, 76, 3, 0],
		["@for (const i of items) {} empty {}", "TSRX1009", 68, 73, 2, 28],
		["@for (const i of items; index) {}", "TS1012", 70, 71, 2, 30],
		["@switch", "TS1359", 42, 50, 2, 2],
		["@switch x {}", "TS1359", 42, 50, 2, 2],
		["@switch () {}", "TS1012", 50, 51, 2, 10],
		["@switch (v) { @ }", "TS1012", 55, 56, 2, 15],
		["@switch (v) { x }", "TS1012", 55, 56, 2, 15],
		["@switch (v) { @case }", "TS1012", 61, 62, 2, 21],
		["@switch (v) { @case 1 }", "TS1012", 63, 64, 2, 23],
		["@switch (v) { @case 1: {} @ }", "TS1012", 67, 68, 2, 27],
		["@try", "TS1359", 42, 47, 2, 2],
		["@try x", "TS1359", 42, 47, 2, 2],
		["@try {} @catch", "TS1012", 56, 57, 3, 0],
		["@try {} @catch (e)", "TS1012", 60, 61, 3, 0],
		["@try {} @catch (e) x", "TS1012", 60, 61, 2, 20],
		["@try {} @pending", "TS1012", 58, 59, 3, 0],
		["@try {} pending {}", "TSRX1009", 49, 56, 2, 9],
		["@try {} catch {}", "TSRX1009", 49, 54, 2, 9],
		["@try {} @x {}", "TSRX1010", 42, 50, 2, 2],
		["@while (a) {}", "TS1359", 42, 49, 2, 2],
		["@do {}", "TS1359", 42, 46, 2, 2],
		["@default", "TS1359", 42, 51, 2, 2],
		["@case 1:", "TS1359", 42, 48, 2, 2],
		["const if = 1; <p />", "TS1359", 47, 51, 2, 7],
		// a comment between the mistake and the token core stops at
		["@if /* c */", "TS1359", 42, 54, 2, 2],
		["@if // c", "TS1359", 42, 51, 2, 2],
		["@x /* c */", "TS1206", 52, 53, 3, 0],
		["@if (a) /* c */ x", "TSRX1008", 57, 58, 2, 17],
	];
	for (const [body, code, pos, raisedAt, line, column] of cases) {
		expectAcornError(
			`export function App({ v, a, items }) @{\n\t${body}\n}`,
			at(code, pos, raisedAt, line, column),
		);
	}
	// a missing `@catch` or `@pending` is at `try`, raised past the token after the block
	expectAcornError(
		"export function App(v) @{\n\t@try { <span/> } @\n}",
		at("TSRX1010", 28, 45, 2, 2),
	);
});

test("a shorthand attribute with no `}` is raised where core's tag tokenizer stops", () => {
	// [attribute, pos, raisedAt]
	const cases: [string, number, number][] = [
		["{a.b}", 7, 9],
		["{a-b}", 7, 9],
		["{a[b]}", 7, 10],
		["{a.b.c}", 7, 11],
		["{a, b}", 7, 10],
		["{a = b}", 8, 11],
		["{a => b}", 8, 12],
		["{a b}", 8, 9],
		["{a b", 8, 12],
	];
	for (const [attribute, pos, raisedAt] of cases) {
		expectAcornError(`<div ${attribute} />`, at("TS1005", pos, raisedAt, 1, pos));
	}
	expectAcornError("<a{b>x</a>", at("TS1005", 4, 5, 1, 4));
});

test("parseModule reads TypeScript in .js and .jsx files, as @tsrx/core 0.5.2 does", () => {
	for (const filename of ["App.js", "App.jsx", "App.JS", "src/app.js?raw"]) {
		const [declaration] = parseModule("const x: number = 1;", filename).body as any[];
		expect(declaration.declarations[0].id.typeAnnotation.typeAnnotation, filename).toMatchObject({
			type: "TSNumberKeyword",
			start: 9,
			end: 15,
		});
		expect(parseModule("type T = string;", filename).body[0], filename).toMatchObject({
			type: "TSTypeAliasDeclaration",
			start: 0,
			end: 16,
			id: { type: "Identifier", name: "T", start: 5, end: 6 },
		});
		expect(templateElements(parseModule("type T = `a${string}b`;", filename)), filename).toEqual([
			[10, 11],
			[20, 21],
		]);
		// JSX too
		expect(
			(parseModule("const v = <p>{x}</p>;", filename).body[0] as any).declarations[0].init.type,
			filename,
		).toBe("JSXElement");
		// a call with type arguments
		const [call] = parseModule("f<T>(x);", filename).body as any[];
		expect(call.expression, filename).toMatchObject({
			type: "CallExpression",
			typeArguments: { type: "TSTypeParameterInstantiation", start: 1, end: 4 },
			arguments: [{ type: "Identifier", name: "x" }],
		});
	}
});

test("plain JavaScript in a .js file keeps its tree", () => {
	const shapes: [string, object][] = [
		[
			"a < b > c;",
			{
				type: "BinaryExpression",
				operator: ">",
				left: { type: "BinaryExpression", operator: "<", start: 0, end: 5 },
				right: { type: "Identifier", name: "c" },
			},
		],
		[
			"x = (a) => a < b;",
			{
				type: "AssignmentExpression",
				right: {
					type: "ArrowFunctionExpression",
					params: [{ type: "Identifier", name: "a", start: 5, end: 6 }],
					body: { type: "BinaryExpression", operator: "<" },
				},
			},
		],
		["x = y / z / w;", { right: { type: "BinaryExpression", operator: "/" } }],
		["type = 1;", { type: "AssignmentExpression", left: { type: "Identifier", name: "type" } }],
		[
			"declare = 1;",
			{ type: "AssignmentExpression", left: { type: "Identifier", name: "declare" } },
		],
		["x = a ? (b) : c;", { right: { type: "ConditionalExpression", consequent: { name: "b" } } }],
		[
			"x = `a${b}c`;",
			{
				right: {
					type: "TemplateLiteral",
					quasis: [
						{ start: 5, end: 6 },
						{ start: 10, end: 11 },
					],
				},
			},
		],
	];
	for (const [source, expression] of shapes) {
		expect((parseModule(source, "App.js").body[0] as any).expression, source).toMatchObject(
			expression,
		);
	}
});

test("parse and analyze still read .js as plain JavaScript", () => {
	expect(parse("const x: number = 1;").diagnostics.length).toBeGreaterThan(0);
	expect(parse("const x: number = 1;", { lang: "js" }).diagnostics.length).toBeGreaterThan(0);
	expect(analyze("const x: number = 1;", "App.js").diagnostics.length).toBeGreaterThan(0);
	expect(analyze("const v = <p/>;", "App.js").diagnostics.length).toBeGreaterThan(0);
	expect(analyze("const v = <p/>;", "App.jsx").diagnostics).toEqual([]);
	// an explicit `lang` still wins in parseModule
	expect(() => parseModule("const x: number = 1;", "App.js", { lang: "js" })).toThrow();
});
