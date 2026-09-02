import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { decode, encode, parse, parseModule, parseWire, walk } from "@tsrx/yuku";
import type { ExpressionStatement, VariableDeclaration } from "@tsrx/yuku";

const fixture = (name: string): string => readFileSync(`test/parser/misc/tsrx/${name}`, "utf8");

test("parses accepted TSRX through the native ArrayBuffer wire", () => {
	const source = fixture("control-flow-if.module.tsrx");
	const wire = parseWire(new TextEncoder().encode(source), {
		lang: "tsx",
		sourceType: "module",
	});
	expect(wire).toBeInstanceOf(ArrayBuffer);

	const direct = decode(wire, source);
	const parsed = parse(source, { lang: "tsx", sourceType: "module" });
	const module = parseModule(source, "fixture.tsrx");
	expect(parsed).toEqual(direct);
	expect(module).toEqual(direct.program);
	expect(module.type).toBe("Program");
	expect(module).not.toHaveProperty("program");
	expect(parsed.diagnostics).toEqual([]);
});

test("parseModule rejects syntax diagnostics while parse remains inspectable", () => {
	const source = "const = ;";
	const parsed = parse(source, { lang: "tsx", sourceType: "module" });
	expect(parsed.diagnostics.length).toBeGreaterThan(0);
	expect(() => parseModule(source, "broken.tsrx")).toThrow(SyntaxError);
});

test("decoded byte input preserves non-ASCII source positions", () => {
	const source = 'const café = "π"; const view = <span>é</span>;';
	const bytes = new TextEncoder().encode(source);
	const fromString = parse(source, { lang: "tsx", sourceType: "module" });
	const fromBytes = parse(bytes, { lang: "tsx", sourceType: "module" });
	expect(fromBytes).toEqual(fromString);
	expect(fromBytes.diagnostics).toEqual([]);

	const slices: string[] = [];
	walk(fromBytes.program, {
		enter(node) {
			if (node.type === "Identifier" || node.type === "Literal" || node.type === "JSXText") {
				slices.push(source.slice(node.start, node.end));
			}
		},
	});
	expect(slices).toEqual(expect.arrayContaining(["café", '"π"', "é"]));
});

test("walks every runtime TSRX record name in the accepted corpus", () => {
	const names = new Set<string>();
	for (const name of [
		"code-block.module.tsrx",
		"control-flow-if.module.tsrx",
		"control-flow-for.module.tsrx",
		"control-flow-switch.module.tsrx",
		"control-flow-try.module.tsrx",
		"style-element.module.tsrx",
	]) {
		const program = parseModule(fixture(name), name);
		walk(program, {
			enter(node) {
				names.add(node.type);
			},
		});
	}
	expect(
		[...names].filter(
			(name) => name.startsWith("JSX") || name.startsWith("Css") || name === "StyleSheet",
		),
	).toEqual(
		expect.arrayContaining([
			"JSXCodeBlock",
			"JSXIfExpression",
			"JSXForExpression",
			"JSXSwitchExpression",
			"JSXTryExpression",
			"JSXStyleElement",
			"StyleSheet",
			"CssRule",
			"CssAtrule",
			"CssSelector",
		]),
	);
});

test("generated encode and decode preserve production program and dialect fields", () => {
	const source = fixture("control-flow-for.module.tsrx");
	const program = parseModule(source, "control-flow-for.module.tsrx");
	const encoded = encode(program);
	expect(encoded).toBeInstanceOf(ArrayBuffer);
	const restored = decode(encoded, source);
	expect(restored.program).toEqual(program);

	const packageSources = ["index.js", "binding.js", "walk.js"].map((name) =>
		readFileSync(`npm/yuku/${name}`, "utf8"),
	);
	for (const sourceText of packageSources) {
		expect(sourceText).not.toMatch(/JSON\.(parse|stringify)/);
	}
});

test("generated encode and decode preserve the distinct TSRXExpression record", () => {
	const source = "const value = 1;";
	const program = parseModule(source, "fixture.tsrx");
	const declaration = program.body[0] as VariableDeclaration;
	const expression = declaration.declarations[0].init;
	if (expression === null) throw new Error("fixture declaration must have an initializer");
	const statement: ExpressionStatement = {
		type: "ExpressionStatement",
		start: expression.start,
		end: expression.end,
		expression: {
			type: "TSRXExpression",
			start: expression.start,
			end: expression.end,
			expression,
		},
	};
	program.body.push(statement);

	const restored = decode(encode(program), source).program;
	const restoredStatement = restored.body.at(-1) as unknown as {
		expression: { type: string; expression: { type: string } };
	};
	expect(restoredStatement.expression.type).toBe("TSRXExpression");
	expect(restoredStatement.expression.expression.type).toBe("Literal");
});

test("publishes the complete TSRX type-name surface without retagging", () => {
	const declarations = readFileSync("npm/yuku/index.d.ts", "utf8");
	for (const name of [
		"JSXCodeBlock",
		"JSXStyleElement",
		"StyleSheet",
		"CssRule",
		"CssAtrule",
		"CssSelector",
		"TSRXExpression",
		"JSXIfExpression",
		"JSXForExpression",
		"JSXSwitchExpression",
		"JSXTryExpression",
		"TSRXJSXElement",
		"TSRXJSXFragment",
		"TSRXJSXOpeningElement",
		"TSRXJSXClosingElement",
	]) {
		expect(declarations).toContain(name);
	}
});
