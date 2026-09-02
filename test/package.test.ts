import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("generated npm host composes the compatibility wrapper with package-relative binding", async () => {
	const packageRoot = resolve("zig-out/npm/yuku");
	const entry = pathToFileURL(resolve(packageRoot, "index.js"));
	entry.searchParams.set("self-contained", String(Date.now()));
	const module = await import(entry.href);

	expect(module.parseModule("export const value = 1;", "value.tsrx").type).toBe("Program");
	expect(module).toHaveProperty("analyze");
	expect(module).toHaveProperty("generate");
	expect(module.isEventAttribute("onClick")).toBe(true);

	const binding = readFileSync(resolve(packageRoot, "binding.js"), "utf8");
	expect(binding).not.toContain("YUKU_TSRX_BINDING");
	expect(binding).toContain("@tsrx/yuku-");

	const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
	// 0.1.0 ships exactly the two bindings that are built and exercised. The
	// twelve this used to expect were entries in a template, not packages
	// anyone had produced. Pinned to the release version, not a range, so a
	// consumer cannot resolve an addon built from different source than the
	// JavaScript that loads it.
	expect(manifest.optionalDependencies).toEqual({
		"@tsrx/yuku-darwin-arm64": manifest.version,
		"@tsrx/yuku-linux-x64-gnu": manifest.version,
	});
	expect(manifest.files).toEqual(
		expect.arrayContaining([
			"index.js",
			"index.d.ts",
			"binding.js",
			"decode.js",
			"decode-analyzer.js",
			"encode.js",
			"walk.js",
		]),
	);
});

test("generated npm host infers TSRX through query and hash suffixes", async () => {
	const entry = pathToFileURL(resolve("zig-out/npm/yuku/index.js"));
	entry.searchParams.set("query-suffixes", String(Date.now()));
	const { parseModule } = await import(entry.href);
	const source = "const view = @if (ready) { <p /> };";

	for (const filename of [
		"module.tsrx?markless-route",
		"module.tsrx?markless-resume",
		"module.tsrx?markless-symbols",
		"module.tsrx#compiled-view",
	]) {
		expect(parseModule(source, filename).type).toBe("Program");
	}

	expect(() => parseModule(source, "module.js?name=.tsrx")).toThrow(/Unexpected token '<'/);
	expect(parseModule(source, "module.js?name=.tsrx", { lang: "tsx" }).type).toBe("Program");
	expect(() => parseModule(source, "module.tsrx?markless-route", { lang: "js" })).toThrow(
		/Unexpected token '<'/,
	);
});
