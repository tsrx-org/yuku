import { expect, test } from "vitest";
import {
	isEventAttribute,
	normalizeEventName,
	parseModule,
	walk,
	type Comment,
	type Diagnostic,
	type ForOfStatement,
	type JSXForExpression,
	type JSXIfExpression,
	type MemberExpression,
	type TSRXJSXElement,
} from "@tsrx/yuku";

test("collects structured parser diagnostics without weakening strict mode", () => {
	const source = "const = ;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "broken.tsrx", { collect: true, errors });

	expect(program.type).toBe("Program");
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({
		severity: "error",
		message: expect.any(String),
		start: expect.any(Number),
		end: expect.any(Number),
		labels: expect.any(Array),
	});
	expect(() => parseModule(source, "broken.tsrx")).toThrow(SyntaxError);
});

test("loose parsing returns a usable tree and preserves collected comments", () => {
	const source = "export function App() @{ <div>{/* kept */}<span>text</div> }";
	const errors: Diagnostic[] = [];
	const comments: Comment[] = [];
	const program = parseModule(source, "App.tsrx", {
		collect: true,
		loose: true,
		errors,
		comments,
	});

	expect(program.type).toBe("Program");
	expect(errors).toEqual([]);
	expect(comments).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "Block", value: " kept ", start: 31, end: 41 }),
		]),
	);
});

test("a less-than that cannot open a tag stays literal JSX text", () => {
	// Markless renders these through SSR and expects `&lt;3` / `&lt;= arrow`,
	// so the `<` has to reach the tree as text rather than ending the parse.
	for (const [source, text] of [
		["export function App() @{ <span><3</span> }", "<3"],
		["export function App() @{ <span><= arrow</span> }", "<= arrow"],
		["export function App() @{ <span>a <3 b</span> }", "a <3 b"],
	] as const) {
		const errors: Diagnostic[] = [];
		const program = parseModule(source, "LessThan.tsrx", { collect: true, errors });
		expect(errors, source).toEqual([]);

		const values: string[] = [];
		walk(program, {
			enter(node) {
				if (node.type === "JSXText") values.push(node.value);
			},
		});
		expect(values, source).toEqual([text]);
	}
});

test("a literal less-than survives inside an expression container", () => {
	const source = "export function App() @{ <div>{<span><3</span>}</div> }";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "LessThanContainer.tsrx", { collect: true, errors });
	expect(errors).toEqual([]);

	const values: string[] = [];
	walk(program, {
		enter(node) {
			if (node.type === "JSXText") values.push(node.value);
		},
	});
	expect(values).toEqual(["<3"]);
});

test("exports Markless-compatible event attribute helpers", () => {
	expect(isEventAttribute("onClick")).toBe(true);
	expect(isEventAttribute("onclick")).toBe(false);
	expect(isEventAttribute("on")).toBe(false);
	expect(normalizeEventName("onClick")).toBe("click");
	expect(normalizeEventName("onPointerDownCapture")).toBe("pointerdown");
});

test("parses JSX-child @for index and key overlays", () => {
	const source =
		"const list = <ul>@for (const item of items; index slot; key item.id) { <li /> }</ul>;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "list.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.statement.type).toBe("ForOfStatement");
	if (directive?.statement.type !== "ForOfStatement") throw new Error("missing for-of");
	expect(directive.statement.index).toMatchObject({ type: "Identifier", name: "slot" });
	expect(directive.statement.key).toMatchObject({ type: "MemberExpression" });
	expect(source.slice(directive.statement.key?.start, directive.statement.key?.end)).toBe(
		"item.id",
	);
});

test("parses constructs in the children of a member-expression tag", () => {
	const source =
		"const list = <select.content>@for (const item of items; key item) { <li /> }</select.content>;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "member-tag.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	let element: TSRXJSXElement | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node as JSXForExpression;
			if (node.type === "JSXElement" && !element) element = node as TSRXJSXElement;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.type).toBe("JSXForExpression");
	expect(element?.openingElement.name).toMatchObject({
		type: "JSXMemberExpression",
		object: { type: "JSXIdentifier", name: "select" },
		property: { type: "JSXIdentifier", name: "content" },
	});
	expect(element?.closingElement?.name).toMatchObject({
		type: "JSXMemberExpression",
		object: { type: "JSXIdentifier", name: "select" },
		property: { type: "JSXIdentifier", name: "content" },
	});
});

test("parses bare identifier for binding in a JSX child", () => {
	const source = "const list = <ul>@for (item of items; key item.id) { <li /> }</ul>;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "bare-identifier-for.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.statement.type).toBe("ForOfStatement");
	if (directive?.statement.type !== "ForOfStatement") throw new Error("missing bare for-of");
	expect(directive.statement.left).toMatchObject({ type: "Identifier", name: "item" });
	expect(directive.statement.right).toMatchObject({ type: "Identifier", name: "items" });
	expect(directive.statement.index).toBeNull();
	expect(directive.statement.key).toMatchObject({
		type: "MemberExpression",
		object: { type: "Identifier", name: "item" },
		property: { type: "Identifier", name: "id" },
	});
	expect(source.slice(directive.statement.left.start, directive.statement.left.end)).toBe("item");
	expect(source.slice(directive.statement.right.start, directive.statement.right.end)).toBe(
		"items",
	);
	expect(source.slice(directive.statement.key?.start, directive.statement.key?.end)).toBe(
		"item.id",
	);
	expect(source.slice(directive.start, directive.end)).toBe(
		"@for (item of items; key item.id) { <li /> }",
	);
	expect(source.slice(directive.statement.start, directive.statement.end)).toBe(
		"for (item of items; key item.id) { <li /> }",
	);
});

