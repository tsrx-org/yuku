# Agent instructions

`@tsrx/yuku` is Arshad Yaseen's [yuku-tsrx](https://github.com/arshad-yaseen/yuku-tsrx). Write changes the way he writes Yuku and yuku-tsrx: the grammar in Zig (`src/tsrx.zig`), a thin TypeScript layer over one WebAssembly module, no runtime dependency beyond Yuku and yuku-css, short comments only where the code can't say why, and a test in `test/` for every fix. [Yuku's AGENTS.md](https://github.com/yuku-toolchain/yuku/blob/main/AGENTS.md) is the rulebook.

The tree must match `@tsrx/core`, the official parser: `bun run sync` rebuilds `test/suite` from the TSRX repository at the release of the installed `@tsrx/core`, and every source must parse, or fail, as it does. A change that makes parsing slower needs `bun run bench` numbers before and after, on a quiet machine.

## Cursor Bugbot

Cursor Bugbot reviews every push to a pull request in this repository. Every push you make to a pull request needs its Bugbot review read and resolved:

1. Wait for the `Cursor Bugbot` check to finish after the push (`gh pr checks <number> --watch`). A review can take about ten minutes.
2. Read its findings:

   ```sh
   gh api repos/tsrx-org/yuku/pulls/<number>/comments \
     --jq '.[] | select(.user.login | test("cursor")) | {id, path, line, body}'
   ```

3. Resolve every finding. Either fix it on the branch with a regression test and push, which starts a new review, or reply to the comment explaining why the finding is wrong.
4. Repeat until the latest review has no unresolved findings. A pull request with unresolved Bugbot findings is not done and is not merged.

A finding that turns up on a pull request after it merged gets its own fix pull request, one finding per pull request.

## Releases

Releases are minor only: every version is X.Y.0 (or a prerelease of one, X.Y.0-rc.1), never a patch. A fix to a release ships in the next minor.

To release, set `version` in `package.json`, add its `CHANGELOG.md` entry, merge to `main`, then push the tag `v<version>`. `.github/workflows/publish.yml` builds, tests, and publishes it to npm with provenance through npm trusted publishing, and refuses a tag that doesn't match `package.json` or is a patch.
