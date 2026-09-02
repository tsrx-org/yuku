#!/usr/bin/env node
// One-time bootstrap: put the three package names on npm so that trusted
// publishing can be configured on them.
//
// Why this exists at all. npm attaches a trusted publisher to a package that
// ALREADY EXISTS. Both the `npm trust` docs ("Package must exist") and the
// trusted-publishing guide ("Navigate to your package settings on npmjs.com")
// say so, and npm/cli#8544, "Allow publishing initial version with OIDC", is
// still open. PyPI lets you pre-register a publisher for a name nobody has
// taken. npm does not. All three of these names are brand new, so the very
// first publish of each one cannot go through the workflow.
//
// That makes this the one release step CI cannot do. It runs from the owner's
// laptop, with interactive `npm login`, and it writes to the registry, so it
// needs the owner's explicit publication approval in its own right. Nobody can
// take it on the owner's behalf, and no long-lived automation token should be
// created for it.
//
// The stubs it publishes are deliberately inert:
//
//   - version 0.0.0, so 0.1.0 is unambiguously newer.
//   - `--tag bootstrap`, so `latest` is never pointed at a placeholder and
//     `npm install @tsrx/yuku` cannot resolve one.
//   - `"provenance": false`, because a laptop cannot produce a provenance
//     attestation and `provenance: true` makes the publish fail outright.
//   - a README whose only line says what the package is, so anyone who does
//     find it on npmjs.com knows immediately that it is not the real thing.
//
// Safety: dry-run is the default. Nothing reaches the registry unless
// `--publish` is passed, and even then any name that already exists is skipped
// rather than republished.
//
// Usage:
//   node scripts/publish-placeholders.mjs              # rehearse, publish nothing
//   node scripts/publish-placeholders.mjs --publish    # the real one-time run

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY = "tsrx-org/yuku";
const SCOPE = "tsrx";
const WORKFLOW_FILE = "publish.yml";
const TARGET_VERSION = JSON.parse(
  readFileSync(new URL("../npm/yuku/package.json", import.meta.url), "utf8"),
).version;
const BOOTSTRAP_TAG = "bootstrap";

// Same order the real publish uses, for no reason other than habit: nothing
// resolves anything at 0.0.0, so order genuinely does not matter here.
const NAMES = ["@tsrx/yuku-darwin-arm64", "@tsrx/yuku-linux-x64-gnu", "@tsrx/yuku"];

const publishing = process.argv.includes("--publish");

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function fail(message) {
  console.error(`\npublish-placeholders: ${message}`);
  process.exit(1);
}

// `npm trust` needs 11.15.0 or newer, and the owner will want it in the same
// session. Checking here turns a confusing later failure into a clear one now.
const NPM_FLOOR = "11.15.0";
const npmVersion = run("npm", ["--version"]).stdout?.trim();
if (!npmVersion) fail("npm is not on PATH");
const order = (value) => value.split(".").map(Number);
const [aMajor, aMinor, aPatch] = order(npmVersion);
const [mMajor, mMinor, mPatch] = order(NPM_FLOOR);
const npmOldEnough =
  aMajor > mMajor ||
  (aMajor === mMajor && aMinor > mMinor) ||
  (aMajor === mMajor && aMinor === mMinor && aPatch >= mPatch);
if (!npmOldEnough) {
  fail(
    `npm ${npmVersion} is older than ${NPM_FLOOR}. \`npm trust\` needs ${NPM_FLOOR}+.\n` +
      "  npm install -g npm@latest",
  );
}
console.log(`npm ${npmVersion} (floor ${NPM_FLOOR} for \`npm trust\`): ok`);

const whoami = run("npm", ["whoami"]);
if (whoami.status !== 0) {
  if (publishing) {
    fail("not logged in. Run `npm login` first (interactive, with 2FA at the prompt).");
  }
  console.log("npm whoami: not logged in (fine for a rehearsal; `npm login` before --publish)");
} else {
  console.log(`npm whoami: ${whoami.stdout.trim()}`);
}

console.log(
  publishing
    ? `\nMODE: publish. Three 0.0.0 placeholders will be written to the registry under the "${BOOTSTRAP_TAG}" tag.`
    : "\nMODE: rehearsal (default). Nothing will be written to the registry. Pass --publish for the real run.",
);

