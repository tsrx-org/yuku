# docs/

The yuku-tsrx documentation site. Static HTML generated from the markdown in
this directory by a small vanilla-JavaScript toolchain, no framework.

## Files

- `site.config.mjs`: title, origin, base path, nav, sidebar order, redirects
  from retired routes, home hero and features. Changing the sidebar changes
  which pages get built; the search index, `llms.txt`, the sitemap and the
  pager all follow it.
- `build.mjs`: the generator. Reads `site.config.mjs`, renders every sidebar
  page from `<link>.md`, and writes `dist/`.
- `widgets/`: build-side widget modules, one per `<!-- widget:NAME -->` marker
  (see below). `assets/widgets/` holds their runtime halves.
- `wasm-node.mjs`: the dialect's WebAssembly build instantiated in Node, so the
  build and the widgets can parse, analyze and generate at build time.
- `highlight.mjs`: shared shiki setup.
- `tsrx.tmLanguage.json`: the TSRX TextMate grammar, vendored so `tsrx` fences
  highlight as TSRX rather than as plain text.
- `demo-sources.mjs`: the one TSRX snippet the home page hero panel shows.
- `assets/style.css`, `assets/app.js`: theme toggle, search dialog, mobile
  drawer, outline scroll spy, copy buttons, client-side routing, widget boot.
- `assets/yuku-wasm.js`, `assets/yuku-shared.js`: the browser host for the
  wasm module and the helpers every engine-backed figure shares.
- `assets/fonts/`: self-hosted Space Grotesk (display) and Inter (body).
- `assets/logo.svg`, `assets/hero-rays.svg`: generated art.
- `generate-assets.mjs`: writes those two SVGs. The logo is an at-mark on the
  teal brand gradient; the hero band is 88 light streaks radiating from a fixed
  point, placed by a seeded PRNG so every run produces the same file.
- `generate-social-card.mjs`: writes `assets/social-card.png` (1200x630, the
  `og:image`). The README hero (`../.github/assets/readme-hero.png`, 1200x400)
  is `tools/readme-hero.mjs`, the same recipe at a banner size. It lays
  the card out in HTML, screenshots it at 2x with system Chrome through
  `playwright-core`, then downscales with ImageMagick so the type stays crisp.
  The sentence under the wordmark is read from `site.config.mjs`, so the card
  cannot drift from the home page hero.
- `serve.mjs`: minimal static server for the built site, with the same
  extensionless-route and redirect behaviour the deploy has.
- `verify-playground.mjs`: drives the built site in a real Chromium and fails
  on any console error (see "Verifying in a browser").

`goals/` is internal project state and is not part of the site. The build never
globs this directory: a page exists on the site only if `site.config.mjs` lists
it.

## Commands

```sh
pnpm run docs:wasm          # zig build wasm, smoke test, write the stamp
pnpm run docs:build         # write docs/dist/ (refuses without a fresh stamp)
pnpm run docs:serve         # serve docs/dist/ at http://127.0.0.1:4519/yuku-tsrx/
pnpm run docs:verify-playground   # open the built site in Chromium and check every widget
pnpm run docs:assets        # regenerate assets/logo.svg and assets/hero-rays.svg
pnpm run docs:social-card   # regenerate the OG card
pnpm run docs:readme-hero   # regenerate the README hero
```

`docs:assets` is deterministic and safe to re-run. `docs:social-card` needs
Google Chrome and ImageMagick (`magick`) installed locally, and it reads the
logo, so run `docs:assets` first if the mark changed.

## The wasm stamp

The playground and every engine-backed figure run `zig-out/wasm/yuku-tsrx.wasm`,
a zig artifact the docs build never produces. `pnpm run docs:wasm`
(`tools/build-wasm.mjs`) builds it, runs `tools/wasm-smoke.mjs` against it, and
writes `zig-out/wasm/yuku-tsrx.wasm.stamp`: the git tree hash of `src/` at
`HEAD` plus a `dirty` flag from `git status --porcelain src`.

`docs:build` reads the stamp first and refuses when it is missing or names a
different `HEAD:src` than the checkout, so a binary built before the last
change to `src/` cannot ship. It also refuses a dirty stamp or checkout; pass
`--allow-dirty` to build that state deliberately. If the binary is known to
match the tree but was built by hand,
`node tools/build-wasm.mjs --stamp-only` smoke-tests and stamps it without
running zig.

## Adding a widget

A widget is an interactive block a page writer places with one marker and no
edit to `build.mjs`:

~~~md
<!-- widget:construct-toggle variants="if,switch,key,empty" key="item.id" -->
```tsrx
const view = @if (items.length > 0) {
  @for (const item of items) {
    <li>{item.id}</li>
  } @empty {
    <li>none</li>
  }
} @else {
  <li>no list</li>
};
```
~~~

`node tools/wasm-smoke.mjs --fences` scans every `.md` under `docs/`, this
file included, so the seed above parses.

