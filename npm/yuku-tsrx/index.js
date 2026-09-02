import binding from "./binding.js";
import { authoredDiagnosticSpan } from "./diagnostic-spans.js";
import { decode } from "./decode.js";
import { decode as decodeAnalyzer } from "./decode-analyzer.js";
import { encode } from "./encode.js";
import { walk } from "./walk.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function sourceText(source) {
  return typeof source === "string" ? source : decoder.decode(source);
}

function inferLang(filename) {
  const lower = filename.split(/[?#]/, 1)[0].toLowerCase();
  if (lower.endsWith(".tsrx") || lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".jsx")) return "jsx";
  if (lower.endsWith(".d.ts")) return "dts";
  if (lower.endsWith(".ts")) return "ts";
  return "js";
}

export function parseWire(source, options = {}) {
  const bytes = typeof source === "string" ? encoder.encode(source) : source;
  return binding.parse(bytes, options);
}

export function parse(source, options = {}) {
  return decode(parseWire(source, options), sourceText(source));
}

/**
 * Analyze a source text, inferring the dialect from `filename` when one is
 * given.
 *
 * The second argument is either a filename or the options object, so the
 * `analyze(source, options)` shape that shipped in 0.1.1 keeps working
 * unchanged. `lang` resolves in this order: an explicit `options.lang` wins,
 * then inference from `filename` (the same `inferLang` `parseModule` uses),
 * then the analyzer's own default.
 *
 * @param {string | Uint8Array} source Source text or its UTF-8 bytes.
 * @param {string | import("./index.d.ts").ParseOptions} [filename]
 *   Filename to infer the dialect from, or the options object.
 * @param {import("./index.d.ts").ParseOptions} [options] Options, when the
 *   second argument is a filename.
 * @returns {import("./index.d.ts").AnalyzeResult}
 */
export function analyze(source, filename, options) {
  let analyzeOptions;
  if (typeof filename === "string") {
    analyzeOptions = { ...options };
    // `??=` and not a truthiness check: an explicitly-undefined `lang` means
    // "not specified", which is exactly what the filename is here to answer.
    analyzeOptions.lang ??= inferLang(filename);
  } else {
    // 0.1.1 shape: the second argument was the options object.
    analyzeOptions = filename ?? options ?? {};
  }
  const text = sourceText(source);
  const bytes = typeof source === "string" ? encoder.encode(source) : source;
  return decodeAnalyzer(binding.analyze(bytes, analyzeOptions), text);
}

const QUOTES_SHORTEST_UNSUPPORTED =
  'yuku-tsrx generate: quotes "shortest" is not supported here; the codegen offers "preserve", "double" and "single", and minify picks the shortest quote itself';

function normalizeGenerateOptions(options) {
  const { minify, sourceMaps, ...next } = options ?? {};
  if (typeof next.comments === "boolean") next.comments = next.comments ? "all" : "none";
  const modes = minify === true ? { whitespace: true, syntax: true, quotes: true } : minify || {};
  next.minify = !!modes.syntax;
  if (modes.whitespace) next.format = "compact";
  if (modes.quotes) next.quotes = "shortest";
  if (next.quotes === "shortest") {
    if (!next.minify) throw new TypeError(QUOTES_SHORTEST_UNSUPPORTED);
    delete next.quotes;
  }
  if (sourceMaps) next.sourceMaps = sourceMapOptions(sourceMaps);
  return next;
}

function sourceMapOptions(sourceMaps) {
  if (typeof sourceMaps !== "object" || typeof sourceMaps.source !== "string") {
    throw new TypeError(
      "yuku-tsrx generate: sourceMaps.source must be the source text the program was parsed from",
    );
  }
  const { source, file, sourceFileName, sourceRoot, sourcesContent } = sourceMaps;
  return {
    source,
    file,
    sourceFileName,
    sourceRoot,
    sourcesContent: sourcesContent === true ? source : undefined,
  };
}

export function generate(program, options) {
  if (!program || program.type !== "Program") {
    throw new TypeError("Expected a Program node from yuku-tsrx");
  }
  return binding.generate(encode(program), normalizeGenerateOptions(options));
}

export function parseModule(source, filename, options = {}) {
  const { collect = false, loose = false, errors, comments, ...parseOptions } = options;
  const text = sourceText(source);
  const result = parse(source, {
    ...parseOptions,
    lang: parseOptions.lang ?? inferLang(filename),
    sourceType: "module",
    loose,
    // A module boundary owes its caller the scope-dependent early errors, not
    // just the grammar ones. Without them an undeclared export slips through,
    // and a bundler that reads a parse throw as "this chunk still has live
    // exports" will strip a body while keeping its exports.
    semanticErrors: parseOptions.semanticErrors ?? true,
    attachComments: parseOptions.attachComments ?? comments !== undefined,
  });
  // Fill on the same condition that enabled attachment above. Gating the fill
  // on `collect || loose` meant a caller who passed only a `comments` array
  // paid for comment attachment and got an empty array back.
  if (comments) comments.push(...result.comments);
  // Only `error` severity makes a module unusable. The native boundary lowers
  // the early errors a mid-edit file still recovers from -- redeclarations --
  // to `warning`, so they stay visible on `parse()` without failing the module
  // here. See src/dialect/diagnostics.zig for how that set was derived.
  // Place the malformed-markup diagnostics on the markup the author wrote
  // before anyone reads them, so the collected `errors` and the thrown message
  // agree with each other and with what a reader would underline. See
  // ./diagnostic-spans.js for which shapes this covers and why it is here
  // rather than at the seam that assigns the spans.
  const fatal = result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => ({ ...diagnostic, ...authoredDiagnosticSpan(diagnostic, text) }));
  if (fatal.length > 0) {
    if (collect || loose) {
      if (errors) errors.push(...fatal);
      return result.program;
    }
    const diagnostic = fatal[0];
    throw new SyntaxError(`${diagnostic.message} (${diagnostic.start}:${diagnostic.end})`);
  }
  return result.program;
}

