import { expect, test } from "vitest";
import { analyze, generate, parse, parseModule } from "@tsrx/yuku";

// Regression tests for shorthand attributes (tsrx-org/oxc#147, #148) and for
// class methods whose body is a `@{ }` template. Every expected value below is
// what @tsrx/core 0.5.2's parseModule returns for the same source, without
// `loc` and `metadata`. yuku adds TypeScript-ESTree fields core doesn't
// have, so each expectation is a subset match, and `shorthand` must be on
// exactly the attributes core puts it on.

type Node = { type?: string; [key: string]: unknown };
type CoreError = SyntaxError & { code?: string; pos?: number };

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

const attributes = (ast: unknown) =>
	findAll(ast, (node) => node.type === "JSXOpeningElement")[0]!.attributes as Node[];

const shorthandFlags = (list: Node[]) => list.map((node) => "shorthand" in node);

const shorthand: Record<string, [string, Node[]]> = {
	"a template": [
		"export function Link({ href }) @{\n\t<a {href} />\n}",
		[
			{
				type: "JSXAttribute",
				start: 38,
				end: 44,
				name: {
					type: "JSXIdentifier",
					start: 39,
					end: 43,
					name: "href",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 38,
					end: 44,
					expression: {
						type: "Identifier",
						start: 39,
						end: 43,
						name: "href",
					},
				},
			},
		],
	],
	"plain JSX in a function": [
		"export function link({ href }) {\n\treturn <a {href} />;\n}",
		[
			{
				type: "JSXAttribute",
				start: 44,
				end: 50,
				name: {
					type: "JSXIdentifier",
					start: 45,
					end: 49,
					name: "href",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 44,
					end: 50,
					expression: {
						type: "Identifier",
						start: 45,
						end: 49,
						name: "href",
					},
				},
			},
		],
	],
	"an arrow function's JSX": [
		"const link = (href) => <a {href} />;",
		[
			{
				type: "JSXAttribute",
				start: 26,
				end: 32,
				name: {
					type: "JSXIdentifier",
					start: 27,
					end: 31,
					name: "href",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 26,
					end: 32,
					expression: {
						type: "Identifier",
						start: 27,
						end: 31,
						name: "href",
					},
				},
			},
		],
	],
	"a template's dynamic tag": [
		"export function Heading({ tag, id }) @{\n\t<{tag} {id} />\n}",
		[
			{
				type: "JSXAttribute",
				start: 48,
				end: 52,
				name: {
					type: "JSXIdentifier",
					start: 49,
					end: 51,
					name: "id",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 48,
					end: 52,
					expression: {
						type: "Identifier",
						start: 49,
						end: 51,
						name: "id",
					},
				},
			},
		],
	],
	"a dynamic tag in plain JSX, after another attribute": [
		'export function heading({ tag, id }) {\n\treturn <{tag} class="h" {id}>{id}</{tag}>;\n}',
		[
			{
				type: "JSXAttribute",
				start: 54,
				end: 63,
				name: {
					type: "JSXIdentifier",
					start: 54,
					end: 59,
					name: "class",
				},
				value: {
					type: "Literal",
					start: 60,
					end: 63,
					value: "h",
					raw: '"h"',
				},
			},
			{
				type: "JSXAttribute",
				start: 64,
				end: 68,
				name: {
					type: "JSXIdentifier",
					start: 65,
					end: 67,
					name: "id",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 64,
					end: 68,
					expression: {
						type: "Identifier",
						start: 65,
						end: 67,
						name: "id",
					},
				},
			},
		],
	],
	"an element mixing every attribute form": [
		'const v = <a x { a } y="1" {...r} {/* c */ b} {this} />;',
		[
			{
				type: "JSXAttribute",
				start: 13,
				end: 14,
				name: {
					type: "JSXIdentifier",
					start: 13,
					end: 14,
					name: "x",
				},
				value: null,
			},
			{
				type: "JSXAttribute",
				start: 15,
				end: 20,
				name: {
					type: "JSXIdentifier",
					start: 17,
					end: 18,
					name: "a",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 15,
					end: 20,
					expression: {
						type: "Identifier",
						start: 17,
						end: 18,
						name: "a",
					},
				},
			},
			{
				type: "JSXAttribute",
				start: 21,
				end: 26,
				name: {
					type: "JSXIdentifier",
					start: 21,
					end: 22,
					name: "y",
				},
				value: {
					type: "Literal",
					start: 23,
					end: 26,
					value: "1",
					raw: '"1"',
				},
			},
			{
				type: "JSXSpreadAttribute",
				start: 27,
				end: 33,
				argument: {
					type: "Identifier",
					start: 31,
					end: 32,
					name: "r",
				},
			},
			{
				type: "JSXAttribute",
				start: 34,
				end: 45,
				name: {
					type: "JSXIdentifier",
					start: 43,
					end: 44,
					name: "b",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 34,
					end: 45,
					expression: {
						type: "Identifier",
						start: 43,
						end: 44,
						name: "b",
					},
				},
			},
			{
				type: "JSXAttribute",
				start: 46,
				end: 52,
				name: {
					type: "JSXIdentifier",
					start: 47,
					end: 51,
					name: "this",
				},
				shorthand: true,
				value: {
					type: "JSXExpressionContainer",
					start: 46,
					end: 52,
					expression: {
						type: "Identifier",
						start: 47,
						end: 51,
						name: "this",
					},
				},
			},
		],
	],
};

