# Publishing the docs site at `yuku.tsrx.dev`

Leonidaz can deploy this site in the Vercel account or team that will host the docs.
He needs permission to create or configure that project, and its Vercel GitHub
integration must have access to `tsrx-org/yuku`. The person configuring DNS also
needs access to the DNS provider for `tsrx.dev`.

1. Import `tsrx-org/yuku` as a project named `yuku-website`.
2. Set **Root Directory** to `yuku-website` and **Framework Preset** to **Other**.
3. Keep **Include source files outside of the Root Directory in the Build Step**
   enabled. The build uses the repository's root lockfile, scripts, parser sources,
   and npm package files. See [Vercel's monorepo settings](https://vercel.com/docs/monorepos/monorepo-faq#can-i-share-source-files-between-projects-are-shared-packages-supported).
4. Use **Node.js 24.x** and **Production Branch** `main`. Leave the install, build,
   and output settings at their repository-defined values: `vercel.json` supplies
   the commands and the `dist` output directory. No environment variables are required.
5. Deploy, then add `yuku.tsrx.dev` under the project's **Settings → Domains**.
6. Follow the DNS instructions shown on that domain's card. With an external DNS
   provider, create the `yuku` CNAME using the exact target Vercel supplies. Complete
   any ownership verification Vercel requests, then wait for **Valid Configuration**
   and the HTTPS certificate. See [Vercel's domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain).
7. Open `https://yuku.tsrx.dev/guide/parse` and `/playground`, and confirm that the
   examples load and update when the source changes.

Vercel's Git integration builds each selected commit from the project directory.
The build fetches the release asset pinned by `yuku-website/wasm-pin.json`, verifies its source tree, size, and sha256, and then runs `yuku-website/build.mjs` for `https://yuku.tsrx.dev/`; Vercel does not need Zig, Rust, or CI secrets.
On pushes to `main`, `.github/workflows/site-artifact.yml` continues to build and verify the WASM and site, and publishes and commits a refreshed pin only when `HEAD:src` changes.
