#!/usr/bin/env node
// Proves zig-out/wasm/yuku-tsrx.wasm is the same dialect the native addon is:
// it instantiates the module in Node and runs parse/analyze/generate through
// the checked-in generated decoders, which is the only way the browser host in
// yuku-website/assets can be trusted before a page ever loads it.
//
//   node tools/wasm-smoke.mjs            hero snippet, fixtures, invalid fixture
//   node tools/wasm-smoke.mjs --fences   every playground-eligible tsrx fence
//
// Build the module first: `zig build wasm -Doptimize=ReleaseSmall`.

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath =
  process.env.YUKU_TSRX_WASM ?? path.join(repoRoot, "zig-out", "wasm", "yuku-tsrx.wasm");
const fixtureDir = path.join(repoRoot, "test", "parser", "misc", "tsrx");
const docsDir = path.join(repoRoot, "yuku-website");
// yuku-website/goals is planning material and yuku-website/dist is generated output; neither is
// a source page a reader can click "Try in playground" from.
const docsSkip = new Set(["goals", "dist", "node_modules"]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SOURCE_TYPES = ["script", "module", "commonjs"];
const LANGS = ["js", "ts", "jsx", "tsx", "dts"];
const QUOTES = ["preserve", "double", "single"];
const COMMENT_MODES = ["none", "all", "some", "line", "block"];

function packFlags(options = {}) {
  const {
    sourceType = "module",
    lang = "js",
    preserveParens = true,
    semantic = false,
    attachComments = false,
    loose = false,
  } = options;
  const sourceTypeIndex = SOURCE_TYPES.indexOf(sourceType);
  const langIndex = LANGS.indexOf(lang);
  if (sourceTypeIndex < 0) throw new Error(`unknown sourceType ${sourceType}`);
  if (langIndex < 0) throw new Error(`unknown lang ${lang}`);
  let flags = sourceTypeIndex;
  flags |= langIndex << 2;
  if (preserveParens) flags |= 1 << 5;
  if (semantic) flags |= 1 << 6;
  if (attachComments) flags |= 1 << 7;
  if (loose) flags |= 1 << 8;
  return flags >>> 0;
}

// Same refusals as yuku-website/assets/yuku-wasm.js and npm/yuku-tsrx/index.js.
const QUOTES_SHORTEST_UNSUPPORTED =
  'yuku-tsrx generate: quotes "shortest" is not supported here; the codegen offers "preserve", "double" and "single", and minify picks the shortest quote itself';
const SOURCE_MAPS_UNSUPPORTED =
  "yuku-tsrx generate: sourceMaps is not supported here; the wasm build carries no source maps";

function packGenerateOptions(options = {}) {
  const {
    strip = false,
    minify = false,
    format = "pretty",
    comments = "some",
    indent = 2,
    sourceMaps,
  } = options;
  let { quotes = "preserve" } = options;
  if (sourceMaps) throw new TypeError(SOURCE_MAPS_UNSUPPORTED);
  if (quotes === "shortest") {
    if (!minify) throw new TypeError(QUOTES_SHORTEST_UNSUPPORTED);
    quotes = "preserve";
  }
  const quoteIndex = QUOTES.indexOf(quotes);
  const commentIndex = COMMENT_MODES.indexOf(comments);
  if (quoteIndex < 0) throw new Error(`unknown quotes ${quotes}`);
  if (commentIndex < 0) throw new Error(`unknown comments ${comments}`);
  let opts = 0;
  if (strip) opts |= 1 << 0;
  if (minify) opts |= 1 << 1;
  if (format === "compact") opts |= 1 << 2;
  opts |= quoteIndex << 3;
  opts |= commentIndex << 5;
  opts |= (indent & 0xff) << 8;
  return opts >>> 0;
}

let wasm = null;

async function instantiate() {
  const bytes = await readFile(wasmPath).catch(() => {
    throw new Error(
      `missing ${path.relative(repoRoot, wasmPath)} - run \`zig build wasm -Doptimize=ReleaseSmall\` first`,
    );
  });
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const instance = new WebAssembly.Instance(module, {});
  return { bytes, imports, exports: instance.exports };
}

// Every call may grow memory, so each view is built from a fresh buffer.
function writeSource(source) {
  const bytes = encoder.encode(source);
  const len = Math.max(bytes.length, 1);
  const ptr = wasm.exports.alloc(len);
  if (ptr === 0) throw new Error("yuku-tsrx wasm: alloc returned 0");
  new Uint8Array(wasm.exports.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len, byteLength: bytes.length };
}

function takePrefixed(ptr) {
  const header = new DataView(wasm.exports.memory.buffer);
  const len = header.getUint32(ptr, true);
  const copy = wasm.exports.memory.buffer.slice(ptr + 4, ptr + 4 + len);
  wasm.exports.free(ptr, 4 + len);
  return copy;
}

function call(name, source, flags, opts) {
  const input = writeSource(source);
  try {
    const ptr =
      opts === undefined
        ? wasm.exports[name](input.ptr, input.byteLength, flags)
        : wasm.exports[name](input.ptr, input.byteLength, flags, opts);
    if (ptr === 0) throw new Error(`yuku-tsrx wasm: ${name} returned a null pointer`);
    return takePrefixed(ptr);
  } finally {
    wasm.exports.free(input.ptr, input.len);
  }
}

let decode;
let decodeAnalyzer;

function parse(source, options) {
  const started = performance.now();
  const buffer = call("parse", source, packFlags(options));
  const ms = performance.now() - started;
  const nodeCount = new Uint32Array(buffer, 0, 1)[0];
  return { buffer, nodeCount, ms, tree: decode(buffer, source) };
}

function analyze(source, options) {
  const buffer = call("analyze", source, packFlags(options));
  return decodeAnalyzer(buffer, source);
}

function generate(source, options, generateOptions) {
  const payload = call(
    "generate",
    source,
    packFlags(options),
    packGenerateOptions(generateOptions),
  );
  const view = new DataView(payload);
  let offset = 0;
  const codeLength = view.getUint32(offset, true);
  offset += 4;
  const code = decoder.decode(new Uint8Array(payload, offset, codeLength));
  offset += codeLength;
  const errorCount = view.getUint32(offset, true);
  offset += 4;
  const errors = [];
  for (let i = 0; i < errorCount; i++) {
    const start = view.getUint32(offset, true);
    const end = view.getUint32(offset + 4, true);
    const messageLength = view.getUint32(offset + 8, true);
    offset += 12;
    const message = decoder.decode(new Uint8Array(payload, offset, messageLength));
    offset += messageLength;
    errors.push({ start, end, message });
  }
  if (offset !== payload.byteLength) {
    throw new Error(`generate payload is ${payload.byteLength} bytes but decoded ${offset}`);
  }
  return { code, errors };
}

function errorsOf(diagnostics) {
  return diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

function describe(diagnostic) {
  return `${diagnostic.severity} ${diagnostic.message} (${diagnostic.start}:${diagnostic.end})`;
}

function findNodeType(root, type) {
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (!Array.isArray(value) && value.type === type) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      if (child !== null && typeof child === "object") stack.push(child);
    }
  }
  return null;
}

