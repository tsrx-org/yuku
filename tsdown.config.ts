import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "module/inline": "src/module/inline.ts",
    "module/workerd": "src/module/workerd.ts",
  },
  platform: "neutral",
  target: "es2020",
  dts: true,
  hash: false,
  loader: { ".wasm": "binary" },
  copy: "zig-out/bin/yuku-tsrx.wasm",
  // `#module` picks the WebAssembly at runtime, inline or, for workerd, the `.wasm` file
  deps: { neverBundle: [/^#/] },
  // bundlers for workerd load an import as WebAssembly only when its path ends in `.wasm`
  outputOptions: { paths: { "#wasm": "../yuku-tsrx.wasm" } },
});