const workDir = mkdtempSync(join(tmpdir(), "yuku-placeholder-"));
const published = [];
const skipped = [];

for (const name of NAMES) {
  // A name that already exists does not need a placeholder, and republishing
  // over a real release would be the worst possible outcome of this script.
  const view = run("npm", ["view", name, "versions", "--json"]);
  if (view.status === 0) {
    console.log(
      `\n${name}: already on the registry. Skipping; configure its trusted publisher directly.`,
    );
    skipped.push(name);
    continue;
  }

  writeFileSync(
    join(workDir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.0.0",
        private: false,
        description: `Name reservation for trusted-publishing setup. The real release is ${TARGET_VERSION}. Do not install this version.`,
        license: "MIT",
        repository: { type: "git", url: `git+https://github.com/${REPOSITORY}.git` },
        // provenance must be false: a laptop publish cannot attest, and
        // asking it to fails the publish rather than skipping the
        // attestation.
        publishConfig: { access: "public", provenance: false },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(workDir, "README.md"),
    `\`${name}@0.0.0\` is a placeholder published only so that npm trusted publishing can be configured on the name. The real release is ${TARGET_VERSION}, published from CI. Do not install this version.\n`,
  );

  const args = ["publish", "--tag", BOOTSTRAP_TAG, "--access", "public"];
  if (!publishing) args.push("--dry-run");
  console.log(`\n--- npm ${args.join(" ")}  (${name}) ---`);
  const result = spawnSync("npm", args, { cwd: workDir, stdio: "inherit" });
  if (result.status !== 0) fail(`npm publish failed for ${name}`);
  published.push(name);
}

const configurable = [...published, ...skipped];

console.log(`
================================================================================
Next: configure a trusted publisher on each package. Only the owner can do this,
and it is the step that makes .github/workflows/${WORKFLOW_FILE} able to
authenticate without any NPM_TOKEN.

STEP 1 -- the organization.

  All three packages are scoped @${SCOPE}/..., so the account that publishes
  must be a member of the "${SCOPE}" npm organization (the one that already
  owns @tsrx/oxc and @tsrx/core) with publish rights.

  If the publishes above failed with E404 or E403, this is why: get added to
  the org, then re-run this script.

STEP 2 -- per package, on npmjs.com.

  For each of these ${configurable.length} package(s):
${configurable.map((name) => `    - ${name}`).join("\n")}

    1. Open https://www.npmjs.com/package/<name>
    2. Settings tab
    3. Trusted publisher section, "Select your publisher" -> GitHub Actions
    4. Organization or user:  ${REPOSITORY.split("/")[0]}
    5. Repository:            ${REPOSITORY.split("/")[1]}
    6. Workflow filename:     ${WORKFLOW_FILE}
       (just the filename with its extension, NOT a path -- not
        .github/workflows/${WORKFLOW_FILE})
    7. Environment name:      leave EMPTY. ${WORKFLOW_FILE} declares no GitHub
       environment. If one is ever added, this field must be filled in to match
       or publishing breaks.
    8. Allowed actions: tick "npm publish".
    9. Save.

  Every field is case sensitive and npm does not validate them on save. A typo
  shows up only later, as a failed publish with ENEEDAUTH.

  The CLI equivalent, which is faster and re-prompts for 2FA only once per
  five-minute window:

${configurable.map((name) => `    npm trust github "${name}" --repo ${REPOSITORY} --file ${WORKFLOW_FILE} --allow-publish --yes`).join("\n")}
    npm trust list @tsrx/yuku    # confirm it saved

  Or run scripts/trust-publishers.sh, which does exactly that for every name.

STEP 3 -- publish ${TARGET_VERSION} from CI.

  Rehearse first: GitHub -> Actions -> "Publish to npm" -> Run workflow with
  mode=dry-run. Then push the tag v${TARGET_VERSION}; the push publishes.
  See .github/releasing/launch-runbook.md.

STEP 4 -- clean up, but only AFTER ${TARGET_VERSION} is on the registry.

    npm unpublish "<name>@0.0.0"

  Never unpublish the placeholder while it is the only version of a package.
  Removing the last version removes the package, and removing the package
  removes its trusted publisher configuration with it.
================================================================================`);

if (!publishing) {
  console.log(
    "\nThis was a rehearsal. Nothing was published. Re-run with --publish when you are ready.",
  );
}
