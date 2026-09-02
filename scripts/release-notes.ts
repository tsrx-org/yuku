#!/usr/bin/env node
// Build the body of a GitHub Release from the commit history.
//
// changelogen only understands Conventional Commits: a subject that is not
// `type(scope): summary` is dropped without a warning. Much of this history is
// prose, so changelogen alone would hide most of the work. This runs
// changelogen for the grouped sections it is good at, appends every commit in
// the range it did not mention, and refuses to write unless the two together
// account for every commit.
//
//   node scripts/release-notes.ts [--from <ref>] [--to <ref>] [--out <path>]
//
//   --from  defaults to the most recent v* tag reachable from --to, and to the
//           first commit when no release tag exists yet (the first cut).
//   --to    defaults to HEAD. Pass the commit before a release commit so the
//           notes describe the work rather than the version bump.
//   --out   defaults to stdout.
//
// Never commits, never tags, never leaves a file behind: changelogen writes to
// a temporary directory that is removed before exit.

import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

class NotesError extends Error {}

const git = (args: string[]): string =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

type Options = { from: string | null; to: string; out: string | null };

function parseArguments(argv: string[]): Options {
	const options: Options = { from: null, to: "HEAD", out: null };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index]!;
		const value = argv[index + 1];
		if (flag !== "--from" && flag !== "--to" && flag !== "--out") {
			throw new NotesError(`unknown argument: ${flag}`);
		}
		if (!value || value.startsWith("--")) throw new NotesError(`${flag} needs a value`);
		options[flag.slice(2) as "from" | "to" | "out"] = value;
		index += 1;
	}
	return options;
}

/** The most recent release tag, or the first commit when there is none yet. */
function defaultFrom(to: string): string {
	try {
		return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", to]);
	} catch {
		const first = git(["rev-list", "--max-parents=0", to]).split("\n").at(-1);
		if (!first) throw new NotesError(`no commits reachable from ${to}`);
		return first;
	}
}

function repositoryUrl(): string | null {
	let remote = "";
	try {
		remote = git(["remote", "get-url", "origin"]);
	} catch {
		const manifest = JSON.parse(readFileSync(path.join(root, "npm/yuku/package.json"), "utf8")) as {
			repository?: { url?: string };
		};
		remote = manifest.repository?.url ?? "";
	}
	const match = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/u);
	return match ? `https://github.com/${match[1]}/${match[2]}` : null;
}

type Commit = { sha: string; short: string; subject: string };

function commitsInRange(from: string, to: string): Commit[] {
	const raw = git(["log", "--reverse", "--format=%H %h %s", `${from}..${to}`]);
	if (!raw) return [];
	return raw.split("\n").map((line) => {
		const [sha, short, ...subject] = line.trim().split(" ");
		return { sha: sha!, short: short!, subject: subject.join(" ") };
	});
}

async function runChangelogen(from: string, to: string, outputDirectory: string): Promise<string> {
	// changelogen's exports map publishes only `.`, so the CLI is found beside it.
	const cli = path.join(path.dirname(require.resolve("changelogen")), "cli.mjs");
	if (!existsSync(cli))
		throw new NotesError(`changelogen's CLI is not at ${cli}; run pnpm install`);
	const output = path.join(outputDirectory, "CHANGELOG.md");
	try {
		await execFile(
			process.execPath,
			[cli, "--from", from, "--to", to, "--output", output, "--no-commit", "--no-tag"],
			{ cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
		);
	} catch (error) {
		const detail = error as { code?: unknown; stderr?: string; message: string };
		throw new NotesError(
			`changelogen failed (${String(detail.code ?? "unknown")}):\n${detail.stderr ?? detail.message}`,
		);
	}
	return readFile(output, "utf8");
}

/** Everything after the first `## ` heading, which duplicates the release title. */
function releaseSection(changelog: string): string {
	const lines = changelog.split("\n");
	const start = lines.findIndex((line) => line.startsWith("## "));
	return start === -1
		? ""
		: lines
				.slice(start + 1)
				.join("\n")
				.trim();
}

/** Commits changelogen mentioned: only link text counts, not the compare URL. */
function emittedShas(section: string, commits: Commit[]): Set<string> {
	const found = new Set<string>();
	for (const match of section.matchAll(/\[([0-9a-f]{7,40})\]\(/gu)) {
		const commit = commits.find((entry) => entry.sha.startsWith(match[1]!));
		if (commit) found.add(commit.sha);
	}
	return found;
}

function otherChangesSection(commits: Commit[], url: string | null): string {
	const lines = commits.map((commit) => {
		const subject = commit.subject.replace(/\s+/gu, " ").trim();
		const link = url ? ` ([${commit.short}](${url}/commit/${commit.sha}))` : ` (${commit.short})`;
		return `- ${subject}${link}`;
	});
	return [
		"### 📋 Other changes",
		"",
		"_Commits changelogen could not classify, oldest first._",
		"",
		...lines,
	].join("\n");
}

/** Keep changelogen's contributors block last, where a reader expects it. */
function spliceSection(section: string, addition: string): string {
	if (!section) return addition;
	const marker = section.indexOf("### ❤️");
	if (marker === -1) return `${section}\n\n${addition}`;
	return `${section.slice(0, marker).trimEnd()}\n\n${addition}\n\n${section.slice(marker)}`;
}

async function main(argv: string[]): Promise<number> {
	const options = parseArguments(argv);
	const to = options.to;
	const from = options.from ?? defaultFrom(to);
	for (const [name, ref] of [
		["--from", from],
		["--to", to],
	] as const) {
		try {
			git(["rev-parse", "--verify", `${ref}^{commit}`]);
		} catch {
			throw new NotesError(`${name} ${ref} is not a commit this repository knows`);
		}
	}

	const commits = commitsInRange(from, to);
	if (commits.length === 0) throw new NotesError(`${from}..${to} contains no commits`);

	const url = repositoryUrl();
	const outputDirectory = await mkdtemp(path.join(tmpdir(), "yuku-release-notes-"));
	let section: string;
	try {
		section = releaseSection(await runChangelogen(from, to, outputDirectory));
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}

	const emitted = emittedShas(section, commits);
	const remainder = commits.filter((commit) => !emitted.has(commit.sha));
	let body =
		remainder.length > 0 ? spliceSection(section, otherChangesSection(remainder, url)) : section;
	body = `${body.trim()}\n`;

	const missing = commits.filter((commit) => !body.includes(commit.short));
	if (missing.length > 0) {
		throw new NotesError(
			`${missing.length} of ${commits.length} commit(s) do not appear in the notes: ` +
				missing.map((commit) => commit.short).join(", "),
		);
	}

	if (options.out) await writeFile(path.resolve(process.cwd(), options.out), body);
	else process.stdout.write(body);

	console.error(
		`release-notes: ${from}..${to} - ${commits.length} commit(s), ${emitted.size} from changelogen, ` +
			`${remainder.length} appended as other changes.`,
	);
	if (options.out) console.error(`release-notes: wrote ${options.out}`);
	return 0;
}

try {
	process.exitCode = await main(process.argv.slice(2));
} catch (error) {
	if (error instanceof NotesError) {
		console.error(`release-notes: ${error.message}`);
		process.exitCode = 1;
	} else {
		throw error;
	}
}