for (const [name, [source, expected]] of Object.entries(shorthand)) {
	test(`a shorthand attribute in ${name} is name={name}, as in core`, () => {
		const actual = attributes(parseModule(source, "App.tsrx"));
		expect(actual).toMatchObject(expected);
		expect(shorthandFlags(actual)).toEqual(shorthandFlags(expected));
	});
}

test("parse and analyze carry shorthand too, and generate prints it back", () => {
	const source = shorthand["a template"]![0];
	for (const program of [
		parse(source, { lang: "tsx" }).program,
		analyze(source, "App.tsrx").program,
	]) {
		const [attribute] = findAll(program, (node) => node.type === "JSXAttribute");
		expect(attribute).toMatchObject(shorthand["a template"]![1][0]!);
	}
	const mixed = parseModule(shorthand["an element mixing every attribute form"]![0], "App.tsrx");
	expect(generate(mixed).code).toContain('<a x {a} y="1" {...r} {b} {this} />');
	const dynamic = parseModule(shorthand["a template's dynamic tag"]![0], "App.tsrx");
	expect(generate(dynamic).code).toContain("<{tag} {id} />");
});

test("a shorthand edited into another value, or unset, prints written out", () => {
	const program = parseModule(shorthand["an element mixing every attribute form"]![0], "App.tsrx");
	const [, a, , , b] = attributes(program);
	(a as { shorthand: boolean }).shorthand = false;
	((b!.value as Node).expression as { name: string }).name = "other";
	expect(generate(program).code).toContain('<a x a={a} y="1" {...r} b={other} {this} />');
});

test("the shorthand's name resolves to the binding it names", () => {
	const result = analyze(shorthand["a template"]![0], "App.tsrx");
	const references = result.semantic.reference;
	expect(references.count).toBe(1);
	expect([references.name(0), references.start(0), references.end(0)]).toEqual(["href", 39, 43]);
	expect(result.semantic.symbol.name(references.symbolId(0))).toBe("href");
});

const malformed: [string, string, number][] = [
	["const v = <a {a.b} />;", "TS1005", 15],
	["const v = <a {} />;", "TS1012", 14],
	['const v = <a {"s"} />;', "TS1012", 14],
	["const v = <a {a />;", "TS1005", 16],
];

for (const [source, code, pos] of malformed) {
	test(`${source} is ${code} at ${pos}, as in core`, () => {
		let error: CoreError | null = null;
		try {
			parseModule(source, "App.tsrx");
		} catch (thrown) {
			error = thrown as CoreError;
		}
		expect(error?.code).toBe(code);
		expect(error?.pos).toBe(pos);
	});
}

