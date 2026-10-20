# yuku.tsrx.dev

The site for `@tsrx/yuku`: Markdown pages, a static-site generator, and a playground that runs the published package in the browser. It needs Node.js 24 and Bun.

```sh
cd yuku-website
bun install
node build.mjs     # writes dist/
node serve.mjs     # serves dist/ at http://127.0.0.1:4519/
node verify.mjs    # opens every page in Chrome and runs the editor and the playground
```

| To change | Edit |
| --- | --- |
| A page | `guide/`, `reference/`, or `architecture/`, and its entry in `site.config.mjs` |
| Navigation, the home page text, redirects | `site.config.mjs`, and `vercel.json` for redirects, which the build checks against it |
| The home editor and the playground examples | `demo-sources.mjs` |
| Layout and generated parts of pages | `build.mjs` |
| Styles and the browser code | `assets/` |

The site uses the `@tsrx/yuku` in its own `package.json`, from npm, so it documents what is published. Bump it there after a release.

The build fails rather than publish something untrue: every `tsrx` fence must parse, or report the code its `error=TSRXnnnn` flag names, unless marked `no-playground`; every demo source must parse as `demo-sources.mjs` says; and the benchmark numbers are read from `../bench/chart.svg` and the table in `../README.md`, whose totals and claims it checks. `{{name}}` in a page is one of those numbers. `include: ../docs/x.md` in a page's front matter publishes a document of the repository as that page.

Vercel deploys this folder to yuku.tsrx.dev, with `vercel.json` for the install and build commands, headers, and redirects.
