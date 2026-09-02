# Publish runbook

How `@tsrx/yuku` and its two binding packages get onto npm, and the traps that
are specific to per-platform native packages. The one-time bootstrap and the
first release are laid out step by step in [the launch
runbook](launch-runbook.md); this file is the reference behind it.

**The 2026-09 rename resets the one-time setup.** The repository moved to
`tsrx-org/yuku` and every published name changed: `yuku-tsrx` is now
`@tsrx/yuku`, and `@yuku-tsrx/binding-<suffix>` is now `@tsrx/yuku-<suffix>`.
The three new names are unpublished, so each has to be bootstrapped onto the
registry by hand and bound to a trusted publisher pointing at `tsrx-org/yuku`
before `publish.yml` can authenticate for any of them. The old names exist on
npm at 0.1.0 through 0.1.4 and stay there, deprecated, once 0.2.0 is out.

## What ships

Three packages, always at one version:

1. `@tsrx/yuku-darwin-arm64`, the macOS arm64 native addon
2. `@tsrx/yuku-linux-x64-gnu`, the linux x64 glibc native addon
3. `@tsrx/yuku`, the JavaScript API, which loads one of the two

Each binding package holds `package.json` and `yuku-tsrx.node` (the addon file
kept its name through the rename, as oxc's binary did). `npm pack` flattens
the scoped names: `@tsrx/yuku` packs as `tsrx-yuku-<version>.tgz` and
`@tsrx/yuku-<suffix>` as `tsrx-yuku-<suffix>-<version>.tgz`.
`release-candidate.yml` asserts the exact file list inside each tarball.

### The order is not negotiable

`@tsrx/yuku` last, always. It lists both bindings in `optionalDependencies`,
and npm resolves those at install time against whatever is on the registry at
that moment. Publish the meta package first and a consumer in that window
installs the JavaScript with no addon behind it and gets no error saying so.
`publish.yml` reads the order out of the tarballs and refuses to proceed if the
pins are not exactly the two bindings at exactly this version.

### Version lockstep

`scripts/sync-version.ts` carries the root `package.json` version to
`npm/yuku/package.json` (its version and both pins), both binding manifests,
and `build.zig.zon`, and `--check` fails on any drift. It also scans those files
for any version-shaped text no declaration covers, so a new pin cannot hide.
`publish.yml` runs the check against the tag before building anything.

## How publishing authenticates

npm Trusted Publishing over GitHub Actions OIDC. There is no `NPM_TOKEN` in
this repository and none is needed: `id-token: write` on the publish job is the
whole credential, and npm attaches a provenance attestation on its own for a
trusted publish from a public repository. Two things have to be true first:

1. Each name exists on the registry. npm configures a trusted publisher on an
   existing package, so the very first version of a new name cannot be
   published this way (`scripts/publish-placeholders.mjs` does it from a
   laptop, as inert `0.0.0` stubs under the `bootstrap` tag).
2. Each name has a trusted publisher pointing at `tsrx-org/yuku` and at the
   filename `publish.yml` exactly (`scripts/trust-publishers.sh`).

`npm trust` needs npm 11.15.0 or newer, account-level 2FA, and write access to
each package. Granular access tokens with the "bypass 2FA" option do not work
for it.

## Running the publish

Pushing a tag `v<version>` runs `publish.yml` in publish mode. It refuses a tag
whose version does not match the root `package.json`, runs
`sync-version --check`, calls `release-candidate.yml` to build both addons on
their own runners (`macos-14` for darwin-arm64 with `-Dcpu=apple_m1`,
`ubuntu-24.04` for linux-x64-gnu with `-Dcpu=x86_64_v2`), strips debug
sections from the linux ELF, runs `scripts/release-local.mjs` as the gate,
packs and checksums, rehearses with `npm publish --dry-run`, publishes bindings
first, then installs the published version into a scratch project and parses a
file through it.

A manual dispatch defaults to `mode: dry-run` and does everything except the
two registry writes. `mode: publish` from a dispatch additionally requires
`confirm` to be `PUBLISH <version>`.

| Input | Rehearsal | Real publish (dispatch) |
| --- | --- | --- |
| `mode` | `dry-run` | `publish` |
| `confirm` | leave empty | `PUBLISH 0.2.0` |
| `dist_tag` | leave empty | leave empty (means `latest`) |

## Rehearsing from a laptop

`scripts/release-local.mjs` checks everything the workflow checks, against the
tree `zig build` just wrote, on a machine with no registry credentials. It
cannot publish: there is no code path that runs `npm publish` without
`--dry-run`.

```sh
zig build -Dcpu=apple_m1                             # darwin-arm64 addon + the meta package
zig build -Dtarget=x86_64-linux-gnu -Dcpu=x86_64_v2  # linux-x64-gnu addon
node scripts/release-local.mjs --strip-linux --dry-run
```

It asserts every manifest's version, `publishConfig.access`,
`publishConfig.provenance`, `repository`, and (for bindings) `os`, `cpu` and
`libc`; that every path each manifest declares in `files` is really staged;
that each addon's magic bytes are the format its `os`/`cpu` claims; and that
the meta package's `optionalDependencies` are exactly the two bindings pinned
to this exact version. `--strip-linux` runs `llvm-objcopy --strip-debug` on the
ELF: `--strip-debug` only, never `--strip-all`, because the dynamic symbol table
is how Node finds `napi_register_module_v1`.

## Troubleshooting

**`ENEEDAUTH` or `E403` on publish.** Nearly always a trusted publisher
mismatch. Check, in order: the workflow filename field is exactly `publish.yml`
and not a path; the repository is `tsrx-org/yuku` with that case; the
environment field is empty; the package exists on the registry; npm on the
runner is 11.5.1 or newer (the workflow asserts this).

**`E404` publishing a scoped package.** The publishing account is not a member
of the `tsrx` organization, or the placeholder step was skipped.

**"You cannot publish over the previously published versions."** The version is
already on the registry. npm versions are immutable. Pick the next patch.

**The gate fails with "declares X in files but ... does not exist".** The staged
tree is incomplete, usually a build for one target only. Both build jobs have
to succeed.

**A consumer gets SIGILL.** The addon was built for the runner's own CPU. The
`-Dcpu` pins above are the fix; `release-candidate.yml` passes them.