test("Markless compatibility accepts static dynamic member tags", () => {
	const source = "const view = <{item.tag}></{item.tag}>;";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "dynamic-tag.tsrx", { collect: true, errors });
	let member: MemberExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "MemberExpression") member = node;
		},
	});

	expect(errors).toEqual([]);
	expect(member).toMatchObject({
		type: "MemberExpression",
		computed: false,
		object: { type: "Identifier", name: "item" },
		property: { type: "Identifier", name: "tag" },
	});
	expect(source.slice(member?.object.start, member?.object.end)).toBe("item");
	expect(source.slice(member?.property.start, member?.property.end)).toBe("tag");
	expect(source.slice(member?.start, member?.end)).toBe("item.tag");
});

test("Markless compatibility parses comparison conditions", () => {
	const source = "const view = @if (count > 0) { <p /> };";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "comparison-if.tsrx", { collect: true, errors });
	let directive: JSXIfExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXIfExpression") directive = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.test).toMatchObject({ type: "BinaryExpression", operator: ">" });
	expect(source.slice(directive?.test.start, directive?.test.end)).toBe("count > 0");
	expect(source.slice(directive?.start, directive?.end)).toBe("@if (count > 0) { <p /> }");
});

test("Markless compatibility parses compatible else-if spellings", () => {
	for (const testCase of [
		{
			source: "const view = @if (a) { <a /> } @else if (b) { <b /> } @else { <c /> };",
			nestedMarker: "if (b)",
		},
		{
			source: "const view = @if (a) { <a /> } @else @if (b) { <b /> } @else { <c /> };",
			nestedMarker: "@if (b)",
		},
	]) {
		const errors: Diagnostic[] = [];
		const program = parseModule(testCase.source, "else-if.tsrx", { collect: true, errors });
		let outer: JSXIfExpression | undefined;
		walk(program, {
			enter(node) {
				if (node.type === "JSXIfExpression" && node.start === testCase.source.indexOf("@if")) {
					outer = node;
				}
			},
		});

		expect(errors).toEqual([]);
		expect(outer?.consequent.type).toBe("BlockStatement");
		expect(outer?.alternate?.type).toBe("JSXIfExpression");
		if (outer?.alternate?.type !== "JSXIfExpression") throw new Error("missing nested else-if");
		expect(outer.alternate.start).toBe(testCase.source.indexOf(testCase.nestedMarker));
		expect(outer.alternate.test).toMatchObject({ type: "Identifier", name: "b" });
		expect(outer.alternate.consequent.type).toBe("BlockStatement");
		expect(outer.alternate.alternate?.type).toBe("BlockStatement");
		expect(outer.alternate.alternate?.end).toBe(testCase.source.lastIndexOf("}") + 1);
		expect(outer.end).toBe(testCase.source.lastIndexOf("}") + 1);
	}
});

test("Markless compatibility copies nested for overlay references", () => {
	const source =
		"export function App() @{ @for (const item of items; index slot; key item.id) { <p /> } }";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "nested-for.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.statement.type).toBe("ForOfStatement");
	if (directive?.statement.type !== "ForOfStatement") throw new Error("missing nested for-of");
	expect(directive.statement.index).toMatchObject({ type: "Identifier", name: "slot" });
	expect(directive.statement.key).toMatchObject({ type: "MemberExpression" });
	expect(source.slice(directive.statement.index?.start, directive.statement.index?.end)).toBe(
		"slot",
	);
	expect(source.slice(directive.statement.key?.start, directive.statement.key?.end)).toBe(
		"item.id",
	);
});

test("keyed repeat clause labels preserve nested Markless shape", () => {
	const source = "const view = @if (ready) { @for (const row of rows; key row.id) { <li /> } };";
	const errors: Diagnostic[] = [];
	const program = parseModule(source, "key-only-repeat.tsrx", { collect: true, errors });
	let directive: JSXForExpression | undefined;
	let statement: ForOfStatement | undefined;
	let key: MemberExpression | undefined;
	walk(program, {
		enter(node) {
			if (node.type === "JSXForExpression") directive = node;
			if (node.type === "ForOfStatement") statement = node;
			if (node.type === "MemberExpression") key = node;
		},
	});

	expect(errors).toEqual([]);
	expect(directive?.statement.type).toBe("ForOfStatement");
	if (directive?.statement.type !== "ForOfStatement") throw new Error("missing keyed repeat");
	expect(directive.statement).toBe(statement);
	expect(directive.statement.index).toBeNull();
	expect(directive.statement.key).toBe(key);
	expect(directive.statement.key).toMatchObject({
		type: "MemberExpression",
		object: { type: "Identifier", name: "row" },
		property: { type: "Identifier", name: "id" },
	});
	expect(source.slice(directive.statement.key?.start, directive.statement.key?.end)).toBe("row.id");
});
