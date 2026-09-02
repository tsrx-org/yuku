# Publishing the docs site at `yuku.tsrx.dev`

`https://yuku.tsrx.dev` is the canonical home of the docs, at the root of its
own domain. The old `https://compiled.run/yuku-tsrx` location becomes a
permanent redirect. This is the hand-off: every step needs access this
repository's workflows do not have (the `tsrx.dev` DNS zone, the TSRX Vercel
team, the Vercel project that served `compiled.run/yuku-tsrx`). Nothing here has
been run.

## What is already true in the tree

- `docs/site.config.mjs` defaults to origin `https://yuku.tsrx.dev` and base
  `/`. `SITE_ORIGIN` and `SITE_BASE` override that for a legacy build, and any
  origin other than the canonical one sets `redirectTo`.
- `docs/build.mjs` writes `vercel.json` into the build output (`cleanUrls`,
  `trailingSlash: false`, the retired-route redirects). On a legacy build it
  adds two permanent redirects: the base path and `base/:path*` to the same
  paths on `https://yuku.tsrx.dev`. With `--redirect-only` it writes only that
  `vercel.json`, a one-line `index.html`, and a `robots.txt` that disallows
  everything. This mirrors how `compiled.run/oxc-tsrx` was redirected to
  `oxc.tsrx.dev` (oxc-tsrx PR #67).
- `.github/workflows/site-artifact.yml` builds the canonical site on every
  push to `main` and every pull request (wasm, docs build, fence smoke, browser
  verification), uploads it as `yuku-docs-<sha>`, and uploads the redirect-only
  artifact as `yuku-docs-legacy-redirect-<sha>`. Two deploy jobs ship them, and
  both skip until the variables below exist.

No repository-root `vercel.json` is needed. The workflow deploys the built
directory with `vercel deploy --cwd`, so the generated file is the one Vercel
reads. Do not add build or output settings in the Vercel dashboard.

## Step 1: the Vercel project for `yuku.tsrx.dev`

In the TSRX Vercel team:

1. Create a project, suggested name `yuku-docs`.
2. Do not connect a Git repository. The site needs Zig and the Yuku seam to
   build its wasm module, which Vercel's image cannot do; the only bytes that
   may reach production are the artifact GitHub Actions built and verified.
3. Framework preset Other; build and output settings empty.
4. Note the Project ID (Settings, General) and the Team ID (Team Settings,
   General): `prj_...` and `team_...`.

## Step 2: the domain

1. Project Settings, Domains, add `yuku.tsrx.dev`.
2. Create the record Vercel shows. For a subdomain that is currently a `CNAME`
   to `cname.vercel-dns.com`; use the value the dashboard shows, not this
   table, because Vercel has changed the target before.

   | Type | Name | Value |
   | --- | --- | --- |
   | `CNAME` | `yuku` | `cname.vercel-dns.com.` |

   If `tsrx.dev` is already a Vercel-managed domain on the same team, adding
   the domain is enough.
3. Wait for Valid Configuration, confirm the domain is assigned to Production,
   and that no Deployment Protection rule covers production (it would make
   the post-deploy verification fail with a 401).

## Step 3: a deploy token

Account Settings, Tokens: create a token scoped to the TSRX team, with the
shortest expiry your rotation allows, and note the expiry; an expired token
turns every push to `main` red.

## Step 4: repository configuration

Settings, Secrets and variables, Actions, in `tsrx-org/yuku`. The two
variables gate the job (secrets cannot be read in an `if:`), so a typo means
the deploy silently skips.

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `YUKU_VERCEL_ORG_ID` | the team ID from step 1 |
| Variable | `YUKU_VERCEL_PROJECT_ID` | the project ID from step 1 |
| Secret | `YUKU_VERCEL_TOKEN` | the token from step 3 |

The deploy job declares a GitHub environment named `yuku-tsrx-dev` (created on
first run). Put the secret there instead if you want required reviewers on the
deploy; an environment secret of the same name wins.

## Step 5: the first deploy

Push to `main` or run **Build website artifact** by hand. Read the run:
`Deploy yuku.tsrx.dev` must have run rather than skipped, and `Prove that
deployment is serving this build` must pass. It fetches the deployment URL the
Vercel CLI printed and compares the served `index.html` hash with the one this
run built, so a first deploy can be proven before DNS has propagated. The last
step reports whether `https://yuku.tsrx.dev` answers 200 and cannot fail the
run.

Then by hand: `https://yuku.tsrx.dev` loads, `https://yuku.tsrx.dev/guide/getting-started`
loads (proves `cleanUrls`), the playground runs the wasm engine.

## Step 6: the redirect from `compiled.run/yuku-tsrx`

The Vercel project that served `compiled.run/yuku-tsrx` keeps existing; it just
stops serving pages. Give the workflow its identity the same way:

| Kind | Name | Value |
| --- | --- | --- |
| Variable | `LEGACY_VERCEL_ORG_ID` | that project's team ID |
| Variable | `LEGACY_VERCEL_PROJECT_ID` | that project's ID |
| Secret | `LEGACY_VERCEL_TOKEN` | a token for that team |

`Deploy the compiled.run/yuku-tsrx redirect` then ships the redirect-only
artifact on every push to `main` and proves, against the deployment URL, that
`/yuku-tsrx`, `/yuku-tsrx/guide/getting-started` and
`/yuku-tsrx/playground?share=abc` answer 308 to the same paths on
`https://yuku.tsrx.dev`.

To do it once by hand instead:

```sh
SITE_ORIGIN=https://compiled.run SITE_BASE=/yuku-tsrx/ \
  YUKU_TSRX_DOCS_OUT_DIR=/tmp/yuku-tsrx-legacy-redirect \
  node docs/build.mjs --redirect-only
cat /tmp/yuku-tsrx-legacy-redirect/vercel.json
npx vercel@57.0.0 deploy --cwd /tmp/yuku-tsrx-legacy-redirect --prod --yes --token "$TOKEN"
curl -sSI https://compiled.run/yuku-tsrx/guide/parse | grep -i '^location'
```

Only the `/yuku-tsrx` path is claimed by the redirects. If that project also
serves other paths of `compiled.run`, deploy the artifact into the project that
owns the `/yuku-tsrx` path, or copy the two `redirects` entries into that
project's own `vercel.json`.

## Turning it off

Delete either `YUKU_VERCEL_*` variable and the next push builds and verifies
but deploys nothing; likewise for `LEGACY_VERCEL_*`.

## After the repository transfer

Actions configuration does not travel with a transfer. The values above have to
be created on `tsrx-org/yuku`; the old repository's `production` environment
and any `VERCEL_*` secrets it held are gone as far as this workflow is
concerned. `ci.yml` needs nothing.
