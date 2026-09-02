import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinPath = path.join(repoRoot, "yuku-website", "wasm-pin.json");
const outputPath = path.join(repoRoot, "zig-out", "wasm", "yuku-tsrx.wasm");
const stampPath = `${outputPath}.stamp`;
const releaseBase = "https://github.com/tsrx-org/yuku/releases/download";

function fail(message) {
  throw new Error(`fetch-docs-wasm: ${message}`);
}

function gitSrcTree() {
  const result = spawnSync("git", ["rev-parse", "HEAD:src"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`git rev-parse HEAD:src failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function verifyBytes(bytes, pin) {
  if (bytes.length !== pin.sizeBytes) {
    fail(`${pin.asset} is ${bytes.length} bytes, but the pin requires ${pin.sizeBytes}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== pin.sha256) {
    fail(`${pin.asset} has sha256 ${digest}, but the pin requires ${pin.sha256}`);
  }
}

function parseStamp(bytes, label) {
  let stamp;
  try {
    stamp = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (
    stamp?.tree !== pin.srcTree ||
    stamp?.dirty !== false ||
    typeof stamp?.built_at !== "string"
  ) {
    fail(`${label} does not describe clean src tree ${pin.srcTree}`);
  }
  return stamp;
}

async function download(name) {
  const url = `${releaseBase}/${encodeURIComponent(pin.release)}/${encodeURIComponent(name)}`;
  let response;
  try {
    response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    fail(`${url} could not be downloaded: ${error.message}`);
  }
  if (!response.ok) fail(`${url} responded ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const pin = JSON.parse(await readFile(pinPath, "utf8"));
for (const field of ["release", "asset", "sha256", "srcTree"]) {
  if (typeof pin[field] !== "string" || pin[field] === "") fail(`wasm-pin.json has no ${field}`);
}
if (!Number.isInteger(pin.sizeBytes) || pin.sizeBytes < 1)
  fail("wasm-pin.json has no valid sizeBytes");

const currentTree = gitSrcTree();
if (pin.srcTree !== currentTree) {
  fail(
    `the pin is stale for this source (${pin.srcTree.slice(0, 12)} != ${currentTree.slice(0, 12)}); run the wasm-pin step`,
  );
}

try {
  const [wasm, stamp] = await Promise.all([readFile(outputPath), readFile(stampPath)]);
  verifyBytes(wasm, pin);
  parseStamp(stamp, path.relative(repoRoot, stampPath));
  console.log(`fetch-docs-wasm: ${path.relative(repoRoot, outputPath)} already matches the pin`);
  process.exit(0);
} catch (error) {
  if (error?.code !== "ENOENT" && !String(error?.message).startsWith("fetch-docs-wasm:"))
    throw error;
}

const [wasm, stamp] = await Promise.all([download(pin.asset), download(`${pin.asset}.stamp`)]);
verifyBytes(wasm, pin);
parseStamp(stamp, `${pin.asset}.stamp`);
await mkdir(path.dirname(outputPath), { recursive: true });
await Promise.all([writeFile(outputPath, wasm), writeFile(stampPath, stamp)]);
console.log(
  `fetch-docs-wasm: installed ${pin.asset} (${wasm.length} bytes) from ${pin.release}, src tree ${pin.srcTree.slice(0, 12)}`,
);
