import { tsrx } from "#module";
import { langFromPath, sourceTypeFromPath, type FileOptions } from "yuku";
import {
  DYNAMIC_IMPORT_WORDS,
  EXPORT_ENTRY_WORDS,
  HEADER,
  POOL_BIT,
  readDynamicImport,
  readExportEntry,
  readStaticExport,
  readStaticImport,
  STATIC_EXPORT_WORDS,
  STATIC_IMPORT_WORDS,
} from "./module-record/layout";

export interface ScanOptions extends FileOptions {
  /** Also fail on the early errors that need scopes, as `parse` does with it. @default false */
  semanticErrors?: boolean;
}

/** What a module imports and exports, without its tree. Offsets are UTF-16, as in the tree. */
export interface ModuleRecordScan {
  /** Whether `parse` reports an error for the source. The lists are empty when it does. */
  readonly failed: boolean;
  /** Every top-level `import`, but `import type`, in source order. */
  readonly staticImports: readonly StaticImport[];
  /** Every top-level `export`, but type exports, in source order. */
  readonly staticExports: readonly StaticExport[];
  /** Every `import()`, `import.source()`, and `import.defer()` at any depth, once each, in source order. */
  readonly dynamicImports: readonly DynamicImport[];
}

/** `import ... from "m"` or `import "m"`. */
export interface StaticImport {
  /** The statement's start. */
  readonly start: number;
  /** The statement's end. */
  readonly end: number;
  /** The module request, its escapes decoded. */
  readonly specifier: string;
  /** The start of the quoted request. */
  readonly specifierStart: number;
  /** The end of the quoted request. */
  readonly specifierEnd: number;
}

/** An `export` statement. */
export interface StaticExport {
  /** The statement's start. */
  readonly start: number;
  /** The statement's end. */
  readonly end: number;
  /** `export { ... }`, with or without `from`. */
  readonly braced: boolean;
  /** The request of `from "m"`, its escapes decoded, or `null` without one. */
  readonly specifier: string | null;
  /** Its names, but type-only ones, in source order. */
  readonly entries: readonly ExportEntry[];
}

/**
 * An ExportEntry Record of the ECMAScript specification: an exported import, as in
 * `import { a } from "m"; export { a as b }`, has `importedFrom` and no `local`.
 */
export interface ExportEntry {
  /** The exported name, `null` for `export * from "m"`. */
  readonly exported: string | null;
  /** The local binding, `null` for an anonymous default and for every entry with `importedFrom`. */
  readonly local: string | null;
  /** The name taken from `importedFrom`, `"default"` for a default import, `null` for a whole namespace. */
  readonly imported: string | null;
  /** The module the name comes from, or `null` for a local binding. */
  readonly importedFrom: string | null;
}

/** An `import()` call. */
export interface DynamicImport {
  /** The start of `import`. */
  readonly start: number;
  /** The end of the closing `)`. */
  readonly end: number;
  /** The start of the first argument. */
  readonly argumentStart: number;
  /** The end of the first argument. */
  readonly argumentEnd: number;
}

interface Exports {
  memory: WebAssembly.Memory;
  dialect(): number;
  module_record_input(len: number): number;
  module_record_scan(len: number, flags: number): number;
}

interface Instance {
  exports: Exports;
  files: { extension: string; lang: string }[];
  grownAt: number;
}

const LANGS: Record<string, number> = { js: 0, ts: 1, jsx: 2, tsx: 3, dts: 4 };
const SOURCE_TYPES: Record<string, number> = { script: 0, module: 1, commonjs: 2 };
// as Yuku does, a module grown past this is replaced once it has been idle a while
const MEMORY_BYTES_MAX = 128 * 1024 * 1024;
const MEMORY_IDLE_MS = 10_000;

const NodeBuffer = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === undefined
  ? undefined
  : (globalThis as unknown as { Buffer: typeof import("node:buffer").Buffer }).Buffer;
const encoder = new TextEncoder();
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });
const empty: ModuleRecordScan = Object.freeze({
  failed: true,
  staticImports: Object.freeze([]),
  staticExports: Object.freeze([]),
  dynamicImports: Object.freeze([]),
});
let instance: Instance | undefined;

/**
 * Reads the imports and exports of a module, and whether it parses, from one parse that never
 * builds the tree in JavaScript.
 */
export function scanModuleRecord(source: string, options: ScanOptions = {}): ModuleRecordScan {
  const current = instanceOf();
  const { exports } = current;
  const flags = flagsOf(options, current.files);
  const bytes = exports.memory.buffer.byteLength;
  const capacity = source.length * 3 || 1;
  const pointer = exports.module_record_input(capacity) >>> 0;
  if (pointer === 0) throw new Error("yuku: out of memory");
  const written = writeSource(exports.memory.buffer, pointer, capacity, source);
  const record = exports.module_record_scan(written, flags) >>> 0;
  if (exports.memory.buffer.byteLength > bytes) current.grownAt = Date.now();
  if (record === 0) throw new Error("yuku: out of memory");
  return decode(exports.memory.buffer, record, source);
}

