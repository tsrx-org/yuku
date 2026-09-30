import { expect, test } from "vitest";
import { decode, encode, generate, parse, parseModule, type Comment } from "@tsrx/yuku";

// Regression tests for the node shapes parseModule gives where yuku's decoder
// had typescript-estree's: a control-flow expression's `statementType`, flat
// loop fields, `await` and keyword spans; parentheses dropped from
// expressions; `parameters`/`typeAnnotation` on signatures; `computed` on a
// JSX member name; and abstract and `accessor` class members. Every expected
// value below is what @tsrx/core 0.5.2's parseModule returns for the same
// source, without `loc` and `metadata`. yuku adds TypeScript-ESTree fields
// core doesn't have, so each expectation is a subset match.

type Node = { type?: string; [key: string]: unknown };

// The value at `path` (`body[0].declarations[0].init`) in `root`.
const at = (root: unknown, path: string): unknown =>
	path
		.split(/[.[\]]+/)
		.filter(Boolean)
		.reduce((value, key) => (value as Record<string, unknown>)[key], root);

// [name, source, path, what core has at path]. Core also attaches a comment
// before `@else` as the expression's innerComments, which parseModule doesn't;
// that case leaves them out.
const cases: [string, string, string, unknown][] = [
	[
		"an @if expression has core's statementType",
		"const c = @if (a) {\n\t<p />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXIfExpression",
			start: 10,
			end: 28,
			test: { type: "Identifier", start: 15, end: 16, name: "a" },
			consequent: {
				type: "BlockStatement",
				start: 18,
				end: 28,
				body: [
					{
						type: "JSXElement",
						start: 21,
						end: 26,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 21,
							end: 26,
							attributes: [],
							name: { type: "JSXIdentifier", start: 22, end: 23, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternate: null,
			statementType: "IfStatement",
		},
	],
	[
		"an @if expression records its @else",
		"const c = @if (a) {\n\t<p />\n} @else {\n\t<b />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXIfExpression",
			start: 10,
			end: 45,
			test: { type: "Identifier", start: 15, end: 16, name: "a" },
			consequent: {
				type: "BlockStatement",
				start: 18,
				end: 28,
				body: [
					{
						type: "JSXElement",
						start: 21,
						end: 26,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 21,
							end: 26,
							attributes: [],
							name: { type: "JSXIdentifier", start: 22, end: 23, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternate: {
				type: "BlockStatement",
				start: 35,
				end: 45,
				body: [
					{
						type: "JSXElement",
						start: 38,
						end: 43,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 38,
							end: 43,
							attributes: [],
							name: { type: "JSXIdentifier", start: 39, end: 40, name: "b" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternateKeyword: { start: 29, end: 34 },
			statementType: "IfStatement",
		},
	],
	[
		"an @if expression on the right of ||",
		"const c = 'L' || @if (a) {\n\t<p />\n};",
		"body[0].declarations[0].init",
		{
			type: "LogicalExpression",
			start: 10,
			end: 35,
			left: { type: "Literal", start: 10, end: 13, value: "L", raw: "'L'" },
			operator: "||",
			right: {
				type: "JSXIfExpression",
				start: 17,
				end: 35,
				test: { type: "Identifier", start: 22, end: 23, name: "a" },
				consequent: {
					type: "BlockStatement",
					start: 25,
					end: 35,
					body: [
						{
							type: "JSXElement",
							start: 28,
							end: 33,
							children: [],
							openingElement: {
								type: "JSXOpeningElement",
								start: 28,
								end: 33,
								attributes: [],
								name: { type: "JSXIdentifier", start: 29, end: 30, name: "p" },
								selfClosing: true,
							},
							closingElement: null,
						},
					],
				},
				alternate: null,
				statementType: "IfStatement",
			},
		},
	],
	[
		"an @if expression as a conditional test",
		"const c = @if (a) {\n\t<p />\n} ? 1 : 2;",
		"body[0].declarations[0].init",
		{
			type: "ConditionalExpression",
			start: 10,
			end: 36,
			test: {
				type: "JSXIfExpression",
				start: 10,
				end: 28,
				test: { type: "Identifier", start: 15, end: 16, name: "a" },
				consequent: {
					type: "BlockStatement",
					start: 18,
					end: 28,
					body: [
						{
							type: "JSXElement",
							start: 21,
							end: 26,
							children: [],
							openingElement: {
								type: "JSXOpeningElement",
								start: 21,
								end: 26,
								attributes: [],
								name: { type: "JSXIdentifier", start: 22, end: 23, name: "p" },
								selfClosing: true,
							},
							closingElement: null,
						},
					],
				},
				alternate: null,
				statementType: "IfStatement",
			},
			consequent: { type: "Literal", start: 31, end: 32, value: 1, raw: "1" },
			alternate: { type: "Literal", start: 35, end: 36, value: 2, raw: "2" },
		},
	],
	[
		"a @for expression has the loop's fields and await",
		"const c = @for (const x of xs) {\n\t<p />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXForExpression",
			start: 10,
			end: 41,
			await: false,
			left: {
				type: "VariableDeclaration",
				start: 16,
				end: 23,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 22,
						end: 23,
						id: { type: "Identifier", start: 22, end: 23, name: "x" },
						init: null,
					},
				],
				kind: "const",
			},
			right: { type: "Identifier", start: 27, end: 29, name: "xs" },
			index: null,
			body: {
				type: "BlockStatement",
				start: 31,
				end: 41,
				body: [
					{
						type: "JSXElement",
						start: 34,
						end: 39,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 34,
							end: 39,
							attributes: [],
							name: { type: "JSXIdentifier", start: 35, end: 36, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			statementType: "ForOfStatement",
			empty: null,
		},
	],
	[
		"a @for expression with index, key and @empty",
		"const c = @for (const x of xs; index i; key x) {\n\t<p />\n} @empty {\n\t<b />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXForExpression",
			start: 10,
			end: 75,
			await: false,
			left: {
				type: "VariableDeclaration",
				start: 16,
				end: 23,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 22,
						end: 23,
						id: { type: "Identifier", start: 22, end: 23, name: "x" },
						init: null,
					},
				],
				kind: "const",
			},
			right: { type: "Identifier", start: 27, end: 29, name: "xs" },
			index: { type: "Identifier", start: 37, end: 38, name: "i" },
			key: { type: "Identifier", start: 44, end: 45, name: "x" },
			body: {
				type: "BlockStatement",
				start: 47,
				end: 57,
				body: [
					{
						type: "JSXElement",
						start: 50,
						end: 55,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 50,
							end: 55,
							attributes: [],
							name: { type: "JSXIdentifier", start: 51, end: 52, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			statementType: "ForOfStatement",
			empty: {
				type: "BlockStatement",
				start: 65,
				end: 75,
				body: [
					{
						type: "JSXElement",
						start: 68,
						end: 73,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 68,
							end: 73,
							attributes: [],
							name: { type: "JSXIdentifier", start: 69, end: 70, name: "b" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			emptyKeyword: { start: 58, end: 64 },
		},
	],
	[
		"a @for await expression",
		"async function f() {\n\tconst c = @for await (const x of xs) {\n\t\t<p />\n\t};\n}",
		"body[0].body.body[0].declarations[0].init",
		{
			type: "JSXForExpression",
			start: 32,
			end: 71,
			await: true,
			left: {
				type: "VariableDeclaration",
				start: 44,
				end: 51,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 50,
						end: 51,
						id: { type: "Identifier", start: 50, end: 51, name: "x" },
						init: null,
					},
				],
				kind: "const",
			},
			right: { type: "Identifier", start: 55, end: 57, name: "xs" },
			index: null,
			body: {
				type: "BlockStatement",
				start: 59,
				end: 71,
				body: [
					{
						type: "JSXElement",
						start: 63,
						end: 68,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 63,
							end: 68,
							attributes: [],
							name: { type: "JSXIdentifier", start: 64, end: 65, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			statementType: "ForOfStatement",
			empty: null,
		},
	],
	[
		"a @for...in expression",
		"const c = @for (const k in obj) {\n\t<p>{(k)}</p>\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXForExpression",
			start: 10,
			end: 49,
			left: {
				type: "VariableDeclaration",
				start: 16,
				end: 23,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 22,
						end: 23,
						id: { type: "Identifier", start: 22, end: 23, name: "k" },
						init: null,
					},
				],
				kind: "const",
			},
			right: { type: "Identifier", start: 27, end: 30, name: "obj" },
			body: {
				type: "BlockStatement",
				start: 32,
				end: 49,
				body: [
					{
						type: "JSXElement",
						start: 35,
						end: 47,
						children: [
							{
								type: "JSXExpressionContainer",
								start: 38,
								end: 43,
								expression: { type: "Identifier", start: 40, end: 41, name: "k" },
							},
						],
						openingElement: {
							type: "JSXOpeningElement",
							start: 35,
							end: 38,
							attributes: [],
							name: { type: "JSXIdentifier", start: 36, end: 37, name: "p" },
							selfClosing: false,
						},
						closingElement: {
							type: "JSXClosingElement",
							start: 43,
							end: 47,
							name: { type: "JSXIdentifier", start: 45, end: 46, name: "p" },
						},
					},
				],
			},
			statementType: "ForInStatement",
			empty: null,
		},
	],
	[
		"a classic @for expression",
		"const c = @for (let i = 0; i < 3; i++) {\n\t<p />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXForExpression",
			start: 10,
			end: 49,
			init: {
				type: "VariableDeclaration",
				start: 16,
				end: 25,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 20,
						end: 25,
						id: { type: "Identifier", start: 20, end: 21, name: "i" },
						init: { type: "Literal", start: 24, end: 25, value: 0, raw: "0" },
					},
				],
				kind: "let",
			},
			test: {
				type: "BinaryExpression",
				start: 27,
				end: 32,
				left: { type: "Identifier", start: 27, end: 28, name: "i" },
				operator: "<",
				right: { type: "Literal", start: 31, end: 32, value: 3, raw: "3" },
			},
			update: {
				type: "UpdateExpression",
				start: 34,
				end: 37,
				operator: "++",
				prefix: false,
				argument: { type: "Identifier", start: 34, end: 35, name: "i" },
			},
			body: {
				type: "BlockStatement",
				start: 39,
				end: 49,
				body: [
					{
						type: "JSXElement",
						start: 42,
						end: 47,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 42,
							end: 47,
							attributes: [],
							name: { type: "JSXIdentifier", start: 43, end: 44, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			statementType: "ForStatement",
			empty: null,
		},
	],
	[
		"a @for statement that renders a template",
		"export function L({ xs }) @{\n\t@for (const x of xs; key x) {\n\t\t<li />\n\t}\n}",
		"body[0].declaration.body.render",
		{
			type: "JSXForExpression",
			start: 30,
			end: 71,
			await: false,
			left: {
				type: "VariableDeclaration",
				start: 36,
				end: 43,
				declarations: [
					{
						type: "VariableDeclarator",
						start: 42,
						end: 43,
						id: { type: "Identifier", start: 42, end: 43, name: "x" },
						init: null,
					},
				],
				kind: "const",
			},
			right: { type: "Identifier", start: 47, end: 49, name: "xs" },
			key: { type: "Identifier", start: 55, end: 56, name: "x" },
			body: {
				type: "BlockStatement",
				start: 58,
				end: 71,
				body: [
					{
						type: "JSXElement",
						start: 62,
						end: 68,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 62,
							end: 68,
							attributes: [],
							name: { type: "JSXIdentifier", start: 63, end: 65, name: "li" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			statementType: "ForOfStatement",
			empty: null,
		},
	],
	[
		"a @switch expression records each arm's keyword",
		"const c = @switch (a) {\n\t@case 1: {\n\t\t<p />\n\t}\n\t@default: {\n\t\t<b />\n\t}\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXSwitchExpression",
			start: 10,
			end: 72,
			discriminant: { type: "Identifier", start: 19, end: 20, name: "a" },
			cases: [
				{
					type: "SwitchCase",
					start: 25,
					end: 46,
					consequent: [
						{
							type: "BlockStatement",
							start: 34,
							end: 46,
							body: [
								{
									type: "JSXElement",
									start: 38,
									end: 43,
									children: [],
									openingElement: {
										type: "JSXOpeningElement",
										start: 38,
										end: 43,
										attributes: [],
										name: { type: "JSXIdentifier", start: 39, end: 40, name: "p" },
										selfClosing: true,
									},
									closingElement: null,
								},
							],
						},
					],
					keyword: { start: 25, end: 30 },
					test: { type: "Literal", start: 31, end: 32, value: 1, raw: "1" },
				},
				{
					type: "SwitchCase",
					start: 48,
					end: 70,
					consequent: [
						{
							type: "BlockStatement",
							start: 58,
							end: 70,
							body: [
								{
									type: "JSXElement",
									start: 62,
									end: 67,
									children: [],
									openingElement: {
										type: "JSXOpeningElement",
										start: 62,
										end: 67,
										attributes: [],
										name: { type: "JSXIdentifier", start: 63, end: 64, name: "b" },
										selfClosing: true,
									},
									closingElement: null,
								},
							],
						},
					],
					keyword: { start: 48, end: 56 },
					test: null,
				},
			],
			statementType: "SwitchStatement",
		},
	],
	[
		"a @try expression records its @pending and @catch",
		"const c = @try {\n\t<p />\n} @pending {\n\t<b />\n} @catch (e) {\n\t<i />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXTryExpression",
			start: 10,
			end: 67,
			block: {
				type: "BlockStatement",
				start: 15,
				end: 25,
				body: [
					{
						type: "JSXElement",
						start: 18,
						end: 23,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 18,
							end: 23,
							attributes: [],
							name: { type: "JSXIdentifier", start: 19, end: 20, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			handler: {
				type: "CatchClause",
				start: 46,
				end: 67,
				param: { type: "Identifier", start: 54, end: 55, name: "e" },
				resetParam: null,
				body: {
					type: "BlockStatement",
					start: 57,
					end: 67,
					body: [
						{
							type: "JSXElement",
							start: 60,
							end: 65,
							children: [],
							openingElement: {
								type: "JSXOpeningElement",
								start: 60,
								end: 65,
								attributes: [],
								name: { type: "JSXIdentifier", start: 61, end: 62, name: "i" },
								selfClosing: true,
							},
							closingElement: null,
						},
					],
				},
			},
			pendingKeyword: { start: 26, end: 34 },
			pending: {
				type: "BlockStatement",
				start: 35,
				end: 45,
				body: [
					{
						type: "JSXElement",
						start: 38,
						end: 43,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 38,
							end: 43,
							attributes: [],
							name: { type: "JSXIdentifier", start: 39, end: 40, name: "b" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			handlerKeyword: { start: 46, end: 52 },
			finalizer: null,
			statementType: "TryStatement",
		},
	],
	[
		"a comment before @else is skipped to find the keyword",
		"const c = @if (a) {\n\t<p />\n} /* no */ @else {\n\t<b />\n};",
		"body[0].declarations[0].init",
		{
			type: "JSXIfExpression",
			start: 10,
			end: 54,
			test: { type: "Identifier", start: 15, end: 16, name: "a" },
			consequent: {
				type: "BlockStatement",
				start: 18,
				end: 28,
				body: [
					{
						type: "JSXElement",
						start: 21,
						end: 26,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 21,
							end: 26,
							attributes: [],
							name: { type: "JSXIdentifier", start: 22, end: 23, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternate: {
				type: "BlockStatement",
				start: 44,
				end: 54,
				body: [
					{
						type: "JSXElement",
						start: 47,
						end: 52,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 47,
							end: 52,
							attributes: [],
							name: { type: "JSXIdentifier", start: 48, end: 49, name: "b" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternateKeyword: { start: 38, end: 43 },
			statementType: "IfStatement",
		},
	],
	[
		"a sequence in parentheses is the sequence",
		"const c = (1, @if (a) {\n\t<p />\n});",
		"body[0].declarations[0].init",
		{
			type: "SequenceExpression",
			start: 11,
			end: 32,
			expressions: [
				{ type: "Literal", start: 11, end: 12, value: 1, raw: "1" },
				{
					type: "JSXIfExpression",
					start: 14,
					end: 32,
					test: { type: "Identifier", start: 19, end: 20, name: "a" },
					consequent: {
						type: "BlockStatement",
						start: 22,
						end: 32,
						body: [
							{
								type: "JSXElement",
								start: 25,
								end: 30,
								children: [],
								openingElement: {
									type: "JSXOpeningElement",
									start: 25,
									end: 30,
									attributes: [],
									name: { type: "JSXIdentifier", start: 26, end: 27, name: "p" },
									selfClosing: true,
								},
								closingElement: null,
							},
						],
					},
					alternate: null,
					statementType: "IfStatement",
				},
			],
		},
	],
	[
		"a control-flow expression in parentheses",
		"const c = (@if (a) {\n\t<p />\n});",
		"body[0].declarations[0].init",
		{
			type: "JSXIfExpression",
			start: 11,
			end: 29,
			test: { type: "Identifier", start: 16, end: 17, name: "a" },
			consequent: {
				type: "BlockStatement",
				start: 19,
				end: 29,
				body: [
					{
						type: "JSXElement",
						start: 22,
						end: 27,
						children: [],
						openingElement: {
							type: "JSXOpeningElement",
							start: 22,
							end: 27,
							attributes: [],
							name: { type: "JSXIdentifier", start: 23, end: 24, name: "p" },
							selfClosing: true,
						},
						closingElement: null,
					},
				],
			},
			alternate: null,
			statementType: "IfStatement",
		},
	],
	[
		"nested parentheses around an operand",
		"const d = ((a + b)) * 2;",
		"body[0].declarations[0].init",
		{
			type: "BinaryExpression",
			start: 10,
			end: 23,
			left: {
				type: "BinaryExpression",
				start: 12,
				end: 17,
				left: { type: "Identifier", start: 12, end: 13, name: "a" },
				operator: "+",
				right: { type: "Identifier", start: 16, end: 17, name: "b" },
			},
			operator: "*",
			right: { type: "Literal", start: 22, end: 23, value: 2, raw: "2" },
		},
	],
	[
		"parentheses around a JSX child expression",
		"const e = <p>{(a)}</p>;",
		"body[0].declarations[0].init",
		{
			type: "JSXElement",
			start: 10,
			end: 22,
			children: [
				{
					type: "JSXExpressionContainer",
					start: 13,
					end: 18,
					expression: { type: "Identifier", start: 15, end: 16, name: "a" },
				},
			],
			openingElement: {
				type: "JSXOpeningElement",
				start: 10,
				end: 13,
				attributes: [],
				name: { type: "JSXIdentifier", start: 11, end: 12, name: "p" },
				selfClosing: false,
			},
			closingElement: {
				type: "JSXClosingElement",
				start: 18,
				end: 22,
				name: { type: "JSXIdentifier", start: 20, end: 21, name: "p" },
			},
		},
	],
	[
		"a parenthesized type keeps its parentheses",
		"type A = (string | number)[];",
		"body[0]",
		{
			type: "TSTypeAliasDeclaration",
			start: 0,
			end: 29,
			id: { type: "Identifier", start: 5, end: 6, name: "A" },
			typeAnnotation: {
				type: "TSArrayType",
				start: 9,
				end: 28,
				elementType: {
					type: "TSParenthesizedType",
					start: 9,
					end: 26,
					typeAnnotation: {
						type: "TSUnionType",
						start: 10,
						end: 25,
						types: [
							{ type: "TSStringKeyword", start: 10, end: 16 },
							{ type: "TSNumberKeyword", start: 19, end: 25 },
						],
					},
				},
			},
		},
	],
	[
		"interface signatures",
		"interface I {\n\t(a: A): R;\n\tnew (a: A): R;\n\tm(a: A): R;\n\tm2?<T>(a: T): R;\n}",
		"body[0].body.body",
		[
			{
				type: "TSCallSignatureDeclaration",
				start: 15,
				end: 25,
				parameters: [
					{
						type: "Identifier",
						start: 16,
						end: 20,
						name: "a",
						typeAnnotation: {
							type: "TSTypeAnnotation",
							start: 17,
							end: 20,
							typeAnnotation: {
								type: "TSTypeReference",
								start: 19,
								end: 20,
								typeName: { type: "Identifier", start: 19, end: 20, name: "A" },
							},
						},
					},
				],
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 21,
					end: 24,
					typeAnnotation: {
						type: "TSTypeReference",
						start: 23,
						end: 24,
						typeName: { type: "Identifier", start: 23, end: 24, name: "R" },
					},
				},
			},
			{
				type: "TSConstructSignatureDeclaration",
				start: 27,
				end: 41,
				parameters: [
					{
						type: "Identifier",
						start: 32,
						end: 36,
						name: "a",
						typeAnnotation: {
							type: "TSTypeAnnotation",
							start: 33,
							end: 36,
							typeAnnotation: {
								type: "TSTypeReference",
								start: 35,
								end: 36,
								typeName: { type: "Identifier", start: 35, end: 36, name: "A" },
							},
						},
					},
				],
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 37,
					end: 40,
					typeAnnotation: {
						type: "TSTypeReference",
						start: 39,
						end: 40,
						typeName: { type: "Identifier", start: 39, end: 40, name: "R" },
					},
				},
			},
			{
				type: "TSMethodSignature",
				start: 43,
				end: 54,
				computed: false,
				key: { type: "Identifier", start: 43, end: 44, name: "m" },
				parameters: [
					{
						type: "Identifier",
						start: 45,
						end: 49,
						name: "a",
						typeAnnotation: {
							type: "TSTypeAnnotation",
							start: 46,
							end: 49,
							typeAnnotation: {
								type: "TSTypeReference",
								start: 48,
								end: 49,
								typeName: { type: "Identifier", start: 48, end: 49, name: "A" },
							},
						},
					},
				],
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 50,
					end: 53,
					typeAnnotation: {
						type: "TSTypeReference",
						start: 52,
						end: 53,
						typeName: { type: "Identifier", start: 52, end: 53, name: "R" },
					},
				},
				kind: "method",
			},
			{
				type: "TSMethodSignature",
				start: 56,
				end: 72,
				computed: false,
				key: { type: "Identifier", start: 56, end: 58, name: "m2" },
				optional: true,
				typeParameters: {
					type: "TSTypeParameterDeclaration",
					start: 59,
					end: 62,
					params: [
						{
							type: "TSTypeParameter",
							start: 60,
							end: 61,
							name: { type: "Identifier", start: 60, end: 61, name: "T" },
						},
					],
				},
				parameters: [
					{
						type: "Identifier",
						start: 63,
						end: 67,
						name: "a",
						typeAnnotation: {
							type: "TSTypeAnnotation",
							start: 64,
							end: 67,
							typeAnnotation: {
								type: "TSTypeReference",
								start: 66,
								end: 67,
								typeName: { type: "Identifier", start: 66, end: 67, name: "T" },
							},
						},
					},
				],
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 68,
					end: 71,
					typeAnnotation: {
						type: "TSTypeReference",
						start: 70,
						end: 71,
						typeName: { type: "Identifier", start: 70, end: 71, name: "R" },
					},
				},
				kind: "method",
			},
		],
	],
	[
		"a function type",
		"type F = (a: A) => R;",
		"body[0].typeAnnotation",
		{
			type: "TSFunctionType",
			start: 9,
			end: 20,
			parameters: [
				{
					type: "Identifier",
					start: 10,
					end: 14,
					name: "a",
					typeAnnotation: {
						type: "TSTypeAnnotation",
						start: 11,
						end: 14,
						typeAnnotation: {
							type: "TSTypeReference",
							start: 13,
							end: 14,
							typeName: { type: "Identifier", start: 13, end: 14, name: "A" },
						},
					},
				},
			],
			typeAnnotation: {
				type: "TSTypeAnnotation",
				start: 16,
				end: 20,
				typeAnnotation: {
					type: "TSTypeReference",
					start: 19,
					end: 20,
					typeName: { type: "Identifier", start: 19, end: 20, name: "R" },
				},
			},
		},
	],
	[
		"a constructor type",
		"type C = abstract new (a: A) => R;",
		"body[0].typeAnnotation",
		{
			type: "TSConstructorType",
			start: 9,
			end: 33,
			abstract: true,
			parameters: [
				{
					type: "Identifier",
					start: 23,
					end: 27,
					name: "a",
					typeAnnotation: {
						type: "TSTypeAnnotation",
						start: 24,
						end: 27,
						typeAnnotation: {
							type: "TSTypeReference",
							start: 26,
							end: 27,
							typeName: { type: "Identifier", start: 26, end: 27, name: "A" },
						},
					},
				},
			],
			typeAnnotation: {
				type: "TSTypeAnnotation",
				start: 29,
				end: 33,
				typeAnnotation: {
					type: "TSTypeReference",
					start: 32,
					end: 33,
					typeName: { type: "Identifier", start: 32, end: 33, name: "R" },
				},
			},
		},
	],
	[
		"a declared function keeps params and returnType",
		"declare function d(a: A): R;",
		"body[0]",
		{
			type: "TSDeclareFunction",
			start: 0,
			end: 28,
			declare: true,
			id: { type: "Identifier", start: 17, end: 18, name: "d" },
			expression: false,
			generator: false,
			async: false,
			params: [
				{
					type: "Identifier",
					start: 19,
					end: 23,
					name: "a",
					typeAnnotation: {
						type: "TSTypeAnnotation",
						start: 20,
						end: 23,
						typeAnnotation: {
							type: "TSTypeReference",
							start: 22,
							end: 23,
							typeName: { type: "Identifier", start: 22, end: 23, name: "A" },
						},
					},
				},
			],
			returnType: {
				type: "TSTypeAnnotation",
				start: 24,
				end: 27,
				typeAnnotation: {
					type: "TSTypeReference",
					start: 26,
					end: 27,
					typeName: { type: "Identifier", start: 26, end: 27, name: "R" },
				},
			},
		},
	],
	[
		"a JSX member expression",
		"const o = <main><UI.List /></main>;",
		"body[0].declarations[0].init.children[0].openingElement.name",
		{
			type: "JSXMemberExpression",
			start: 17,
			end: 24,
			object: { type: "JSXIdentifier", start: 17, end: 19, name: "UI" },
			property: { type: "JSXIdentifier", start: 20, end: 24, name: "List" },
			computed: false,
		},
	],
	[
		"abstract and accessor class members",
		"abstract class K {\n\tabstract x(a: A): R;\n\tabstract p: number;\n\tabstract accessor q: number;\n\taccessor r = 1;\n\tm(): void;\n\tm() {}\n}",
		"body[0].body.body",
		[
			{
				type: "MethodDefinition",
				start: 20,
				end: 40,
				abstract: true,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 29, end: 30, name: "x" },
				kind: "method",
				value: {
					type: "TSDeclareMethod",
					start: 30,
					end: 40,
					id: null,
					expression: false,
					generator: false,
					async: false,
					params: [
						{
							type: "Identifier",
							start: 31,
							end: 35,
							name: "a",
							typeAnnotation: {
								type: "TSTypeAnnotation",
								start: 32,
								end: 35,
								typeAnnotation: {
									type: "TSTypeReference",
									start: 34,
									end: 35,
									typeName: { type: "Identifier", start: 34, end: 35, name: "A" },
								},
							},
						},
					],
					returnType: {
						type: "TSTypeAnnotation",
						start: 36,
						end: 39,
						typeAnnotation: {
							type: "TSTypeReference",
							start: 38,
							end: 39,
							typeName: { type: "Identifier", start: 38, end: 39, name: "R" },
						},
					},
				},
				decorators: [],
			},
			{
				type: "PropertyDefinition",
				start: 42,
				end: 61,
				abstract: true,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 51, end: 52, name: "p" },
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 52,
					end: 60,
					typeAnnotation: { type: "TSNumberKeyword", start: 54, end: 60 },
				},
				value: null,
				decorators: [],
			},
			{
				type: "PropertyDefinition",
				start: 63,
				end: 91,
				abstract: true,
				accessor: true,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 81, end: 82, name: "q" },
				typeAnnotation: {
					type: "TSTypeAnnotation",
					start: 82,
					end: 90,
					typeAnnotation: { type: "TSNumberKeyword", start: 84, end: 90 },
				},
				value: null,
				decorators: [],
			},
			{
				type: "PropertyDefinition",
				start: 93,
				end: 108,
				accessor: true,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 102, end: 103, name: "r" },
				value: { type: "Literal", start: 106, end: 107, value: 1, raw: "1" },
				decorators: [],
			},
			{
				type: "MethodDefinition",
				start: 110,
				end: 120,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 110, end: 111, name: "m" },
				kind: "method",
				value: {
					type: "TSDeclareMethod",
					start: 111,
					end: 120,
					id: null,
					expression: false,
					generator: false,
					async: false,
					params: [],
					returnType: {
						type: "TSTypeAnnotation",
						start: 113,
						end: 119,
						typeAnnotation: { type: "TSVoidKeyword", start: 115, end: 119 },
					},
				},
				decorators: [],
			},
			{
				type: "MethodDefinition",
				start: 122,
				end: 128,
				static: false,
				computed: false,
				key: { type: "Identifier", start: 122, end: 123, name: "m" },
				kind: "method",
				value: {
					type: "FunctionExpression",
					start: 123,
					end: 128,
					id: null,
					expression: false,
					generator: false,
					async: false,
					params: [],
					body: { type: "BlockStatement", start: 126, end: 128, body: [] },
				},
				decorators: [],
			},
		],
	],
];

for (const [name, source, path, expected] of cases) {
	test(`parseModule: ${name}, as @tsrx/core 0.5.2 has it`, () => {
		expect(at(parseModule(source, "App.tsrx"), path)).toMatchObject(expected as object);
	});
}

test("a control-flow expression's core fields are its enumerable children, and statement stays readable", () => {
	const source = "const c = @for (const x of xs; key x) {\n\t<p />\n};";
	const node = at(parseModule(source, "App.tsrx"), "body[0].declarations[0].init") as Node & {
		statement: Node;
	};
	expect(Object.keys(node)).toEqual(
		expect.arrayContaining(["await", "left", "right", "index", "key", "body", "statementType"]),
	);
	expect(Object.keys(node)).not.toContain("statement");
	expect(node.statement.type).toBe("ForOfStatement");
	expect(node.left).toBe(node.statement.left);
	// An edit through core's name reaches the statement the encoder reads.
	node.right = { type: "Identifier", start: 27, end: 29, name: "ys" };
	expect(node.statement.right).toBe(node.right);
	expect(generate(parseModule(source, "App.tsrx")).code).toContain("of xs");
});

test("a signature's params and returnType stay readable, unlisted", () => {
	const node = at(
		parseModule("type F = (a: A) => R;", "App.tsrx"),
		"body[0].typeAnnotation",
	) as Node;
	expect(Object.keys(node)).not.toContain("params");
	expect(Object.keys(node)).not.toContain("returnType");
	expect(node.params).toBe(node.parameters);
	expect(node.returnType).toBe(node.typeAnnotation);
});

test("preserveParens: true keeps the parentheses parseModule otherwise drops", () => {
	const program = parseModule("const c = (1, 2);", "App.tsrx", { preserveParens: true });
	expect(at(program, "body[0].declarations[0].init")).toMatchObject({
		type: "ParenthesizedExpression",
		start: 10,
		end: 16,
		expression: { type: "SequenceExpression", start: 11, end: 15 },
	});
});

test("comments on dropped parentheses move to the expression inside them", () => {
	const comments: Comment[] = [];
	const program = parseModule("let b = /* a */ (/* c */ (1 /* b */) /* e */);", "App.tsrx", {
		comments,
	});
	const init = at(program, "body[0].declarations[0].init") as Node;
	expect(init.type).toBe("Literal");
	expect((init.comments as { value: string }[]).map(({ value }) => value.trim())).toEqual([
		"a",
		"c",
		"b",
		"e",
	]);
});

test("parse keeps typescript-estree's shapes", () => {
	const { program } = parse(
		"abstract class K {\n\tabstract x(): R;\n\tm(): void;\n}\ntype F = (a: A) => R;\nconst c = (@for (const x of xs) {\n\t<p />\n});",
		{ lang: "tsx", tsrx: true },
	);
	expect(at(program, "body[0].body.body[0]")).toMatchObject({
		type: "TSAbstractMethodDefinition",
		value: { type: "TSEmptyBodyFunctionExpression" },
	});
	expect(at(program, "body[0].body.body[1].value.type")).toBe("TSEmptyBodyFunctionExpression");
	const fn = at(program, "body[1].typeAnnotation") as Node;
	expect(Object.keys(fn)).toEqual(expect.arrayContaining(["params", "returnType"]));
	expect(fn).not.toHaveProperty("parameters");
	const paren = at(program, "body[2].declarations[0].init") as Node;
	expect(paren.type).toBe("ParenthesizedExpression");
	expect(Object.keys(paren.expression as Node)).toContain("statement");
});

test("generate prints parseModule's core shapes as it prints parse's", () => {
	const sources = [
		"abstract class K {\n\tabstract x(a: A): R;\n\tabstract p: number;\n\tabstract accessor q: number;\n\taccessor r = 1;\n\tstatic accessor s;\n\tm(): void;\n\tm() {}\n}",
		"interface I {\n\t(a: A): R;\n\tnew (a: A): R;\n\tm?<T>(a: T): R;\n}\ntype F = (a: A) => R;\ntype C = abstract new () => R;",
		"const c = @for (const x of xs; key x) {\n\t<p />\n} @empty {\n\t<b />\n};\nconst d = @switch (a) {\n\t@case 1: {\n\t\t<p />\n\t}\n};\nconst e = @try {\n\t<p />\n} @pending {\n\t<b />\n} @catch (e) {\n\t<i />\n};",
		"const c = (1, @if (a) {\n\t<p />\n});\nconst d = (a + b) * 2;\nconst e = (() => {})();\nconst o = <main><UI.List /></main>;",
	];
	for (const source of sources) {
		const expected = generate(parse(source, { lang: "tsx", tsrx: true }).program).code;
		const program = parseModule(source, "App.tsrx");
		const before = JSON.stringify(program);
		expect(generate(program).code, source).toBe(expected);
		// Encoding reads the typescript-estree types back and leaves core's in place.
		expect(JSON.stringify(program), source).toBe(before);
	}
});

test("a JSON copy of parseModule's tree, which loses the unlisted fields, encodes as the tree does", () => {
	const source =
		"const c = @for (const x of xs; index i; key x) {\n\t<p />\n} @empty {\n\t<b />\n};\nconst d = @switch (a) {\n\t@case 1: {\n\t\t<p />\n\t}\n};\nconst e = @try {\n\t<p />\n} @pending {\n\t<b />\n} @catch (e) {\n\t<i />\n};\nconst f = @try {\n\t<p />\n} @pending {\n\t<b />\n};\nconst g = @for (let i = 0; i < 3; i++) {\n\t<p />\n};\nconst h = @for (const k in obj) {\n\t<p />\n};\ninterface I {\n\t(a: A): R;\n\tm?<T>(a: T): R;\n}\ntype F = (a: A) => R;\nabstract class K {\n\tabstract x(): R;\n\taccessor r = 1;\n\tm(): void;\n}";
	const program = parseModule(source, "App.tsrx");
	const copy = JSON.parse(JSON.stringify(program));
	// The decoder marks a TypeScript program with a symbol, which JSON drops too.
	const typescript = Symbol.for("yuku.estree.transfer.ts");
	Object.defineProperty(copy, typescript, Object.getOwnPropertyDescriptor(program, typescript)!);
	const before = JSON.stringify(copy);
	expect(decode(encode(copy), source).program).toEqual(decode(encode(program), source).program);
	expect(generate(copy).code).toBe(generate(program).code);
	expect(JSON.stringify(copy)).toBe(before);
});

test("a @for...in expression's index and key, which core rejects, stay walkable", () => {
	const source = "const c = @for (const k in obj; index i; key k) {\n\t<p />\n};";
	const program = parseModule(source, "App.tsrx");
	const node = at(program, "body[0].declarations[0].init") as Node & { statement: Node };
	expect(node.statementType).toBe("ForInStatement");
	expect(Object.keys(node)).toEqual(
		expect.arrayContaining(["left", "right", "index", "key", "body"]),
	);
	expect(node.index).toMatchObject({ type: "Identifier", name: "i" });
	expect(node.key).toBe(node.statement.key);
	// A JSON copy, rebuilt for the encoder, keeps them too.
	const copy = JSON.parse(JSON.stringify(program));
	const typescript = Symbol.for("yuku.estree.transfer.ts");
	Object.defineProperty(copy, typescript, Object.getOwnPropertyDescriptor(program, typescript)!);
	expect(decode(encode(copy), source).program).toEqual(decode(encode(program), source).program);
});
