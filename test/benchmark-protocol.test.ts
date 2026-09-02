import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the published benchmark retains its reproducible protocol", () => {
	const runner = readFileSync("benchmarks/m6-performance.ts", "utf8");
	const child = readFileSync("benchmarks/m6-performance-child.ts", "utf8");
	for (const required of [
		'"/usr/bin/time"',
		'"-l"',
		"spawnSync(",
		"process.hrtime.bigint",
		"Object.freeze({ collect: false, loose: false })",
	]) {
		expect(`${runner}\n${child}`).toContain(required);
	}
	for (const forbidden of ["process.memoryUsage", "process.resourceUsage", "global.gc"])
		expect(`${runner}\n${child}`).not.toContain(forbidden);

	const reportText = readFileSync("benchmarks/m6-baseline.json", "utf8");
	expect(reportText).toBe(`${JSON.stringify(JSON.parse(reportText), null, 2)}\n`);
	const report = JSON.parse(reportText);
	expect(report).toMatchObject({
		schema: "yuku-tsrx-m6-baseline-v1",
		protocol: {
			warmups: 5,
			samples: 20,
			iterations: 25,
			seed: "6d362d7631",
			options: { collect: false, loose: false },
		},
		input: {
			file_count: 224,
			bytes: 214751,
			paths_sha256: "b42716fbfa16ffc7a900aa9386b3411a3f07d2ebbff4b49527e423a49b646cbb",
			corpus_sha256: "79e79d5c599e40993de029f294a7e8446598d66c7e069d4a489174adc1ab38c5",
		},
		valid: true,
	});
	for (const parser of ["yuku", "core"]) {
		expect(report.raw_samples[parser]).toHaveLength(20);
		expect(report.noise[parser].valid).toBe(true);
	}
});
