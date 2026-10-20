import bytes from "../../zig-out/bin/yuku-tsrx.wasm";

export const tsrx: WebAssembly.Module = new WebAssembly.Module(bytes);
