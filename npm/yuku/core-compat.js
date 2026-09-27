// The `@tsrx/core` shape of a decoded result, shared by every host that
// decodes a yuku-tsrx buffer: the native addon (./index.js), the browser
// playground and the site build's wasm engine. The wire format carries neither
// piece, so each host applies them after decoding, from this one module.

/** Core's message for a dynamic tag expression that isn't an allowed form. */
export const DYNAMIC_TAG_EXPRESSION_MESSAGE =
  "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";

const SCRIPT_END_TAG_IN_BODY_MESSAGE =
  /^'<\/script' can end a script in HTML, so a '<script>' body can't contain it\. Write '<\\\/script' instead\.$/i;

/**
 * The `@tsrx/core` code for a diagnostic, or `undefined` when core has none.
 * The native diagnostic record carries no code field, so it is assigned from
 * core's exact messages; each is one the native parser reports only for that
 * code.
 *
 * A spread or empty dynamic tag (`<{...a} />`, `<{} />`) shares the dynamic
 * tag message, but core raises it as a plain syntax error without a code; the
 * native parser marks it with help text, which the coded diagnostic never has.
 *
 * @param {{ message: string, help: string | null }} diagnostic
 * @returns {string | undefined}
 */
export function diagnosticCode(diagnostic) {
  if (diagnostic.message === DYNAMIC_TAG_EXPRESSION_MESSAGE && diagnostic.help === null) {
    return "tsrx-dynamic-tag-expression";
  }
  if (SCRIPT_END_TAG_IN_BODY_MESSAGE.test(diagnostic.message)) {
    return "tsrx-script-end-tag-in-body";
  }
  return undefined;
}

/** `diagnostic` with its core `code`, when it has one. */
export function withDiagnosticCode(diagnostic) {
  const code = diagnosticCode(diagnostic);
  return code === undefined ? diagnostic : { ...diagnostic, code };
}

/**
 * Removes `content` from every self-closing `<script />` in `program`: it has
 * no body, and core gives it no `content`, where the wire format carries an
 * empty string. Returns the elements it changed, so an encoder can put the
 * empty string back. Skips the walk when `text` holds no `<script`.
 *
 * @param {object} program
 * @param {string} text Source text the program was decoded from.
 * @returns {object[]}
 */
export function dropSelfClosingScriptContent(program, text) {
  if (!text.includes("<script")) return [];
  const scripts = [];
  const pending = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (value.type === "JSXScriptElement" && value.closingElement === null) {
      delete value.content;
      scripts.push(value);
    }
    for (const key in value) if (key !== "comments") pending.push(value[key]);
  }
  return scripts;
}

/**
 * Gives a decoded result (`decode` or the analyzer's `decode`) the core shape,
 * lazily and in place: `diagnostics` gain their `code`, and `program` loses
 * the `content` of every self-closing `<script />`. Every other field of the
 * result is left as decoded.
 *
 * @template {{ program: object, diagnostics: object[] }} T
 * @param {T} view
 * @param {string} text Source text the result was decoded from.
 * @param {(program: object, scripts: object[]) => void} [onSelfClosingScripts]
 *   Called once with the program and the elements whose `content` was removed.
 * @returns {T} The same `view`.
 */
export function applyCoreShape(view, text, onSelfClosingScripts) {
  const decodeProgram = Object.getOwnPropertyDescriptor(view, "program").get;
  const decodeDiagnostics = Object.getOwnPropertyDescriptor(view, "diagnostics").get;
  let program;
  let diagnostics;
  Object.defineProperty(view, "program", {
    configurable: true,
    enumerable: true,
    get() {
      if (program === undefined) {
        program = decodeProgram.call(view);
        const scripts = dropSelfClosingScriptContent(program, text);
        if (scripts.length > 0) onSelfClosingScripts?.(program, scripts);
      }
      return program;
    },
  });
  Object.defineProperty(view, "diagnostics", {
    configurable: true,
    enumerable: true,
    get() {
      return (diagnostics ??= decodeDiagnostics.call(view).map(withDiagnosticCode));
    },
  });
  return view;
}
