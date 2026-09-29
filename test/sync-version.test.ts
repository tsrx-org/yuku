// Releases are minor only. scripts/sync-version.ts refuses a patch version
// wherever one is being released: sync mode (after bumpp) and any run given an
// explicit --version (the publish gate). Each case runs the script against a
// copy of the version surface in a temporary directory, never this checkout.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";

const surface = [
	"scripts/sync-version.ts",
	"package.json",
	"build.zig.zon",
	"npm/yuku/package.json",
	"npm/yuku/@tsrx/yuku-darwin-arm64/package.json",
	"npm/yuku/@tsrx/yuku-linux-x64-gnu/package.json",
] as const;

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

/** A copy of the version surface, already synced to `version`. */
const surfaceAt = (version: string): string => {
	const directory = mkdtempSync(join(tmpdir(), "yuku-tsrx-sync-version-"));
	temporaryDirectories.push(directory);
	for (const file of surface) {
		mkdirSync(dirname(join(directory, file)), { recursive: true });
		copyFileSync(file, join(directory, file));
	}
	const manifest = join(directory, "package.json");
	const root = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
	root.version = version;
	writeFileSync(manifest, `${JSON.stringify(root, null, "\t")}\n`);
	const synced = run(directory, []);
	expect(synced.status, synced.stderr).toBe(0);
	return directory;
};

const run = (directory: string, args: string[]) =>
	spawnSync(process.execPath, [join(directory, "scripts/sync-version.ts"), ...args], {
		encoding: "utf8",
	});

test("a minor release passes the publish gate's check", () => {
	const directory = surfaceAt("0.5.0");
	const result = run(directory, ["--check", "--version", "0.5.0"]);
	expect(result.status, result.stderr).toBe(0);
});

test("a prerelease of a minor passes the publish gate's check", () => {
	const directory = surfaceAt("0.5.0-rc.1");
	const result = run(directory, ["--check", "--version", "0.5.0-rc.1"]);
	expect(result.status, result.stderr).toBe(0);
});

test("the publish gate's check refuses a patch version", () => {
	const directory = surfaceAt("0.5.0");
	for (const version of ["0.5.1", "0.5.1-rc.1", "1.0.12"]) {
		const result = run(directory, ["--check", "--version", version]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("releases are minor only");
	}
});

test("sync mode refuses a patch bump and rewrites nothing", () => {
	const directory = surfaceAt("0.5.0");
	const before = readFileSync(join(directory, "npm/yuku/package.json"), "utf8");
	const manifest = join(directory, "package.json");
	const root = JSON.parse(readFileSync(manifest, "utf8")) as { version: string };
	root.version = "0.5.1";
	writeFileSync(manifest, `${JSON.stringify(root, null, "\t")}\n`);

	const result = run(directory, []);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("0.5.1 is a patch release");
	expect(result.stderr).toContain("0.6.0");
	expect(readFileSync(join(directory, "npm/yuku/package.json"), "utf8")).toBe(before);
});

test("a bare --check only proves consistency, so a tree at a published patch passes", () => {
	const directory = surfaceAt("0.5.0");
	for (const file of surface.slice(1)) {
		const path = join(directory, file);
		writeFileSync(path, readFileSync(path, "utf8").replaceAll("0.5.0", "0.5.1"));
	}
	const result = run(directory, ["--check"]);
	expect(result.status, result.stderr).toBe(0);
});
