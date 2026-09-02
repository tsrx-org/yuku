import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

type ParseModule = (source: string, filename: string, options: ParseOptions) => unknown;
type ParseOptions = Readonly<{ collect: false; loose: false }>;
type Pair = Readonly<{
	id: string;
	tsrx: Readonly<{ filename: string; source: string }>;
	tsx: Readonly<{ filename: string; source: string }>;
}>;
type CorpusFile = Readonly<{ path: string; source: string }>;
type Payload =
	| Readonly<{ schema: "yuku-tsrx-m5-pair-payload-v1"; order: number[]; pairs: Pair[] }>
	| Readonly<{ schema: "yuku-tsrx-m5-corpus-payload-v1"; files: CorpusFile[] }>;

const coreEntry =
	"file:///Users/jacksm5pro/dev/open-source/markless-yuku-tsrx-migration/node_modules/.pnpm/@tsrx+core@0.1.32/node_modules/@tsrx/core/src/index.js";
const yukuEntry = "file:///Users/jacksm5pro/dev/open-source/yuku-tsrx/zig-out/npm/yuku/index.js";
const options: ParseOptions = Object.freeze({ collect: false, loose: false });

const fail = (message: string): never => {
	throw new Error(message);
};
const argument = (name: string): string => {
	const index = process.argv.indexOf(name);
	const value = process.argv[index + 1];
	if (index < 0 || !value || value.startsWith("--")) fail(`${name} requires a value`);
	return value;
};
const positiveInteger = (name: string): number => {
	const value = Number(argument(name));
	if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
	return value;
};
const duration = (run: () => void): number => {
	const start = process.hrtime.bigint();
	run();
	const elapsed = process.hrtime.bigint() - start;
	const value = Number(elapsed);
	if (!Number.isSafeInteger(value) || value <= 0) fail("invalid duration");
	return value;
};

const main = async (): Promise<void> => {
	const scenario = argument("--scenario");
	const variant = argument("--variant");
	const iterations = positiveInteger("--iterations");
	const sampleIndex = Number(argument("--sample-index"));
	if (!Number.isSafeInteger(sampleIndex)) fail("invalid sample index");
	const expectedDigest = argument("--payload-sha256");
	const payloadBytes = readFileSync(0);
	const digest = createHash("sha256").update(payloadBytes).digest("hex");
	if (digest !== expectedDigest) fail("payload digest mismatch");
	const payload = JSON.parse(payloadBytes.toString("utf8")) as Payload;
	const entry = scenario === "pairs" ? yukuEntry : variant === "core" ? coreEntry : yukuEntry;
	const imported = (await import(entry)) as { parseModule?: ParseModule };
	const parseModule = imported.parseModule;
	if (typeof parseModule !== "function") fail("parser load failed");
	if (!Object.isFrozen(options) || JSON.stringify(options) !== '{"collect":false,"loose":false}')
		fail("parser options changed");

	if (scenario === "pairs") {
		if (payload.schema !== "yuku-tsrx-m5-pair-payload-v1") fail("unexpected pair payload");
		if (variant !== "tsrx" && variant !== "tsx") fail("unexpected pair variant");
		if (
			payload.order.length !== payload.pairs.length ||
			new Set(payload.order).size !== payload.pairs.length
		)
			fail("invalid pair order");
		for (const pairIndex of payload.order) {
			const pair = payload.pairs[pairIndex] ?? fail("pair index out of range");
			const input = pair[variant];
			for (let index = 0; index < iterations; index++)
				parseModule(input.source, input.filename, options);
		}
		const features: Array<{ id: string; duration_ns: number; parses: number; bytes: number }> = [];
		for (const pairIndex of payload.order) {
			const pair = payload.pairs[pairIndex] ?? fail("pair index out of range");
			const input = pair[variant];
			const duration_ns = duration(() => {
				for (let index = 0; index < iterations; index++)
					parseModule(input.source, input.filename, options);
			});
			features.push({
				id: pair.id,
				duration_ns,
				parses: iterations,
				bytes: Buffer.byteLength(input.source) * iterations,
			});
		}
		process.stdout.write(
			`${JSON.stringify({
				schema: "yuku-tsrx-m5-child-v1",
				scenario,
				variant,
				sample_index: sampleIndex,
				features,
				aggregate: {
					duration_ns: features.reduce((sum, feature) => sum + feature.duration_ns, 0),
					parses: features.reduce((sum, feature) => sum + feature.parses, 0),
					bytes: features.reduce((sum, feature) => sum + feature.bytes, 0),
				},
			})}\n`,
		);
		return;
	}

	if (scenario !== "corpus" || payload.schema !== "yuku-tsrx-m5-corpus-payload-v1")
		fail("unexpected corpus payload");
	if (variant !== "core" && variant !== "yuku") fail("unexpected corpus variant");
	for (const file of payload.files) parseModule(file.source, file.path, options);
	const duration_ns = duration(() => {
		for (let iteration = 0; iteration < iterations; iteration++)
			for (const file of payload.files) parseModule(file.source, file.path, options);
	});
	process.stdout.write(
		`${JSON.stringify({
			schema: "yuku-tsrx-m5-child-v1",
			scenario,
			variant,
			sample_index: sampleIndex,
			aggregate: {
				duration_ns,
				parses: payload.files.length * iterations,
				bytes:
					payload.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0) * iterations,
			},
		})}\n`,
	);
};

await main();
