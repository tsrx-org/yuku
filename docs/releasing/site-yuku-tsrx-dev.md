# Publishing the docs site at `yuku.tsrx.dev`

In the TSRX Vercel team, import the `tsrx-org/yuku` GitHub repository as a project named `yuku-website`.
Set the Root Directory to `yuku-website`, choose Framework Preset **Other**, and leave the build settings unchanged because `vercel.json` supplies them.
Set the Production Branch to `main`, add the domain `yuku.tsrx.dev`, and make no other project or repository configuration changes.

Vercel's Git integration builds each selected commit from the project directory.
The build fetches the release asset pinned by `yuku-website/wasm-pin.json`, verifies its source tree, size, and sha256, and then runs `docs/build.mjs` for `https://yuku.tsrx.dev/`; Vercel does not need Zig, Rust, or CI secrets.
On pushes to `main`, `.github/workflows/site-artifact.yml` continues to build and verify the WASM and site, and publishes and commits a refreshed pin only when `HEAD:src` changes.
