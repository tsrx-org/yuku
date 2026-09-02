import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { analyze, generate, parse, parseModule, walk } from "yuku-tsrx";

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
		"const v = @for (const k in obj) { <b/> }; const z = 1;",
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
	const browser = await import("../docs/assets/yuku-wasm.js");
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
