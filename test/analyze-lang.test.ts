import { expect, test } from "vitest";
import { analyze, type SourceLang } from "@tsrx/yuku";

// Three probes whose acceptance differs per dialect. Read as a table:
//
//   probe                   | js | jsx | ts | tsx | dts
//   jsxElement              |  x |  ok |  x |  ok |  x
//   typeAnnotation          |  x |   x | ok |  ok | ok
//   ambientImplementation   | ok |  ok | ok |  ok |  x
//
// Every column is a distinct signature, so comparing the diagnostics a
// filename produces against the diagnostics an explicit `lang` produces
// identifies exactly which dialect the filename resolved to. The
// "distinct signature" test below keeps that property honest.
const probes = {
	jsxElement: "const view = <div />;",
	typeAnnotation: "const value: number = 1;",
	ambientImplementation: "export function run(): void {}",
} as const;

const messagesFor = (
	source: string,
	run: (source: string) => { diagnostics: { message: string }[] },
) => run(source).diagnostics.map((diagnostic) => diagnostic.message);

const signature = (run: (source: string) => { diagnostics: { message: string }[] }) =>
	Object.fromEntries(
		Object.entries(probes).map(([name, source]) => [name, messagesFor(source, run)]),
	);

const langSignature = (lang: SourceLang) => signature((source) => analyze(source, { lang }));

const ALL_LANGS: SourceLang[] = ["js", "jsx", "ts", "tsx", "dts"];

test("each dialect leaves a distinct probe signature, so the inference tests are not vacuous", () => {
	const signatures = ALL_LANGS.map((lang) => JSON.stringify(langSignature(lang)));
	expect(new Set(signatures).size).toBe(ALL_LANGS.length);
});

const filenameCases: [string, SourceLang][] = [
	["app/routes/view.tsrx", "tsx"],
	["app/routes/view.tsx", "tsx"],
	["app/routes/view.jsx", "jsx"],
	["types/public.d.ts", "dts"],
	["src/module.ts", "ts"],
	["src/module.js", "js"],
	// Unknown extensions keep falling through to the existing default.
	["src/module.mjs", "js"],
	["Makefile", "js"],
];

for (const [filename, lang] of filenameCases) {
	test(`analyze infers ${lang} from ${filename}`, () => {
		expect(signature((source) => analyze(source, filename))).toEqual(langSignature(lang));
	});
}

test("a .tsrx filename analyzes dialect constructs cleanly with no explicit lang", () => {
	const source = "const outer = 1;\nconst view = @{ const inner = outer; <p>{inner}</p> };";
	const result = analyze(source, "app/routes/view.tsrx");
	expect(result.diagnostics).toEqual([]);
	expect(result.semantic.reference.count).toBeGreaterThan(0);
});

test("an explicit options.lang wins over the filename", () => {
	const typed = "const value: number = 1;";
	expect(analyze(typed, "src/module.js", { lang: "ts" }).diagnostics).toEqual([]);
	expect(analyze(typed, "src/module.ts", { lang: "js" }).diagnostics.length).toBeGreaterThan(0);
	// The filename still decides when `lang` is present but undefined.
	expect(
		signature((source) => analyze(source, "app/routes/view.jsx", { lang: undefined })),
	).toEqual(langSignature("jsx"));
});

test("a filename carrying a query or hash suffix still infers", () => {
	const tsrx = "const view = @{ <p>hi</p> };";
	for (const filename of ["view.tsrx?raw", "view.tsrx#inline", "view.tsx?v=1#frag"]) {
		expect(analyze(tsrx, filename).diagnostics, filename).toEqual([]);
	}
	expect(signature((source) => analyze(source, "src/module.ts?worker"))).toEqual(
		langSignature("ts"),
	);
});

test("the options-only call shape from 0.1.1 keeps working", () => {
	const tsrx = "const view = @{ <p>hi</p> };";
	expect(analyze(tsrx, { lang: "tsx" }).diagnostics).toEqual([]);
	expect(analyze("const value: number = 1;", { lang: "ts" }).diagnostics).toEqual([]);
	// No filename and no lang: the parser's own default, unchanged.
	expect(signature((source) => analyze(source))).toEqual(
		signature((source) => analyze(source, {})),
	);
	// Other options still reach the analyzer untouched.
	expect(analyze("(1);", { lang: "ts", preserveParens: true }).program.body).toHaveLength(1);
});

test("filename inference works for a byte source too", () => {
	const bytes = new TextEncoder().encode("const view = @{ <p>hi</p> };");
	expect(analyze(bytes, "view.tsrx").diagnostics).toEqual([]);
});
