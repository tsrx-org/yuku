// The stamp beside zig-out/wasm/yuku-tsrx.wasm records which src/ tree the
// module was built from, so docs/build.mjs can refuse a binary that predates
// the code it claims to run.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultWasmPath = path.join(repoRoot, "zig-out", "wasm", "yuku-tsrx.wasm");
export const stampPathFor = (wasmPath) => `${wasmPath}.stamp`;

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.status}`);
  }
  return result.stdout.trim();
}

export function srcTree() {
  return {
    tree: git(["rev-parse", "HEAD:src"]),
    dirty: git(["status", "--porcelain", "--", "src"]) !== "",
  };
}

export async function readStamp(wasmPath = defaultWasmPath) {
  let raw;
  try {
    raw = await readFile(stampPathFor(wasmPath), "utf8");
  } catch {
    return null;
  }
  const stamp = JSON.parse(raw);
  if (
    typeof stamp.tree !== "string" ||
    typeof stamp.dirty !== "boolean" ||
    typeof stamp.built_at !== "string" ||
    Number.isNaN(Date.parse(stamp.built_at))
  ) {
    throw new Error(`${stampPathFor(wasmPath)} is not a stamp this tooling wrote`);
  }
  return stamp;
}

export async function writeStamp(wasmPath = defaultWasmPath) {
  const stamp = { ...srcTree(), built_at: new Date().toISOString() };
  await writeFile(stampPathFor(wasmPath), `${JSON.stringify(stamp, null, 2)}\n`);
  return stamp;
}
