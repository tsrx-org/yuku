import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";
import {
	applyGeneratedArtifacts,
	CONTROL_SHA256,
	generationSteps,
	loadControlGitObject,
	validateDialectFree,
} from "../tools/m3-generated.ts";

const artifacts = ["decode.js", "decode-analyzer.js", "encode.js"] as const;
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const temporaryDirectory = (name: string): string => {
	const directory = mkdtempSync(join(tmpdir(), `yuku-tsrx-${name}-`));
	temporaryDirectories.push(directory);
	return directory;
};

const copyProduction = (directory: string): Map<string, Buffer> => {
	const copies = new Map<string, Buffer>();
	for (const artifact of artifacts) {
		const bytes = readFileSync(`npm/yuku/${artifact}`);
		copies.set(artifact, bytes);
		writeFileSync(join(directory, artifact), bytes);
	}
	return copies;
};

const expectCopies = (directory: string, expected: Map<string, Buffer>) => {
	for (const artifact of artifacts) {
		expect(readFileSync(join(directory, artifact))).toEqual(expected.get(artifact));
	}
};

const runCheck = (outputDirectory: string) =>
	spawnSync(
		process.execPath,
		["tools/m3-generated.ts", "--check", "--output-dir", outputDirectory],
		{
			cwd: process.cwd(),
			encoding: "utf8",
		},
	);

test("invokes all four generators and accepts exact clean temporary copies", () => {
	expect(generationSteps).toEqual([
		"gen-parser-decoder",
		"gen-analyzer-decoder",
		"gen-codegen-encoder",
		"gen-dialect-free-parser-decoder",
	]);
	const directory = temporaryDirectory("m3-generated-clean");
	const expected = copyProduction(directory);
	const result = runCheck(directory);
	expect(result.status, result.stderr).toBe(0);
	expectCopies(directory, expected);
});

test("check rejects missing and one-byte-drifted production artifacts without mutation", () => {
	const productionBefore = copyProduction(temporaryDirectory("m3-production-snapshot"));

	const missingDirectory = temporaryDirectory("m3-generated-missing");
	const missingExpected = new Map<string, Buffer>();
	for (const artifact of artifacts.slice(0, -1)) {
		const bytes = productionBefore.get(artifact)!;
		missingExpected.set(artifact, bytes);
		writeFileSync(join(missingDirectory, artifact), bytes);
	}
	const missing = runCheck(missingDirectory);
	expect(missing.status).not.toBe(0);
	for (const artifact of artifacts.slice(0, -1)) {
		expect(readFileSync(join(missingDirectory, artifact))).toEqual(missingExpected.get(artifact));
	}
	expect(() => readFileSync(join(missingDirectory, "encode.js"))).toThrow();

	const driftDirectory = temporaryDirectory("m3-generated-drift");
	const driftExpected = copyProduction(driftDirectory);
	const corruptPath = join(driftDirectory, "decode.js");
	const corrupted = readFileSync(corruptPath);
	corrupted[0] ^= 1;
	writeFileSync(corruptPath, corrupted);
	driftExpected.set("decode.js", readFileSync(corruptPath));
	const drifted = runCheck(driftDirectory);
	expect(drifted.status).not.toBe(0);
	expectCopies(driftDirectory, driftExpected);
	for (const artifact of artifacts) {
		expect(readFileSync(`npm/yuku/${artifact}`)).toEqual(productionBefore.get(artifact));
	}
});

test("dialect-free validation rejects byte drift, hash drift, and unavailable Git refs", () => {
	const control = loadControlGitObject("../yuku");
	const drifted = Buffer.from(control);
	drifted[0] ^= 1;
	expect(() => validateDialectFree(drifted, control, CONTROL_SHA256)).toThrow(/byte/);
	expect(() => validateDialectFree(control, control, "0".repeat(64))).toThrow(/SHA-256/);
	expect(() => loadControlGitObject("../yuku", "0000000000000000000000000000000000000000")).toThrow(
		/Git object/,
	);
});

test("sync validates every generated input and dialect-free control before copying targets", () => {
	const root = temporaryDirectory("m3-generated-sync");
	const generatedDirectory = join(root, "generated");
	const targetDirectory = join(root, "target");
	mkdirSync(generatedDirectory);
	mkdirSync(targetDirectory);
	const targetsBefore = copyProduction(targetDirectory);
	const generatedBefore = new Map<string, Buffer>();
	for (const artifact of artifacts) {
		const bytes = Buffer.from(`replacement:${artifact}`);
		generatedBefore.set(artifact, bytes);
		writeFileSync(join(generatedDirectory, artifact), bytes);
	}
	const control = loadControlGitObject("../yuku");
	const drifted = Buffer.from(control);
	drifted[0] ^= 1;
	writeFileSync(join(generatedDirectory, "dialect-free-decode.js"), drifted);

	expect(() =>
		applyGeneratedArtifacts({
			mode: "sync",
			generatedDirectory,
			targetDirectory,
			controlBytes: control,
		}),
	).toThrow(/byte/);
	expectCopies(targetDirectory, targetsBefore);
	expectCopies(generatedDirectory, generatedBefore);
	expect(readFileSync(join(generatedDirectory, "dialect-free-decode.js"))).toEqual(drifted);
});
