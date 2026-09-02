import { expect, test } from "vitest";
import {
	duplicateBindingDiagnostics,
	duplicateBindings,
	normalizeProgram,
	parseModule,
	sourceLocation,
	sourcePosition,
	type Comment,
	type Diagnostic,
	type JSXForExpression,
	type JSXSwitchExpression,
	type JSXTryExpression,
} from "@tsrx/yuku";

// These three capabilities were each re-implemented downstream (markless, and
// frameless after it) because the package did not offer them. They live here so
// there is one implementation to fix.

test("sourcePosition reports 1-based lines and 0-based columns", () => {
	const source = "const a = 1;\nconst b = 2;\n\nconst c = 3;";

	expect(sourcePosition(source, 0)).toEqual({ line: 1, column: 0 });
	expect(sourcePosition(source, 6)).toEqual({ line: 1, column: 6 });
	// The newline itself still belongs to the line it terminates.
	expect(sourcePosition(source, 12)).toEqual({ line: 1, column: 12 });
	expect(sourcePosition(source, 13)).toEqual({ line: 2, column: 0 });
	expect(sourcePosition(source, 26)).toEqual({ line: 3, column: 0 });
	expect(sourcePosition(source, 27)).toEqual({ line: 4, column: 0 });
});

test("sourcePosition clamps offsets outside the source instead of throwing", () => {
	const source = "const a = 1;";

	expect(sourcePosition(source, -5)).toEqual({ line: 1, column: 0 });
	expect(sourcePosition(source, 9_000)).toEqual({ line: 1, column: source.length });
	expect(sourcePosition("", 0)).toEqual({ line: 1, column: 0 });
});

test("sourceLocation pairs the endpoints of a span", () => {
	const source = "const a = 1;\nconst bb = 2;";

	expect(sourceLocation(source, 13, 26)).toEqual({
		start: { line: 2, column: 0 },
		end: { line: 2, column: 13 },
	});
});

test("sourceLocation places a real diagnostic where the source reads it", () => {
	const errors: Diagnostic[] = [];
	const source = "const a = 1;\nconst = ;\n";
	parseModule(source, "broken.tsrx", { collect: true, errors });

	expect(errors.length).toBeGreaterThan(0);
	const location = sourceLocation(source, errors[0].start, errors[0].end);
	expect(location.start.line).toBe(2);
	expect(source.split("\n")[1]).toContain("const");
});

test("normalizeProgram aliases dialect wrapper fields onto the wrapper", () => {
	const program = parseModule(
		"export function App() @{ @for (const item of items) { <li>{item}</li> } }",
		"App.tsrx",
	);
	normalizeProgram(program);

	const wrappers: JSXForExpression[] = [];
	const collect = (value: unknown, seen = new Set<object>()): void => {
		if (!value || typeof value !== "object" || seen.has(value)) return;
		seen.add(value);
		if (Array.isArray(value)) {
			for (const item of value) collect(item, seen);
			return;
		}
		if ((value as { type?: unknown }).type === "JSXForExpression") {
			wrappers.push(value as JSXForExpression);
		}
		for (const child of Object.values(value)) collect(child, seen);
	};
	collect(program);

	expect(wrappers).toHaveLength(1);
	const wrapper = wrappers[0] as JSXForExpression & { left?: unknown; right?: unknown };
	const statement = wrapper.statement as unknown as Record<string, unknown>;
	expect(wrapper.left).toBe(statement.left);
	expect(wrapper.right).toBe(statement.right);

	// Non-enumerable, so serializers and tree walkers still see one canonical
	// child rather than the same subtree twice.
	expect(Object.keys(wrapper)).not.toContain("left");
	expect(Object.keys(JSON.parse(JSON.stringify(wrapper)))).toEqual(
		expect.not.arrayContaining(["left", "right", "body"]),
	);
});

test("normalizeProgram is idempotent and never overwrites an owned field", () => {
	const node = {
		type: "JSXSwitchExpression",
		discriminant: "already mine",
		statement: { type: "SwitchStatement", discriminant: "inner", cases: [] },
	};
	const program = { type: "Program", body: [node] };

	normalizeProgram(program);
	normalizeProgram(program);

	expect(node.discriminant).toBe("already mine");
	expect((node as unknown as JSXSwitchExpression & { cases: unknown }).cases).toBe(
		node.statement.cases,
	);
});

