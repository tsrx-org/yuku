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

/** Whether `node` is a `<script />` with no closing tag, and so no body. */
function isSelfClosingScript(node) {
  return node.type === "JSXScriptElement" && node.closingElement == null;
}

/**
 * Calls `visit` once on every self-closing `<script />` in `program`. Each
 * object is walked once, so a back-edge a caller added (a `parent`, say) ends
 * the walk instead of looping.
 */
function forEachSelfClosingScript(program, visit) {
  const seen = new Set();
  const pending = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === null || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
      continue;
    }
    if (isSelfClosingScript(value)) visit(value);
    for (const key in value) if (key !== "comments") pending.push(value[key]);
  }
}

/**
 * Removes `content` from every self-closing `<script />` in `program`: it has
 * no body, and core gives it no `content`, where the wire format carries an
 * empty string. Skips the walk when `text` holds no `<script`.
 *
 * @param {object} program
 * @param {string} text Source text the program was decoded from.
 */
export function dropSelfClosingScriptContent(program, text) {
  if (!text.includes("<script")) return;
  forEachSelfClosingScript(program, (script) => {
    delete script.content;
  });
}

/**
 * Runs `callback` with an empty `content` on every self-closing `<script />`
 * in `program` that has none, and removes it again afterwards. The encoder
 * needs the string the wire format carries, and core's shape has none, so any
 * tree in that shape (parsed, cloned, or built by hand) encodes this way.
 *
 * @template T
 * @param {object} program
 * @param {() => T} callback
 * @returns {T}
 */
export function withSelfClosingScriptContent(program, callback) {
  const filled = [];
  forEachSelfClosingScript(program, (script) => {
    if (script.content === undefined) {
      script.content = "";
      filled.push(script);
    }
  });
  try {
    return callback();
  } finally {
    for (const script of filled) delete script.content;
  }
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
 * @returns {T} The same `view`.
 */
export function applyCoreShape(view, text) {
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
        dropSelfClosingScriptContent(program, text);
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
