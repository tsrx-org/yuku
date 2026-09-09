# Work on the Yuku docs

This folder contains the Markdown pages and static-site generator for
[yuku.tsrx.dev](https://yuku.tsrx.dev). Start here to edit a page or change an
interactive example. For parser work, follow the [contribution guide](guide/contributing.md).

## Preview a change

Use Node.js 24 and pnpm 10.33.2. From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
node scripts/fetch-docs-wasm.mjs
pnpm run docs:build
pnpm run docs:serve
```

Open **http://127.0.0.1:4519/**. Edit a page, run `pnpm run docs:build` again,
and refresh. The server doesn't watch or rebuild files.

The download supplies the browser parser used by the examples. It verifies
both the artifact's hash and its source revision. If it reports a stale pin,
follow [Build from source](guide/build-from-source.md) and run `pnpm run docs:wasm`.

## Find the right file

| I want to change… | Edit… |
| --- | --- |
| A guide or reference page | `guide/*.md`, `architecture/*.md`, or `reference/*.md` |
| Navigation, page order, or home feature text | `site.config.mjs` |
| Home metadata | `index.md` |
| The home editor example | `demo-sources.mjs` |
| Page layout or generated home sections | `build.mjs` |
| Site appearance and navigation behavior | `assets/style.css` and `assets/app.js` |
| An interactive example | `widgets/NAME.mjs` and `assets/widgets/NAME.js` |

The build writes `dist/`. Edit the sources above; generated files are gitignored.

## Add or rewrite a page

Create a Markdown file with a title, description, and one top-level heading:

```md
---
title: Your page title
description: What the reader will learn or do.
---

# Your page title

Start with the problem this page helps solve.
```

Add its route to the sidebar in `site.config.mjs`. For example,
`/guide/example` builds `guide/example.md`. The sidebar also drives the pager,
search index, sitemap, and `llms.txt`. If you move a page, add its old route to
`redirects` so existing links keep working.

Use root-relative site links such as `/guide/parse`. The build applies the
configured base path. Each page also gets a `.md` copy for the copy-page action.

Write for someone who knows JavaScript but may be new to parsers:

- Start with a concrete task and the smallest useful example.
- Define a term when the reader first needs it. Explain what the result means.
- Include imports, input, a command to run, and expected output for a runnable example.
- Link to the API reference for exhaustive signatures and advanced options.
- Explain which behavior belongs to the parser and which is a rule in a demo.

Use `tsrx` fences for templates. They get highlighting and a **Try in playground**
action. Mark intentionally invalid input as `tsrx no-playground`; the fence check
then knows it isn't supposed to parse successfully.

## Ground technical explanations

Read the relevant page on [yuku.fyi](https://yuku.fyi/) before describing Yuku’s parser, AST, semantic model, traverser, analyzer, or codegen. Then verify the claim against this checkout: the pinned dependency, `npm/yuku/index.js`, `index.d.ts`, and the native or browser host. Current upstream docs are not a versioned API reference for `@tsrx/yuku`.

Describe semantic analysis in terms of the compiler, lint, or refactoring task it enables. Keep the distinction between per-file semantic tables here and upstream’s project `Analyzer`, between early errors and type checking, and between printing or stripping and runtime lowering. Upstream [testing](https://yuku.fyi/testing/) and [security](https://yuku.fyi/security/) claims apply to upstream; only claim local coverage or release behavior supported by this repository.

## Check your work

After rebuilding:

```sh
node tools/wasm-smoke.mjs --fences
pnpm run docs:verify-playground
```

The fence check parses eligible TSRX examples. The browser check serves the
built site and exercises the editor, playground, widgets, and navigation. It
fails on browser errors and failed requests. JavaScript snippets in prose
aren't run by the fence check: run those yourself, too.

The verifier looks for `PLAYWRIGHT_CHROME`, a cached Playwright Chromium, or
system Chrome/Chromium. To install a browser:

```sh
pnpm exec playwright-core install chromium
```

Also read your changed pages at desktop and mobile widths. Follow the links,
try the examples, and check that the page makes sense before any interaction.

## Add an interactive example

Place `<!-- widget:NAME -->` before its optional code fence. Start by reading a
similar widget; `widgets/keyed-loops.mjs` is a working transform example.

1. Create `widgets/NAME.mjs`. Its default export is
   `async function render({ attrs, fence, page, ctx })`, returning the HTML inside
   a `<figure data-widget="NAME">`. `fence` is `null` or
   `{ lang, flags, code, html }`; keep readable output for visitors without JavaScript.
   `ctx` provides `highlight`, `parse`, `analyze`, `generate`, `readFixture`,
   `withBase`, and `escapeHtml`, plus repository paths.
2. Create `assets/widgets/NAME.js`. Export `mount(root, { cleanup })` and push
   teardown functions onto `cleanup`. The site loads widgets near the viewport;
   call the WASM host's `ready()` inside `mount`, not at module load. Set
   `root.dataset.widgetState` to `ready`, `error`, or `unavailable`, and show
   progress in `[data-widget-status]`.
3. Add `widgets/NAME.verify.mjs`, following a nearby verifier. Exercise the
   interaction and check what changed. `verify-playground.mjs` discovers it
   and runs it on the pages carrying the widget.

Optional `assets/widgets/NAME.css` styles are included at build time. A build
module can export `className` for the figure and `markdown({ attrs, fence, page })`
for the page's Markdown copy. Include a useful explanation in that copy.

## Parser builds and deployment

After changing `src/`, run `pnpm run docs:wasm`. It builds and smoke-tests the
WASM module and stamps it with the source tree. The site build rejects a missing
or stale stamp. For a deliberate local preview of uncommitted parser changes,
rebuild WASM, then run `pnpm run docs:build -- --allow-dirty`.

[site-artifact.yml](../.github/workflows/site-artifact.yml) builds the parser and
site, checks code fences, and runs browser verification in CI. On `main`, it
also publishes and pins a new WASM artifact when the parser source changes.

Vercel deploys from this folder using the Git integration. Its build downloads
the pinned artifact and generates the site at the domain root.

For generated artwork, use `docs:assets`, `docs:social-card`, and
`docs:readme-hero` from the root package scripts. The last two need Chrome and
ImageMagick; these aren't needed for a Markdown edit.
