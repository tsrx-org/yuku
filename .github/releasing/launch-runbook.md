# Launch runbook: `@tsrx/yuku` 0.2.0 from `tsrx-org/yuku`

What the owner runs, in order, from the transferred repository to the first
`npm publish` and the domain. Every step that writes somewhere outside this
repository says so. Nothing in this file has been run by the agent that wrote
it; the scripts it names were only rehearsed with their `--dry-run` flags.

The identities:

| What | Value |
| --- | --- |
| Repository | `https://github.com/tsrx-org/yuku` (transferred; GitHub redirects the old `compiled-run/yuku-tsrx` URL) |
| Packages | `@tsrx/yuku`, `@tsrx/yuku-darwin-arm64`, `@tsrx/yuku-linux-x64-gnu` |
| Version | `0.2.0`, already in every manifest (`node scripts/sync-version.ts --check`) |
| Tag | `v0.2.0`; pushing it is what publishes |
| Docs | `https://yuku.tsrx.dev`, with `compiled.run/yuku-tsrx` redirecting to it |
| Retired names | `yuku-tsrx`, `@yuku-tsrx/binding-darwin-arm64`, `@yuku-tsrx/binding-linux-x64-gnu` (0.1.4 is their last release; 0.1.5 was never published) |

## 0. Already done

The repository lives at `tsrx-org/yuku`. Every URL in the tree says so, and
`git remote get-url origin` should too. If it still says `compiled-run`, run
`git remote set-url origin git@github.com:tsrx-org/yuku.git`.

## 1. Land this branch on `main`

Merge `chore/tsrx-org-migration` (an owner directive, not something a workflow
does). After the merge, on a clean `main`:

```sh
node scripts/sync-version.ts --check
pnpm run check:generated
pnpm test
```

Then confirm Actions are enabled: `gh api repos/tsrx-org/yuku/actions/permissions`.

## 2. npm: get the three names to exist

npm attaches a trusted publisher only to a package that already exists, so the
first version of each brand-new name cannot come from CI. This step writes to
the registry from your laptop, with interactive login, and needs your own
publication approval.

Prerequisites: membership of the `tsrx` npm organization (the one that owns
`@tsrx/oxc` and `@tsrx/core`) with publish rights, and npm 11.15 or newer.

```sh
npm install -g npm@latest
npm login                                        # interactive, 2FA at the prompt
node scripts/publish-placeholders.mjs            # rehearsal, publishes nothing
node scripts/publish-placeholders.mjs --publish  # three 0.0.0 stubs, tag "bootstrap"
```

The stubs are inert: version `0.0.0`, dist-tag `bootstrap` so `latest` never
points at them, a one-line README saying what they are.

## 3. npm: trust the publish workflow

```sh
sh scripts/trust-publishers.sh --dry-run   # prints every command, runs none
sh scripts/trust-publishers.sh             # attaches tsrx-org/yuku + publish.yml to each name
sh scripts/trust-publishers.sh --check     # shows what npm now has on record
```

The script revokes any existing trust on a name before creating the new one,
because npm refuses to overwrite (E409). The fields it sets, if you would
rather click through npmjs.com per package: publisher GitHub Actions,
organization `tsrx-org`, repository `yuku`, workflow filename `publish.yml`
(the filename only), environment empty, allowed actions publish and stage.

## 4. Rehearse the publish from CI

```sh
gh workflow run publish.yml --ref main -f mode=dry-run
gh run watch
```

This builds both addons on their own runners, packs the three tarballs,
verifies every file inside them, checksums them, and runs
`npm publish --dry-run` against the real registry. It publishes nothing.
Read the log once.

## 5. Draft the GitHub Release

```sh
sh scripts/placeholder-release.sh --dry-run   # writes the notes, creates nothing
sh scripts/placeholder-release.sh             # gh release create v0.2.0 --draft
```

The body is `node scripts/release-notes.ts`: changelogen over conventional
commits since the last release tag (there is none yet, so from the first
commit), plus every commit changelogen could not classify. The script only
creates a draft; publishing the release is a click on GitHub after the tag
exists.

## 6. Tag, which publishes

The tree already carries `0.2.0`, so there is no bump for this release:

```sh
git switch main && git pull
node scripts/sync-version.ts --check
git tag -a v0.2.0 -m v0.2.0
git push origin v0.2.0
gh run watch
```

The tag push runs `publish.yml` in publish mode: it rebuilds the candidate from
the tagged commit, rehearses, publishes the two bindings and then `@tsrx/yuku`,
and installs the published version into a scratch project to parse one file
through the addon. npm attaches a provenance attestation because the publish
came through the trusted publisher.

Afterwards, publish the draft release on GitHub (`gh release edit v0.2.0
--draft=false`), and check:

```sh
npm view @tsrx/yuku version dist-tags optionalDependencies
npm view @tsrx/yuku-darwin-arm64 version
npm view @tsrx/yuku-linux-x64-gnu version
```

Later releases: `pnpm release` on a clean `main` runs bumpp for the root
version and `scripts/sync-version.ts` for everything else; commit as
`chore: release vX.Y.Z`, tag, `git push --follow-tags`. Or dispatch
`manual-release.yml`, which does the same on a runner; note that a tag pushed by
that workflow with the default token does not trigger `publish.yml`, so either
set a `RELEASE_PUSH_TOKEN` repository secret (a fine-grained token with
contents: write) or dispatch `publish.yml` by hand afterwards.

## 7. Retire the old names

Only after step 6 is green. Deprecation is a registry write and is reversible
(`npm deprecate <name> ""` clears it).

```sh
npm deprecate yuku-tsrx "moved to @tsrx/yuku"
npm deprecate @yuku-tsrx/binding-darwin-arm64 "moved to @tsrx/yuku-darwin-arm64"
npm deprecate @yuku-tsrx/binding-linux-x64-gnu "moved to @tsrx/yuku-linux-x64-gnu"
```

Markless pins `yuku-tsrx@0.1.3` today; the deprecation warns on install and
breaks nothing. Its move to `@tsrx/yuku` is a change in that repository.

## 8. Clean up the placeholders

Only after `0.2.0` is on every name, so each still has a real version:

```sh
npm unpublish @tsrx/yuku-darwin-arm64@0.0.0
npm unpublish @tsrx/yuku-linux-x64-gnu@0.0.0
npm unpublish @tsrx/yuku@0.0.0
```

Never unpublish a placeholder while it is the only version: removing the last
version removes the package and its trusted publisher with it.

## 9. The site and the domain

[site-yuku-tsrx-dev.md](site-yuku-tsrx-dev.md): the Vercel project for
`yuku.tsrx.dev`, the DNS record, the repository variables that turn the deploy
job on, and the redirect-only deploy that keeps `compiled.run/yuku-tsrx`
pointing at the new home.

## 10. Optional hardening, later

On each package: Settings, Publishing access, require two-factor authentication
and disallow tokens. Trusted publishing keeps working. Consider stage-only
trust (`--allow-stage-publish` without `--allow-publish`) so a human approves
each release with 2FA before it becomes installable.
