import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { analyze, generate, parse, parseModule, walk } from "@tsrx/yuku";

test("one package analyzes dialect bindings and generates reparsable TSRX", () => {
	const source = "const outer = 1; const view = @{ const inner = outer; <p>{inner}</p> };";
	const analysis = analyze(source, { lang: "tsx" });
	expect(analysis.diagnostics).toEqual([]);
	expect(analysis.semantic.reference.count).toBeGreaterThanOrEqual(2);

	const generated = generate(analysis.program);
	expect(generated.errors).toEqual([]);
	expect(parse(generated.code, { lang: "tsx" }).diagnostics).toEqual([]);
});

test("all invalid fixtures stay diagnostic and cannot be silently projected", () => {
	const fixtureRoot = resolve("test/parser/misc/tsrx");
	const fixtures = [
		"control-flow-switch-invalid.module.tsrx",
		"dynamic-tag-invalid.module.tsrx",
		"template-return-invalid.module.tsrx",
	];
	expect(fixtures).toHaveLength(3);
	for (const fixture of fixtures) {
		const source = readFileSync(resolve(fixtureRoot, fixture), "utf8");
		expect(analyze(source, { lang: "tsx" }).diagnostics.length, fixture).toBeGreaterThan(0);
	}
});

test("a malformed TSRX construct is a module error, never a silently truncated program", () => {
	// Each of these used to return zero diagnostics and a program cut off at the construct.
	const sources = [
		"const z = 1; const v = @for (const i of xs) <b/>; const w = 2;",
		"const v = @for (const i of xs; index a; index b) { <b/> }; const z = 1;",
		"const v = @for (const i of xs; key a; index b) { <b/> }; const z = 1;",
		"const v = @for (const i of xs; foo) { <b/> }; const z = 1;",
		"const v = @for (const i of xs; 1) { <b/> }; const z = 1;",
		"const v = @for (const i of xs; index ) { <b/> }; const z = 1;",
		"const v = @switch (x) { <b/> }; const z = 1;",
		"const v = <{a />; const z = 1;",
		"let &x = p; const z = 1;",
		"const v = @fortune (x) { }; const z = 1;",
	];
	for (const source of sources) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics.length, source).toBeGreaterThan(0);
		expect(() => parseModule(source, "module.tsrx"), source).toThrow(SyntaxError);
	}
});

test("TSRX for-in uses the for directive surface and tail clauses", () => {
	const cases = [
		["const v = @for (const k in obj) { <b>{k}</b> };", "ForInStatement", null, null],
		["const v = @for (const k in obj; index i) { <b>{k}</b> };", "ForInStatement", "i", null],
		["const v = @for (const k in obj; key k) { <b>{k}</b> };", "ForInStatement", null, "k"],
		["const v = @for (const k in obj; index i; key k) { <b>{k}</b> };", "ForInStatement", "i", "k"],
		["const v = @for (const k of obj; index i; key k) { <b>{k}</b> };", "ForOfStatement", "i", "k"],
	] as const;
	for (const [source, type, index, key] of cases) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		const directive = result.program.body[0].declarations[0].init;
		expect(directive.type, source).toBe("JSXForExpression");
		const expected = {
			type,
			left: { type: "VariableDeclaration", declarations: [{ id: { name: "k" } }] },
			right: { type: "Identifier", name: "obj" },
			...(index !== null || key !== null || type === "ForOfStatement"
				? { index: index === null ? null : { type: "Identifier", name: index } }
				: {}),
			...(key !== null ? { key: { type: "Identifier", name: key } } : {}),
		};
		expect(directive.statement, source).toMatchObject(expected);
	}
});