export function isEventAttribute(attribute) {
  return (
    attribute.startsWith("on") &&
    attribute.length > 2 &&
    attribute[2] === attribute[2].toUpperCase()
  );
}

export function normalizeEventName(attribute) {
  let name = attribute.slice(2);
  const lower = name.toLowerCase();
  if (name.endsWith("Capture") && lower !== "gotpointercapture" && lower !== "lostpointercapture") {
    name = name.slice(0, -7);
  }
  return name.toLowerCase();
}

// ---------------------------------------------------------------------------
// Source positions
//
// Diagnostics and comments carry byte-free UTF-16 offsets into the source text.
// Editor hosts and error reporters want line/column instead, and every consumer
// had been writing the same conversion. `line` is 1-based, `column` is 0-based,
// which is what the ESTree `loc` convention and most editors expect.
// ---------------------------------------------------------------------------

/**
 * Convert an offset into the `{ line, column }` position it falls on.
 * Offsets outside `source` are clamped to its bounds rather than throwing, so a
 * diagnostic whose span ran past the end of a truncated file still reports a
 * usable position.
 *
 * @param {string} source Source text the offset indexes into.
 * @param {number} offset UTF-16 offset into `source`.
 * @returns {{ line: number, column: number }} 1-based line, 0-based column.
 */
export function sourcePosition(source, offset) {
  const bounded = Math.max(0, Math.min(source.length, offset));
  let line = 1;
  let lineStart = -1;
  for (let index = source.indexOf("\n"); index !== -1 && index < bounded; ) {
    line += 1;
    lineStart = index;
    index = source.indexOf("\n", index + 1);
  }
  return { line, column: bounded - lineStart - 1 };
}

