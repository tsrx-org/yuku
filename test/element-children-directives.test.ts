import { expect, test } from "vitest";
import { parseModule } from "@tsrx/yuku";

// Every expected `code` and `pos` below is what @tsrx/core 0.5.2's parseModule
// gives the same source. Messages keep yuku's wording.

type Thrown = SyntaxError & { code?: string; pos?: number };

const app = (body: string) => `export function App(v) @{\n\t${body}\n}`;

function thrown(source: string): Thrown {
	try {
		parseModule(source, "App.tsrx");
	} catch (error) {
		return error as Thrown;
	}
	throw new Error(`expected ${JSON.stringify(source)} to throw`);
}

function children(source: string): string[] {
	const program = parseModule(source, "App.tsrx") as unknown;
	const find = (value: unknown): { children: { type: string; value?: string }[] } | undefined => {
		if (value === null || typeof value !== "object") return undefined;
		if ((value as { type?: string }).type === "JSXElement") return value as never;
		for (const [key, child] of Object.entries(value)) {
			if (key === "loc") continue;
			const found = find(child);
			if (found) return found;
		}
		return undefined;
	};
	return find(program)!.children.map((child) =>
		child.type === "JSXText" ? `text ${JSON.stringify(child.value)}` : child.type,
	);
}

test("a malformed directive among an element's children reports its own error", () => {
	const cases: [string, string, number][] = [
		// the bare `@` in the switch body, not the `@switch` before it
		["<div>@switch (v) { @ }</div>", "TS1012", 46],
		["<div>@try { <p/> }</div>", "TSRX1010", 33],
		["<div>@if (</div>", "TS1012", 37],
		// in a fragment, and in an element nested in another's directive
		["<>@try { <p/> }</>", "TSRX1010", 30],
		["<div><span>@switch (v) { @ }</span></div>", "TS1012", 52],
		["<div>@if (a) { <b>@try { <p/> }</b> }</div>", "TSRX1010", 46],
		// in a child element after a directive, and in an expression container
		["<div>@if (a) {x}<span>@try { <p/> }</span></div>", "TSRX1010", 50],
		["<div>@if (a) {x}{<span>@try { <p/> }</span>}</div>", "TSRX1010", 51],
		["<div>@if (a) {<p>@if (b) {<i>@try {x}</i>}</p>}</div>", "TSRX1010", 57],
	];
	for (const [body, code, pos] of cases) {
		const error = thrown(app(body));
		expect({ code: error.code, pos: error.pos }, body).toEqual({ code, pos });
	}
});

test("a malformed directive's error comes first among an element's collected errors", () => {
	const errors: { code?: string; pos?: number }[] = [];
	parseModule(app("<div>@try { <p/> }</div>"), "App.tsrx", { collect: true, errors });
	expect({ code: errors[0]?.code, pos: errors[0]?.pos }).toEqual({ code: "TSRX1010", pos: 33 });
});

test("a control-flow keyword without its header is text among an element's children", () => {
	for (const word of [
		"@if",
		"@if x",
		"@for",
		"@for x",
		"@for await x",
		"@switch",
		"@switch x",
		"@try",
		"@try x",
		"@if\n",
	]) {
		expect(children(app(`<div>${word}</div>`)), word).toEqual([`text ${JSON.stringify(word)}`]);
	}
	// the `{}` after a keyword with no header is an expression container
	expect(children(app("<div>@if {}</div>"))).toEqual(['text "@if "', "JSXExpressionContainer"]);
	expect(children(app("<div>@for {}</div>"))).toEqual(['text "@for "', "JSXExpressionContainer"]);
});

test("a control-flow header may follow its keyword past whitespace and comments", () => {
	expect(children(app("<div>@if /* c */ (a) {x}</div>"))).toEqual(["JSXIfExpression"]);
	expect(children(app("<div>@if\n(a) {x}</div>"))).toEqual(["JSXIfExpression"]);
	expect(children(app("<div>@try /* c */ {x} @catch (e) {y}</div>"))).toEqual(["JSXTryExpression"]);
});
