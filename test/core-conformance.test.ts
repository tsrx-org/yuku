import { expect, test } from "vitest";
import { analyze, encode, generate, parse, parseModule } from "@tsrx/yuku";

// Regression tests for the @tsrx/core 0.5.0 rules reported against tsrx-org/oxc
// (#110, #112, #113, #114, #115, #116, #118). Every expected value below is what
// @tsrx/core (tsrx main at f78fada) returns for the same source, so a difference
// here is a difference from the reference parser. Offsets are yuku's
// `start`/`end`, which core calls `pos`/`end`.

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

// The text that isn't only ASCII whitespace.
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

// The children of the first element or fragment: text by value, `{}` for a
// comment, `<tag>` for an element, and the type of anything else.
function children(source: string, filename = "App.tsrx", options?: object): string[] {
	const [first] = findAll(
		parseModule(source, filename, options),
		(node) => node.type === "JSXElement" || node.type === "JSXFragment",
	);
	return (first.children as Node[]).map((child) =>
		child.type === "JSXText"
			? String(child.value)
			: child.type === "JSXElement"
				? `<${(child.openingElement as { name: { name: string } }).name.name}>`
				: (child.expression as Node | undefined)?.type === "JSXEmptyExpression"
					? "{}"
					: String(child.type),
	);
}

test("#110, #118: every comment between children is a {} of its own, and all text is kept", () => {
	const cases: [string, string[]][] = [
		[
			"export function App({ x }) @{\n\t<div>\n\t\ta /* c */ b\n\t\t<b />\n\t\t// d\n\t\t@if (x) {\n\t\t\t<i />\n\t\t} // e\n\t</div>\n}",
			[
				"\n\t\ta ",
				"{}",
				" b\n\t\t",
				"<b>",
				"\n\t\t",
				"{}",
				"\n\t\t",
				"JSXIfExpression",
				" ",
				"{}",
				"\n\t",
			],
		],
		// a `//` touching text, or right after a comment, is text
		[
			"export function App() {\n\treturn <p>a//b https://x.dev /* */// c\n</p>;\n}",
			["a//b https://x.dev ", "{}", "// c\n"],
		],
		// a comment hides the markup in it
		[
			"export function App({ a }) {\n\treturn <div>/* <b>x</b> {a} } */<i>y</i></div>;\n}",
			["{}", "<i>"],
		],
		["export function App() @{\n\t<>\n\t\t// <b>x</b>\n\t</>\n}", ["\n\t\t", "{}", "\n\t"]],
	];
	for (const [source, expected] of cases) expect(children(source), source).toEqual(expected);

	// the container and its expression span the comment, which joins the comment list
	const comments: { value: string }[] = [];
	const source = "export function App() {\n\treturn <p>a /* c */ b</p>;\n}";
	const [comment] = findAll(
		parseModule(source, "App.tsrx", { comments }),
		(node) => node.type === "JSXExpressionContainer",
	);
	const expression = comment.expression as Node;
	expect([comment.start, comment.end, expression.start, expression.end]).toEqual([37, 44, 37, 44]);
	expect(comments.map(({ value }) => value)).toEqual([" c "]);
	// ... and is the empty expression's innerComments, as in core, with `{/* e */}`'s
	const inner = "export function App() {\n\treturn <p>a /* c */ b\n// d\n{/* e */}</p>;\n}";
	expect(
		findAll(parseModule(inner, "App.tsrx"), (node) => node.type === "JSXEmptyExpression").map(
			({ innerComments }) => innerComments,
		),
	).toEqual([
		[
			{
				type: "Block",
				value: " c ",
				start: 37,
				end: 44,
				loc: { start: { line: 2, column: 13 }, end: { line: 2, column: 20 } },
			},
		],
		[
			{
				type: "Line",
				value: " d",
				start: 47,
				end: 51,
				loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 4 } },
			},
		],
		[
			{
				type: "Block",
				value: " e ",
				start: 53,
				end: 60,
				loc: { start: { line: 4, column: 1 }, end: { line: 4, column: 8 } },
			},
		],
	]);

	// a line comment runs over the closing tag on its line
	const unclosed = "export function App() @{\n\t<p>// c</p>\n}";
	expect(thrown(unclosed)?.message).toBe(
		"Unclosed tag '<p>'. Expected '</p>' before end of template. (38:39)",
	);
	expect(collected(unclosed).map(({ code, pos }) => [code, pos])).toEqual([
		["tsrx-unclosed-tag", 38],
	]);
	// ... and the next closing tag is an ancestor's, so it is reported, not read as text
	for (const source of [
		"export function App() {\n\treturn <div><p>// c</p>\n</div>;\n}",
		"export function App() {\n\treturn <p><>// c</>\n</p>;\n}",
	]) {
		expect(thrown(source)?.message, source).toMatch(/^Expected closing tag for '<p?>' but found/);
	}
	// a `<` before whitespace is text, so `< /p>` closes nothing
	for (const source of [
		"export function App() {\n\treturn <p>/* c */< /p>;\n}",
		"export function App() @{\n\t<p>a< /p>\n}",
	]) {
		expect(thrown(source)?.message, source).toMatch(/^Unclosed tag '<p>'/);
	}
});

