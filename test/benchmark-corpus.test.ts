import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

const pairIds = [
	"function-code-block",
	"arrow-code-block",
	"if-expression",
	"basic-for-of-expression",
	"switch-expression",
	"dynamic-tag",
] as const;
const exclusionIds = [
	"counted-for",
	"for-empty",
	"for-index",
	"for-key",
	"jsx-child-statements",
	"lazy-array-pattern",
	"lazy-object-pattern",
	"raw-style-css",
	"submodule-import",
	"try-pending-catch",
] as const;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const measurementKeySegments = new Set([
	"timestamp",
	"duration",
	"elapsed",
	"memory",
	"rss",
	"stack",
	"samples",
]);
const artifactKeys = (value: unknown): string[] => {
	if (Array.isArray(value)) return value.flatMap(artifactKeys);
	if (value === null || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, nested]) => [key, ...artifactKeys(nested)]);
};
const hasMeasurementKeySegment = (key: string): boolean =>
	key.split(/[_-]+|(?=[A-Z])/).some((segment) => measurementKeySegments.has(segment.toLowerCase()));

test("benchmark corpus artifacts retain the deterministic no-measurement contract", () => {
	expect(existsSync("benchmarks/m5-classify.ts"), "missing classifier behavior").toBe(true);
	expect(existsSync("benchmarks/m5-corpus.json"), "missing classifier output").toBe(true);

	const source = readFileSync("benchmarks/m5-classify.ts", "utf8");
	for (const forbidden of [
		"performance.now",
		"process.hrtime",
		"process.memoryUsage",
		"Date.now",
		"console.time",
	])
		expect(source).not.toContain(forbidden);
	expect(source).toContain("collect: false");
	expect(source).toContain("loose: false");

	const pairs = JSON.parse(readFileSync("benchmarks/m5-pairs.json", "utf8"));
	expect(Object.keys(pairs)).toEqual(["schema", "pairs", "exclusions"]);
	expect(pairs.schema).toBe("yuku-tsrx-m5-pairs-v1");
	expect(pairs.pairs.map(({ id }: { id: string }) => id)).toEqual(pairIds);
	expect(pairs.exclusions.map(({ id }: { id: string }) => id)).toEqual(exclusionIds);
	for (const pair of pairs.pairs) {
		expect(Object.keys(pair)).toEqual([
			"id",
			"feature",
			"render_intent",
			"equivalence_rationale",
			"assumptions",
			"tsrx",
			"tsx",
		]);
		expect(Object.keys(pair.tsrx)).toEqual(["filename", "source", "source_sha256"]);
		expect(Object.keys(pair.tsx)).toEqual(["filename", "source", "source_sha256"]);
		expect(pair.tsrx.filename).toMatch(/\.tsrx$/);
		expect(pair.tsx.filename).toMatch(/\.tsx$/);
		expect(pair.tsrx.source_sha256).toBe(sha256(pair.tsrx.source));
		expect(pair.tsx.source_sha256).toBe(sha256(pair.tsx.source));
		expect(pair.render_intent).toEqual(expect.any(Object));
		expect(pair.equivalence_rationale).toEqual(expect.any(String));
		expect(pair.assumptions.length).toBeGreaterThan(0);
	}
	for (const exclusion of pairs.exclusions) {
		expect(Object.keys(exclusion)).toEqual([
			"id",
			"construct",
			"representative_paths",
			"no_faithful_tsx_reason",
			"pair_timing_only",
		]);
		expect(exclusion.construct).toEqual(expect.any(String));
		expect(exclusion.representative_paths.accepted.length).toBeGreaterThan(0);
		expect(exclusion.representative_paths.migration).toEqual(expect.any(Array));
		expect(exclusion.no_faithful_tsx_reason).toEqual(expect.any(String));
		expect(exclusion.pair_timing_only).toBe(true);
	}

	const corpus = JSON.parse(readFileSync("benchmarks/m5-corpus.json", "utf8"));
	expect(Object.keys(corpus)).toEqual([
		"schema",
		"corpus",
		"engines",
		"identical_input",
		"files",
		"partitions",
	]);
	expect(corpus.schema).toBe("yuku-tsrx-m5-corpus-v1");
	expect(corpus.corpus.file_count).toBe(237);
	expect(corpus.files).toHaveLength(237);
	expect(corpus.engines.core).toMatchObject({ valid_count: 224, invalid_count: 13 });
	expect(corpus.identical_input.core_sha256).toBe(corpus.identical_input.yuku_sha256);
	expect(corpus.identical_input.source_array_sha256_before).toBe(
		corpus.identical_input.source_array_sha256_after,
	);
	expect(corpus.identical_input.core_sha256).toBe(
		corpus.identical_input.source_array_sha256_before,
	);
	expect(corpus.identical_input.options_frozen).toBe(true);
	expect(corpus.identical_input.source_array_frozen).toBe(true);
	expect(corpus.identical_input.source_records_frozen).toBe(true);
	expect(corpus.identical_input.options).toEqual({ collect: false, loose: false });
	for (const file of corpus.files) {
		expect(Object.keys(file)).toEqual(["path", "source_sha256", "bytes", "core", "yuku"]);
		expect(file).not.toHaveProperty("source");
		expect(file.source_sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(file.bytes).toEqual(expect.any(Number));
		if (!file.yuku.valid) {
			expect(file.yuku.error.start).toEqual(expect.any(Number));
			expect(file.yuku.error.end).toEqual(expect.any(Number));
			expect(file.yuku.error.message).not.toMatch(/ \(\d+:\d+\)$/);
		}
	}
	const intrinsicContractError = corpus.files.find(
		({ path }: { path: string }) =>
			path ===
			"packages/typescript-plugin/test/fixtures/completion-matrix/intrinsic-contract-errors.tsrx",
	);
	expect(intrinsicContractError?.core).toEqual({
		valid: false,
		error: expect.objectContaining({ name: "Error" }),
	});
	expect(source).toContain("type CoreCompileError = Error &");
	expect(source).toContain('error.name !== "Error"');
	expect(source).toContain('candidate.type !== "fatal"');
	expect(source).toContain("candidate.fileName !== fileName");
	for (const field of ["code", "pos", "raisedAt", "end", "loc", "fileName", "type"])
		expect(source).toContain(`Object.hasOwn(candidate, field)`);
	expect(source).toContain('engine === "core" && isCoreCompileError(error, file.path)');
	expect(Object.keys(corpus.partitions)).toEqual([
		"common_valid",
		"common_invalid",
		"core_only_valid",
		"yuku_only_valid",
	]);
	for (const partition of Object.values(corpus.partitions) as Array<Record<string, unknown>>) {
		expect(partition.count).toBe((partition.paths as string[]).length);
		expect(partition.paths_sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(partition.corpus_sha256).toMatch(/^[0-9a-f]{64}$/);
	}
	const serialized = JSON.stringify({ corpus, pairs });
	expect(serialized).not.toMatch(/\/Users\//);
	expect(artifactKeys({ corpus, pairs }).filter(hasMeasurementKeySegment)).toEqual([]);
});
