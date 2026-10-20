import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error @tsrx/core types itself with JSDoc in JavaScript
import { parseModule } from "@tsrx/core";
import { parse } from "yuku";
import { walk } from "yuku/ast";

const SUITE = new URL("suite/", import.meta.url);
// what @tsrx/core reads, as acorn does, though TypeScript rejects it
const INVALID = new Set([
  "046a0432b5e10828", "05bf225d67ac2440", "06c5f754f9c6b69f", "0e662e2ac5c0f2bc",
  "17c0c35b2306d2b7", "30419b11b1573854", "382ef7d6cf91487d", "3b26dc47930b44f3",
  "5a531b7c7e4dcd49", "5b70306f64b7d217", "5bb99b9ed538de0f", "5fcdcfed4d982d43",
  "604debf0436139f0", "62d924e13ca363a8", "67c1824a76aa7921", "6b8c72824618a7bc",
  "6e79f0f5dc16f183", "79224810459dabf5", "7a124a575aba8a10", "82aacf29fbfac42a",
  "860fd9e8c7f4abc6", "947f1b1ec6b95d8b", "9c86658e3d7b7642", "b6168d0f38ea4e86",
  "cfd0ea336be5a40c", "d6a4ddc42d8e3bda", "dc57aa324ea9503d", "e2a92500462cde6f",
  "ee1a36a98f884874",
]);
const { version } = JSON.parse(
  readFileSync(new URL("../node_modules/@tsrx/core/package.json", import.meta.url), "utf8"),
);

const repo = mkdtempSync(join(tmpdir(), "tsrx-"));
try {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git(
    ...["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth=1", "--filter=blob:none"],
    ...["--sparse", `--branch=@tsrx/core@${version}`, "https://github.com/tsrx-org/tsrx.git", "."],
  );
  git("sparse-checkout", "set", "--no-cone", "/**/*.tsrx", "/packages/tsrx/tests/**/*.test.js");

  const sources = new Set<string>();
  for (const path of git("ls-files").split("\n")) {
    if (path.endsWith(".tsrx")) sources.add(readFileSync(join(repo, path), "utf8"));
    if (!path.startsWith("packages/tsrx/tests/") || !path.endsWith(".test.js")) continue;
    const { program } = parse(readFileSync(join(repo, path), "utf8"), { lang: "js" });
    walk(program, {
      Literal(node) {
        if (typeof node.value === "string") sources.add(node.value);
      },
      TemplateLiteral(node) {
        if (node.expressions.length === 0) sources.add(node.quasis[0]!.value.cooked ?? "");
      },
    });
  }

  rmSync(SUITE, { recursive: true, force: true });
  const counts = { pass: 0, fail: 0 };
  for (const source of sources) {
    const name = createHash("sha256").update(source).digest("hex").slice(0, 16);
    const kind = INVALID.has(name) ? "fail" : expected(source);
    if (kind === null) continue;
    mkdirSync(new URL(kind, SUITE), { recursive: true });
    writeFileSync(new URL(`${kind}/${name}.tsrx`, SUITE), source);
    counts[kind]++;
  }
  console.log(`@tsrx/core@${version}: ${counts.pass} pass, ${counts.fail} fail`);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function expected(source: string): "pass" | "fail" | null {
  const errors: { code?: string }[] = [];
  try {
    parseModule(source, "App.tsrx", { collect: true, errors });
  } catch (error) {
    errors.push(error as { code?: string });
  }
  const codes = errors.map((e) => e.code ?? "").filter((code) => code.startsWith("TSRX"));
  // style errors wait for the CSS tree
  if (codes.length > 0) return codes.every((code) => code.startsWith("TSRX3")) ? null : "fail";
  return errors.length === 0 && /[<@{;=(]/.test(source) ? "pass" : null;
}
