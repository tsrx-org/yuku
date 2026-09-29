import { expect, test } from "vitest";
import { parse, parseModule } from "@tsrx/yuku";

// Regression tests for tsrx-org/oxc#111: character references in JSX text and
// string attributes. Every expected value below is what @tsrx/core 0.5.2's
// parseModule returns for the same source: `value` decoded by acorn-typescript's
// `jsx_readEntity`, `raw` as written. Offsets are yuku's `start`/`end`, which
// core calls `pos`/`end`.

type Node = { type?: string; [key: string]: unknown };
type Literal = { value: string; raw: string; start: number; end: number };

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

// `[value, raw]` of every text that isn't only ASCII whitespace.
const texts = (ast: unknown) =>
	findAll(ast, (node) => node.type === "JSXText")
		.filter(({ raw }) => String(raw).trim() !== "")
		.map(({ value, raw }) => [value, raw]);

// `[value, raw]` of every string attribute value.
const attributes = (ast: unknown) =>
	findAll(ast, (node) => node.type === "JSXAttribute")
		.map((node) => node.value as Literal | null)
		.filter((value) => value !== null && (value as unknown as Node).type === "Literal")
		.map((literal) => [literal!.value, literal!.raw]);

const template = (jsx: string) => `export function App() @{\n\t${jsx}\n}`;
const plain = (jsx: string) => `export function App() {\n\treturn ${jsx};\n}`;
const moduleLevel = (jsx: string) => `const el = ${jsx};\nexport default el;`;
const shapes = { template, plain, moduleLevel };

for (const [shape, wrap] of Object.entries(shapes)) {
	test(`attribute strings decode their references into value in ${shape} JSX`, () => {
		const ast = parseModule(
			wrap(`<div title="a &amp;lt;b&amp;gt; &quot;q&quot; &#x2713;" alt='&apos;' />`),
			"App.tsrx",
		);
		expect(attributes(ast)).toEqual([
			['a &lt;b&gt; "q" ✓', '"a &amp;lt;b&amp;gt; &quot;q&quot; &#x2713;"'],
			["'", "'&apos;'"],
		]);
	});

	test(`text decodes its references into value and keeps raw as written in ${shape} JSX`, () => {
		const ast = parseModule(
			wrap(`<p>a &quot;b&quot; &amp;lt; &nbsp;&#x1F600; &bogus;</p>`),
			"App.tsrx",
		);
		expect(texts(ast)).toEqual([
			['a "b" &lt;  😀 &bogus;', "a &quot;b&quot; &amp;lt; &nbsp;&#x1F600; &bogus;"],
		]);
	});
}

test("only acorn-jsx's references decode; anything else stays as written", () => {
	const ast = parseModule(
		template(
			`<p a="AT&T & &; &&amp; &check; &amp &#1114112; &#X41;">AT&T & &; &&amp; &check; &amp &#1114112; &#X41; &#x10FFFF; &hearts; &#; &#xG;</p>`,
		),
		"App.tsrx",
	);
	expect(attributes(ast)).toEqual([
		["AT&T & &; && &check; &amp &#1114112; A", '"AT&T & &; &&amp; &check; &amp &#1114112; &#X41;"'],
	]);
	expect(texts(ast)).toEqual([
		[
			"AT&T & &; && &check; &amp &#1114112; A \u{10ffff} ♥ &#; &#xG;",
			"AT&T & &; &&amp; &check; &amp &#1114112; &#X41; &#x10FFFF; &hearts; &#; &#xG;",
		],
	]);
});

test("a reference is read from at most 10 characters after the &, its ; included", () => {
	const ast = parseModule(
		plain(`<p a="&#00000065;&#000000065;">&#x0000041; &#x00000041; &thetasym; &abcdefghij;</p>`),
		"App.tsrx",
	);
	expect(attributes(ast)).toEqual([["A&#000000065;", '"&#00000065;&#000000065;"']]);
	expect(texts(ast)).toEqual([
		["A &#x00000041; ϑ &abcdefghij;", "&#x0000041; &#x00000041; &thetasym; &abcdefghij;"],
	]);
});

test("a table name that is also an Object.prototype key stays as written", () => {
	const ast = parseModule(plain(`<p a="&constructor;">&toString; &__proto__;</p>`), "App.tsrx");
	expect(attributes(ast)).toEqual([["&constructor;", '"&constructor;"']]);
	expect(texts(ast)).toEqual([["&toString; &__proto__;", "&toString; &__proto__;"]]);
});

test("a reference cut off by a comment or a child is text", () => {
	for (const wrap of [template, plain]) {
		const ast = parseModule(wrap(`<b>&amp/* c */;</b>`), "App.tsrx");
		expect(texts(ast)).toEqual([
			["&amp", "&amp"],
			[";", ";"],
		]);
		const [element] = findAll(ast, (node) => node.type === "JSXElement");
		expect((element.children as Node[]).map(({ type }) => type)).toEqual([
			"JSXText",
			"JSXExpressionContainer",
			"JSXText",
		]);
	}
	expect(texts(parseModule(plain(`<b>&amp<i />;</b>`), "App.tsrx"))).toEqual([
		["&amp", "&amp"],
		[";", ";"],
	]);
	expect(texts(parseModule(template(`<b>&amp{x};</b>`), "App.tsrx"))).toEqual([
		["&amp", "&amp"],
		[";", ";"],
	]);
});

test("text split by a comment decodes each piece on its own", () => {
	const ast = parseModule(template(`<b>&lt;x/* c */&gt;y // d\n&amp;</b>`), "App.tsrx");
	expect(texts(ast)).toEqual([
		["<x", "&lt;x"],
		[">y ", "&gt;y "],
		["\n&", "\n&amp;"],
	]);
});

test("text value reads CRLF as LF and raw keeps it; attribute strings keep CRLF", () => {
	const ast = parseModule(
		plain(`<p title="a\r\n&amp;b">\r\n  a &amp;\r\n  b\r c\r\n</p>`),
		"App.tsrx",
	);
	expect(attributes(ast)).toEqual([["a\r\n&b", '"a\r\n&amp;b"']]);
	expect(texts(ast)).toEqual([["\n  a &\n  b\r c\n", "\r\n  a &amp;\r\n  b\r c\r\n"]]);

	const file = "export function App() @{\r\n\t<p>\r\n\t\ta b\r\n\t</p>\r\n}\r\n";
	const [text] = findAll(parseModule(file, "App.tsrx"), (node) => node.type === "JSXText");
	expect([text.value, text.raw, text.start, text.end]).toEqual([
		"\n\t\ta b\n\t",
		"\r\n\t\ta b\r\n\t",
		30,
		40,
	]);
});

test("strings in expression containers are JavaScript strings and are not decoded", () => {
	const ast = parseModule(plain(`<p a={"&amp;"}>{"&lt;"}{\`&gt;\`}</p>`), "App.tsrx");
	const strings = findAll(
		ast,
		(node) => node.type === "Literal" || node.type === "TemplateElement",
	).map((node) =>
		node.type === "Literal" ? node.value : (node.value as { cooked: string }).cooked,
	);
	expect(strings.sort()).toEqual(["&amp;", "&gt;", "&lt;"]);
});

test("parse keeps its ESTree JSX strings; only parseModule takes core's decoding", () => {
	const ast = parse(`const a = <p t="&amp;&nbsp;">&nbsp;</p>;`, { lang: "tsx" });
	expect(attributes(ast.program)).toEqual([["&amp;&nbsp;", '"&amp;&nbsp;"']]);
	expect(texts(ast.program)).toEqual([["&nbsp;", "&nbsp;"]]);
});
