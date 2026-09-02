#!/usr/bin/env node
// Rehearse the release from a laptop, against the tree `zig build` just wrote.
//
// This script cannot publish. There is no publish mode and no code path that
// runs `npm publish` without `--dry-run`. Publishing is `.github/workflows/
// publish.yml`, which authenticates over OIDC and needs a typed confirmation
// phrase; this file exists so that everything that workflow checks can be
// checked before a commit, on a machine with no registry credentials.
//
// What it does, in order:
//
//   1. Reads the three staged manifests and asserts they agree with each other
//      and with what npm will require of them at publish time.
//   2. Asserts every path each manifest declares in its own `files` array is
//      really in the staged directory, and that each addon is the binary format
//      its `os`/`cpu` claims. A manifest that promises a file it does not ship
//      is the failure mode that produces a package which installs and then
//      throws on first import.
//   3. With --strip-linux, strips debug sections from the linux ELF addon.
//   4. With --dry-run, runs `npm publish --dry-run` per package, bindings first,
//      and prints the file list npm reports for each.
//
// Usage:
//   node scripts/release-local.mjs --dry-run
//   node scripts/release-local.mjs --strip-linux --dry-run
//   node scripts/release-local.mjs --strip-linux --dry-run --json report.json

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, openSync, readSync, closeSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(REPO, "zig-out", "npm", "yuku");

// The publish order is not negotiable, and it is the same reason it is not
// negotiable in oxc-tsrx: npm resolves optionalDependencies at install time
// against whatever is on the registry at that moment. Publish the meta package
// before its bindings and a consumer who installs in that window gets the
// JavaScript with no addon behind it, and no error saying so.
const BINDINGS = [
  {
    name: "@tsrx/yuku-darwin-arm64",
    dir: "@tsrx/yuku-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    libc: undefined,
    // Mach-O 64-bit little-endian.
    magic: [0xcf, 0xfa, 0xed, 0xfe],
    format: "Mach-O 64-bit",
  },
  {
    name: "@tsrx/yuku-linux-x64-gnu",
    dir: "@tsrx/yuku-linux-x64-gnu",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
    // ELF.
    magic: [0x7f, 0x45, 0x4c, 0x46],
    format: "ELF 64-bit",
  },
];
const META = "@tsrx/yuku";
const PUBLISH_ORDER = [...BINDINGS.map((binding) => binding.dir), "."];

const argv = process.argv.slice(2);
const wants = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};

function readMagic(path, length) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, 0);
    return [...buffer];
  } finally {
    closeSync(fd);
  }
}

async function manifestAt(subdir) {
  const path = join(STAGE, subdir, "package.json");
  assert.ok(existsSync(path), `missing manifest: ${path}. Run \`zig build\` first.`);
  return JSON.parse(await readFile(path, "utf8"));
}

function assertFilesExist(subdir, manifest) {
  for (const entry of manifest.files ?? []) {
    const path = join(STAGE, subdir, entry);
    assert.ok(
      existsSync(path),
      `${manifest.name}: declares "${entry}" in files but ${path} does not exist`,
    );
  }
  if (manifest.main) {
    const path = join(STAGE, subdir, manifest.main);
    assert.ok(existsSync(path), `${manifest.name}: main "${manifest.main}" is not in the package`);
  }
}

const report = { version: undefined, packages: [], warnings: [] };

const meta = await manifestAt(".");
const version = meta.version;
report.version = version;
assert.match(
  version,
  /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
  `meta version is not a release version: ${version}`,
);
assert.equal(meta.name, META, "meta manifest has the wrong name");
assert.equal(meta.publishConfig?.access, "public", "meta: publishConfig.access must be public");
assert.equal(meta.publishConfig?.provenance, true, "meta: publishConfig.provenance must be true");
assert.ok(meta.repository?.url, "meta: repository is required for provenance");
assertFilesExist(".", meta);

// Exactly the two bindings 0.1.0 ships, each pinned to this exact version. A
// range here would let a consumer resolve an addon built from different source
// than the JavaScript that loads it.
const optional = meta.optionalDependencies ?? {};
assert.deepEqual(
  Object.keys(optional).sort(),
  BINDINGS.map((binding) => binding.name).sort(),
  `meta optionalDependencies must be exactly the shipped bindings, got: ${Object.keys(optional).join(", ")}`,
);
for (const binding of BINDINGS) {
  assert.equal(
    optional[binding.name],
    version,
    `${binding.name} must be pinned to ${version} in optionalDependencies`,
  );
}