test("an at sign only starts a complete JSX child directive keyword", () => {
	for (const [source, value] of [
		["const view = <p>mail @ home</p>;", "mail @ home"],
		["const view = <main>@ifπ is text</main>;", "@ifπ is text"],
		["const view = <p>email@</p>;", "email@"],
		["const view = <p>@iffy</p>;", "@iffy"],
		["const view = <p>@else is text</p>;", "@else is text"],
	] as const) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		expect(result.program.body[0].declarations[0].init.children, source).toEqual([
			expect.objectContaining({ type: "JSXText", value: expect.stringContaining("@") }),
		]);
		expect(result.program.body[0].declarations[0].init.children[0].value, source).toBe(value);
	}

	const mixed = parse("const view = <p>@if (x) { <b/> } and @ sign</p>;", { lang: "tsx" });
	expect(mixed.diagnostics).toEqual([]);
	expect(mixed.program.body[0].declarations[0].init.children).toMatchObject([
		{ type: "JSXIfExpression" },
		{ type: "JSXText", value: " and @ sign" },
	]);
});

test("dynamic tags preserve conditional and logical expressions", () => {
	for (const [source, type] of [
		["const view = <{cond ? A : B}>x</{cond ? A : B}>;", "ConditionalExpression"],
		["const view = <{a || B}>x</{a || B}>;", "LogicalExpression"],
	] as const) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		const element = result.program.body[0].declarations[0].init;
		expect(element.openingElement.name.expression.type, source).toBe(type);
		expect(element.closingElement.name.expression.type, source).toBe(type);
		expect(
			source.slice(
				element.openingElement.name.expression.start,
				element.openingElement.name.expression.end,
			),
		).toBe(
			source.slice(
				element.closingElement.name.expression.start,
				element.closingElement.name.expression.end,
			),
		);
	}

	const rejected = parse("const view = <{pick()} />;", { lang: "tsx" });
	expect(rejected.diagnostics).toEqual([
		expect.objectContaining({
			message: "TSRX dynamic tag expression must resolve to an element name",
		}),
	]);
});

test("semantic analysis resolves dialect scopes and excludes stylesheet text", () => {
	const source = `
		const outer = 1;
		const block = @{ const inner = outer; <p>{inner}</p> };
		const branch = @if (outer) { const insideIf = outer; <p>{insideIf}</p> };
		const loop = @for (const item of [outer]) { <p>{item}</p> };
		const attempt = @try { <p>{outer}</p> } @catch (error) { <p>{error}</p> };
		const styled = <style>.outer { color: red; }</style>;
		outside;
	`;
	const result = analyze(source, { lang: "tsx" });
	expect(result.diagnostics).toEqual([]);
	const references = Array.from({ length: result.semantic.reference.count }, (_, index) => ({
		name: result.semantic.reference.name(index),
		symbol: result.semantic.reference.symbolId(index),
	}));
	expect(
		references.filter(({ name }) => name === "outer").every(({ symbol }) => symbol !== null),
	).toBe(true);
	expect(references.find(({ name }) => name === "insideIf")?.symbol).not.toBeNull();
	expect(references.find(({ name }) => name === "item")?.symbol).not.toBeNull();
	expect(references.find(({ name }) => name === "error")?.symbol).not.toBeNull();
	expect(references.find(({ name }) => name === "outside")?.symbol).toBeNull();
	expect(references.some(({ name }) => name === "color" || name === "red")).toBe(false);
});

test("script raw text and style sheets remain distinct in either fragment order", () => {
	const [scriptFirst, styleFirst, external] = readFileSync(
		resolve("test/fixtures/script-raw-text.tsrx"),
		"utf8",
	)
		.trim()
		.split("\n");
	for (const source of [scriptFirst, styleFirst]) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		const children = result.program.body[0].expression.children;
		const script = children.find(({ type }) => type === "JSXScriptElement");
		const style = children.find(({ type }) => type === "JSXStyleElement");
		expect(script, source).toMatchObject({
			type: "JSXScriptElement",
			raw: '{"a":1}',
			children: [{ type: "JSXText", value: '{"a":1}', raw: '{"a":1}' }],
		});
		expect(style, source).toMatchObject({
			type: "JSXStyleElement",
			children: [{ type: "StyleSheet", source: ".a{color:red}", scanned: true }],
		});
		const generated = generate(result.program);
		expect(generated.errors, source).toEqual([]);
		expect(generated.code, source).toContain('{"a":1}');
		expect(parse(generated.code, { lang: "tsx" }).diagnostics, source).toEqual([]);
	}

	const empty = parse(external, { lang: "tsx" });
	expect(empty.diagnostics).toEqual([]);
	expect(empty.program.body[0].expression).toMatchObject({
		type: "JSXScriptElement",
		raw: "",
		children: [{ type: "JSXText", value: "", raw: "" }],
	});
	const generated = generate(empty.program);
	expect(generated.errors).toEqual([]);
	expect(parse(generated.code, { lang: "tsx" }).diagnostics).toEqual([]);
});

