import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Bench } from "tinybench";

interface Parser {
  name: string;
  color: string;
  load(): Promise<(source: string, path: string) => unknown>;
}

const RUNS = 3;
const FIXTURES = new URL("../test/suite/pass/", import.meta.url);

const PARSERS: Parser[] = [
  {
    name: "yuku-tsrx",
    color: "#FF6B35",
    async load() {
      const { parse } = await import("yuku-tsrx");
      // reading `program` builds the AST
      return (source, path) => parse(source, { path }).program;
    },
  },
  {
    name: "@tsrx/core",
    color: "#3A86FF",
    async load() {
      // @ts-expect-error @tsrx/core types itself with JSDoc in JavaScript
      const { parseModule } = await import("@tsrx/core");
      return (source, path) => parseModule(source, path);
    },
  },
];

const child = PARSERS.find((parser) => parser.name === process.argv[2]);
if (child === undefined) main();
else process.stdout.write(String(await time(child)));

function main(): void {
  const results = PARSERS.map((parser) => {
    const runs = Array.from({ length: RUNS }, () => spawn(parser));
    return { ...parser, microseconds: median(runs) };
  });
  console.table(
    results.map(({ name, microseconds }) => ({ parser: name, "per file": format(microseconds) })),
  );
  writeFileSync(new URL("chart.svg", import.meta.url), chart(results));
}

function spawn(parser: Parser): number {
  const { status, stdout } = spawnSync(process.execPath, [import.meta.filename, parser.name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${parser.name} exited with ${status}`);
  return Number(stdout);
}

async function time(parser: Parser): Promise<number> {
  const files = readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".tsrx"))
    .map((name) => ({ name, source: readFileSync(new URL(name, FIXTURES), "utf8") }));
  const parse = await parser.load();
  const bench = new Bench({ time: 5000, warmupTime: 1000 });
  bench.add(parser.name, () => {
    for (const { name, source } of files) parse(source, name);
  });
  await bench.run();
  const { result } = bench.tasks[0]!;
  if (result.state !== "completed") throw new Error(`${parser.name} did not complete`);
  return (result.latency.p50 * 1000) / files.length;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function format(microseconds: number): string {
  return `${microseconds.toFixed(1)} µs`;
}

function chart(results: (Parser & { microseconds: number })[]): string {
  const width = 640;
  const barX = 96;
  const fastest = Math.min(...results.map((result) => result.microseconds));
  const slowest = Math.max(...results.map((result) => result.microseconds));
  const rows = results.map(({ name, color, microseconds }, index) => {
    const y = index * 30;
    const middle = y + 11;
    const barEnd = barX + Math.round((microseconds / slowest) * (width - barX - 80));
    const row = [
      `<text x="${barX - 10}" y="${middle}" text-anchor="end">${name}</text>`,
      `<rect x="${barX}" y="${y}" width="${barEnd - barX}" height="22" rx="4" fill="${color}"/>`,
      `<text x="${barEnd + 8}" y="${middle}">${format(microseconds)}</text>`,
    ];
    if (microseconds !== fastest) {
      const ratio = `${(microseconds / fastest).toFixed(2)}×`;
      row.push(`<text class="ratio" x="${barEnd - 8}" y="${middle}" text-anchor="end">${ratio}</text>`);
    }
    return row.join("\n  ");
  });

  const height = results.length * 30 - 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; fill: #848d97; dominant-baseline: central; font-variant-numeric: tabular-nums }
    .ratio { font-size: 12px; fill: #fff }
  </style>
  ${rows.join("\n  ")}
</svg>
`;
}
