import { expect, test } from "vitest";
import {
	parseModule,
	walk,
	type CssAtrule,
	type CssRule,
	type Diagnostic,
	type JSXStyleElement,
	type StyleSheet,
} from "@tsrx/yuku";

const SCOPE = "mk-x";

const styleElements = (source: string): JSXStyleElement[] => {
	const found: JSXStyleElement[] = [];
	walk(parseModule(source, "styles.tsrx"), {
		enter(node) {
			if (node.type === "JSXStyleElement") found.push(node as unknown as JSXStyleElement);
		},
	});
	return found;
};

const sheet = (css: string): StyleSheet => {
	const elements = styleElements(`const view = <style>${css}</style>;`);
	expect(elements).toHaveLength(1);
	const sheets = elements[0].children;
	expect(sheets).toHaveLength(1);
	return sheets[0];
};

/** The byte splice the Markless compiler performs, reproduced against the record tree. */
const scope = (css: string): string => {
	const style = sheet(css);
	if (style.scanned !== true) throw new Error("stylesheet was not scanned");
	const offsets: number[] = [];
	const descend = (nodes: Array<CssRule | CssAtrule>): void => {
		for (const node of nodes) {
			if (node.type === "CssAtrule") {
				if (!node.keyframes) descend(node.block);
				continue;
			}
			for (const selector of node.prelude) offsets.push(selector.scopeInsert);
			descend(node.block);
		}
	};
	descend(style.children);
	let text = style.source;
	for (const offset of [...offsets].sort((left, right) => right - left)) {
		text = `${text.slice(0, offset)}.${SCOPE}${text.slice(offset)}`;
	}
	return text;
};

test("a pseudo-element after a pseudo-class inserts at the first colon", () => {
	expect(scope(".card:hover::before { content: 'hover'; }")).toBe(
		`.card.${SCOPE}:hover::before { content: 'hover'; }`,
	);
	expect(scope("::before { content: 'x'; }")).toBe(`.${SCOPE}::before { content: 'x'; }`);
});

test("a colon inside an attribute selector string is not a pseudo", () => {
	expect(scope('[data-when=":hover"] { color: red; }')).toBe(
		`[data-when=":hover"].${SCOPE} { color: red; }`,
	);
	expect(scope('.card[data-when=":x"]:hover { color: red; }')).toBe(
		`.card[data-when=":x"].${SCOPE}:hover { color: red; }`,
	);
});

test("a colon nested inside :is() parentheses is not the subject pseudo", () => {
	expect(scope(":is(a:hover, b:focus) { color: red; }")).toBe(
		`.${SCOPE}:is(a:hover, b:focus) { color: red; }`,
	);
	expect(scope(".card:is(a:hover) { color: red; }")).toBe(
		`.card.${SCOPE}:is(a:hover) { color: red; }`,
	);
});

test("the subject compound is the run after the last top-level combinator", () => {
	expect(scope(".card h2 { color: red; }")).toBe(`.card h2.${SCOPE} { color: red; }`);
	expect(scope(".card > h2:first-child { color: red; }")).toBe(
		`.card > h2.${SCOPE}:first-child { color: red; }`,
	);
	expect(scope(".card + h2 { color: red; }")).toBe(`.card + h2.${SCOPE} { color: red; }`);
	expect(scope(".card ~ h2 { color: red; }")).toBe(`.card ~ h2.${SCOPE} { color: red; }`);
	expect(scope("col || td { color: red; }")).toBe(`col || td.${SCOPE} { color: red; }`);
	// An earlier compound's pseudo must not win over the subject compound.
	expect(scope(".card:hover h2 { color: red; }")).toBe(`.card:hover h2.${SCOPE} { color: red; }`);
});

test("whitespace and comments before the brace or comma are not combinators", () => {
	expect(scope(".card   { color: red; }")).toBe(`.card.${SCOPE}   { color: red; }`);
	expect(scope(".card /* trailing */ { color: red; }")).toBe(
		`.card.${SCOPE} /* trailing */ { color: red; }`,
	);
	expect(scope(".card , .title { color: red; }")).toBe(
		`.card.${SCOPE} , .title.${SCOPE} { color: red; }`,
	);
	expect(scope(".card /* c */ .title { color: red; }")).toBe(
		`.card /* c */ .title.${SCOPE} { color: red; }`,
	);
});

test("each complex selector in a list gets its own insertion offset", () => {
	expect(scope(".card h2, .title { font-size: 2rem; }")).toBe(
		`.card h2.${SCOPE}, .title.${SCOPE} { font-size: 2rem; }`,
	);
	const rules = sheet(".card h2, .title { font-size: 2rem; }").children;
	expect(rules).toHaveLength(1);
	expect(rules[0].type).toBe("CssRule");
	expect((rules[0] as CssRule).prelude).toHaveLength(2);
});

