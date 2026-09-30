import { expect, test } from "vitest";
import { analyze, parseModule } from "@tsrx/yuku";

// Where @tsrx/core 0.5.2 allows a `return` in a template, where it rejects
// one, and with which code. Every expected value below is what core's
// parseModule gives for the same source.
//
// - A function's `@{ }` body (a component, a method, an arrow) may return, and
//   so may an `@if`, `@else`, `@for` or `@empty` body.
// - A `return` under a `@{ }` block that is no function's body, or under a
//   `@try`, `@pending` or `@catch` body, is TSRX2001, core's own Error: in
//   nested statements, directives and JSX, but not in a function or a loop.
// - One of an `@case` body's own statements is TSRX2009; a deeper one is
//   allowed. A `{ }` among them is an expression container, so a `return` or
//   any other statement in it is TS1012, and a second one TS1005.

type CoreError = Error & { code?: string; pos?: number; raisedAt?: number; end?: number };

test("a return in a template is allowed, TSRX2001, TSRX2009 or TS1012, as core has it", () => {
	// [source, core's thrown [constructor, code, pos, raisedAt] or null, core's
	// collected [code, pos, end] or null when core throws while collecting]
	const cases: [
		string,
		[string, string, number, number] | null,
		[string, number, number][] | null,
	][] = [
		["export function App({ x }) @{\n\treturn;\n\t<p />\n}", null, []],
		["const App = (x) => @{\n\tif (x) return null;\n\t<p />\n};", null, []],
		["class V {\n\trender() @{\n\t\tif (this.x) return;\n\t\t<p />\n\t}\n}", null, []],
		[
			"export function App({ x }) @{\n\t@if (x) {\n\t\treturn;\n\t\t<p />\n\t} @else {\n\t\treturn <b />;\n\t}\n}",
			null,
			[],
		],
		[
			"export function App({ items }) @{\n\t@for (const i of items) {\n\t\tif (!i) return;\n\t\t<p />\n\t} @empty {\n\t\treturn;\n\t}\n}",
			null,
			[],
		],
		["export function f(x) {\n\treturn <div>@if (x) { return; <p /> }</div>;\n}", null, []],
		[
			"export const v = @{\n\tif (x) return;\n\t<p />\n};",
			["Error", "TSRX2001", 28, 35],
			[["TSRX2001", 28, 35]],
		],
		[
			"export const v = @{\n\tswitch (x) { case 1: return; }\n\t<p />\n};",
			["Error", "TSRX2001", 42, 49],
			[["TSRX2001", 42, 49]],
		],
		[
			"export const v = @{\n\tfor (;;) { return; }\n\tconst f = () => { return 1; };\n\t<p />\n};",
			null,
			[],
		],
		[
			"export const v = @{\n\tconst a = <div>@if (x) { return; <b/> }</div>;\n\t<p />\n};",
			["Error", "TSRX2001", 46, 53],
			[["TSRX2001", 46, 53]],
		],
		[
			"export function f(x) {\n\treturn <div>@{ return; <p /> }</div>;\n}",
			["Error", "TSRX2001", 39, 46],
			[["TSRX2001", 39, 46]],
		],
		[
			"export function App({ x }) @{\n\t@try {\n\t\tif (x) { return; }\n\t\t<p />\n\t} @pending {\n\t\treturn;\n\t} @catch (e) {\n\t\treturn;\n\t}\n}",
			["Error", "TSRX2001", 49, 56],
			[
				["TSRX2001", 49, 56],
				["TSRX2001", 83, 90],
				["TSRX2001", 109, 116],
			],
		],
		[
			"export function App({ x, items }) @{\n\t@try {\n\t\t@for (const i of items) { return; <b/> }\n\t} @catch (e) { <b /> }\n}",
			["Error", "TSRX2001", 73, 80],
			[["TSRX2001", 73, 80]],
		],
		[
			"export function App({ x }) @{\n\t@try {\n\t\tfor (;;) { return; }\n\t\t<p />\n\t} @catch (e) { <b /> }\n}",
			null,
			[],
		],
		[
			"export function App({ x }) @{\n\t@switch (x) {\n\t\t@case 1: {\n\t\t\treturn;\n\t\t}\n\t}\n}",
			["SyntaxError", "TSRX2009", 61, 67],
			null,
		],
		[
			"export function App({ x }) @{\n\t@switch (x) {\n\t\t@case 1: {\n\t\t\tif (x) { return; }\n\t\t\t<p />\n\t\t}\n\t}\n}",
			null,
			[],
		],
		[
			"export function App({ x }) @{\n\t@switch (x) {\n\t\t@case 1: {\n\t\t\t{ return; }\n\t\t\t<p />\n\t\t}\n\t}\n}",
			["SyntaxError", "TS1012", 63, 69],
			null,
		],
		[
			"export function App({ x }) @{\n\t@switch (x) {\n\t\t@case 1: {\n\t\t\t{ x; y; }\n\t\t\t<p />\n\t\t}\n\t}\n}",
			["SyntaxError", "TS1005", 66, 67],
			null,
		],
	];
	for (const [source, strict, collected] of cases) {
		let error: CoreError | undefined;
		try {
			parseModule(source, "App.tsrx");
		} catch (thrown) {
			error = thrown as CoreError;
		}
		expect(
			error === undefined ? null : [error.constructor.name, error.code, error.pos, error.raisedAt],
			source,
		).toEqual(strict);
		const errors: CoreError[] = [];
		parseModule(source, "App.tsrx", { collect: true, errors });
		// where core throws while collecting, yuku records the same error
		expect(
			errors.map(({ code, pos, end }) => [code, pos, end]),
			source,
		).toEqual(collected ?? (strict === null ? [] : [[strict[1], strict[2], strict[3]]]));
	}
});

