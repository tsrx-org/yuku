# yuku-website

This folder is the Vercel project root for <https://yuku.tsrx.dev>.
Vercel installs the workspace, fetches the pinned prebuilt WASM release asset, and runs `docs/build.mjs` with the canonical origin and root base.
The main-branch site workflow refreshes `wasm-pin.json` after it builds and verifies a WASM module from a new `src/` tree.