/**
 * Convert a `[start, end)` offset span into an ESTree-shaped `loc`.
 *
 * @param {string} source Source text the offsets index into.
 * @param {number} start Offset the span opens at.
 * @param {number} end Offset the span closes at.
 * @returns {{ start: { line: number, column: number }, end: { line: number, column: number } }}
 */
export function sourceLocation(source, start, end) {
  return { start: sourcePosition(source, start), end: sourcePosition(source, end) };
}

// ---------------------------------------------------------------------------
// Program normalization
//
// The TSRX dialect wraps three control-flow forms around an ordinary statement
// node: `JSXForExpression` holds a `ForOfStatement`/`ForStatement`,
// `JSXSwitchExpression` a `SwitchStatement`, `JSXTryExpression` a
// `TryStatement`. Generic ESTree tooling reaches for `node.left` or
// `node.cases` directly and finds nothing, because those live one level down on
// `node.statement`. `normalizeProgram` adds the missing names as
// non-enumerable aliases, so the tooling resolves them while serializers and
// tree walkers still see one canonical child.
// ---------------------------------------------------------------------------

const WRAPPER_ALIASES = {
  JSXForExpression: ["left", "right", "body", "index", "key", "await"],
  JSXSwitchExpression: ["discriminant", "cases"],
  JSXTryExpression: ["block", "handler", "finalizer"],
};

/**
 * Walk a program and alias each dialect wrapper's inner-statement fields onto
 * the wrapper itself. Mutates and returns `program`; it is idempotent, and it
 * never overwrites a field the node already owns.
 *
 * @template {object} T
 * @param {T} program Program (or any subtree) to normalize.
 * @param {{ onNode?: (node: Record<string, unknown>) => void }} [options]
 *   `onNode` runs once per visited object node before aliasing, which lets a
 *   consumer fold its own per-node pass into this single traversal instead of
 *   walking the tree a second time.
 * @returns {T} The same `program`, normalized in place.
 */
export function normalizeProgram(program, options = {}) {
  const { onNode } = options;
  const visited = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    if (onNode) onNode(value);
    const aliases = typeof value.type === "string" ? WRAPPER_ALIASES[value.type] : undefined;
    const statement = value.statement;
    if (aliases && statement && typeof statement === "object") {
      for (const name of aliases) {
        if (Object.hasOwn(value, name)) continue;
        Object.defineProperty(value, name, {
          configurable: true,
          // Non-enumerable so the alias stays invisible to `Object.values`
          // walks, to serializers, and to this traversal's own recursion.
          enumerable: false,
          value: statement[name],
          writable: true,
        });
      }
    }

    for (const child of Object.values(value)) visit(child);
  };
  visit(program);
  return program;
}

// ---------------------------------------------------------------------------
// Duplicate lexical declarations
//
// `analyze()` does not report redeclaration today, so consumers that want it
// have been re-deriving it from the AST. This is that derivation, done once
// here.
//
// TODO(zig): move this into the Zig analyzer and report it through
// `analyze().semantic`, which already builds the scope and binding tables this
// re-walks. Until then this JS pass is the supported surface, and it covers
// only statement-list `VariableDeclaration`s -- not function, class, import,
// parameter, or catch-clause bindings, and not the cross-scope cases (a `let`
// shadowed by a nested `var`) that need real scope analysis.
// ---------------------------------------------------------------------------

const STATEMENT_LIST_TYPES = new Set([
  "Program",
  "BlockStatement",
  "JSXCodeBlock",
  "StaticBlock",
  "TSModuleBlock",
]);

/**
 * @typedef {object} DuplicateBinding
 * @property {string} name Identifier declared more than once.
 * @property {{ start: number, end: number }} declaration Span of the first declaration.
 * @property {{ start: number, end: number }} redeclaration Span of the later one.
 */

