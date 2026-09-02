import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

type ParseModule = (source: string, filename: string, options: ParseOptions) => unknown;
type ParseOptions = Readonly<{ collect: false; loose: false }>;
type CoreCompileError = Error &
	Readonly<{
		code: string | undefined;
		pos: number | undefined;
		raisedAt: number | undefined;
		end: number | undefined;
		loc:
			| Readonly<{
					start: Readonly<{ line: number; column: number }>;
					end: Readonly<{ line: number; column: number }>;
			  }>
			| undefined;
		fileName: string;
		type: "fatal";
	}>;
type ParsedOutcome = Readonly<
	{ valid: true } | { valid: false; error: Readonly<Record<string, unknown>> }
>;
type SourceFile = Readonly<{
	path: string;
	source: string;
	source_sha256: string;
	bytes: number;
}>;

const coreEntry =
	"file:///Users/jacksm5pro/dev/open-source/markless-yuku-tsrx-migration/node_modules/.pnpm/@tsrx+core@0.1.32/node_modules/@tsrx/core/src/index.js";
const yukuEntry = "file:///Users/jacksm5pro/dev/open-source/yuku-tsrx/zig-out/npm/yuku/index.js";
const options: ParseOptions = Object.freeze({ collect: false, loose: false });
const expectedPairIds = [
	"function-code-block",
	"arrow-code-block",
	"if-expression",
	"basic-for-of-expression",
	"switch-expression",
	"dynamic-tag",
];
const expectedExclusionIds = [
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
];
const exclusionPatterns: Record<string, RegExp> = {
	"counted-for": /@for\s*\(\s*(?:let|var)\b/,
	"for-empty": /@empty\b/,
	"for-index": /@for\s*\([^)]*;\s*index\b/,
	"for-key": /@for\s*\([^)]*;\s*key\b/,
	"jsx-child-statements": /@\{\s*(?:const|let|var|if|for|switch|try)\b/,
	"lazy-array-pattern": /&\[/,
	"lazy-object-pattern": /&\{/,
	"raw-style-css": /<style(?:\s|>)/,
	"submodule-import": /import\s*\{[^}]*\}\s*from\s+[A-Za-z_$]/,
	"try-pending-catch": /@try\b/,
};

const fail = (message: string): never => {
	throw new Error(message);
};

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

const bytewise = (left: string, right: string): number =>
	Buffer.compare(Buffer.from(left), Buffer.from(right));

const parseArguments = (): { check: boolean; corpus: string; output: string; pairs: string } => {
	const value = (name: string): string => {
		const index = process.argv.indexOf(name);
		if (index < 0) fail(`${name} is required`);
		const argument = process.argv[index + 1];
		if (!argument || argument.startsWith("--")) fail(`${name} requires a value`);
		return argument;
	};
	const allowed = new Set(["--check", "--corpus", "--output", "--pairs"]);
	for (const argument of process.argv.slice(2)) {
		if (argument.startsWith("--") && !allowed.has(argument)) fail(`unknown option ${argument}`);
	}
	return {
		check: process.argv.includes("--check"),
		corpus: resolve(value("--corpus")),
		output: resolve(value("--output")),
		pairs: resolve(value("--pairs")),
	};
};

const trackedFiles = (corpusRoot: string): string[] => {
	const result = spawnSync("git", ["-C", corpusRoot, "ls-files", "-z", "--", "*.tsrx"], {
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) fail(`git ls-files exited with ${result.status ?? "unknown"}`);
	const paths = result.stdout.split("\0").filter(Boolean).sort(bytewise);
	if (paths.length !== 237) fail(`expected 237 tracked TSRX files, received ${paths.length}`);
	return paths;
};

const loadSources = (corpusRoot: string): ReadonlyArray<SourceFile> =>
	Object.freeze(
		trackedFiles(corpusRoot).map((relativePath) => {
			const source = readFileSync(resolve(corpusRoot, relativePath), "utf8");
			return Object.freeze({
				path: relativePath,
				source,
				source_sha256: sha256(source),
				bytes: Buffer.byteLength(source),
			});
		}),
	);

const sourceArrayHash = (files: ReadonlyArray<SourceFile>): string => {
	const hash = createHash("sha256");
	for (const file of files) hash.update(file.path).update("\0").update(file.source).update("\0");
	return hash.digest("hex");
};

const isOptionalInteger = (value: unknown): value is number | undefined =>
	value === undefined || Number.isInteger(value);

const isCoreCompileError = (error: unknown, fileName: string): error is CoreCompileError => {
	if (!(error instanceof Error) || error.name !== "Error") return false;
	const candidate = error as Error & Record<string, unknown>;
	for (const field of ["code", "pos", "raisedAt", "end", "loc", "fileName", "type"])
		if (!Object.hasOwn(candidate, field)) return false;
	if (candidate.type !== "fatal" || candidate.fileName !== fileName) return false;
	if (candidate.code !== undefined && typeof candidate.code !== "string") return false;
	if (!isOptionalInteger(candidate.pos)) return false;
	if (!isOptionalInteger(candidate.raisedAt)) return false;
	if (!isOptionalInteger(candidate.end)) return false;
	if (candidate.loc === undefined) return true;
	if (!candidate.loc || typeof candidate.loc !== "object") return false;
	const loc = candidate.loc as Record<string, unknown>;
	if (!Object.hasOwn(loc, "start") || !Object.hasOwn(loc, "end")) return false;
	for (const position of [loc.start, loc.end]) {
		if (!position || typeof position !== "object") return false;
		const point = position as Record<string, unknown>;
		if (!Object.hasOwn(point, "line") || !Object.hasOwn(point, "column")) return false;
		if (!Number.isInteger(point.line) || !Number.isInteger(point.column)) return false;
	}
	return true;
};

const normalizeError = (
	error: SyntaxError | CoreCompileError,
	engine: "core" | "yuku",
	corpusRoot: string,
): Record<string, unknown> => {
	let message = error.message.replaceAll("\r\n", "\n").replaceAll(corpusRoot, "<corpus>");
	const normalized: Record<string, unknown> = { name: error.name, message };
	const candidate = error as Error & {
		pos?: unknown;
		position?: unknown;
		loc?: unknown;
	};
	const pos = Number.isInteger(candidate.pos) ? candidate.pos : candidate.position;
	if (Number.isInteger(pos)) normalized.pos = pos;
	if (candidate.loc && typeof candidate.loc === "object") {
		const loc = candidate.loc as {
			line?: unknown;
			column?: unknown;
			start?: unknown;
			end?: unknown;
		};
		if (Number.isInteger(loc.line) && Number.isInteger(loc.column)) {
			normalized.loc = { line: loc.line, column: loc.column };
		} else if (loc.start && loc.end) {
			normalized.loc = loc;
		}
	}
	if (engine === "yuku") {
		const trailingSpan = message.match(/ \((\d+):(\d+)\)$/);
		if (!trailingSpan) fail("Yuku SyntaxError lacks a trailing numeric span");
		normalized.start = Number(trailingSpan[1]);
		normalized.end = Number(trailingSpan[2]);
		message = message.slice(0, trailingSpan.index);
		normalized.message = message;
	}
	if (JSON.stringify(normalized).includes("/Users/")) fail("normalized diagnostic leaks a root");
	return normalized;
};

const classify = (
	parseModule: ParseModule,
	file: SourceFile,
	engine: "core" | "yuku",
	corpusRoot: string,
): ParsedOutcome => {
	try {
		parseModule(file.source, file.path, options);
		return { valid: true };
	} catch (error) {
		const diagnostic =
			error instanceof SyntaxError || (engine === "core" && isCoreCompileError(error, file.path));
		if (!diagnostic) {
			fail(
				`${engine} threw ${error instanceof Error ? error.name : typeof error} for ${file.path}`,
			);
		}
		return {
			valid: false,
			error: normalizeError(error as SyntaxError | CoreCompileError, engine, corpusRoot),
		};
	}
};

const pathsHash = (paths: ReadonlyArray<string>): string => {
	const hash = createHash("sha256");
	for (const relativePath of paths) hash.update(relativePath).update("\0");
	return hash.digest("hex");
};

const partition = (paths: ReadonlyArray<string>, filesByPath: ReadonlyMap<string, SourceFile>) => {
	const hash = createHash("sha256");
	for (const relativePath of paths) {
		const file = filesByPath.get(relativePath) ?? fail(`missing loaded source ${relativePath}`);
		hash.update(relativePath).update("\0").update(file.source).update("\0");
	}
	return {
		count: paths.length,
		paths,
		paths_sha256: pathsHash(paths),
		corpus_sha256: hash.digest("hex"),
	};
};

const canonicalPairs = (
	raw: unknown,
	files: ReadonlyArray<SourceFile>,
	parseYuku: ParseModule,
): unknown => {
	if (!raw || typeof raw !== "object") fail("pair manifest must be an object");
	const manifest = structuredClone(raw) as Record<string, any>;
	if (manifest.schema !== "yuku-tsrx-m5-pairs-v1") fail("unexpected pair schema");
	if (
		JSON.stringify(manifest.pairs.map((pair: any) => pair.id)) !== JSON.stringify(expectedPairIds)
	)
		fail("pair IDs or order differ");
	if (
		JSON.stringify(manifest.exclusions.map((exclusion: any) => exclusion.id)) !==
		JSON.stringify(expectedExclusionIds)
	)
		fail("exclusion IDs or order differ");
	const pairSourcesBefore = manifest.pairs.map((pair: any) => [pair.tsrx.source, pair.tsx.source]);
	for (const pair of manifest.pairs) {
		for (const side of [pair.tsrx, pair.tsx]) {
			parseYuku(side.source, side.filename, options);
			side.source_sha256 = sha256(side.source);
		}
		if (!pair.render_intent || !pair.equivalence_rationale || pair.assumptions.length === 0)
			fail(`incomplete render intent for ${pair.id}`);
	}
	for (const exclusion of manifest.exclusions) {
		if (exclusion.pair_timing_only !== true) fail(`non-pair exclusion ${exclusion.id}`);
		const pattern = exclusionPatterns[exclusion.id] ?? fail(`missing pattern ${exclusion.id}`);
		exclusion.representative_paths.migration = files
			.filter((file) => pattern.test(file.source))
			.map((file) => file.path)
			.slice(0, 3);
	}
	const pairSourcesAfter = manifest.pairs.map((pair: any) => [pair.tsrx.source, pair.tsx.source]);
	if (JSON.stringify(pairSourcesAfter) !== JSON.stringify(pairSourcesBefore))
		fail("pair source mutated");
	return manifest;
};

const serialize = (value: unknown): string => `${JSON.stringify(value, null, "\t")}\n`;

const main = async (): Promise<void> => {
	const arguments_ = parseArguments();
	const [{ parseModule: parseCore }, { parseModule: parseYuku }] = (await Promise.all([
		import(coreEntry),
		import(yukuEntry),
	])) as Array<{ parseModule: ParseModule }>;
	if (typeof parseCore !== "function" || typeof parseYuku !== "function")
		fail("parser load failed");

	const files = loadSources(arguments_.corpus);
	if (!Object.isFrozen(options)) fail("shared parser options are mutable");
	if (!Object.isFrozen(files)) fail("shared source array is mutable");
	if (!files.every((file) => Object.isFrozen(file))) fail("shared source record is mutable");
	const optionsBefore = JSON.stringify(options);
	const inputHashBefore = sourceArrayHash(files);
	if (inputHashBefore !== "1c3b2df54720be22e60d102ae2cb27c295a700e12271e5f8e8cc7e8bf42dbd88")
		fail(`unexpected corpus hash ${inputHashBefore}`);
	const outcomes = files.map((file) => {
		const core = classify(parseCore, file, "core", arguments_.corpus);
		const yuku = classify(parseYuku, file, "yuku", arguments_.corpus);
		const coreRepeat = classify(parseCore, file, "core", arguments_.corpus);
		const yukuRepeat = classify(parseYuku, file, "yuku", arguments_.corpus);
		if (JSON.stringify(core) !== JSON.stringify(coreRepeat))
			fail(`core nondeterminism for ${file.path}`);
		if (JSON.stringify(yuku) !== JSON.stringify(yukuRepeat))
			fail(`yuku nondeterminism for ${file.path}`);
		return { ...file, core, yuku };
	});
	const inputHashAfter = sourceArrayHash(files);
	if (inputHashAfter !== inputHashBefore) fail("classification mutated the source array");
	if (JSON.stringify(options) !== optionsBefore)
		fail("classification mutated shared parser options");

	const coreValid = outcomes.filter(({ core }) => core.valid).length;
	const coreInvalid = outcomes.length - coreValid;
	if (coreValid !== 224 || coreInvalid !== 13)
		fail(`expected core 224/13, received ${coreValid}/${coreInvalid}`);
	const yukuValid = outcomes.filter(({ yuku }) => yuku.valid).length;
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const select = (predicate: (entry: (typeof outcomes)[number]) => boolean): string[] =>
		outcomes.filter(predicate).map(({ path: relativePath }) => relativePath);
	const partitions = {
		common_valid: partition(
			select(({ core, yuku }) => core.valid && yuku.valid),
			filesByPath,
		),
		common_invalid: partition(
			select(({ core, yuku }) => !core.valid && !yuku.valid),
			filesByPath,
		),
		core_only_valid: partition(
			select(({ core, yuku }) => core.valid && !yuku.valid),
			filesByPath,
		),
		yuku_only_valid: partition(
			select(({ core, yuku }) => !core.valid && yuku.valid),
			filesByPath,
		),
	};
	const corpus = {
		schema: "yuku-tsrx-m5-corpus-v1",
		corpus: {
			file_count: files.length,
			paths_sha256: pathsHash(files.map(({ path: relativePath }) => relativePath)),
			corpus_sha256: inputHashBefore,
		},
		engines: {
			core: {
				package: "@tsrx/core",
				version: "0.1.32",
				valid_count: coreValid,
				invalid_count: coreInvalid,
			},
			yuku: {
				package: "yuku-tsrx",
				version: "0.0.0",
				valid_count: yukuValid,
				invalid_count: outcomes.length - yukuValid,
			},
		},
		identical_input: {
			core_sha256: inputHashBefore,
			yuku_sha256: inputHashAfter,
			source_array_sha256_before: inputHashBefore,
			source_array_sha256_after: inputHashAfter,
			bytewise_ordered: true,
			once_loaded: true,
			options_frozen: Object.isFrozen(options),
			source_array_frozen: Object.isFrozen(files),
			source_records_frozen: files.every((file) => Object.isFrozen(file)),
			options,
		},
		files: outcomes.map(({ path, source_sha256, bytes, core, yuku }) => ({
			path,
			source_sha256,
			bytes,
			core,
			yuku,
		})),
		partitions,
	};
	const pairs = canonicalPairs(
		JSON.parse(readFileSync(arguments_.pairs, "utf8")),
		files,
		parseYuku,
	);
	const corpusBytes = serialize(corpus);
	const pairBytes = serialize(pairs);
	if (arguments_.check) {
		if (readFileSync(arguments_.output, "utf8") !== corpusBytes) fail("corpus output differs");
		if (readFileSync(arguments_.pairs, "utf8") !== pairBytes) fail("pair output differs");
		return;
	}
	writeFileSync(arguments_.pairs, pairBytes);
	writeFileSync(arguments_.output, corpusBytes);
};

await main();
