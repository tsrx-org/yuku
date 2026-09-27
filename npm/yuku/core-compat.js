// The `@tsrx/core` shape of a decoded result, shared by every host that
// decodes a yuku-tsrx buffer: the native addon (./index.js), the browser
// playground and the site build's wasm engine. The wire format carries neither
// piece, so each host applies them after decoding, from this one module.

/** Core's message for a dynamic tag expression that isn't an allowed form. */
export const DYNAMIC_TAG_EXPRESSION_MESSAGE =
  "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";

// The `@tsrx/core` code of each native message: TSRX's own code for a mistake
// only TSRX reports, and TypeScript's for one TypeScript also reports, the
// code core gives the same mistake. A message that could be more than one
// mistake (a `return` in any template block, an `'export'` in a function or a
// block) has none.
const MESSAGE_CODES = [
  [
    /^Unclosed tag '<.*>'\. Expected '<\/.*>' before end of template\.$|^Expected '<\/' to close the JSX element, but found 'end of file'$/,
    "TSRX1001",
  ],
  [/^Expected closing tag for '<[^']*>' but found '<\/[^']*>'$/, "TSRX1002"],
  [/^'<\/script' can end a script in HTML, /i, "TSRX1004"],
  [/^Expected '\{' after TSRX control-flow directive$/, "TSRX1008"],
  [/^TSRX try directive requires /, "TSRX1010"],
  [/^Expected unique 'index' then 'key' clauses /, "TSRX1011"],
  [/^`break` is invalid inside `@switch` cases\.$/, "TSRX2008"],
  [/^`return` is invalid inside `@switch` cases\.$/, "TSRX2009"],
  [/^A dynamic tag expression must be /, "TSRX2014"],
  [/^Duplicate import attribute key /, "TSRX4003"],
  [/^(?:Identifier|type) '[^']+' has already been declared\.?$|^Argument name clash$/, "TS2300"],
  [/^Duplicate (?:private name|export of) '/, "TS2300"],
  [/^Export '[^']+' is not defined$/, "TS2304"],
  // a missing token, but not a TSRX directive's or an element's closing tag
  [
    /^Expected (?!.*(?:TSRX|'@|for-of))(?:'[^'<]*'(?: or '[^']*')? (?:to close|in|after) |a semicolon or an implicit )/,
    "TS1005",
  ],
  [/^Unexpected token\b/, "TS1012"],
  [/^Unexpected '\}' in JSX text$/, "TS1381"],
  [/^Unexpected '>' in JSX text$/, "TS1382"],
  [/^'import' declaration may only appear at the top level$/, "TS1232"],
  [/^'export \*' declaration may only appear at the top level$/, "TS1233"],
  [/^'return' statement is only valid inside a function$/, "TS1108"],
  [/^Private field '#[^']*' must be declared in an enclosing class$/, "TS1111"],
  [/^'(?:const|using|await using)' declarations must be initialized$/, "TS1155"],
  [/^Destructuring declaration must have an initializer$/, "TS1182"],
  [/^Rest parameter (?:must be last formal parameter|may not have a trailing comma)$/, "TS1013"],
  [/^Getter must have no parameters$/, "TS1054"],
  [/^Setter must have exactly one parameter$/, "TS1049"],
  [/^A class can only have one constructor$/, "TS2392"],
  [/^An abstract method cannot have an implementation$/, "TS1245"],
  [/^'super\(\)' is only valid in a constructor of a derived class$/, "TS2337"],
  [/^Optional chaining is not allowed in assignment pattern$/, "TS2779"],
  [/^Optional chaining is not allowed in new expression$/, "TS1209"],
  [/^Private fields cannot be deleted$/, "TS18011"],
  [/^Duplicate '__proto__' property in object literal$/, "TS1117"],
  [/^Logical expressions and nullish coalescing cannot be mixed$/, "TS5076"],
  [/^Try statement requires catch or finally clause$/, "TS1472"],
  [/^A switch statement can only have one default clause$/, "TS1113"],
  [/^Duplicate label '/, "TS1114"],
  [/^Illegal break statement$/, "TS1105"],
  [/^Illegal continue statement$/, "TS1104"],
  [/^Illegal newline after throw$/, "TS1142"],
  [/^'with' statements are not allowed in strict mode$/, "TS1101"],
  [/^'(?:eval|arguments)' is not allowed as a binding identifier in strict mode$/, "TS1100"],
  [/^'await' is reserved in an async\/module context /, "TS1262"],
  [/^Import attribute value must be a string literal$/, "TS2858"],
  [/^Unterminated string literal$/, "TS1002"],
  [/^Unterminated multi-line comment$/, "TS1010"],
  [/^Unterminated template literal$/, "TS1160"],
  [/^Unterminated regular expression(?: literal)?$/, "TS1161"],
  [/^Invalid regular expression flag$/, "TS1499"],
  [/^Duplicate regular expression flag$/, "TS1500"],
  [/^Octal literals are not allowed in strict mode$/, "TS1124"],
  [/^Identifier cannot immediately follow a numeric literal$/, "TS1351"],
  [/^Hexadecimal literal must contain at least one hex digit$/, "TS1125"],
  [/^Numeric separator cannot appear at the end of a numeric literal$/, "TS6188"],
];

/**
 * The `@tsrx/core` code for a diagnostic, or `undefined` when core has none
 * or the message doesn't say which it is. The native diagnostic record carries
 * no code field, so it is assigned from the message, as core assigns its own.
 *
 * @param {{ message: string }} diagnostic
 * @returns {string | undefined}
 */
export function diagnosticCode(diagnostic) {
  return MESSAGE_CODES.find(([pattern]) => pattern.test(diagnostic.message))?.[1];
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
  // the index of the first of the sorted `list` at or after `offset`
  const seek = (list, offset) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle] < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const starts = comments.map((comment) => comment.start);
  // where each line starts, with core's line breaks (\r\n, \r, \n, U+2028, U+2029)
  let lines;
  const position = (offset) => {
    if (lines === undefined) {
      lines = [
        0,
        ...Array.from(text.matchAll(/\r\n?|[\n\u2028\u2029]/g), (m) => m.index + m[0].length),
      ];
    }
    const line = seek(lines, offset + 1) - 1;
    return { line: line + 1, column: offset - lines[line] };
  };
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node?.start !== "number") return;
    let index = seek(starts, node.start);
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
