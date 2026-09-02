import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { analyze, generate, parse, parseModule } from "yuku-tsrx";

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
