import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const artifacts = ["decode.js", "decode-analyzer.js", "encode.js"] as const;
const UPSTREAM_PATH = "npm/yuku-parser/decode.js";
const UPSTREAM_REF = "0aac786cdda22d06e8669abe198d6d1d6bd72183";
export const UPSTREAM_SHA256 = "78c9a9624749aa34785f7ff2a9289aa9eb00381b844a5eac1a847cc288213087";
export const generationSteps = [
	"gen-parser-decoder",
	"gen-analyzer-decoder",
	"gen-codegen-encoder",
	"gen-upstream-parser-decoder",
] as const;

export type GeneratedMode = "sync" | "check";

export interface ApplyGeneratedOptions {
	mode: GeneratedMode;
	generatedDirectory: string;
	targetDirectory: string;
	upstreamBytes: Uint8Array;
	expectedUpstreamHash?: string;
}

const requiredFile = (path: string, description: string): Buffer => {
	try {
		return readFileSync(path);
	} catch (error) {
		throw new Error(`${description} unavailable: ${path}: ${String(error)}`);
	}
};

export function validateUpstreamDecoder(
	generatedBytes: Uint8Array,
	upstreamBytes: Uint8Array,
	expectedHash = UPSTREAM_SHA256,
): void {
	if (!Buffer.from(generatedBytes).equals(Buffer.from(upstreamBytes))) {
		throw new Error(
			"upstream decoder output differs byte-for-byte from the pinned seam Git object",
		);
	}
	const hash = createHash("sha256").update(generatedBytes).digest("hex");
	if (hash !== expectedHash) {
		throw new Error(`upstream decoder SHA-256 differs: expected ${expectedHash}, received ${hash}`);
	}
}

export function loadUpstreamGitObject(repository: string, reference = UPSTREAM_REF): Buffer {
	const result = spawnSync("git", ["-C", repository, "show", `${reference}:${UPSTREAM_PATH}`], {
		encoding: null,
		env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error !== undefined || result.status !== 0 || result.stdout === null) {
		const detail = result.stderr === null ? "" : Buffer.from(result.stderr).toString("utf8").trim();
		throw new Error(
			`upstream Git object unavailable: ${reference}:${UPSTREAM_PATH}${detail === "" ? "" : `: ${detail}`}`,
		);
	}
	return Buffer.from(result.stdout);
}

export function applyGeneratedArtifacts(options: ApplyGeneratedOptions): void {
	const generatedArtifacts = artifacts.map((artifact) => ({
		artifact,
		bytes: requiredFile(join(options.generatedDirectory, artifact), "generated artifact"),
	}));
	const upstream = requiredFile(
		join(options.generatedDirectory, "upstream-decode.js"),
		"upstream generated artifact",
	);
	validateUpstreamDecoder(
		upstream,
		options.upstreamBytes,
		options.expectedUpstreamHash ?? UPSTREAM_SHA256,
	);

	if (options.mode === "check") {
		const drift: string[] = [];
		for (const generated of generatedArtifacts) {
			const targetPath = join(options.targetDirectory, generated.artifact);
			const target = requiredFile(targetPath, "production artifact");
			if (!generated.bytes.equals(target)) drift.push(targetPath);
		}
		if (drift.length > 0) throw new Error(`generated artifact differs: ${drift.join(", ")}`);
		return;
	}

	for (const generated of generatedArtifacts) {
		const targetPath = join(options.targetDirectory, generated.artifact);
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(join(options.generatedDirectory, generated.artifact), targetPath);
	}
}

function runGeneration(root: string): void {
	const generated = spawnSync("zig", ["build", ...generationSteps], {
		cwd: root,
		encoding: "utf8",
		env: process.env,
	});
	if (generated.status !== 0) {
		throw new Error(`generation failed:\n${generated.stdout}${generated.stderr}`);
	}
}

function parseArguments(argumentsList: string[]): { mode: GeneratedMode; outputDirectory: string } {
	const sync = argumentsList.includes("--sync");
	const check = argumentsList.includes("--check");
	const outputIndex = argumentsList.indexOf("--output-dir");
	if (
		outputIndex !== -1 &&
		(argumentsList[outputIndex + 1] === undefined ||
			argumentsList[outputIndex + 1].startsWith("--"))
	) {
		throw new Error("--output-dir requires a path");
	}
	const knownArguments = new Set(["--sync", "--check", "--output-dir"]);
	for (const [index, argument] of argumentsList.entries()) {
		if (outputIndex === index - 1) continue;
		if (!knownArguments.has(argument)) throw new Error(`unknown argument: ${argument}`);
	}
	if (sync === check) throw new Error("select exactly one of --sync or --check");
	return {
		mode: sync ? "sync" : "check",
		outputDirectory: outputIndex === -1 ? "npm/yuku" : argumentsList[outputIndex + 1],
	};
}

function main(): void {
	const root = process.cwd();
	const arguments_ = parseArguments(process.argv.slice(2));
	runGeneration(root);
	const upstreamBytes = loadUpstreamGitObject(join(root, "../yuku-minimal-seam"));
	applyGeneratedArtifacts({
		mode: arguments_.mode,
		generatedDirectory: join(root, "zig-out"),
		targetDirectory: resolve(root, arguments_.outputDirectory),
		upstreamBytes,
	});
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