function deadEmptyLoops(root, source) {
  const lengthAliases = new Map();
  const compared = new Set(["<", "<=", ">", ">=", "==", "===", "!=", "!=="]);
  const textOf = (node) => source.slice(node.start, node.end);
  const lengthTarget = (node) => {
    if (
      node?.type === "MemberExpression" &&
      !node.computed &&
      node.property?.type === "Identifier" &&
      node.property.name === "length"
    ) {
      return textOf(node.object);
    }
    return node?.type === "Identifier" ? lengthAliases.get(node.name) : undefined;
  };
  const visits = (value, visit, seen = new Set()) => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    visit(value);
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      visits(child, visit, seen);
    }
  };
  visits(root, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
    const target = lengthTarget(node.init);
    if (target) lengthAliases.set(node.id.name, target);
  });
  const testTargets = (test) => {
    if (test?.type !== "BinaryExpression" || !compared.has(test.operator)) return [];
    return [lengthTarget(test.left), lengthTarget(test.right)].filter(Boolean);
  };
  const found = [];
  const walk = (value, enclosingTests = [], seen = new Set()) => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const tests = value.type === "JSXIfExpression" ? [...enclosingTests, value.test] : enclosingTests;
    if (value.type === "JSXForExpression" && value.empty && value.statement?.right) {
      const iterable = textOf(value.statement.right);
      const test = enclosingTests.find((candidate) => testTargets(candidate).includes(iterable));
      if (test) found.push({ iterable, test: textOf(test) });
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      walk(child, tests, seen);
    }
  };
  walk(root);
  return found;
}

const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
  return condition;
}

