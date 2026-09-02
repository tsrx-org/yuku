import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	compareOutside,
	intentionalDifference,
	lazyDestructuringDifference,
	submoduleImportDifference,
	type Parsed,
} from "../tools/fixture-oracle.ts";

const expectedDifference = {
	kind: "intentional-difference",
	fixture: "ts/dynamic-tag-outside-tsrx.tsx",
	diagnosticIndex: 0,
	path: "diagnostics[0].help",
	priorArtText: "Dynamic JSX tag names are only enabled in TSRX files",
	seamText: "JSX element names must start with a valid identifier",
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification: "Dialect-free Yuku must not contain TSRX-specific policy.",
} as const;

const expectedLazyDifference = {
	kind: "intentional-difference",
	fixture: "ts/lazy-destructuring-outside-tsrx.ts",
	diagnosticIndex: 0,
	differences: [
		{
			path: "diagnostics[0].message",
			priorArtText: "Lazy destructuring patterns are only enabled in TSRX files",
			seamText: "Unexpected token '&' in binding pattern",
		},
		{
			path: "diagnostics[0].help",
			priorArtText: "Use a .tsrx file or remove the '&' lazy-pattern marker.",
			seamText: "Expected an identifier, array pattern ([a, b]), or object pattern ({a, b}).",
		},
	],
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification:
		"Dialect-free Yuku must use the ordinary binding-pattern diagnostic and contain no TSRX-specific policy.",
} as const;

const expectedSubmoduleDifference = {
	kind: "intentional-difference",
	fixture: "ts/submodule-import-outside-tsrx.ts",
	diagnosticIndex: 0,
	differences: [
		{
			path: "diagnostics[0].message",
			priorArtText: "Identifier module specifiers require TSRX",
			seamText: "Expected module specifier, but found 'server'",
		},
		{
			path: "diagnostics[0].help",
			priorArtText: "Use a .tsrx file for submodule imports such as import { load } from server.",
			seamText: "Module specifiers must be string literals, e.g., './module.js' or 'package'",
		},
	],
	upstreamBase: "eb2adcb4c17da16e7ade1a0517192d81d469e67f",
	justification:
		"Dialect-free Yuku must require string-literal module specifiers and contain no TSRX-specific submodule policy.",
} as const;

const expectedStyleSheetDifference = {
	kind: "intentional-difference",
	fixture: "tsrx/style-element.module.tsrx",
	scannedSnapshot: "style-element.scanned.snapshot.json",
	styleSheetCount: 5,
	addedFields: ["children", "scanned"],
	upstreamBase: "bf03e146d97ae2f0c2d4c4ec90456e1e544d2760",
	justification:
		"Prior-art Yuku carries no CSS structure scanner, so its StyleSheet nodes hold only the raw stylesheet text.",
} as const;

test("matches every immutable tree and diagnostic oracle", () => {
	const build = spawnSync("zig", ["build", "test-fixtures"], {
		encoding: "utf8",
		env: {
			...process.env,
			ZIG_GLOBAL_CACHE_DIR: join(tmpdir(), "yuku-tsrx-fixtures-zig-cache"),
		},
	});
	expect(build.status, build.stderr).toBe(0);
	const reports = build.stdout.trim().split("\n");
	expect(reports).toEqual([
		JSON.stringify(expectedStyleSheetDifference),
		JSON.stringify(expectedDifference),
		JSON.stringify(expectedLazyDifference),
		JSON.stringify(expectedSubmoduleDifference),
		JSON.stringify({ kind: "intentional-difference-summary", count: 4 }),
		"Exact fixture oracle passed: 12 valid, 3 invalid, 3 dialect-off",
	]);
}, 30_000);