test("normalizeProgram runs onNode once per node, before aliasing", () => {
	const node = {
		type: "JSXTryExpression",
		statement: { type: "TryStatement", block: { type: "BlockStatement", body: [] } },
	};
	const program = { type: "Program", body: [node] };
	const seen: unknown[] = [];

	normalizeProgram(program, {
		onNode: (visited) => {
			seen.push(visited);
			if ((visited as { type?: unknown }).type === "JSXTryExpression") {
				// Aliasing has not happened yet when the hook runs.
				expect(Object.hasOwn(visited, "block")).toBe(false);
			}
		},
	});

	expect(seen).toContain(node);
	expect(new Set(seen).size).toBe(seen.length);
	expect((node as unknown as JSXTryExpression & { block: unknown }).block).toBe(
		node.statement.block,
	);
});

test("duplicateBindings reports each redeclaration with both spans", () => {
	const source = "const value = 1;\nconst value = 2;\n";
	const program = parseModule(source, "dupe.tsrx", { collect: true, loose: true });
	const duplicates = duplicateBindings(program, source);

	expect(duplicates).toHaveLength(1);
	expect(duplicates[0].name).toBe("value");
	expect(source.slice(duplicates[0].declaration.start, duplicates[0].declaration.end)).toBe(
		"value",
	);
	expect(duplicates[0].declaration.start).toBe(6);
	expect(duplicates[0].redeclaration.start).toBe(23);
});

test("duplicateBindings walks destructuring patterns", () => {
	const source = "const { a } = x;\nconst [a] = y;\n";
	const program = parseModule(source, "dupe.tsrx", { collect: true, loose: true });

	expect(duplicateBindings(program, source).map((duplicate) => duplicate.name)).toEqual(["a"]);
});

test("duplicateBindings allows repeated var and reports lexical repeats", () => {
	const legal = "var a = 1;\nvar a = 2;\n";
	const illegal = "var a = 1;\nlet a = 2;\n";

	expect(
		duplicateBindings(parseModule(legal, "v.tsrx", { collect: true, loose: true }), legal),
	).toEqual([]);
	expect(
		duplicateBindings(parseModule(illegal, "v.tsrx", { collect: true, loose: true }), illegal).map(
			(duplicate) => duplicate.name,
		),
	).toEqual(["a"]);
});

test("duplicateBindings scopes its comparison to one statement list", () => {
	const source = "const a = 1;\nfunction f() { const a = 2; }\n";
	const program = parseModule(source, "scoped.tsrx", { collect: true, loose: true });

	// A nested block redeclaring an outer name is shadowing, not a redeclaration.
	expect(duplicateBindings(program, source)).toEqual([]);
});

test("duplicateBindings reports one entry per repeat", () => {
	const source = "let a = 1;\nlet a = 2;\nlet a = 3;\n";
	const program = parseModule(source, "thrice.tsrx", { collect: true, loose: true });

	expect(duplicateBindings(program, source)).toHaveLength(2);
});

test("duplicateBindingDiagnostics renders the redeclaration as a Diagnostic", () => {
	const source = "const value = 1;\nconst value = 2;\n";
	const program = parseModule(source, "dupe.tsrx", { collect: true, loose: true });
	const [diagnostic] = duplicateBindingDiagnostics(program, source);

	expect(diagnostic).toMatchObject({
		severity: "error",
		message: "Identifier 'value' has already been declared",
		start: 23,
		end: 28,
	});
	// The original declaration first, the repeat second.
	expect(diagnostic.labels).toEqual([
		{ start: 6, end: 11 },
		{ start: 23, end: 28 },
	]);
});

test("parseModule fills a comments array that was passed without collect", () => {
	// 0.1.0 turned comment attachment on whenever this array was present but
	// only filled it under `collect` or `loose`, so this returned empty.
	const comments: Comment[] = [];
	parseModule("// kept\nexport const a = 1;\n", "commented.tsrx", { comments });

	expect(comments.map((comment) => comment.value)).toEqual([" kept"]);
});