async function collectDocs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (docsSkip.has(entry.name)) continue;
      out.push(...(await collectDocs(path.join(dir, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out.sort();
}

function extractFences(text) {
  const lines = text.split("\n");
  const fences = [];
  let i = 0;
  while (i < lines.length) {
    const opening = /^```\s*tsrx\b(.*)$/.exec(lines[i]);
    if (!opening) {
      i += 1;
      continue;
    }
    const info = opening[1].trim();
    const body = [];
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j += 1;
    }
    fences.push({ line: i + 1, info, code: body.join("\n") });
    i = j + 1;
  }
  return fences;
}

async function runFences() {
  const files = await collectDocs(docsDir);
  let checked = 0;
  let skipped = 0;
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const fence of extractFences(text)) {
      const where = `${path.relative(repoRoot, file)}:${fence.line}`;
      if (/\bno-playground\b/.test(fence.info)) {
        skipped += 1;
        continue;
      }
      if (fence.code.trim().length === 0) {
        failures.push(`${where}: empty tsrx fence`);
        continue;
      }
      checked += 1;
      let result;
      try {
        result = parse(fence.code, { lang: "tsx", sourceType: "module", semantic: true });
      } catch (error) {
        failures.push(`${where}: parse threw ${error.message}\n    ${fence.code.split("\n")[0]}`);
        continue;
      }
      const errors = errorsOf(result.tree.diagnostics);
      if (errors.length > 0) {
        failures.push(
          `${where}: ${errors.length} error diagnostic(s)\n    ${fence.code.split("\n")[0]}\n    ${errors.map(describe).join("\n    ")}`,
        );
      }
    }
  }
  console.log(
    `fences: ${checked} checked, ${skipped} marked no-playground, ${files.length} markdown files`,
  );
}

async function runSmoke() {
  const expected = ["memory", "alloc", "free", "parse", "analyze", "generate"];
  for (const name of expected) {
    check(name in wasm.exports, `missing export \`${name}\``);
  }
  if (failures.length > 0) return;

  const { heroCode } = await import(pathToFileURL(path.join(docsDir, "demo-sources.mjs")));

  const hero = parse(heroCode, { lang: "tsx", sourceType: "module", semantic: true });
  const heroErrors = errorsOf(hero.tree.diagnostics);
  check(
    heroErrors.length === 0,
    `heroCode has ${heroErrors.length} error diagnostic(s): ${heroErrors.map(describe).join("; ")}`,
  );
  check(hero.nodeCount > 0, "heroCode parsed to 0 nodes");
  const program = hero.tree.program;
  check(program.type === "Program", `heroCode program.type is ${program.type}`);
  check(program.body.length > 0, "heroCode program body is empty");
  check(
    findNodeType(program, "JSXCodeBlock") !== null,
    "heroCode program has no JSXCodeBlock node",
  );
  for (const dead of deadEmptyLoops(program, heroCode)) {
    failures.push(
      `heroCode has a dead @empty: the @for iterable \`${dead.iterable}\` sits under @if (${dead.test}), which compares that iterable's .length`,
    );
  }

  const semantic = analyze(heroCode, { lang: "tsx", sourceType: "module" }).semantic;
  check(semantic.symbol.count > 0, "heroCode analyze reported 0 symbols");

  const generated = generate(heroCode, { lang: "tsx", sourceType: "module" }, {});
  check(generated.code.length > 0, "heroCode generate produced no code");
  check(generated.code.includes("Cart"), "heroCode generated code does not mention Cart");
  check(
    generated.errors.length === 0,
    `heroCode generate reported ${generated.errors.length} error(s): ${generated.errors.map((e) => e.message).join("; ")}`,
  );

  const invalidPath = path.join(fixtureDir, "control-flow-switch-invalid.module.tsrx");
  const invalidSource = await readFile(invalidPath, "utf8");
  let invalid = null;
  try {
    invalid = parse(invalidSource, { lang: "tsx", sourceType: "module", semantic: true });
  } catch (error) {
    failures.push(`control-flow-switch-invalid threw ${error.message}`);
  }
  if (invalid) {
    const invalidErrors = errorsOf(invalid.tree.diagnostics);
    check(
      invalidErrors.length >= 1,
      "control-flow-switch-invalid produced no error-severity diagnostic",
    );
  }

  const fixtures = (await readdir(fixtureDir)).filter((name) => name.endsWith(".tsrx")).sort();
  check(fixtures.length > 0, `no .tsrx fixtures under ${path.relative(repoRoot, fixtureDir)}`);
  for (const name of fixtures) {
    const source = await readFile(path.join(fixtureDir, name), "utf8");
    try {
      const result = parse(source, { lang: "tsx", sourceType: "module", semantic: true });
      check(result.nodeCount > 0, `${name} parsed to 0 nodes`);
    } catch (error) {
      failures.push(`${name}: parse threw ${error.message}`);
    }
  }

  const size = await stat(wasmPath);
  console.log(
    [
      `wasm: ${path.relative(repoRoot, wasmPath)} ${(size.size / 1024).toFixed(0)} KiB`,
      `imports: ${wasm.imports.length === 0 ? "none" : wasm.imports.map((i) => `${i.module}.${i.name}`).join(", ")}`,
      `hero: ${hero.nodeCount} nodes in ${hero.ms.toFixed(2)} ms, ${hero.tree.diagnostics.length} diagnostics`,
      `semantic: ${semantic.scope.count} scopes, ${semantic.symbol.count} symbols, ${semantic.reference.count} references`,
      `generate: ${generated.code.length} bytes, ${generated.errors.length} errors`,
      `fixtures: ${fixtures.length} parsed`,
    ].join("\n"),
  );
}

async function main() {
  wasm = await instantiate();
  ({ decode } = await import(pathToFileURL(path.join(repoRoot, "npm", "yuku", "decode.js"))));
  ({ decode: decodeAnalyzer } = await import(
    pathToFileURL(path.join(repoRoot, "npm", "yuku", "decode-analyzer.js"))
  ));

  if (process.argv.includes("--fences")) {
    await runFences();
  } else {
    await runSmoke();
  }

  if (failures.length > 0) {
    console.error(`\nwasm smoke failed with ${failures.length} problem(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("ok");
}

main().catch((error) => {
  console.error(`wasm smoke failed: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
