#!/bin/sh
# Attach a GitHub Actions trusted publisher to each of the three packages.
#
# npm configures trusted publishing per package, not per organization, and only
# on a package that already exists, so the first publish of each name (from
# scripts/publish-placeholders.mjs) has to happen before this runs. After this,
# .github/workflows/publish.yml publishes with no credential and npm attaches a
# provenance attestation automatically.
#
#   sh scripts/trust-publishers.sh            # attach
#   sh scripts/trust-publishers.sh --dry-run  # print every command, run none
#   sh scripts/trust-publishers.sh --check    # report the current state
#
# npm's 2FA window is about five minutes, long enough for all three.

set -u

REPO="tsrx-org/yuku"
WORKFLOW="publish.yml"
NAMES="@tsrx/yuku-darwin-arm64 @tsrx/yuku-linux-x64-gnu @tsrx/yuku"
MODE="attach"
case "${1:-}" in
  --dry-run) MODE="dry-run" ;;
  --check) MODE="check" ;;
  "") ;;
  *) echo "unknown argument: $1 (expected --dry-run or --check)" >&2; exit 2 ;;
esac

# What the GitHub side needs, spelled out because `npm trust` only checks its
# own side: the repository must be public, Actions must be enabled, and the
# workflow file name must be exactly publish.yml at .github/workflows/.
echo "GitHub side (nothing to run; verify by eye):"
echo "  gh repo view $REPO --json visibility,isArchived"
echo "  gh api repos/$REPO/actions/permissions"
echo "  ls .github/workflows/$WORKFLOW"
echo

if [ "$MODE" = "dry-run" ]; then
  echo "dry run: these are the commands, in order. None of them will run."
  for name in $NAMES; do
    echo "  npm view \"$name\" version"
    echo "  npm trust list \"$name\""
    echo "  npm trust github \"$name\" --repo $REPO --file $WORKFLOW --allow-publish --allow-stage-publish --yes"
  done
  echo "  npm trust list @tsrx/yuku"
  exit 0
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "not logged in to npm: run 'npm login' first" >&2
  exit 1
fi

# `npm trust` before 11.15.0 sends a payload the registry rejects with a bare
# 400, once per package, with no hint that the CLI is the problem.
NPM_VERSION=$(npm --version)
if ! node -e '
  const [have, want] = [process.argv[1], "11.15.0"].map((v) => v.split(".").map(Number));
  const ok = have[0] > want[0]
    || (have[0] === want[0] && (have[1] > want[1] || (have[1] === want[1] && have[2] >= want[2])));
  process.exit(ok ? 0 : 1);
' "$NPM_VERSION"; then
  echo "npm $NPM_VERSION is too old for 'npm trust' (needs >= 11.15.0). Run: npm install -g npm@latest" >&2
  exit 1
fi

ok=0
skipped=0
failed=0

for name in $NAMES; do
  if ! npm view "$name" version >/dev/null 2>&1; then
    echo "  not published yet, skipping   $name  (run: node scripts/publish-placeholders.mjs --publish)"
    skipped=$((skipped + 1))
    continue
  fi

  if [ "$MODE" = "check" ]; then
    echo "--- $name"
    npm trust list "$name" 2>&1 | sed 's/^/    /'
    continue
  fi

  echo ">>> $name"
  # npm refuses to overwrite an existing trusted publisher (E409), so a re-point
  # after the repository move must revoke the old configuration first.
  existing_ids=$(npm trust list "$name" 2>/dev/null \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    | sort -u)
  for trust_id in $existing_ids; do
    echo "  revoking existing trust $trust_id"
    npm trust revoke "$name" --id="$trust_id" || {
      echo "  FAILED to revoke $trust_id on $name; skipping create" >&2
      failed=$((failed + 1))
      continue 2
    }
    sleep 2
  done

  if npm trust github "$name" \
    --repo "$REPO" \
    --file "$WORKFLOW" \
    --allow-publish \
    --allow-stage-publish \
    --yes
  then
    echo "  trusted   $name"
    ok=$((ok + 1))
  else
    echo "  FAILED    $name"
    failed=$((failed + 1))
  fi
  sleep 2
done

[ "$MODE" = "check" ] && exit 0

echo
echo "trusted $ok, skipped $skipped, failed $failed"
if [ "$failed" -eq 0 ] && [ "$skipped" -eq 0 ]; then
  echo
  echo "Every package now trusts $REPO/$WORKFLOW."
  echo "Next: push the release tag (git push origin vX.Y.Z); publish.yml publishes with provenance."
fi