function decode(memory: ArrayBuffer, record: number, source: string): ModuleRecordScan {
  const u32 = new Uint32Array(memory, record);
  if (u32[HEADER.failed] !== 0) return empty;
  const poolStart = record + u32[HEADER.poolStart]! * 4;
  const u8 = new Uint8Array(memory, poolStart, u32[HEADER.poolLen]);
  const text = (start: number, end: number): string =>
    start & POOL_BIT ? wtf8(u8, (start & ~POOL_BIT) >>> 0, end) : source.slice(start, end);

  let i = HEADER.words;
  const staticImports = new Array<StaticImport>(u32[HEADER.staticImports]!);
  for (let n = 0; n < staticImports.length; n++, i += STATIC_IMPORT_WORDS) {
    staticImports[n] = readStaticImport(u32, i, text);
  }
  const staticExports = new Array<StaticExport>(u32[HEADER.staticExports]!);
  const entries = (count: number): ExportEntry[] => {
    const list = new Array<ExportEntry>(count);
    for (let n = 0; n < count; n++, i += EXPORT_ENTRY_WORDS) list[n] = readExportEntry(u32, i, text);
    return list;
  };
  for (let n = 0; n < staticExports.length; n++) {
    const at = i;
    i += STATIC_EXPORT_WORDS;
    staticExports[n] = readStaticExport(u32, at, text, entries);
  }
  const dynamicImports = new Array<DynamicImport>(u32[HEADER.dynamicImports]!);
  for (let n = 0; n < dynamicImports.length; n++, i += DYNAMIC_IMPORT_WORDS) {
    dynamicImports[n] = readDynamicImport(u32, i);
  }
  return { failed: false, staticImports, staticExports, dynamicImports };
}

// WTF-8, so a lone surrogate an escape wrote decodes as it does in the tree
function wtf8(u8: Uint8Array, start: number, end: number): string {
  let lone = false;
  for (let i = start; i < end; i++) if (u8[i] === 0xed) lone = true;
  if (!lone) return utf8.decode(u8.subarray(start, end));
  let text = "";
  for (let i = start; i < end; ) {
    const c = u8[i]!;
    if (c < 0x80) {
      text += String.fromCharCode(c);
      i += 1;
    } else if (c < 0xe0) {
      text += String.fromCharCode(((c & 0x1f) << 6) | (u8[i + 1]! & 0x3f));
      i += 2;
    } else if (c < 0xf0) {
      text += String.fromCharCode(((c & 0x0f) << 12) | ((u8[i + 1]! & 0x3f) << 6) | (u8[i + 2]! & 0x3f));
      i += 3;
    } else {
      text += String.fromCodePoint(
        ((c & 0x07) << 18) | ((u8[i + 1]! & 0x3f) << 12) | ((u8[i + 2]! & 0x3f) << 6) | (u8[i + 3]! & 0x3f),
      );
      i += 4;
    }
  }
  return text;
}

function instanceOf(): Instance {
  if (instance === undefined) {
    const exports = new WebAssembly.Instance(tsrx).exports as unknown as Exports;
    instance = { exports, files: filesOf(exports), grownAt: 0 };
  } else if (
    instance.exports.memory.buffer.byteLength > MEMORY_BYTES_MAX &&
    Date.now() - instance.grownAt > MEMORY_IDLE_MS
  ) {
    instance.exports = new WebAssembly.Instance(tsrx).exports as unknown as Exports;
  }
  return instance;
}

function filesOf(exports: Exports): Instance["files"] {
  const pointer = exports.dialect() >>> 0;
  if (pointer === 0) return [];
  const size = new DataView(exports.memory.buffer).getUint32(pointer, true);
  return JSON.parse(utf8.decode(new Uint8Array(exports.memory.buffer, pointer + 4, size))).files;
}

// as Yuku's `parse` reads the options, so a source fails here exactly when it fails there
function flagsOf(options: ScanOptions, files: Instance["files"]): number {
  const path = options.path ?? "";
  const file =
    options.lang === undefined && files.length > 0
      ? path === ""
        ? files[0]
        : files.find((f) => path.endsWith(f.extension))
      : undefined;
  const lang = LANGS[options.lang ?? file?.lang ?? langFromPath(path)];
  if (lang === undefined) throw new TypeError('`lang` must be "js", "jsx", "ts", "tsx", or "dts"');
  const sourceType = SOURCE_TYPES[options.sourceType ?? sourceTypeFromPath(path)];
  if (sourceType === undefined) {
    throw new TypeError('`sourceType` must be "module", "script", or "commonjs"');
  }
  let flags = sourceType | (lang << 2);
  if (options.semanticErrors) flags |= 1 << 6;
  if (file !== undefined) flags |= 1 << 9;
  return flags;
}

function writeSource(memory: ArrayBuffer, pointer: number, capacity: number, source: string): number {
  if (source.length === 0) return 0;
  if (NodeBuffer !== undefined) return NodeBuffer.from(memory, pointer, capacity).write(source);
  return encoder.encodeInto(source, new Uint8Array(memory, pointer, capacity)).written;
}