test("all valid fixtures generate and strictly reparse to the same structure", () => {
	const fixtureRoot = resolve("test/parser/misc/tsrx");
	const fixtures = [
		"code-block-expression.module.tsrx",
		"code-block-function.module.tsrx",
		"code-block.module.tsrx",
		"control-flow-for.module.tsrx",
		"control-flow-if.module.tsrx",
		"control-flow-switch.module.tsrx",
		"control-flow-try.module.tsrx",
		"dynamic-tag.module.tsrx",
		"lazy-destructuring.module.tsrx",
		"style-element.module.tsrx",
		"submodule-import.module.tsrx",
		"text-entities.module.tsrx",
	];
	expect(fixtures).toHaveLength(12);
	for (const fixture of fixtures) {
		const source = readFileSync(resolve(fixtureRoot, fixture), "utf8");
		const first = parse(source, { lang: "tsx" });
		expect(first.diagnostics, fixture).toEqual([]);
		const generated = generate(first.program);
		expect(generated.errors, fixture).toEqual([]);
		const second = parse(generated.code, { lang: "tsx" });
		expect(second.diagnostics, `${fixture}\n${generated.code}`).toEqual([]);
		expect(structure(second.program), fixture).toEqual(structure(first.program));
	}
});

function structure(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(structure);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "start" && key !== "end")
			.map(([key, child]) => [key, structure(child)]),
	);
}

test("generate honours strip and minify through the npm host", () => {
	const source = "const a: number = 1; type T = 2; export function f(x: string): void {}";
	const program = parse(source, { lang: "ts" }).program;
	expect(generate(program).code).toContain(": number");
	expect(generate(program, { strip: true }).code).toBe("const a = 1;\nexport function f(x) {}");
	expect(generate(program, { minify: true }).code).toBe(
		"const a:number=1;type T=2;export function f(x:string):void{}",
	);
	// strip wins over minify's syntax mode on both hosts; its whitespace mode still applies
	expect(generate(program, { strip: true, minify: true }).code).toBe(
		"const a=1;export function f(x){}",
	);
	const quoted = parse("const s = 'x' + \"y\";", { lang: "ts" }).program;
	expect(generate(quoted, { minify: { syntax: true } }).code).toBe('const s = "x" + "y";');
	expect(generate(quoted, { minify: { syntax: true }, quotes: "shortest" }).code).toBe(
		'const s = "x" + "y";',
	);
});

test("generate refuses shortest quotes outside minify with one message on both hosts", async () => {
	const program = parse("const s = 'x';", { lang: "ts" }).program;
	const message =
		'yuku-tsrx generate: quotes "shortest" is not supported here; the codegen offers "preserve", "double" and "single", and minify picks the shortest quote itself';
	expect(() => generate(program, { quotes: "shortest" })).toThrow(new TypeError(message));
	expect(() => generate(program, { minify: { quotes: true } })).toThrow(new TypeError(message));
	const browser = await import("../yuku-website/assets/yuku-wasm.js");
	expect(() => browser.packGenerateOptions({ quotes: "shortest" })).toThrow(new TypeError(message));
	expect(browser.packGenerateOptions({ quotes: "shortest", minify: true })).toBe(
		browser.packGenerateOptions({ minify: true }),
	);
	expect(() => browser.packGenerateOptions({ sourceMaps: { source: "const s = 'x';" } })).toThrow(
		new TypeError(
			"yuku-tsrx generate: sourceMaps is not supported here; the wasm build carries no source maps",
		),
	);
});