Three steps:

1. **Write the build half**, `docs/widgets/NAME.mjs`. It default-exports
   `async function render({ attrs, fence, page, ctx })` and returns the HTML
   that goes inside the widget's `<figure data-widget="NAME">`. `attrs` is the
   marker's `key=value` pairs (a bare word is `"true"`). `fence` is the fenced
   block right after the marker, or `null`: `{ lang, flags, code, html }`, where
   `html` is the shiki-rendered block (use it as the no-JavaScript fallback).
   `ctx` gives `highlight(code, lang)`, the engine in Node as
   `parse / analyze / generate(source, options)`, `readFixture(file)` for
   `test/parser/misc/tsrx/`, `withBase`, `escapeHtml`, `base`, `repoRoot` and
   `tsrxRecordTypes`. Optional exports: `className` (extra classes on the
   figure; `'explorer ex-figure'` gives the engine-figure chrome) and
   `markdown({ attrs, fence, page })` for the page's `.md` twin.
2. **Write the runtime half**, `docs/assets/widgets/NAME.js`. It default-exports
   `mount(root, { cleanup })`; `root` is the figure, `cleanup` is an array to
   push teardown functions onto (timers, observers) so an SPA navigation can
   dispose the widget. Import `parse / analyze / generate / ready` from
   `../yuku-wasm.js` and the helpers from `../yuku-shared.js`. `app.js` fetches
   the module only on a page that carries the figure, and only once it is near
   the viewport, so call `ready()` inside `mount` rather than at module load.
   Report progress in a `[data-widget-status]` element and set
   `root.dataset.widgetState` to `ready`, `error` or `unavailable`.
3. **Add a check to `verify-playground.mjs`** that clicks the widget and reads
   what changed. A marker whose build or runtime module is missing fails the
   build; a widget nobody has clicked in a real browser is not done.

`construct-toggle` is the reference: its build half rewrites the seed once per
variant (`@if` to `@switch`, add `; key`, drop `@empty`), parses every variant
so a chip can never show a snippet the engine refuses, and ships them as JSON;
its runtime half swaps the editor text on a chip click and recomputes the node
chips and the AST pane with the wasm in the tab.

## Verifying in a browser

`node docs/verify-playground.mjs` serves `docs/dist` itself (or takes
`--url <origin>` for a deployment) and drives every interactive surface in
headless Chromium: the hero editor, the playground tabs and fixtures, the
try-in-playground button, the engine figures, the construct-toggle widget, the
redirects from retired routes, and an SPA round trip. It fails on any console
error, page error or failed request.

Pages are located by what the build emitted, not by a list: a figure no page
carries is reported as skipped. The home page, the playground and the
construct-toggle widget must exist.

The browser is resolved in this order: `PLAYWRIGHT_CHROME`, playwright's cached
Chromium (`~/Library/Caches/ms-playwright` or `~/.cache/ms-playwright`), the
macOS Google Chrome, then `google-chrome` / `chromium` on `PATH`. With none of
them: `pnpm exec playwright-core install chromium`.

## CI

`.github/workflows/ci.yml` has a `docs` job (pushes to `main` and `docs/**`,
pull requests touching `docs/`). It installs dependencies and headless Chromium,
builds the docs, runs the fence check and the browser verification. Because
`zig-out/` is gitignored and the wasm needs zig plus the Yuku seam checkout, the
job prints a notice and skips when the binary is absent; add a step that runs
`node tools/build-wasm.mjs` before it to turn the checks on.

## Output layout

The site is served under a base path, so pages land in
`dist/yuku-tsrx/` and the deploy-root files (`vercel.json`, `robots.txt`) sit in
`dist/`. `dist/` is gitignored.

Alongside each page the build writes a `.md` twin (used by the copy-page
button), plus `search-index.json`, `llms.txt`, `llms-full.txt` and
`sitemap.xml`. `vercel.json` carries a permanent redirect for every route in
`site.config.mjs` `redirects` (and its `.md` twin); in-page links to a retired
route are rewritten to the destination at build time.

## Deploy

The canonical site at <https://yuku.tsrx.dev> is deployed by Vercel's Git
integration from the `yuku-website` project root. Its build fetches the pinned,
prebuilt WASM release artifact and then runs this generator, so Vercel needs no
Zig or repository secrets; `.github/workflows/site-artifact.yml` builds and
verifies new WASM bytes and refreshes the pin when `src/` changes on `main`.

See `releasing/site-yuku-tsrx-dev.md` for the one-time Vercel project setup.

Two more optional files per widget: `docs/assets/widgets/NAME.css` (appended to every shell's stylesheet at build, so a widget never edits `style.css`) and `docs/widgets/NAME.verify.mjs` (default export `async ({ routes, open, pagesWith, pageCarrying, check, notes, skipped, waitForParse, statusText })`, run by `docs/verify-playground.mjs` on every page that carries the widget).
