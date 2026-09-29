// The bump step of manual-release.yml, run as written against a throwaway
// package.json. Releases are minor only, so every choice the workflow offers
// has to land on X.Y.0 or a prerelease of one; a prerelease from a stable
// version starts the next minor instead of bumpp's default patch.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const bumpp = resolve("node_modules/.bin/bumpp");

/** The `run:` block of the named step, dedented. */
const stepScript = (workflow: string, step: string): string => {
	const lines = readFileSync(workflow, "utf8").split("\n");
	const start = lines.findIndex((line) => line.trim() === `- name: ${step}`);
	expect(start, `step "${step}" in ${workflow}`).toBeGreaterThan(-1);
	const run = lines.findIndex((line, index) => index > start && line.trim() === "run: |");
	const indent = lines[run + 1]!.match(/^ */)![0];
	const body: string[] = [];
	for (const line of lines.slice(run + 1)) {
		if (line.trim() !== "" && !line.startsWith(indent)) break;
		body.push(line.slice(indent.length));
	}
	return body.join("\n");
};

const script = stepScript(".github/workflows/manual-release.yml", "Bump the root version");
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const bump = (from: string, releaseType: string, preid = ""): string => {
	const directory = mkdtempSync(join(tmpdir(), "yuku-tsrx-manual-release-"));
	temporaryDirectories.push(directory);
	writeFileSync(join(directory, "package.json"), `${JSON.stringify({ version: from })}\n`);
	const output = join(directory, "github-output");
	writeFileSync(output, "");
	const result = spawnSync("bash", ["-c", script.replaceAll("pnpm exec bumpp", `"${bumpp}"`)], {
		cwd: directory,
		encoding: "utf8",
		env: { ...process.env, RELEASE_TYPE: releaseType, PREID: preid, GITHUB_OUTPUT: output },
	});
	expect(result.status, result.stderr).toBe(0);
	const version = /^version=(.*)$/m.exec(readFileSync(output, "utf8"))?.[1];
	expect(version).toBe(JSON.parse(readFileSync(join(directory, "package.json"), "utf8")).version);
	return version!;
};

test.each([
	["0.5.0", "minor", "", "0.6.0"],
	["0.4.1", "minor", "", "0.5.0"],
	["0.5.0", "major", "", "1.0.0"],
	["0.5.0", "prerelease", "rc", "0.6.0-rc.1"],
	["0.4.1", "prerelease", "rc", "0.5.0-rc.1"],
	["0.6.0-rc.1", "prerelease", "rc", "0.6.0-rc.2"],
	["0.6.0-rc.2", "minor", "", "0.6.0"],
])("%s %s %s -> %s", (from, releaseType, preid, expected) => {
	const version = bump(from, releaseType, preid);
	expect(version).toBe(expected);
	expect(version).toMatch(/^\d+\.\d+\.0(?:-[0-9A-Za-z.-]+)?$/);
});