const methods: Record<string, [string, Node]> = {
	"a method": [
		"class View {\n\trender() @{\n\t\t<div />\n\t}\n}",
		{
			type: "MethodDefinition",
			start: 14,
			end: 38,
			static: false,
			computed: false,
			key: {
				type: "Identifier",
				start: 14,
				end: 20,
				name: "render",
			},
			kind: "method",
			value: {
				type: "FunctionExpression",
				start: 20,
				end: 38,
				id: null,
				expression: false,
				generator: false,
				async: false,
				params: [],
				body: {
					type: "JSXCodeBlock",
					start: 23,
					end: 38,
					body: [],
					render: {
						type: "JSXElement",
						start: 28,
						end: 35,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 28,
							end: 35,
							attributes: [],
							name: {
								type: "JSXIdentifier",
								start: 29,
								end: 32,
								name: "div",
							},
							selfClosing: true,
						},
						closingElement: null,
					},
				},
			},
			decorators: [],
		},
	],
	"a method returning Element<'div'>": [
		"class View {\n\trender(): Element<'div'> @{\n\t\t<div />\n\t}\n}",
		{
			type: "MethodDefinition",
			start: 14,
			end: 54,
			static: false,
			computed: false,
			key: {
				type: "Identifier",
				start: 14,
				end: 20,
				name: "render",
			},
			kind: "method",
			value: {
				type: "FunctionExpression",
				start: 20,
				end: 54,
				id: null,
				expression: false,
				generator: false,
				async: false,
				params: [],
				returnType: {
					type: "TSTypeAnnotation",
					start: 22,
					end: 38,
					typeAnnotation: {
						type: "TSTypeReference",
						start: 24,
						end: 38,
						typeName: {
							type: "Identifier",
							start: 24,
							end: 31,
							name: "Element",
						},
						typeArguments: {
							type: "TSTypeParameterInstantiation",
							start: 31,
							end: 38,
							params: [
								{
									type: "TSLiteralType",
									start: 32,
									end: 37,
									literal: {
										type: "Literal",
										start: 32,
										end: 37,
										value: "div",
										raw: "'div'",
									},
								},
							],
						},
					},
				},
				body: {
					type: "JSXCodeBlock",
					start: 39,
					end: 54,
					body: [],
					render: {
						type: "JSXElement",
						start: 44,
						end: 51,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 44,
							end: 51,
							attributes: [],
							name: {
								type: "JSXIdentifier",
								start: 45,
								end: 48,
								name: "div",
							},
							selfClosing: true,
						},
						closingElement: null,
					},
				},
			},
			decorators: [],
		},
	],
	"a static method": [
		"class View {\n\tstatic render() @{\n\t\t<div />\n\t}\n}",
		{
			type: "MethodDefinition",
			start: 14,
			end: 45,
			static: true,
			computed: false,
			key: {
				type: "Identifier",
				start: 21,
				end: 27,
				name: "render",
			},
			kind: "method",
			value: {
				type: "FunctionExpression",
				start: 27,
				end: 45,
				id: null,
				expression: false,
				generator: false,
				async: false,
				params: [],
				body: {
					type: "JSXCodeBlock",
					start: 30,
					end: 45,
					body: [],
					render: {
						type: "JSXElement",
						start: 35,
						end: 42,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 35,
							end: 42,
							attributes: [],
							name: {
								type: "JSXIdentifier",
								start: 36,
								end: 39,
								name: "div",
							},
							selfClosing: true,
						},
						closingElement: null,
					},
				},
			},
			decorators: [],
		},
	],
	"a getter": [
		"class View {\n\tget view() @{\n\t\t<div />\n\t}\n}",
		{
			type: "MethodDefinition",
			start: 14,
			end: 40,
			static: false,
			computed: false,
			key: {
				type: "Identifier",
				start: 18,
				end: 22,
				name: "view",
			},
			kind: "get",
			value: {
				type: "FunctionExpression",
				start: 22,
				end: 40,
				id: null,
				expression: false,
				generator: false,
				async: false,
				params: [],
				body: {
					type: "JSXCodeBlock",
					start: 25,
					end: 40,
					body: [],
					render: {
						type: "JSXElement",
						start: 30,
						end: 37,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 30,
							end: 37,
							attributes: [],
							name: {
								type: "JSXIdentifier",
								start: 31,
								end: 34,
								name: "div",
							},
							selfClosing: true,
						},
						closingElement: null,
					},
				},
			},
			decorators: [],
		},
	],
	"a private method": [
		"class View {\n\t#render() @{\n\t\t<div />\n\t}\n}",
		{
			type: "MethodDefinition",
			start: 14,
			end: 39,
			static: false,
			computed: false,
			key: {
				type: "PrivateIdentifier",
				start: 14,
				end: 21,
				name: "render",
			},
			kind: "method",
			value: {
				type: "FunctionExpression",
				start: 21,
				end: 39,
				id: null,
				expression: false,
				generator: false,
				async: false,
				params: [],
				body: {
					type: "JSXCodeBlock",
					start: 24,
					end: 39,
					body: [],
					render: {
						type: "JSXElement",
						start: 29,
						end: 36,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 29,
							end: 36,
							attributes: [],
							name: {
								type: "JSXIdentifier",
								start: 30,
								end: 33,
								name: "div",
							},
							selfClosing: true,
						},
						closingElement: null,
					},
				},
			},
			decorators: [],
		},
	],
};

for (const [name, [source, expected]] of Object.entries(methods)) {
	test(`${name} in a class can have a template body, as in core`, () => {
		const program = parseModule(source, "App.tsrx") as unknown as {
			body: [{ body: { body: Node[] } }];
		};
		expect(program.body[0].body.body[0]).toMatchObject(expected);
		expect(generate(program as never).code).toContain("@{");
	});
}