test("rules nested inside @media are scoped, and the at-rule reports its name", () => {
	expect(scope("@media (min-width: 40rem) { .card > h2:first-child { font-weight: 700; } }")).toBe(
		`@media (min-width: 40rem) { .card > h2.${SCOPE}:first-child { font-weight: 700; } }`,
	);
	const children = sheet("@media (min-width: 40rem) { .card { color: red; } }").children;
	expect(children).toHaveLength(1);
	const atrule = children[0] as CssAtrule;
	expect(atrule.type).toBe("CssAtrule");
	expect(atrule.name).toBe("media");
	expect(atrule.keyframes).toBe(false);
	expect(atrule.block).toHaveLength(1);
});

test("keyframes at-rules are flagged case-insensitively and left unscoped", () => {
	const css = "@KEYFRAMES pulse { from { opacity: 0; } 50% { opacity: 1; } to { opacity: 0; } }";
	expect(scope(css)).toBe(css);
	const atrule = sheet(css).children[0] as CssAtrule;
	expect(atrule.name).toBe("KEYFRAMES");
	expect(atrule.keyframes).toBe(true);

	for (const name of ["@keyframes", "@-webkit-keyframes", "@-WEBKIT-KeyFrames"]) {
		const source = `${name} pulse { from { opacity: 0; } to { opacity: 1; } }`;
		expect(scope(source), name).toBe(source);
		expect((sheet(source).children[0] as CssAtrule).keyframes, name).toBe(true);
	}
});

test("a statement at-rule without a block is recorded and carries no children", () => {
	const children = sheet("@import url(other.css); .card { color: red; }").children;
	expect(children).toHaveLength(2);
	const atrule = children[0] as CssAtrule;
	expect(atrule.type).toBe("CssAtrule");
	expect(atrule.name).toBe("import");
	expect(atrule.block).toEqual([]);
	expect(children[1].type).toBe("CssRule");
});

test("nested rules descend through the parent rule's block", () => {
	expect(scope(".card { color: red; & h2:hover { color: blue; } }")).toBe(
		`.card.${SCOPE} { color: red; & h2.${SCOPE}:hover { color: blue; } }`,
	);
});

test("unbalanced braces leave the sheet unscanned with no diagnostic", () => {
	const errors: Diagnostic[] = [];
	const program = parseModule("const view = <style>.card { color: red;</style>;", "bail.tsrx", {
		collect: true,
		errors,
	});
	expect(errors).toEqual([]);
	expect(program.type).toBe("Program");

	const style = sheet(".card { color: red;");
	expect(style.scanned).toBe(false);
	expect(style.children).toEqual([]);
	expect(style.source).toBe(".card { color: red;");
});

test("an unterminated string leaves the sheet unscanned", () => {
	const style = sheet('.card { content: "oops; }');
	expect(style.scanned).toBe(false);
	expect(style.children).toEqual([]);
});

test("an unterminated comment leaves the sheet unscanned", () => {
	const style = sheet(".card { color: red; } /* never closed");
	expect(style.scanned).toBe(false);
	expect(style.children).toEqual([]);
});

test("an empty sheet scans successfully with no children", () => {
	const style = sheet("");
	expect(style.scanned).toBe(true);
	expect(style.children).toEqual([]);
	expect(style.source).toBe("");

	const blank = sheet("\n   /* only a comment */\n  ");
	expect(blank.scanned).toBe(true);
	expect(blank.children).toEqual([]);
});

test("a self-closing style element produces no stylesheet child at all", () => {
	const elements = styleElements("const view = <style />;");
	expect(elements).toHaveLength(1);
	expect(elements[0].children).toEqual([]);
	expect(elements[0].css).toBe("");
});

test("scopeInsert indexes StyleSheet.source directly, not the module source", () => {
	const style = sheet(".card { color: red; }");
	const rule = style.children[0] as CssRule;
	const selector = rule.prelude[0];
	expect(selector.type).toBe("CssSelector");
	expect(selector.scopeInsert).toBe(".card".length);
	// Node spans stay absolute; only scopeInsert is sheet-relative.
	expect(selector.start).toBe(style.start);
	expect(selector.end).toBe(style.start + ".card".length);
});

test("reproduces every Markless scoped-style assertion in one sheet", () => {
	const css = [
		".card { color: red; }",
		".card h2, .title { font-size: 2rem; }",
		".card:hover::before { content: 'hover'; }",
		"@media (min-width: 40rem) { .card > h2:first-child { font-weight: 700; } }",
		"@KEYFRAMES pulse { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }",
	].join("\n");
	expect(scope(css)).toBe(
		[
			`.card.${SCOPE} { color: red; }`,
			`.card h2.${SCOPE}, .title.${SCOPE} { font-size: 2rem; }`,
			`.card.${SCOPE}:hover::before { content: 'hover'; }`,
			`@media (min-width: 40rem) { .card > h2.${SCOPE}:first-child { font-weight: 700; } }`,
			"@KEYFRAMES pulse { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }",
		].join("\n"),
	);
});
