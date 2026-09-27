// The `@tsrx/core` shape of a decoded result, shared by every host that
// decodes a yuku-tsrx buffer: the native addon (./index.js), the browser
// playground and the site build's wasm engine. The wire format carries neither
// piece, so each host applies them after decoding, from this one module.

/** Core's message for a dynamic tag expression that isn't an allowed form. */
export const DYNAMIC_TAG_EXPRESSION_MESSAGE =
  "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";

const UNCLOSED_TAG_MESSAGE = /^Unclosed tag '<.*>'\. Expected '<\/.*>' before end of template\.$/;

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
  if (UNCLOSED_TAG_MESSAGE.test(diagnostic.message)) return "tsrx-unclosed-tag";
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
 * Calls `visit` once on every node in `program` that passes `test`. Each
 * object is walked once, so a back-edge a caller added (a `parent`, say) ends
 * the walk instead of looping.
 */
function forEachNode(program, test, visit) {
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
    if (test(value)) visit(value);
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
  forEachNode(program, isSelfClosingScript, (script) => {
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
  forEachNode(program, isSelfClosingScript, (script) => {
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
 * Gives every `{}` that holds comments, braced or a comment between
 * children, the `innerComments` `@tsrx/core`'s parseModule gives it. `comments` is the file's comment list,
 * in source order: only the nodes around a comment are walked.
 */
export function addInnerComments(program, text, comments) {
  if (comments.length === 0) return;
  // The index of the first of the sorted `list` at or after `offset`. The
  // walk asks in source order, mostly, so it steps from its last answer first.
  const seeker = (list) => {
    let last = 0;
    return (offset) => {
      let low = last > 0 && list[last - 1] < offset ? last : 0;
      let high = list.length;
      for (let step = 0; step < 4 && low < high && list[low] < offset; step++) low++;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (list[middle] < offset) low = middle + 1;
        else high = middle;
      }
      return (last = low);
    };
  };
  const firstComment = seeker(comments.map((comment) => comment.start));
  // where each line starts, with core's line breaks (\r\n, \r, \n, U+2028, U+2029)
  let lines, lineAfter;
  const position = (offset) => {
    if (lines === undefined) {
      lines = [
        0,
        ...Array.from(text.matchAll(/\r\n?|[\n\u2028\u2029]/g), (m) => m.index + m[0].length),
      ];
      lineAfter = seeker(lines);
    }
    const line = lineAfter(offset + 1) - 1;
    return { line: line + 1, column: offset - lines[line] };
  };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node?.start !== "number") return;
    let index = firstComment(node.start);
    if (!(comments[index]?.end <= node.end)) return;
    if (node.type !== "JSXEmptyExpression") {
      for (const key in node) if (key !== "comments") visit(node[key]);
      return;
    }
    node.innerComments = [];
    for (; comments[index]?.end <= node.end; index++) {
      const { type, start, end } = comments[index];
      let { value } = comments[index];
      if (type === "Block" && value.includes("\n")) {
        // as core, a block comment's lines lose the indentation of its first line
        const indent = /[ \t]*/.exec(text.slice(text.lastIndexOf("\n", start - 1) + 1, start))[0];
        value = value.replace(new RegExp(`^${indent}`, "gm"), "");
      }
      node.innerComments.push({
        type,
        value,
        start,
        end,
        loc: { start: position(start), end: position(end) },
      });
    }
  };
  visit(program);
}

/**
 * Gives every mapped type in `program` core's `typeParameter`, a
 * `TSTypeParameter` named by the key, for typescript-estree's `key` and
 * `constraint`, which stay on the node unlisted for the encoder.
 */
export function addMappedTypeParameters(program, text) {
  if (!/\bin\b/.test(text)) return;
  forEachNode(
    program,
    (node) => node.type === "TSMappedType" && !node.typeParameter,
    (node) => {
      const { key, constraint } = node;
      node.typeParameter = {
        type: "TSTypeParameter",
        start: key.start,
        end: constraint.end,
        name: key,
        constraint,
      };
      Object.defineProperties(node, {
        key: { enumerable: false },
        constraint: { enumerable: false },
      });
    },
  );
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