test("generate returns a Source Map V3 when sourceMaps is requested", () => {
	const source = "const a = 1;\nexport function f(x) { return x; }\n";
	const program = parse(source, { lang: "ts" }).program;
	expect(generate(program).map).toBeNull();
	const { code, map } = generate(program, {
		sourceMaps: { source, file: "x.js", sourceFileName: "x.tsrx", sourcesContent: true },
	});
	expect(code).toContain("export function f");
	expect(map).toMatchObject({
		version: 3,
		file: "x.js",
		sources: ["x.tsrx"],
		sourcesContent: [source],
		names: [],
	});
	expect(map?.mappings).toMatch(/^[A-Za-z0-9+/,;]+$/);
	expect(() => generate(program, { sourceMaps: { file: "x.js" } as never })).toThrow(TypeError);
});

test("parentIndex answers for every node of every dialect construct", () => {
	const sources = {
		codeBlock: "const v = @{ const inner = 1; <p>{inner}</p> };",
		if: "const v = @if (a) { <b/> } @else @if (c) { <i/> } @else { <u/> };",
		for: "const v = @for (const item of items; index i; key item.id) { <li>{item}</li> } @empty { <p/> };",
		switch: "const v = @switch (x) { @case 1: { <b/> } @default: { <i/> } };",
		try: "const v = @try { <b/> } @pending { <p/> } @catch (error, reset) { <i>{error}</i> };",
		style: "const v = <style>.a { color: red; }</style>;",
		lazyPattern: "const &[a, b] = pair; let &{ c } = obj; &{ c } = obj;",
		dynamicTag: 'const v = <{tag} id="x"><{inner}/></{tag}>;',
		plain: "const a: number = 1; function f() { return a; }",
	};
	for (const [name, source] of Object.entries(sources)) {
		const result = analyze(source, "x.tsrx");
		expect(result.diagnostics, name).toEqual([]);
		const programIndex = result.indexOf(result.program);
		expect(programIndex, name).toBeTypeOf("number");
		expect(result.parentIndex(programIndex as number), name).toBe(-1);
		const reachable = new Set<object>();
		walk(result.program, { enter: (node) => void reachable.add(node) });
		expect(reachable.size, name).toBeGreaterThan(3);
		for (const node of reachable) {
			if (node === result.program) continue;
			const index = result.indexOf(node as never);
			expect(index, `${name}: ${node.type} is not indexed`).toBeTypeOf("number");
			const parent = result.parentIndex(index as number);
			expect(parent, `${name}: ${node.type}@${index} has no parent`).toBeGreaterThanOrEqual(0);
			expect(
				holds(result.nodeOf(parent), node),
				`${name}: ${result.nodeOf(parent).type}@${parent} does not hold ${node.type}@${index}`,
			).toBe(true);
		}
	}
	const branch = analyze(sources.if, "x.tsrx");
	const ifIndex = branch.indexOf(branch.program.body[0].declarations[0].init) as number;
	expect(branch.nodeOf(ifIndex).type).toBe("JSXIfExpression");
	expect(branch.nodeOf(branch.parentIndex(ifIndex)).type).toBe("VariableDeclarator");
	const test = branch.indexOf(branch.nodeOf(ifIndex).test) as number;
	expect(branch.parentIndex(test)).toBe(ifIndex);
});

// Whether `child` sits directly under `parent`, looking through arrays and
// the plain wrappers a non-node slot materializes as, but never into another node.
function holds(parent: unknown, child: object): boolean {
	if (parent === null || typeof parent !== "object") return false;
	for (const value of Object.values(parent)) {
		if (value === child) return true;
		if (value === null || typeof value !== "object") continue;
		if (Array.isArray(value) ? value.includes(child) : false) return true;
		if (!Array.isArray(value) && typeof (value as { type?: unknown }).type === "string") continue;
		if (holds(value, child)) return true;
	}
	return false;
}

