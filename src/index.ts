import { tsrx } from "#module";
import { parse as parseYuku, type ParseOptions, type ParseResult } from "yuku";
import { analyze as analyzeYuku, type AnalyzeOptions, type Module } from "yuku/analyzer";

export type * from "./ast";
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