for (const binding of BINDINGS) {
  const manifest = await manifestAt(binding.dir);
  assert.equal(manifest.name, binding.name, `${binding.dir}: unexpected package name`);
  assert.equal(manifest.version, version, `${binding.name}: version is not ${version}`);
  assert.equal(manifest.publishConfig?.access, "public", `${binding.name}: not public`);
  assert.equal(manifest.publishConfig?.provenance, true, `${binding.name}: provenance is off`);
  assert.deepEqual(manifest.os, [binding.os], `${binding.name}: wrong os`);
  assert.deepEqual(manifest.cpu, [binding.cpu], `${binding.name}: wrong cpu`);
  assert.deepEqual(
    manifest.libc,
    binding.libc ? [binding.libc] : undefined,
    `${binding.name}: wrong libc`,
  );
  assertFilesExist(binding.dir, manifest);

  // A binding package whose manifest is right and whose addon is a different
  // platform's binary installs cleanly and throws on require. Check the bytes.
  const addon = join(STAGE, binding.dir, "yuku-tsrx.node");
  const magic = readMagic(addon, binding.magic.length);
  assert.deepEqual(
    magic,
    binding.magic,
    `${binding.name}: yuku-tsrx.node is not ${binding.format} (magic ${magic.map((b) => b.toString(16)).join(" ")})`,
  );
  report.packages.push({
    name: binding.name,
    bytes: statSync(addon).size,
    format: binding.format,
  });
}

// A repository with no LICENSE file cannot honestly claim a license, and
// "UNLICENSED" grants nobody the right to install it. That is the current
// state of this tree, so it is a warning here and a hard refusal in the
// workflow's publish mode: rehearsing is fine, shipping it is not.
if (!existsSync(join(REPO, "LICENSE")) || meta.license === "UNLICENSED") {
  report.warnings.push(
    `license is "${meta.license}" and there is no LICENSE file at the repo root. ` +
      "Publishing is blocked until the owner picks one.",
  );
}

console.log(`staged ${PUBLISH_ORDER.length} packages at ${version} from ${STAGE}`);
for (const warning of report.warnings) console.log(`WARNING: ${warning}`);

if (wants("--strip-linux")) {
  const objcopy = [
    "llvm-objcopy",
    "/opt/homebrew/opt/llvm/bin/llvm-objcopy",
    "/usr/bin/llvm-objcopy",
    "llvm-objcopy-18",
    "objcopy",
  ].find((candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0);
  assert.ok(objcopy, "llvm-objcopy not found; install LLVM or drop --strip-linux");
  const addon = join(STAGE, "@tsrx/yuku-linux-x64-gnu", "yuku-tsrx.node");
  const before = statSync(addon).size;
  // --strip-debug only, never --strip-all: the dynamic symbol table is how
  // Node finds napi_register_module_v1.
  execFileSync(objcopy, ["--strip-debug", addon], { stdio: "inherit" });
  const after = statSync(addon).size;
  console.log(`stripped linux-x64-gnu addon: ${before} -> ${after} bytes`);
  const entry = report.packages.find((pkg) => pkg.name === "@tsrx/yuku-linux-x64-gnu");
  if (entry) entry.bytes = after;
}

if (wants("--dry-run")) {
  for (const subdir of PUBLISH_ORDER) {
    const target = join(STAGE, subdir);
    console.log(`\n--- npm publish --dry-run ${subdir === "." ? META : subdir} ---`);
    // `./` on a relative path is load-bearing for npm: a bare `a/b` is read
    // as the GitHub shorthand `user/repo`. An absolute path sidesteps that
    // entirely, which is why this passes one.
    const result = spawnSync("npm", ["publish", target, "--dry-run", "--access", "public"], {
      stdio: "inherit",
      cwd: REPO,
    });
    assert.equal(result.status, 0, `npm publish --dry-run failed for ${subdir}`);
  }
}

const jsonPath = valueOf("--json");
if (jsonPath) {
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nwrote ${jsonPath}`);
}

console.log("\nrelease-local: every staged manifest and artifact check passed.");