test("a TSRX catch parameter takes any binding pattern", () => {
	// `@catch` used to read one identifier by hand, so every destructured or lazy parameter failed at ')'.
	const cases: [clause: string, type: string, lazy: boolean, reset: boolean][] = [
		["@catch (&{ message }, reset)", "ObjectPattern", true, true],
		["@catch ({ message }, reset)", "ObjectPattern", false, true],
		["@catch ({ message }: ErrorInfo, reset)", "ObjectPattern", false, true],
		["@catch (&[first])", "ArrayPattern", true, false],
		["@catch (error)", "Identifier", false, false],
		["@catch (error: Error, reset)", "Identifier", false, true],
		["@catch (error, reset)", "Identifier", false, true],
	];
	for (const [clause, type, lazy, reset] of cases) {
		const source = `const v = @try { <b/> } ${clause} { <i/> };`;
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, clause).toEqual([]);
		const handler = result.program.body[0].declarations[0].init.statement.handler;
		expect(handler.param.type, clause).toBe(type);
		expect(handler.param.lazy ?? false, clause).toBe(lazy);
		expect(handler.resetParam?.type ?? null, clause).toBe(reset ? "Identifier" : null);
	}

	for (const [clause, annotation] of [
		["@catch (&{ message }: { message: string }, reset)", "TSTypeLiteral"],
		["@catch (e: Result<T>, reset)", "TSTypeReference"],
		["@catch (e: A | B)", "TSUnionType"],
	] as const) {
		const source = `const v = @try { <b/> } ${clause} { <i/> };`;
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, clause).toEqual([]);
		const param = result.program.body[0].declarations[0].init.statement.handler.param;
		expect(param.typeAnnotation.typeAnnotation.type, clause).toBe(annotation);
		if (annotation === "TSTypeReference") {
			expect(param.typeAnnotation.typeAnnotation.typeArguments.params, clause).toHaveLength(1);
		}
	}
});

test("lazy covers keep parameter and arrow annotations", () => {
	for (const [source, parameterTyped, returnTyped] of [
		["const f = (&{ a }: P): string => a;", true, true],
		["const g = (&{ a }): R => a;", false, true],
		["const h = (&{ a }) => a;", false, false],
	] as const) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		const arrow = result.program.body[0].declarations[0].init;
		expect(arrow.params[0], source).toMatchObject({ type: "ObjectPattern", lazy: true });
		expect(arrow.params[0].typeAnnotation !== null, source).toBe(parameterTyped);
		expect(arrow.returnType !== null, source).toBe(returnTyped);
	}

	const source = "const [a, &{ b }, &[c], { d }] = x;";
	const result = parse(source, { lang: "tsx" });
	expect(result.diagnostics).toEqual([]);
	const pattern = result.program.body[0].declarations[0].id;
	expect(pattern).toMatchObject({
		type: "ArrayPattern",
		elements: [
			{ type: "Identifier", name: "a" },
			{ type: "ObjectPattern", lazy: true },
			{ type: "ArrayPattern", lazy: true },
			{ type: "ObjectPattern" },
		],
	});
	expect(pattern.lazy ?? false).toBe(false);
	expect(pattern.elements[3].lazy ?? false).toBe(false);
});

test("line-leading committed JSX forms a statement boundary", () => {
	const blockSource = "const view = @{\nconst count = get()\n<button>{'Count: ' + count}</button>\n};";
	const blockResult = parse(blockSource, { lang: "tsx" });
	expect(blockResult.diagnostics).toEqual([]);
	const block = blockResult.program.body[0].declarations[0].init;
	expect(block.body).toHaveLength(1);
	expect(block.render).toMatchObject({ type: "JSXElement" });

	for (const source of [
		"const wide = a < b\n<main>{wide}</main>",
		"const useValue =\n<T extends Value,>(value: T): T => value\n<main>{useValue(1)}</main>",
	]) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		expect(result.program.body, source).toHaveLength(2);
		expect(result.program.body[1], source).toMatchObject({
			type: "ExpressionStatement",
			expression: { type: "JSXElement" },
		});
	}
});

test("less-than continuations remain one expression", () => {
	for (const source of ["a <\nb", "a\n< b", "x = y <T>(z)"]) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		expect(result.program.body, source).toHaveLength(1);
	}
});

