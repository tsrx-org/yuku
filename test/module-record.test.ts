import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "yuku/types";
import {
  parse,
  scanModuleRecord,
  type DynamicImport,
  type ExportEntry,
  type ModuleRecordScan,
  type ScanOptions,
  type StaticExport,
  type StaticImport,
} from "@tsrx/yuku";

type Any = Record<string, any>;

// the record as the tree `parse` builds gives it, which the scan must match field for field
function fromTree(source: string, options: ScanOptions): ModuleRecordScan {
  const { program, diagnostics } = parse(source, options);
  if (diagnostics.some((d) => d.severity === "error")) {
    return { failed: true, staticImports: [], staticExports: [], dynamicImports: [] };
  }
  const body = program.body as Any[];
  const bindings = new Map<string, { kind: string; name: string | null; specifier: string; typeOnly: boolean }>();
  const staticImports: StaticImport[] = [];
  for (const node of body) {
    if (node.type !== "ImportDeclaration" || node.importKind === "type" || node.source.type !== "Literal") continue;
    staticImports.push({
      start: node.start,
      end: node.end,
      specifier: node.source.value,
      specifierStart: node.source.start,
      specifierEnd: node.source.end,
    });
    for (const spec of node.specifiers) {
      const local = spec.local.name;
      if (bindings.has(local)) continue;
      bindings.set(local, {
        kind: spec.type,
        name: spec.type === "ImportSpecifier" ? nameOf(spec.imported) : null,
        specifier: node.source.value,
        typeOnly: spec.importKind === "type",
      });
    }
  }

  const staticExports: StaticExport[] = [];
  for (const node of body) {
    const entries: ExportEntry[] = [];
    const entry = (exported: string | null, local: string | null, imported: string | null, importedFrom: string | null) =>
      entries.push({ exported, local, imported, importedFrom });
    let braced = false;
    let specifier: string | null = null;
    if (node.type === "ExportNamedDeclaration") {
      if (node.exportKind === "type" || node.declaration?.type === "TSImportEqualsDeclaration") continue;
      if (node.declaration) {
        for (const name of declaredNames(node.declaration)) entry(name, name, null, null);
      } else {
        braced = true;
        specifier = node.source?.value ?? null;
        for (const spec of node.specifiers) {
          if (spec.exportKind === "type") continue;
          const exported = nameOf(spec.exported);
          const local = nameOf(spec.local);
          const binding = bindings.get(local);
          if (specifier !== null) entry(exported, null, local, specifier);
          else if (binding?.typeOnly) continue;
          else if (binding && binding.kind !== "ImportNamespaceSpecifier") {
            entry(exported, null, binding.name ?? "default", binding.specifier);
          } else entry(exported, local, null, null);
        }
      }
    } else if (node.type === "ExportAllDeclaration") {
      if (node.exportKind === "type") continue;
      specifier = node.source.value;
      entry(node.exported ? nameOf(node.exported) : null, null, null, specifier);
    } else if (node.type === "ExportDefaultDeclaration") {
      const declaration = node.declaration;
      if (declaration.type === "TSInterfaceDeclaration") continue;
      const named = ["FunctionDeclaration", "TSDeclareFunction", "ClassDeclaration"].includes(declaration.type);
      entry("default", named && declaration.id ? declaration.id.name : null, null, null);
    } else continue;
    staticExports.push({ start: node.start, end: node.end, braced, specifier, entries });
  }

  const dynamicImports: DynamicImport[] = [];
  walk(program, (node) => {
    if (node.type === "ImportExpression") {
      dynamicImports.push({
        start: node.start,
        end: node.end,
        argumentStart: node.source.start,
        argumentEnd: node.source.end,
      });
    }
  });
  dynamicImports.sort((a, b) => a.start - b.start);
  return { failed: false, staticImports, staticExports, dynamicImports };
}

function nameOf(node: Any): string {
  return node.type === "Literal" ? node.value : node.name;
}

function declaredNames(node: Any): string[] {
  switch (node.type) {
    case "VariableDeclaration":
      return node.declarations.flatMap((d: Any) => patternNames(d.id));
    case "FunctionDeclaration":
    case "TSDeclareFunction":
    case "ClassDeclaration":
    case "TSEnumDeclaration":
      return node.id ? [node.id.name] : [];
    case "TSModuleDeclaration":
      return node.id.type === "Identifier" ? [node.id.name] : [];
    default:
      return [];
  }
}