test("analyze gives a template-block return core's code", () => {
	expect(
		analyze("export const v = @{\n\tif (x) return;\n\t<p />\n};", "App.tsrx").diagnostics.map(
			({ code, start, end }) => [code, start, end],
		),
	).toEqual([["TSRX2001", 28, 35]]);
	expect(
		analyze("export function App() @{\n\treturn;\n\t<p />\n}", "App.tsrx").diagnostics,
	).toEqual([]);
});

test("core searches no expression block's rendered node, and a nested one twice, as core does", () => {
	// [source, core 0.5.2's collected [code, pos, end]]
	const cases: [string, [string, number, number][]][] = [
		// the rendered node is not searched: an `@if` or `@for` there may return
		["export const v = @{\n\t@if (x) { return; <p /> }\n};", []],
		["export const v = @{\n\t<div>@if (x) { return; <p /> }</div>\n};", []],
		["export const v = @{\n\t@for (const i of items) { return; <p /> }\n};", []],
		// under a `@try` everything is, a nested code block's rendered node too
		[
			"export function App({ x }) @{\n\t@try {\n\t\t@{ <div>@if (x) { return; <b/> }</div> }\n\t} @catch (e) { <b /> }\n}",
			[["TSRX2001", 58, 65]],
		],
		// a nested block reports its own, and the one around it again
		[
			"export function App({ x }) @{\n\t@try {\n\t\t@{ return; <b/> }\n\t} @catch (e) { <b /> }\n}",
			[
				["TSRX2001", 43, 50],
				["TSRX2001", 43, 50],
			],
		],
		[
			"export const v = @{\n\tconst a = <div>@{ return; <b/> }</div>;\n\t<p />\n};",
			[
				["TSRX2001", 39, 46],
				["TSRX2001", 39, 46],
			],
		],
		[
			"export function App({ x }) @{\n\t@try {\n\t\t@try { return; <b/> } @catch (e) { <b/> }\n\t} @catch (e) { <b /> }\n}",
			[
				["TSRX2001", 47, 54],
				["TSRX2001", 47, 54],
			],
		],
	];
	for (const [source, expected] of cases) {
		const errors: CoreError[] = [];
		parseModule(source, "App.tsrx", { collect: true, errors });
		expect(
			errors.map(({ code, pos, end }) => [code, pos, end]),
			source,
		).toEqual(expected);
	}
});