test("a lazy pattern cannot initialize a C-style for loop", () => {
	for (const source of [
		"for (&{ bit }; i < 4; i++) { a(bit); }",
		"const v = @for (&{ bit }; index < 4; index += 1) { <b/> };",
	]) {
		const result = parse(source, { lang: "tsx" });
		const start = source.indexOf("&{ bit }");
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0]).toMatchObject({
			message: "A lazy pattern needs 'of' or 'in' after it",
			start,
			end: start + "&{ bit }".length,
		});
	}

	for (const source of [
		"for (&{ bit } of items) { a(bit); }",
		"for (&[key] in table) { a(key); }",
		"for await (&{ a } of s) { a; }",
		"const v = @for (&{ id } of items) { <b/> };",
		"const &{ a } = props;",
		"const f = (&{ a }) => a;",
		"try {} catch (&{ cause }) {}",
	]) {
		expect(parse(source, { lang: "tsx" }).diagnostics, source).toEqual([]);
	}
});

test("lazy patterns recurse through object values and array elements", () => {
	for (const [source, outerType, patternCount, lazyCount] of [
		["const f = (&{ user: &{ id } }) => id;", "ObjectPattern", 2, 2],
		["const &{ user: &{ id } } = props;", "ObjectPattern", 2, 2],
		["const &[ &{ id } ] = props;", "ArrayPattern", 2, 2],
		["const &{ user: { id }, row: [first] } = props;", "ObjectPattern", 3, 1],
	] as const) {
		const result = parse(source, { lang: "tsx" });
		expect(result.diagnostics, source).toEqual([]);
		let patterns = 0;
		const lazyPatterns: { type: string; lazy?: boolean; start: number }[] = [];
		walk(result.program, {
			enter(node) {
				if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
					patterns += 1;
				}
				if ((node.type === "ObjectPattern" || node.type === "ArrayPattern") && node.lazy) {
					lazyPatterns.push(node);
				}
			},
		});
		expect(patterns, source).toBe(patternCount);
		expect(lazyPatterns, source).toHaveLength(lazyCount);
		expect(lazyPatterns.find(({ start }) => start === source.indexOf("&"))?.type, source).toBe(
			outerType,
		);
		expect(
			lazyPatterns.every(({ lazy }) => lazy === true),
			source,
		).toBe(true);
	}
});

test("an unclosed function code block stays in the editor tree", () => {
	for (const source of [
		"export function View() @{",
		"export function View() @{ const value = ",
		"export function View() @{ @if (",
		"export function View() @{ @ }",
		"export function View() @{\n  <div>\n}",
	]) {
		const result = parse(source, { lang: "tsx" });
		expect(result.program.end, source).toBe(source.length);
		expect(result.program.body, source).toHaveLength(1);
		const exported = result.program.body[0];
		expect(exported.type, source).toBe("ExportNamedDeclaration");
		expect(exported.declaration?.type, source).toBe("FunctionDeclaration");
		expect(exported.declaration?.body?.type, source).toBe("JSXCodeBlock");
		expect(result.diagnostics.length, source).toBeGreaterThan(0);
		expect(
			result.diagnostics.filter(({ message }) => message === "Unclosed '@{' code block"),
			source,
		).toEqual([expect.objectContaining({ start: 23, end: 25 })]);
		for (const diagnostic of result.diagnostics) {
			expect(diagnostic.start, diagnostic.message).toBeGreaterThanOrEqual(0);
			expect(diagnostic.end, diagnostic.message).toBeGreaterThanOrEqual(diagnostic.start);
			expect(diagnostic.end, diagnostic.message).toBeLessThanOrEqual(source.length);
		}
	}
});

test("a closed function code block still keeps its render element", () => {
	const source = "function View() @{ const value; <main /> }";
	const result = parse(source, { lang: "tsx" });
	expect(result.program.body[0]).toMatchObject({
		type: "FunctionDeclaration",
		body: { type: "JSXCodeBlock", render: { type: "JSXElement" } },
	});
});