test("#118: a comment is a {} child whichever parser reads the element", () => {
	const cases: [string, string[]][] = [
		// shapes the dialect's own children scan declines, read by the host parser
		[
			"export const A = <div>\n\t// a\n\t<Slot content=<span>x</span> />\n</div>;",
			["\n\t", "{}", "\n\t", "<Slot>", "\n"],
		],
		[
			"export const A = <div>\n\t// a\n\t<Foo<string> x={1} />\n</div>;",
			["\n\t", "{}", "\n\t", "<Foo>", "\n"],
		],
		[
			"export const A = <div>\n\t// a\n\t{/}/.test(x) ? 1 : 2}\n</div>;",
			["\n\t", "{}", "\n\t", "JSXExpressionContainer", "\n"],
		],
		["export const A = <p>{...a}// c\n</p>;", ["JSXSpreadChild", "{}", "\n"]],
		// a `>` in text is text (tsrx-org/tsrx tests/shared/runtime/jsx-text-whitespace-components.tsrx)
		[
			"export const A = <div>\n\t// a\n\t<b>a > b</b>\n</div>;",
			["\n\t", "{}", "\n\t", "<b>", "\n"],
		],
		// after a block's `}` a line comment ends at U+2028, which its `{}` takes
		[
			"export function A({ x }) @{\n\t<p>\n\t\t@if (x) {\n\t\t\t<i />\n\t\t} // a\u2028<b />\n\t</p>\n}",
			["\n\t\t", "JSXIfExpression", " ", "{}", "<b>", "\n\t"],
		],
		// ... and core reads what follows the block as code only up to a tag
		[
			"export function A({ x }) @{\n\t<p>@if (x) { <i /> } \u2028// c\n\tz</p>\n}",
			["JSXIfExpression", " \u2028// c\n\tz"],
		],
		// ... which the scan of a parent's children reads the same way
		[
			"export function A({ x, y }) @{\n\t<div>\n\t\t@if (x) { <i /> }\n\t\t<p>@if (y) /* h */ { <b /> } // c\u2028</p>\n\t</div>\n}",
			["\n\t\t", "JSXIfExpression", "\n\t\t", "<p>", "\n\t"],
		],
	];
	for (const [source, expected] of cases) {
		expect(children(source), source).toEqual(expected);
		expect(collected(source), source).toEqual([]);
	}
	// `<@tag>` is one error, not a regular expression after it
	expect(collected("export function A() @{\n\t<div><@tag>// c\n</@tag></div>\n}").length).toBe(1);

	// every braced `{}` gets its comments, with core's lines (\r\n, \r, U+2028, U+2029)
	const inner = (source: string) =>
		findAll(parseModule(source, "App.tsrx"), (node) => node.type === "JSXEmptyExpression").map(
			({ innerComments }) =>
				(innerComments as { value: string; start: number; loc: { start: object } }[]).map(
					({ value, start, loc }) => [value, start, loc.start],
				),
		);
	expect(inner("export const A = <p>{ /* a */ }{/* b */ /* c */}{// d\n}</p>;")).toEqual([
		[[" a ", 22, { line: 1, column: 22 }]],
		[
			[" b ", 32, { line: 1, column: 32 }],
			[" c ", 40, { line: 1, column: 40 }],
		],
		[[" d", 49, { line: 1, column: 49 }]],
	]);
	expect(
		inner("export function A({ x }) @{\n\t<p>@if (x) { <i /> } // c\u2028/* d */<b /></p>\n}").map(
			(comments) => comments.map(([value]) => value),
		),
	).toEqual([[" c", " d "]]);
	expect(
		inner("export const A = <p>\r\n/* a */\u2028/* b */\r/* c */\u2029/* d */</p>;").map(
			([[, , start]]) => start,
		),
	).toEqual([2, 3, 4, 5].map((line) => ({ line, column: 0 })));
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

test("#114: a self-closing <script /> without content prints from a cloned or hand-built tree", () => {
	const source = 'export function App() @{\n\t<script src="x" />\n}';
	const expected = generate(parseModule(source, "App.tsrx")).code;
	const cloned = structuredClone(parseModule(source, "App.tsrx"));
	expect(generate(cloned).code).toBe(expected);
	expect("content" in findAll(cloned, (node) => node.type === "JSXScriptElement")[0]).toBe(false);

	// A tree rebuilt from plain objects, as a transform might, with no content.
	const rebuilt = JSON.parse(JSON.stringify(parseModule(source, "App.tsrx")));
	const [script] = findAll(rebuilt, (node) => node.type === "JSXScriptElement");
	expect("content" in script).toBe(false);
	expect(encode(rebuilt)).toBeInstanceOf(ArrayBuffer);
	expect(generate(rebuilt).code).toBe(expected);
	expect("content" in script).toBe(false);

	// An explicit empty string is still accepted and left in place.
	script.content = "";
	expect(generate(rebuilt).code).toBe(expected);
	expect(script.content).toBe("");
});

test("#114: a tree with parent back-edges still encodes a self-closing <script />", () => {
	const source = 'export function App() @{\n\t<script src="x" />\n}';
	const expected = generate(parseModule(source, "App.tsrx")).code;
	const program = structuredClone(parseModule(source, "App.tsrx"));
	const [script] = findAll(program, (node) => node.type === "JSXScriptElement");
	// Give every node a `parent`, as a transform that walks upward might.
	const link = (value: unknown, parent: unknown) => {
		if (value === null || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const item of value) link(item, parent);
			return;
		}
		for (const child of Object.values(value)) link(child, value);
		Object.assign(value, { parent });
	};
	link(program, null);
	expect(script.parent).toBeTypeOf("object");
	expect(generate(program).code).toBe(expected);
	expect("content" in script).toBe(false);
});

test("#114: parse and analyze programs encode directly with no content on <script />", () => {
	const source = 'export function App() @{\n\t<script src="x" />\n}';
	for (const result of [parse(source, { lang: "tsx", tsrx: true }), analyze(source, "App.tsrx")]) {
		expect(
			"content" in findAll(result.program, (node) => node.type === "JSXScriptElement")[0],
		).toBe(false);
		expect(() => encode(result.program)).not.toThrow();
		expect(() => encode(structuredClone(result.program))).not.toThrow();
	}
});

test("#110: parseModule reads comments in JSX text for every filename; parse and analyze only for .tsrx", () => {
	const source =
		"export function App() {\n\treturn <div>\n\t\t// x <b>y</b>\n\t\ta /* c */ b\n\t</div>;\n}";
	const values = (filename: string) =>
		findAll(parseModule(source, filename), (node) => node.type === "JSXText")
			.map(({ value }) => String(value).trim())
			.filter(Boolean);
	// @tsrx/core's parseModule applies the comment rule whatever the extension
	for (const filename of ["App.tsrx", "App.tsx", "App.jsx"]) {
		expect(values(filename), filename).toEqual(["a", "b"]);
	}
	// `tsrx: false` reads standard JSX
	const standard = findAll(
		parseModule(source, "App.tsx", { tsrx: false }),
		(node) => node.type === "JSXText",
	);
	expect(standard.map(({ value }) => String(value).trim()).filter(Boolean)).toEqual([
		"// x",
		"y",
		"a /* c */ b",
	]);
	// `analyze` gates on the filename
	const analyzed = (filename: string) =>
		findAll(analyze(source, filename).program, (node) => node.type === "JSXText")
			.map(({ value }) => String(value).trim())
			.filter(Boolean);
	expect(analyzed("App.tsrx")).toEqual(["a", "b"]);
	expect(analyzed("App.tsx")).toEqual(["// x", "y", "a /* c */ b"]);
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

	// An unclosed body still reports the `</script` in it.
	expect(collected("export function App() @{\n\t<div><script>a</SCRIPT>b\n}")[0]?.code).toBe(
		"tsrx-script-end-tag-in-body",
	);

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

test("a thrown argument name clash spans one character, a recorded one the whole name, as in core", () => {
	// [source, core's thrown [pos, end], core's recorded [pos, end] in order]
	const cases: [string, [number, number], [number, number][]][] = [
		[
			"function f(abc, abc) {}",
			[16, 17],
			[
				[11, 14],
				[16, 19],
			],
		],
		[
			"export function App(props, props) @{\n\t<div />\n}",
			[27, 28],
			[
				[20, 25],
				[27, 32],
			],
		],
		[
			"export function App({ abc }, abc) @{\n\t<div />\n}",
			[29, 30],
			[
				[22, 25],
				[29, 32],
			],
		],
		[
			"const g = (abc, abc) => abc;",
			[16, 17],
			[
				[11, 14],
				[16, 19],
			],
		],
		// the earlier parameter is recorded once however often its name repeats
		[
			"function f(abc, abc, abc) {}",
			[16, 17],
			[
				[11, 14],
				[16, 19],
				[21, 24],
			],
		],
		[
			"function f(ab, cd, ab, cd, ab) {}",
			[19, 20],
			[
				[11, 13],
				[19, 21],
				[15, 17],
				[23, 25],
				[27, 29],
			],
		],
		[
			"function f(ab, ab) {} function g(ab, ab) {}",
			[15, 16],
			[
				[11, 13],
				[15, 17],
				[33, 35],
				[37, 39],
			],
		],
	];
	for (const [source, strict, expected] of cases) {
		const error = thrown(source);
		expect(
			error?.message.startsWith(`Argument name clash (${strict[0]}:${strict[1]})`),
			source,
		).toBe(true);
		expect([error?.pos, error?.end], source).toEqual(strict);
		for (const mode of ["collect", "loose"] as const) {
			expect(
				collected(source, mode).map(({ pos, end }) => [pos, end]),
				`${mode}: ${source}`,
			).toEqual(expected);
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

test("parse and analyze give the core shape too: diagnostic codes, no content on <script />", () => {
	const source = "export function App() @{\n\t<script />\n\t<{a()} />\n}";
	for (const result of [parse(source, { lang: "tsx" }), analyze(source, "App.tsrx")]) {
		expect(result.diagnostics.map(({ code }) => code)).toEqual(["tsrx-dynamic-tag-expression"]);
		const [script] = findAll(result.program, (node) => node.type === "JSXScriptElement");
		expect("content" in script).toBe(false);
	}
});

test("sloppy-mode scripts keep Annex B function declarations", () => {
	for (const source of [
		"{ function g() {} function g() {} }",
		"function o() { { function g() {} function g() {} } }",
	]) {
		for (const lang of ["js", "ts"] as const) {
			const { diagnostics } = parse(source, { lang, sourceType: "script", semanticErrors: true });
			expect(diagnostics, `${lang}: ${source}`).toEqual([]);
		}
	}
	expect(thrown("{ function g() {} function g() {} }")?.message).toMatch(
		/^Identifier 'g' has already been declared/,
	);
});

// tsrx-org/oxc#125, #127, #128: the shapes of @tsrx/core 0.5.0
test("an @case or @default arm's consequent is its { ... } block", () => {
	const source =
		"export function A({ x }) @{\n\t@switch (x) {\n\t\t@case 1: /* c */ {\n\t\t\tconst y = 1;\n\t\t\t<b>{y}</b>\n\t\t}\n\t\t@default: {\n\t\t\t// only a comment\n\t\t}\n\t}\n}\n";
	const cases = findAll(parseModule(source, "A.tsrx"), (node) => node.type === "SwitchCase");
	const blocks = cases.map(({ consequent }) => consequent as Node[]);
	expect(blocks.map((consequent) => consequent.map(({ type }) => type))).toEqual([
		["BlockStatement"],
		["BlockStatement"],
	]);
	const [[first], [fallback]] = blocks;
	expect([first.start, first.end]).toEqual([
		source.indexOf("{\n\t\t\tconst"),
		source.indexOf("}", source.indexOf("</b>")) + 1,
	]);
	expect((first.body as Node[]).map(({ type }) => type)).toEqual([
		"VariableDeclaration",
		"JSXElement",
	]);
	expect(source.slice(fallback.start as number, fallback.end as number)).toBe(
		"{\n\t\t\t// only a comment\n\t\t}",
	);
});

test("a type parameter's name is an Identifier, and an enum's members are in a TSEnumBody", () => {
	for (const [source, name] of [
		["function f<const T extends string>(x: T) {}", "T"],
		["class A<in /* c */ out T> {}", "T"],
		["type I = X extends Array<infer U> ? U : never;", "U"],
		["type M = { [K in keyof X]: X[K] };", "K"],
	]) {
		const [parameter] = findAll(
			parseModule(source, "a.ts"),
			(node) => node.type === "TSTypeParameter",
		);
		const start = source.lastIndexOf(
			name,
			source.indexOf(name === "T" ? ">" : name === "K" ? " in" : " ?"),
		);
		expect(parameter.name, source).toMatchObject({
			type: "Identifier",
			name,
			start,
			end: start + 1,
		});
	}
	// a mapped type's key and constraint are its typeParameter's, as in core
	const [mapped] = findAll(
		parseModule("type M = { [K in X]: 1 };", "a.ts"),
		(node) => node.type === "TSMappedType",
	);
	expect(mapped.typeParameter).toMatchObject({
		type: "TSTypeParameter",
		start: 12,
		end: 18,
		constraint: { start: 17 },
	});
	expect(["key", "constraint"].filter((key) => Object.keys(mapped).includes(key))).toEqual([]);
	const source = "enum E /* c */ { A, B = 2 }";
	const [declaration] = findAll(
		parseModule(source, "a.ts"),
		(node) => node.type === "TSEnumDeclaration",
	);
	expect(declaration.body).toMatchObject({
		type: "TSEnumBody",
		start: source.indexOf("{"),
		end: source.length,
	});
	expect(((declaration.body as Node).members as Node[]).length).toBe(2);
	expect("members" in declaration).toBe(false);
});