function patternNames(node: Any | null): string[] {
  if (node === null) return [];
  switch (node.type) {
    case "Identifier":
      return [node.name];
    case "AssignmentPattern":
      return patternNames(node.left);
    case "RestElement":
      return patternNames(node.argument);
    case "ArrayPattern":
      return node.elements.flatMap(patternNames);
    case "ObjectPattern":
      return node.properties.flatMap((p: Any) => patternNames(p.type === "RestElement" ? p : p.value));
    default:
      return [];
  }
}

function walk(node: unknown, visit: (node: Any) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (node !== null && typeof node === "object") {
    if (typeof (node as Node).type === "string") visit(node as Any);
    for (const key in node) if (key !== "comments") walk((node as Any)[key], visit);
  }
}

function expectParity(source: string, options: ScanOptions): ModuleRecordScan {
  const scanned = scanModuleRecord(source, options);
  expect(scanned).toEqual(fromTree(source, options));
  return scanned;
}

describe("scanModuleRecord", () => {
  const scan = (source: string) => expectParity(source, { path: "chunk.js" });

  test("reads static imports with their statement and quoted request spans", () => {
    expect(scan(`import a, { b } from "./m.js"; import "./side.js";`).staticImports).toEqual([
      { start: 0, end: 30, specifier: "./m.js", specifierStart: 21, specifierEnd: 29 },
      { start: 31, end: 50, specifier: "./side.js", specifierStart: 38, specifierEnd: 49 },
    ]);
  });

  test("files an exported import under the module it comes from", () => {
    const [statement] = scan(`import d, { a } from "./m.js"; import * as ns from "./n.js"; export { a as b, d, ns };`)
      .staticExports;
    expect(statement!.entries).toEqual([
      { exported: "b", local: null, imported: "a", importedFrom: "./m.js" },
      { exported: "d", local: null, imported: "default", importedFrom: "./m.js" },
      // a namespace object is a local binding of the importing module
      { exported: "ns", local: "ns", imported: null, importedFrom: null },
    ]);
  });

  test("an import after the export it feeds still counts", () => {
    expect(scan(`export { a }; import { a } from "./m.js";`).staticExports[0]!.entries).toEqual([
      { exported: "a", local: null, imported: "a", importedFrom: "./m.js" },
    ]);
  });

  test("reads re-exports, stars, defaults, and declarations", () => {
    const exports = scan(
      `export { x as y } from "./x.js"; export * from "./s.js"; export * as q from "./q.js";
export default function f() {} export const k = 1, { p, r: [s] } = o; export {} from "./e.js";`,
    ).staticExports;
    expect(exports.map(({ braced, specifier, entries }) => ({ braced, specifier, entries }))).toEqual([
      { braced: true, specifier: "./x.js", entries: [{ exported: "y", local: null, imported: "x", importedFrom: "./x.js" }] },
      { braced: false, specifier: "./s.js", entries: [{ exported: null, local: null, imported: null, importedFrom: "./s.js" }] },
      { braced: false, specifier: "./q.js", entries: [{ exported: "q", local: null, imported: null, importedFrom: "./q.js" }] },
      { braced: false, specifier: null, entries: [{ exported: "default", local: "f", imported: null, importedFrom: null }] },
      {
        braced: false,
        specifier: null,
        entries: ["k", "p", "s"].map((name) => ({ exported: name, local: name, imported: null, importedFrom: null })),
      },
      { braced: true, specifier: "./e.js", entries: [] },
    ]);
  });

  test("a parenthesized default is an expression, with no local", () => {
    expect(scan(`export default (function f() {});`).staticExports[0]!.entries[0]!.local).toBeNull();
    expect(scan(`export default class C {}`).staticExports[0]!.entries[0]!.local).toBe("C");
  });

  test("lists each dynamic import once, in source order, nested ones too", () => {
    const source = `import(import("./a.js")); x = import.meta; import.source(y); f(import(\`./b\`, { with: {} }));`;
    const spans = scan(source).dynamicImports.map((d) => [
      source.slice(d.start, d.end),
      source.slice(d.argumentStart, d.argumentEnd),
    ]);
    expect(spans).toEqual([
      ['import(import("./a.js"))', 'import("./a.js")'],
      ['import("./a.js")', '"./a.js"'],
      ["import.source(y)", "y"],
      ["import(`./b`, { with: {} })", "`./b`"],
    ]);
  });

  test("dynamic imports in rewritten cover grammar are listed once", () => {
    scan(`({ a = import("./a.js") } = o); [b = import("./b.js")] = c; (d = import("./d.js")) => d;`);
    scan(`async (e = import("./e.js")) => e; for ({ f = import("./f.js") } of g);`);
  });

  test("offsets are UTF-16 and texts are decoded as the tree decodes them", () => {
    const record = scan(
      `const é = "😀"; import { "\\u{1F600}" as smile } from "./\\u00e9.js"; export { é as "\\u{1F600}" }; import "./\\ud800"; import("./😀.js");`,
    );
    expect(record.staticImports.map((i) => i.specifier)).toEqual(["./é.js", "./\ud800"]);
    expect(record.staticExports[0]!.entries[0]).toEqual({ exported: "😀", local: "é", imported: null, importedFrom: null });
  });

  test("offsets stay UTF-16 far into a long non-ASCII source", () => {
    const filler = (n: number) => `const s${n} = "${"é😀ü".repeat(97 * n)}";\n`;
    const source = [0, 1, 2, 3].map((n) => `${filler(n)}import "./${n}.js";\nimport(\`./é${n}\`);\n`).join("");
    const record = scan(source);
    expect(record.staticImports.map((i) => source.slice(i.start, i.end))).toEqual(
      [0, 1, 2, 3].map((n) => `import "./${n}.js";`),
    );
  });

  test("type-only imports and exports are left out", () => {
    const record = expectParity(
      `import type { T } from "./t"; import { type U, v } from "./u"; export type { T }; export { type U, v };
export interface I {} export type A = 1; export declare const z: 1; export enum E { A } export namespace N {}`,
      { path: "chunk.ts" },
    );
    expect(record.staticImports.map((i) => i.specifier)).toEqual(["./u"]);
    expect(record.staticExports.flatMap((e) => e.entries.map((entry) => entry.exported))).toEqual(["v", "E", "N"]);
  });

  test("fails exactly when parse reports an error", () => {
    for (const source of ["export {", "import x from;", "a => {", "`${", "/*", "return 1;", "x = 08n;"]) {
      expect(scan(source).failed).toBe(true);
    }
    expect(expectParity("return 1;", { path: "chunk.cjs" }).failed).toBe(false);
    expect(expectParity("let a; let a;", { path: "chunk.js" }).failed).toBe(false);
    expect(expectParity("let a; let a;", { path: "chunk.js", semanticErrors: true }).failed).toBe(true);
  });

  test("reads TSRX with the dialect, as parse does", () => {
    const record = expectParity(
      `import { B } from "./b.tsrx"; export const A = () => @{ @if (x) { <B load={() => import("./c.tsrx")} /> } }`,
      { path: "a.tsrx" },
    );
    expect(record.failed).toBe(false);
    expect(record.dynamicImports).toHaveLength(1);
  });
});

for (const kind of ["pass", "fail"]) {
  const dir = new URL(`suite/${kind}/`, import.meta.url);
  test(`the scan matches the tree on every ${kind} source of the suite`, () => {
    for (const name of readdirSync(dir)) {
      const source = readFileSync(new URL(name, dir), "utf8");
      expectParity(source, { path: name });
      expectParity(source, { path: name, semanticErrors: true });
      expectParity(source, { path: name.replace(/\.tsrx$/, ".tsx") });
    }
  });
}

// MODULE_RECORD_CORPUS lists directories of more sources, such as a bundler's chunks, separated by `:`
const corpus = process.env.MODULE_RECORD_CORPUS?.split(":").filter(Boolean) ?? [];
test.skipIf(corpus.length === 0)("the scan matches the tree on every source of MODULE_RECORD_CORPUS", () => {
  let files = 0;
  let failed = 0;
  for (const root of corpus) {
    for (const path of filesUnder(root)) {
      const source = readFileSync(path, "utf8");
      if (!/\.[cm]?[jt]sx?$/.test(path)) continue;
      if (expectParity(source, { path }).failed) failed++;
      files++;
    }
  }
  console.log(`${files} sources, ${failed} failing to parse`);
}, 600_000);

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}