test("pins one fail-closed intentional difference and rejects every unlisted field", () => {
	expect(intentionalDifference).toEqual(expectedDifference);
	const priorArt: Parsed = {
		program: { type: "Program" },
		comments: [],
		diagnostics: [
			{
				severity: "error",
				message: "Expected JSX element name, but found '{'",
				start: 38,
				end: 39,
				help: expectedDifference.priorArtText,
				labels: [],
			},
		],
	};
	const seam: Parsed = {
		program: priorArt.program,
		comments: priorArt.comments,
		diagnostics: [
			{
				...priorArt.diagnostics[0],
				help: expectedDifference.seamText,
			},
		],
	};
	expect(compareOutside(expectedDifference.fixture, seam, priorArt)).toBe(intentionalDifference);
	expect(() => compareOutside("ts/another.ts", seam, priorArt)).toThrow();
	expect(() =>
		compareOutside(
			expectedDifference.fixture,
			{
				...seam,
				diagnostics: [{ ...seam.diagnostics[0], end: 40 }],
			},
			priorArt,
		),
	).toThrow();

	const source = readFileSync("tools/fixture-oracle.ts", "utf8");
	expect(source.match(/fixture: "ts\/dynamic-tag-outside-tsrx\.tsx"/g)).toHaveLength(1);
	expect(source).not.toMatch(
		/wildcard|normalize|structuredClone|\.delete\(|JSON\.parse\(JSON\.stringify/,
	);
});

test("pins the independent lazy diagnostic record and rejects non-target drift", () => {
	expect(lazyDestructuringDifference).toEqual(expectedLazyDifference);
	const priorArt: Parsed = {
		program: { type: "Program" },
		comments: [],
		diagnostics: [
			{
				severity: "error",
				message: expectedLazyDifference.differences[0].priorArtText,
				start: 46,
				end: 47,
				help: expectedLazyDifference.differences[1].priorArtText,
				labels: [],
			},
		],
	};
	const seam: Parsed = {
		program: priorArt.program,
		comments: priorArt.comments,
		diagnostics: [
			{
				severity: "error",
				message: expectedLazyDifference.differences[0].seamText,
				start: 46,
				end: 47,
				help: expectedLazyDifference.differences[1].seamText,
				labels: [],
			},
		],
	};
	expect(compareOutside(expectedLazyDifference.fixture, seam, priorArt)).toBe(
		lazyDestructuringDifference,
	);
	expect(() =>
		compareOutside(
			expectedLazyDifference.fixture,
			{
				...seam,
				diagnostics: [{ ...seam.diagnostics[0], start: 45 }],
			},
			priorArt,
		),
	).toThrow();
	expect(() => compareOutside("ts/a-third-case.ts", seam, priorArt)).toThrow();
});

test("pins the independent submodule diagnostic record and rejects fourth drift", () => {
	expect(submoduleImportDifference).toEqual(expectedSubmoduleDifference);
	const priorArt: Parsed = {
		program: { type: "Program" },
		comments: [],
		diagnostics: [
			{
				severity: "error",
				message: expectedSubmoduleDifference.differences[0].priorArtText,
				start: 21,
				end: 27,
				help: expectedSubmoduleDifference.differences[1].priorArtText,
				labels: [],
			},
		],
	};
	const seam: Parsed = {
		program: priorArt.program,
		comments: priorArt.comments,
		diagnostics: [
			{
				severity: "error",
				message: expectedSubmoduleDifference.differences[0].seamText,
				start: 21,
				end: 27,
				help: expectedSubmoduleDifference.differences[1].seamText,
				labels: [],
			},
		],
	};
	expect(compareOutside(expectedSubmoduleDifference.fixture, seam, priorArt)).toBe(
		submoduleImportDifference,
	);
	expect(() =>
		compareOutside(
			expectedSubmoduleDifference.fixture,
			{
				...seam,
				diagnostics: [{ ...seam.diagnostics[0], labels: [{ start: 21, end: 27 }] }],
			},
			priorArt,
		),
	).toThrow();
	expect(() => compareOutside("ts/a-fourth-case.ts", seam, priorArt)).toThrow();
});
