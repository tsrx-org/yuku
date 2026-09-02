#!/usr/bin/env node
// Builds the WebAssembly module the docs ship, proves it with the smoke test,
// then stamps it with the src/ tree it came from (tools/wasm-stamp.mjs).
//
//   node tools/build-wasm.mjs               zig build wasm, smoke, stamp
//   node tools/build-wasm.mjs --stamp-only  smoke and stamp the binary already there
import { spawnSync } from "node:child_process";
import path from "node:path";
import { defaultWasmPath, repoRoot, stampPathFor, writeStamp } from "./wasm-stamp.mjs";

const stampOnly = process.argv.includes("--stamp-only");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: "inherit" });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
}

if (!stampOnly) run("zig", ["build", "wasm", "-Doptimize=ReleaseSmall"]);
run(process.execPath, [path.join(repoRoot, "tools", "wasm-smoke.mjs")]);
const stamp = await writeStamp(defaultWasmPath);
console.log(
  `stamped ${path.relative(repoRoot, stampPathFor(defaultWasmPath))}: src tree ${stamp.tree.slice(0, 12)}${stamp.dirty ? " (src/ has uncommitted changes)" : ""}`,
);
