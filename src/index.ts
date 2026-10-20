import { tsrx } from "#module";
import { parse as parseYuku, type ParseOptions, type ParseResult } from "yuku";
import {
  Analyzer as YukuAnalyzer,
  analyze as analyzeYuku,
  type AnalyzeOptions,
  type AnalyzerOptions,
  type Module,
} from "yuku/analyzer";

export type * from "yuku/types";
export type { ParseOptions, ParseResult } from "yuku";
export type * from "yuku/analyzer";
export type { GenerateOptions, GenerateResult, SourceMap, SourceMapOptions } from "yuku/codegen";
export type * from "./ast";
export { BindingFlags } from "yuku/analyzer";
export { generate } from "./codegen";

type TSRXOptions<T> = Omit<T, "lang" | "wasm">;

/**
 * Parses TSRX into an ESTree program, with TSRX's own nodes.
 */
export function parse(source: string, options: TSRXOptions<ParseOptions> = {}): ParseResult {
  return parseYuku(source, { preserveParens: false, ...options, wasm: tsrx });
}

/** Parses and analyzes TSRX, with its scopes, bindings, references, imports, and exports. */
export function analyze(source: string, options: TSRXOptions<AnalyzeOptions> = {}): Module {
  return analyzeYuku(source, { ...options, wasm: tsrx });
}

/** Analyzes a project of TSRX files, resolving imports and exports across them. */
export class Analyzer extends YukuAnalyzer {
  constructor(options: TSRXOptions<AnalyzerOptions> = {}) {
    super({ ...options, wasm: tsrx });
  }
}
