import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const artifacts = ["decode.js", "decode-analyzer.js", "encode.js"] as const;
const CONTROL_PATH = "npm/yuku-parser/decode.js";
const CONTROL_REF = "eb2adcb4c17da16e7ade1a0517192d81d469e67f";
export const CONTROL_SHA256 = "78c9a9624749aa34785f7ff2a9289aa9eb00381b844a5eac1a847cc288213087";
export const generationSteps = [
	"gen-parser-decoder",
	"gen-analyzer-decoder",
	"gen-codegen-encoder",
	"gen-dialect-free-parser-decoder",
] as const;

export type GeneratedMode = "sync" | "check";

export interface ApplyGeneratedOptions {
	mode: GeneratedMode;
	generatedDirectory: string;
	targetDirectory: string;
	controlBytes: Uint8Array;
	expectedControlHash?: string;
}

const requiredFile = (path: string, description: string): Buffer => {
	try {
		return readFileSync(path);
	} catch (error) {
		throw new Error(`${description} unavailable: ${path}: ${String(error)}`);
	}
};

export function validateDialectFree(
	generatedBytes: Uint8Array,
	controlBytes: Uint8Array,
	expectedHash = CONTROL_SHA256,
): void {
	if (!Buffer.from(generatedBytes).equals(Buffer.from(controlBytes))) {
		throw new Error("dialect-free output differs byte-for-byte from the exact control Git object");
	}
	const hash = createHash("sha256").update(generatedBytes).digest("hex");
	if (hash !== expectedHash) {
		throw new Error(
			`dialect-free output SHA-256 differs: expected ${expectedHash}, received ${hash}`,
		);
	}
}

export function loadControlGitObject(repository: string, reference = CONTROL_REF): Buffer {
	const result = spawnSync("git", ["-C", repository, "show", `${reference}:${CONTROL_PATH}`], {
		encoding: null,
		env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error !== undefined || result.status !== 0 || result.stdout === null) {
		const detail = result.stderr === null ? "" : Buffer.from(result.stderr).toString("utf8").trim();
		throw new Error(
			`control Git object unavailable: ${reference}:${CONTROL_PATH}${detail === "" ? "" : `: ${detail}`}`,
		);
	}
	return Buffer.from(result.stdout);
}

export function applyGeneratedArtifacts(options: ApplyGeneratedOptions): void {
	const generatedArtifacts = artifacts.map((artifact) => ({
		artifact,
		bytes: requiredFile(join(options.generatedDirectory, artifact), "generated artifact"),
	}));
	const dialectFree = requiredFile(
		join(options.generatedDirectory, "dialect-free-decode.js"),
		"dialect-free generated artifact",
	);
	validateDialectFree(
		dialectFree,
		options.controlBytes,
		options.expectedControlHash ?? CONTROL_SHA256,
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
	const controlBytes = loadControlGitObject(join(root, "../yuku"));
	applyGeneratedArtifacts({
		mode: arguments_.mode,
		generatedDirectory: join(root, "zig-out"),
		targetDirectory: resolve(root, arguments_.outputDirectory),
		controlBytes,
	});
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
