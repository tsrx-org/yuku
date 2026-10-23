// node bench/module-record.ts [dir...]: ms per MB to read a module record, by each parser, over the
// sources under the directories, test/suite/pass by default. Rolldown runs when it is installed.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RUNS = 5;

const READERS: Record<string, () => Promise<((source: string, path: string) => unknown) | null>> = {
  async scanModuleRecord() {
    const { scanModuleRecord } = await import("@tsrx/yuku");
    return (source, path) => scanModuleRecord(source, { path });
  },
  async "parse, reading program"() {
    const { parse } = await import("@tsrx/yuku");
    return (source, path) => parse(source, { path }).program;
  },
  async "rolldown parseSync"() {
    const rolldown = await import("rolldown/experimental" as string).catch(() => null);
    if (rolldown === null) return null;
    // its record and errors, as a bundler reads them, without decoding `program`
    return (source, path) => {
      const { module, errors } = rolldown.parseSync(path, source);
      return [module.staticImports, module.staticExports, module.dynamicImports, errors];
    };
  },
};

const child = process.argv[2] !== undefined && process.argv[2] in READERS ? process.argv[2] : undefined;
const roots = process.argv.slice(child === undefined ? 2 : 3);
if (roots.length === 0) roots.push(fileURLToPath(new URL("../test/suite/pass/", import.meta.url)));
const files = roots.flatMap(filesUnder).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const megabytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0) / 1e6;

if (child !== undefined) {
  const read = await READERS[child]!();
  if (read === null) process.stdout.write("null");
  else {
    for (const { path, source } of files) read(source, path);
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      for (const { path, source } of files) read(source, path);
      times.push(performance.now() - start);
    }
    process.stdout.write(String(times.toSorted((a, b) => a - b)[RUNS >> 1]));
  }
} else {
  console.log(`${files.length} sources, ${megabytes.toFixed(1)} MB, median of ${RUNS} passes each`);
  const rows = Object.keys(READERS).flatMap((name) => {
    const { status, stdout } = spawnSync(process.execPath, [import.meta.filename, name, ...roots], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 1 << 20,
    });
    if (status !== 0) throw new Error(`${name} exited with ${status}`);
    if (stdout === "null") return [];
    const ms = Number(stdout);
    return [{ reader: name, "ms per pass": ms.toFixed(0), "ms per MB": (ms / megabytes).toFixed(2) }];
  });
  console.table(rows);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(tsrx|[cm]?[jt]sx?)$/.test(name) ? [path] : [];
  });
}
