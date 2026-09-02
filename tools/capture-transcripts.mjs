#!/usr/bin/env node
// Records what the build and wasm commands actually print, so the terminal
// figures on the docs site are transcripts rather than prose about transcripts.
//
//   pnpm run docs:transcripts
//
// It runs each demo's commands from the repository root with colour disabled,
// strips any escape sequence that survived that, trims long output to a head
// and a tail with a labelled marker, and writes one JSON file per demo into
// yuku-website/transcripts/. yuku-website/build.mjs reads those files and never runs a command
// itself.
//
// The one rule this tool exists to enforce: a command that exits non-zero is
// dropped from the demo, never edited and never faked. A reader who sees a line
// here is seeing what the command printed on the machine and date in the
// caption.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "yuku-website", "transcripts");

// Head and tail kept around the marker. Fifteen each is enough to show a
// command's opening lines and its verdict without pasting a whole test run.
const HEAD_LINES = 15;
const TAIL_LINES = 15;

async function prepareFirstParse() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "yuku-first-parse-"));
  const scopeDir = path.join(cwd, "node_modules", "@tsrx");
  await mkdir(scopeDir, { recursive: true });
  await symlink(
    path.join(repoRoot, "zig-out", "npm", "yuku"),
    path.join(scopeDir, "yuku"),
    "dir",
  );
  await writeFile(
    path.join(cwd, "list.mjs"),
    `// list.mjs
import { parseModule } from "@tsrx/yuku";

const source = \`<ul>@for (const item of items; key item.id) { <li>{item.label}</li> }</ul>\`;
const program = parseModule(source, "list.tsrx");
const list = program.body[0].expression;
console.log(list.children.map((child) => child.type));
`,
  );
  return cwd;
}

const DEMOS = [
  {
    name: "getting-started-first-parse",
    prepare: prepareFirstParse,
    commands: [
      {
        comment: "parse the first TSRX file",
        argv: ["node", "list.mjs"],
      },
    ],
  },
  {
    name: "getting-started-build",
    commands: [
      {
        comment: "build the addon and write the npm package layout",
        argv: ["zig", "build"],
      },
      {
        comment: "zig build prints nothing on success, so look at what it wrote",
        argv: ["ls", "zig-out/npm/yuku"],
      },
      {
        comment: "the Zig test suite; --summary all only adds the tree at the end",
        argv: ["zig", "build", "test", "--summary", "all"],
      },
      {
        comment: "the JavaScript test suite",
        argv: ["pnpm", "test"],
      },
    ],
  },
  {
    name: "getting-started-wasm",
    commands: [
      {
        comment: "the WebAssembly build the docs site and the playground load",
        argv: ["zig", "build", "wasm", "-Doptimize=ReleaseSmall"],
      },
      {
        comment: "prove the module in Node before a page ever fetches it",
        argv: ["node", "tools/wasm-smoke.mjs"],
      },
    ],
  },
];

// CSI, OSC and the two-byte escapes a colouring test runner still emits when it
// has decided the stream is a terminal.
const ANSI = /\u001B\][\s\S]*?(?:\u0007|\u001B\\)|\u001B\[[0-9;:?]*[ -/]*[@-~]|\u001B[@-Z\\-_]/g;

const stripAnsi = (text) =>
  text
    .replace(ANSI, "")
    // Progress lines rewrite themselves with a carriage return; keep the final
    // state of each line, which is what a reader would have seen.
    .replace(/\r(?!\n)/g, "\n")
    .replace(/\r\n/g, "\n");

function trimOutput(output) {
  const lines = output.replace(/\n+$/, "").split("\n");
  if (lines.length <= HEAD_LINES + TAIL_LINES + 1) {
    return { text: lines.join("\n"), omitted: 0 };
  }
  const omitted = lines.length - HEAD_LINES - TAIL_LINES;
  return {
    text: [
      ...lines.slice(0, HEAD_LINES),
      `... ${omitted} lines omitted ...`,
      ...lines.slice(lines.length - TAIL_LINES),
    ].join("\n"),
    omitted,
  };
}

function runCommand(argv, cwd = repoRoot) {
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CI: "1",
      TERM: "dumb",
    },
  });
  if (result.error) {
    return {
      exitCode: -1,
      output: `${result.error.message}\n`,
      durationMs: Date.now() - started,
    };
  }
  return {
    exitCode: result.status ?? -1,
    output: stripAnsi(`${result.stdout ?? ""}${result.stderr ?? ""}`),
    durationMs: Date.now() - started,
  };
}

function zigVersion() {
  const result = spawnSync("zig", ["version"], { encoding: "utf8" });
  return (result.stdout ?? "").trim() || "unknown";
}

const platform = {
  os: `${os.type()} ${os.release()}`,
  arch: os.arch(),
  cpu: os.cpus()[0]?.model ?? "unknown",
  node: process.version,
  zig: zigVersion(),
};

await mkdir(outDir, { recursive: true });

let wrote = 0;
for (const demo of DEMOS) {
  const cwd = demo.prepare ? await demo.prepare() : repoRoot;
  const transcript = [];
  const dropped = [];
  for (const command of demo.commands) {
    const display = command.argv.join(" ");
    process.stderr.write(`${demo.name}: $ ${display}\n`);
    const { exitCode, output, durationMs } = runCommand(command.argv, cwd);
    if (exitCode !== 0) {
      // The rule, in one branch: nothing that failed is published, and the
      // output is never touched up to make it look like it did not.
      dropped.push({ command: display, exit_code: exitCode, duration_ms: durationMs });
      process.stderr.write(`${demo.name}: dropped "${display}" (exit ${exitCode})\n`);
      continue;
    }
    const { text, omitted } = trimOutput(output);
    transcript.push({
      comment: command.comment,
      command: display,
      exit_code: exitCode,
      duration_ms: durationMs,
      output: text,
      omitted_lines: omitted,
    });
  }

  if (transcript.length === 0) {
    if (demo.prepare) await rm(cwd, { recursive: true, force: true });
    throw new Error(`${demo.name}: every command failed, so there is nothing honest to publish`);
  }

  const capturedAt = new Date().toISOString();
  const file = path.join(outDir, `${demo.name}.json`);
  await writeFile(
    file,
    `${JSON.stringify(
      {
        generated_by: "tools/capture-transcripts.mjs",
        captured_at: capturedAt,
        platform,
        caption: '',
        dropped,
        transcript,
      },
      null,
      2,
    )}\n`,
  );
  wrote += 1;
  if (demo.prepare) await rm(cwd, { recursive: true, force: true });
  process.stderr.write(
    `${demo.name}: wrote ${path.relative(repoRoot, file)} (${transcript.length} commands, ${dropped.length} dropped)\n`,
  );
}

process.stderr.write(
  `captured ${wrote} transcript file(s) into ${path.relative(repoRoot, outDir)}\n`,
);