/**
 * Find names a statement list declares more than once.
 *
 * Two `var`s of the same name are legal and are not reported. Every other
 * repeat within one statement list is, including `let`/`const` repeats and a
 * `var` that collides with a lexical declaration beside it. Destructuring
 * patterns are walked, so `const { a } = x; const [a] = y;` is caught.
 *
 * Results are in source order per statement list, and one entry is produced per
 * repeat: a name declared three times yields two entries, each pairing the
 * repeat against the first declaration.
 *
 * @param {object} program Program (or any subtree) to scan.
 * @param {string} source Source text the program was parsed from; identifier
 *   names are read back out of it by span.
 * @returns {DuplicateBinding[]}
 */
export function duplicateBindings(program, source) {
  const duplicates = [];
  const visited = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value.type === "string" && STATEMENT_LIST_TYPES.has(value.type)) {
      collectStatementListDuplicates(value.body, duplicates, source);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(program);
  return duplicates;
}

function collectStatementListDuplicates(body, duplicates, source) {
  if (!Array.isArray(body)) return;
  const declared = new Map();
  for (const statement of body) {
    if (!statement || typeof statement !== "object") continue;
    if (statement.type !== "VariableDeclaration" || !Array.isArray(statement.declarations)) {
      continue;
    }
    const kind = typeof statement.kind === "string" ? statement.kind : "";
    for (const declarator of statement.declarations) {
      if (!declarator || typeof declarator !== "object") continue;
      for (const binding of bindingIdentifiers(declarator.id, source)) {
        const existing = declared.get(binding.name);
        if (!existing) {
          declared.set(binding.name, { ...binding, kind });
          continue;
        }
        // `var x; var x;` is a legal redeclaration. Anything reaching a
        // lexical binding is not.
        if (kind === "var" && existing.kind === "var") continue;
        duplicates.push({
          name: binding.name,
          declaration: { start: existing.start, end: existing.end },
          redeclaration: { start: binding.start, end: binding.end },
        });
      }
    }
  }
}

function bindingIdentifiers(value, source) {
  if (!value || typeof value !== "object") return [];
  if (
    value.type === "Identifier" &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  ) {
    return [{ name: source.slice(value.start, value.end), start: value.start, end: value.end }];
  }
  if (value.type === "RestElement") return bindingIdentifiers(value.argument, source);
  if (value.type === "AssignmentPattern") return bindingIdentifiers(value.left, source);
  if (value.type === "TSParameterProperty") return bindingIdentifiers(value.parameter, source);
  if (value.type === "ArrayPattern" && Array.isArray(value.elements)) {
    return value.elements.flatMap((element) => bindingIdentifiers(element, source));
  }
  if (value.type === "ObjectPattern" && Array.isArray(value.properties)) {
    return value.properties.flatMap((property) => {
      if (!property || typeof property !== "object") return [];
      return bindingIdentifiers(property.type === "Property" ? property.value : property, source);
    });
  }
  return [];
}

/**
 * `duplicateBindings` rendered as `Diagnostic`s, so a consumer that already has
 * a diagnostic pipeline can concatenate them onto a parse's own diagnostics
 * instead of formatting the spans itself. Each carries both spans as labels:
 * the original declaration first, the repeat second.
 *
 * @param {object} program Program (or any subtree) to scan.
 * @param {string} source Source text the program was parsed from.
 * @returns {import("./index.d.ts").Diagnostic[]}
 */
export function duplicateBindingDiagnostics(program, source) {
  return duplicateBindings(program, source).map((duplicate) => ({
    severity: "error",
    message: `Identifier '${duplicate.name}' has already been declared`,
    start: duplicate.redeclaration.start,
    end: duplicate.redeclaration.end,
    help: `Consider removing or renaming this declaration of '${duplicate.name}'`,
    labels: [
      { start: duplicate.declaration.start, end: duplicate.declaration.end },
      { start: duplicate.redeclaration.start, end: duplicate.redeclaration.end },
    ],
  }));
}

export { authoredDiagnosticSpan, decode, decodeAnalyzer, encode, walk };
