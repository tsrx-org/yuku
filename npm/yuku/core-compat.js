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
// mistake (an `'export'` in a function or a block) has none.
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
  // only where core reports it: see src/dialect/returns.zig
  [/^`return` is invalid inside TSRX template blocks$/, "TSRX2001"],
  [/^`break` is invalid inside `@switch` cases\.$/, "TSRX2008"],
  [/^A code block renders a single node; /, "TSRX2011"],
  [/^Code must be at the top of '@\{ \}'; /, "TSRX2012"],
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
  // a `@for` tail clause with no value, where acorn reads a token
  [/^Expected an expression after a for-of tail clause$/, "TS1012"],
  // a directive's header or `@switch` body that isn't what the grammar reads
  [
    /^(?:Expected (?:a condition after '@if \('|'\)' after '@if' condition|an expression after '@switch \('|'\)' after '@switch' expression|'@case' or '@default' in TSRX switch body|a value after '@case'|':' after TSRX switch clause)$)/,
    "TS1012",
  ],
  // a directive keyword with no `(` after it, which acorn reads as a keyword
  [/^Expected '\(' after '@(?:if|switch)'$/, "TS1359"],
  [/^'[^']+' is reserved in strict mode and cannot be used as /, "TS1212"],
  [/^'[^']+' is reserved and cannot be used as /, "TS1359"],
  [/^Expected 'class' keyword, but found /, "TS1206"],
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

/**
 * The offset before the whitespace and comments that end right before
 * `offset`. A `//` earlier on the line is read as a comment running to
 * `offset`.
 */
function skipTriviaBefore(text, offset) {
  let index = offset;
  for (;;) {
    const before = index;
    let lineStart = index;
    while (lineStart > 0 && !/[\n\r\u2028\u2029]/.test(text[lineStart - 1])) lineStart--;
    const lineComment = text.indexOf("//", lineStart);
    if (lineComment !== -1 && lineComment < index) index = lineComment;
    while (index > 0 && /\s/.test(text[index - 1])) index--;
    if (text[index - 1] === "/" && text[index - 2] === "*") {
      const open = text.lastIndexOf("/*", index - 3);
      if (open !== -1) index = open;
    }
    if (index === before) return index;
  }
}

/** The offset of the first token at or after `offset`, past whitespace and comments. */
function skipTriviaAfter(text, offset) {
  let index = offset;
  while (index < text.length) {
    if (/\s/.test(text[index])) index++;
    else if (text[index] === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
      index = skipComment(text, index);
    } else break;
  }
  return index;
}

/** The offset after the comment that starts at `start`. */
function skipComment(text, start) {
  if (text[start + 1] === "*") {
    const close = text.indexOf("*/", start + 2);
    return close === -1 ? text.length : close + 2;
  }
  const newline = /[\n\r\u2028\u2029]/g;
  newline.lastIndex = start + 2;
  return newline.exec(text)?.index ?? text.length;
}

/** The offset after the string literal whose quote is at `start`. */
function skipQuoted(text, start) {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") index += 2;
    else if (text[index] === quote) return index + 1;
    else index++;
  }
  return text.length;
}

const IDENTIFIER = /[\p{ID_Start}$_\\](?:[\p{ID_Continue}$\\]|\u200c|\u200d)*/uy;
const NUMBER = /(?:\d[\w.]*|\.\d[\w]*)(?:[eE][+-]\d+)?/y;
// acorn's punctuators, longest first; any other character is a token of its own
const PUNCTUATOR =
  />>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.(?!\d)|\+\+|--|[-+*/%&|^]=|\*\*|<<|>>/y;

/** The identifier or keyword that starts at `offset`, or `undefined`. */
function wordAt(text, offset) {
  IDENTIFIER.lastIndex = offset;
  return IDENTIFIER.exec(text)?.[0];
}

/**
 * The end of the token acorn reads at `offset`: a name, a private name, a
 * string or a number whole, a punctuator, and any other character alone (a
 * backtick, the `/` of a regular expression, a JSX `<`).
 */
function tokenEnd(text, offset) {
  if (offset >= text.length) return text.length;
  const character = text[offset];
  const word = wordAt(text, character === "#" ? offset + 1 : offset);
  if (word !== undefined) return offset + (character === "#" ? 1 : 0) + word.length;
  if (character === '"' || character === "'") return skipQuoted(text, offset);
  for (const pattern of [NUMBER, PUNCTUATOR]) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (match !== null) return offset + match[0].length;
  }
  return offset + 1;
}

/**
 * The directive keyword (`if`, `for`, `try`, …) right after an `@` that ends
 * before `offset`, give or take whitespace, comments and a `( … )` header:
 * its name and where it starts, or `undefined`.
 */
function directiveBefore(text, offset) {
  let index = skipTriviaBefore(text, offset);
  if (text[index - 1] === ")") {
    const open = text.lastIndexOf("(", index - 1);
    if (open === -1) return undefined;
    index = skipTriviaBefore(text, open);
  }
  const end = index;
  while (index > 0 && /[a-z]/.test(text[index - 1])) index--;
  if (index === end || text[index - 1] !== "@") return undefined;
  return { keyword: text.slice(index, end), start: index };
}

/**
 * The directive whose block's `}` ends right before `offset`, give or take
 * whitespace and comments, or `undefined`. The braces between are matched as
 * written.
 */
function directiveBlockBefore(text, offset) {
  const close = skipTriviaBefore(text, offset) - 1;
  if (text[close] !== "}") return undefined;
  let depth = 0;
  for (let index = close; index >= 0; index--) {
    if (text[index] === "}") depth++;
    else if (text[index] === "{" && --depth === 0) return directiveBefore(text, index);
  }
  return undefined;
}

// The branch each directive takes after its block, written with an `@`.
const DIRECTIVE_BRANCHES = { if: ["else"], for: ["empty"], try: ["pending", "catch"] };

// The words acorn reads as keywords, which it reports as `Unexpected keyword`
// where a name should be.
const KEYWORDS = new Set(
  (
    "break case catch continue debugger default do else finally for function if return switch " +
    "throw try var while with null true false instanceof typeof void delete new in this const " +
    "class extends export import super"
  ).split(" "),
);
// The words reserved only in strict mode, which acorn reports as TS1212.
const STRICT_RESERVED = new Set(
  "implements interface let package private protected public static yield".split(" "),
);

/**
 * Whether the word at `offset` comes right after an `@` (a decorator's name,
 * or a directive keyword core doesn't read as one) or after the keyword that
 * declares it (`const`, `let`, `var`, `using`, `function`), where acorn reads
 * a name and raises on a keyword once it has read the token after it.
 */
function keywordReadAsName(text, offset) {
  const before = skipTriviaBefore(text, offset);
  if (text[before - 1] === "@") return true;
  let start = before;
  while (start > 0 && /[a-z]/.test(text[start - 1])) start--;
  return /^(?:const|let|var|using|function)$/.test(text.slice(start, before));
}

/**
 * A directive branch written without its `@` (`@if (a) {} else {}`) at
 * `offset`, which core reports as TSRX1009 over the word: the diagnostic for
 * it, or `undefined`.
 */
function branchWithoutAt(diagnostic, text, offset) {
  const word = wordAt(text, offset);
  const directive = directiveBlockBefore(text, offset);
  if (word === undefined || !DIRECTIVE_BRANCHES[directive?.keyword]?.includes(word)) {
    return undefined;
  }
  return {
    ...diagnostic,
    message: `Expected '@${word}' after the '@${directive.keyword}' block`,
    code: "TSRX1009",
    start: offset,
    end: offset + word.length,
    raisedAt: offset + word.length,
  };
}

/**
 * `diagnostic` (with its code) as `@tsrx/core` reports the mistake: where
 * core's error points and the code core gives it, when the message alone
 * doesn't say. `raisedAt` is where acorn stopped reading: the end of the
 * token the diagnostic is on, or, for a keyword where a name should be, the
 * end of the token after it.
 *
 * A directive keyword with no `(` or `{` after it (`@if`, `@for`, `@switch`,
 * `@try`) is acorn's `Unexpected keyword`, TS1359, at the keyword; the body
 * of a `@catch` or `@pending` that doesn't open with `{` is `Unexpected
 * token`, TS1012. A branch written without its `@` is TSRX1009.
 *
 * @template {{ message: string, start: number, end: number, code?: string }} D
 * @param {D} diagnostic
 * @param {string} text Source text the diagnostic was produced from.
 * @returns {D & { raisedAt: number }}
 */
export function coreDiagnostic(diagnostic, text) {
  const reported = { ...withDiagnosticCode(diagnostic), raisedAt: diagnostic.end };
  const { message } = diagnostic;
  if (reported.code === "TSRX1010" && text[diagnostic.start] === "@") {
    // `@try {} catch {}`: the branch without its `@`
    const after = skipTriviaAfter(text, diagnostic.end);
    const branch = branchWithoutAt(reported, text, after);
    if (branch !== undefined) return branch;
    // a `@try` with neither `@pending` nor `@catch` is reported at its
    // keyword, once acorn has read the token after its block
    return { ...reported, start: diagnostic.start + 1, raisedAt: tokenEnd(text, after) };
  }
  // `@for (…) {} empty {}`: the `{` after the branch without its `@`
  if (reported.code === "TS1005" && message.startsWith("Expected a semicolon ")) {
    const before = skipTriviaBefore(text, diagnostic.start);
    let start = before;
    while (start > 0 && /[a-z]/.test(text[start - 1])) start--;
    return branchWithoutAt(reported, text, start) ?? reported;
  }
  if (["TS1359", "TS1212", "TS1262"].includes(reported.code) && / is reserved /.test(message)) {
    const branch = branchWithoutAt(reported, text, diagnostic.start);
    if (branch !== undefined) return branch;
    // a keyword read as a name, after an `@` or as a declared name: acorn
    // raises once it has read the token after it
    if (keywordReadAsName(text, diagnostic.start)) {
      return { ...reported, raisedAt: tokenEnd(text, skipTriviaAfter(text, diagnostic.end)) };
    }
    return reported;
  }
  // a shorthand attribute with no `}`: core's tag tokenizer has read the
  // attribute's text up to its `}`, or through the tag's `>`
  if (reported.code === "TS1005" && /shorthand attribute/.test(message)) {
    const close = /}|(?<!=)>/g;
    close.lastIndex = diagnostic.start;
    const found = close.exec(text);
    const raisedAt = found === null ? text.length : found.index + (found[0] === ">" ? 1 : 0);
    return { ...reported, raisedAt };
  }
  const keywordError =
    /^Expected '\(' after '@(?:if|switch)'$|^Expected '\(' after 'for', /.test(message) ||
    reported.code === "TSRX1008";
  if (!keywordError) return reported;
  const directive = directiveBefore(text, diagnostic.start);
  if (directive === undefined) {
    // `@else if x`: an `if` with no `@` is acorn's, which reads a token there
    return reported.code === "TS1359" ? { ...reported, code: "TS1012" } : reported;
  }
  if (reported.code === "TSRX1008") {
    if (directive.keyword === "catch" || directive.keyword === "pending") reported.code = "TS1012";
    if (directive.keyword !== "try") return reported;
  } else if (!["if", "for", "switch"].includes(directive.keyword)) {
    return reported;
  }
  return { ...reported, code: "TS1359", start: directive.start };
}

/**
 * The first `@` before `limit` that opens a statement of a code block or a
 * block with nothing after it that acorn reads as a decorator's name: no
 * name, no `(`, and no directive keyword or `{` right after it. Acorn fails
 * at the token after that `@`, before it reads anything later, so a later
 * diagnostic of the native parser never hides it. An `@` in element text is
 * text, and an `@` followed by a name is a decorator.
 *
 * Returns the diagnostic core raises there, or `undefined`:
 * - a keyword is TS1359, or TS1212 for one reserved only in strict mode, or
 *   TS1262 for `await`, raised once acorn has read the token after it;
 * - any other token is TS1012.
 *
 * @param {string} text
 * @param {number} limit Start of the first diagnostic the native parser reported.
 * @returns {{ message: string, code: string, start: number, end: number, raisedAt: number, severity: "error", labels: [], help: null } | undefined}
 */
export function bareAtDiagnostic(text, limit) {
  for (let index = 0; index < limit; index++) {
    const character = text[index];
    if (character === '"' || character === "'" || character === "`") {
      index = skipQuoted(text, index) - 1;
      continue;
    }
    if (character === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
      index = skipComment(text, index) - 1;
      continue;
    }
    if (character !== "@" || text[index + 1] === "{" || wordAt(text, index + 1) !== undefined) {
      continue;
    }
    // only where a statement starts: right after the `{` of a code block or
    // of a block (a directive's, a function's, an `if`'s), not in element text
    const open = skipTriviaBefore(text, index) - 1;
    if (text[open] !== "{") continue;
    const opener = text[skipTriviaBefore(text, open) - 1];
    if (opener !== "@" && opener !== ")" && directiveBefore(text, open) === undefined) continue;
    const next = skipTriviaAfter(text, index + 1);
    if (next > limit) return undefined;
    // `@(…)` is a decorator
    if (text[next] === "(") return undefined;
    const word = wordAt(text, next);
    const end = tokenEnd(text, next);
    const diagnostic = {
      start: next,
      end,
      raisedAt: end,
      severity: "error",
      labels: [],
      help: null,
    };
    if (word === undefined) {
      const found = next >= text.length ? "end of file" : text.slice(next, end);
      return {
        ...diagnostic,
        message: `Expected a decorator name after '@', but found '${found}'`,
        code: "TS1012",
      };
    }
    const raisedAt = tokenEnd(text, skipTriviaAfter(text, end));
    if (KEYWORDS.has(word)) {
      return {
        ...diagnostic,
        raisedAt,
        message: `'${word}' is reserved and cannot be used as an identifier`,
        code: "TS1359",
      };
    }
    if (STRICT_RESERVED.has(word)) {
      return {
        ...diagnostic,
        raisedAt,
        message: `'${word}' is reserved in strict mode and cannot be used as an identifier`,
        code: "TS1212",
      };
    }
    if (word === "await") {
      return {
        ...diagnostic,
        raisedAt,
        message:
          "'await' is reserved in an async/module context and cannot be used as an identifier",
        code: "TS1262",
      };
    }
    // a name: the `@` is a decorator
    return undefined;
  }
  return undefined;
}

/**
 * The 1-based line and 0-based column of `offset` in `text`, with acorn's line
 * breaks: `\r\n`, `\r`, `\n`, U+2028 and U+2029.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {{ line: number, column: number }}
 */
export function corePosition(text, offset) {
  const bounded = Math.max(0, Math.min(text.length, offset));
  let line = 1;
  let lineStart = 0;
  const breaks = /\r\n?|[\n\u2028\u2029]/g;
  for (let match = breaks.exec(text); match !== null && match.index < bounded; ) {
    line++;
    lineStart = match.index + match[0].length;
    match = breaks.exec(text);
  }
  return { line, column: bounded - lineStart };
}

/**
 * Gives every `TemplateElement` in a TypeScript `program` the span
 * `@tsrx/core` gives it, its text alone, as acorn spans one: typescript-estree's
 * span, which the decoder gives a TypeScript tree, also covers the backtick
 * and the `${` or `}` around the text. Skips the walk when `text` holds no
 * backtick.
 */
export function narrowTemplateElements(program, text) {
  if (!text.includes("`")) return;
  forEachNode(
    program,
    (node) => node.type === "TemplateElement",
    (node) => {
      node.start += 1;
      node.end -= node.tail ? 1 : 2;
    },
  );
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

// acorn-jsx's XHTML entity table, which acorn-typescript's `jsx_readEntity`
// reads for `@tsrx/core`: each name and the code point it stands for, in hex.
const XHTML_ENTITIES = new Map(
  `
quot:22 amp:26 apos:27 lt:3c gt:3e nbsp:a0 iexcl:a1 cent:a2 pound:a3
curren:a4 yen:a5 brvbar:a6 sect:a7 uml:a8 copy:a9 ordf:aa laquo:ab
not:ac shy:ad reg:ae macr:af deg:b0 plusmn:b1 sup2:b2 sup3:b3 acute:b4
micro:b5 para:b6 middot:b7 cedil:b8 sup1:b9 ordm:ba raquo:bb frac14:bc
frac12:bd frac34:be iquest:bf Agrave:c0 Aacute:c1 Acirc:c2 Atilde:c3
Auml:c4 Aring:c5 AElig:c6 Ccedil:c7 Egrave:c8 Eacute:c9 Ecirc:ca Euml:cb
Igrave:cc Iacute:cd Icirc:ce Iuml:cf ETH:d0 Ntilde:d1 Ograve:d2
Oacute:d3 Ocirc:d4 Otilde:d5 Ouml:d6 times:d7 Oslash:d8 Ugrave:d9
Uacute:da Ucirc:db Uuml:dc Yacute:dd THORN:de szlig:df agrave:e0
aacute:e1 acirc:e2 atilde:e3 auml:e4 aring:e5 aelig:e6 ccedil:e7
egrave:e8 eacute:e9 ecirc:ea euml:eb igrave:ec iacute:ed icirc:ee
iuml:ef eth:f0 ntilde:f1 ograve:f2 oacute:f3 ocirc:f4 otilde:f5 ouml:f6
divide:f7 oslash:f8 ugrave:f9 uacute:fa ucirc:fb uuml:fc yacute:fd
thorn:fe yuml:ff OElig:152 oelig:153 Scaron:160 scaron:161 Yuml:178
fnof:192 circ:2c6 tilde:2dc Alpha:391 Beta:392 Gamma:393 Delta:394
Epsilon:395 Zeta:396 Eta:397 Theta:398 Iota:399 Kappa:39a Lambda:39b
Mu:39c Nu:39d Xi:39e Omicron:39f Pi:3a0 Rho:3a1 Sigma:3a3 Tau:3a4
Upsilon:3a5 Phi:3a6 Chi:3a7 Psi:3a8 Omega:3a9 alpha:3b1 beta:3b2
gamma:3b3 delta:3b4 epsilon:3b5 zeta:3b6 eta:3b7 theta:3b8 iota:3b9
kappa:3ba lambda:3bb mu:3bc nu:3bd xi:3be omicron:3bf pi:3c0 rho:3c1
sigmaf:3c2 sigma:3c3 tau:3c4 upsilon:3c5 phi:3c6 chi:3c7 psi:3c8
omega:3c9 thetasym:3d1 upsih:3d2 piv:3d6 ensp:2002 emsp:2003 thinsp:2009
zwnj:200c zwj:200d lrm:200e rlm:200f ndash:2013 mdash:2014 lsquo:2018
rsquo:2019 sbquo:201a ldquo:201c rdquo:201d bdquo:201e dagger:2020
Dagger:2021 bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033
lsaquo:2039 rsaquo:203a oline:203e frasl:2044 euro:20ac image:2111
weierp:2118 real:211c trade:2122 alefsym:2135 larr:2190 uarr:2191
rarr:2192 darr:2193 harr:2194 crarr:21b5 lArr:21d0 uArr:21d1 rArr:21d2
dArr:21d3 hArr:21d4 forall:2200 part:2202 exist:2203 empty:2205
nabla:2207 isin:2208 notin:2209 ni:220b prod:220f sum:2211 minus:2212
lowast:2217 radic:221a prop:221d infin:221e ang:2220 and:2227 or:2228
cap:2229 cup:222a int:222b there4:2234 sim:223c cong:2245 asymp:2248
ne:2260 equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286
supe:2287 oplus:2295 otimes:2297 perp:22a5 sdot:22c5 lceil:2308
rceil:2309 lfloor:230a rfloor:230b lang:2329 rang:232a loz:25ca
spades:2660 clubs:2663 hearts:2665 diams:2666
`
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const [name, code] = entry.split(":");
      return [name, String.fromCodePoint(parseInt(code, 16))];
    }),
);

/**
 * Reads the character reference at `at` (a `&`) in `raw` as acorn-typescript's
 * `jsx_readEntity` does: a name from the XHTML table, `&#…;` in decimal or
 * `&#x…;`/`&#X…;` in hexadecimal up to U+10FFFF, with its `;` among the (at
 * most 10) characters read after the `&`. Returns what it stands for and where
 * it ends, or `undefined` when the `&` starts no reference and is text.
 */
function readCharacterReference(raw, at) {
  let name = "";
  for (let index = at + 1, count = 0; index < raw.length && count++ < 10; index++) {
    const ch = raw[index];
    if (ch !== ";") {
      name += ch;
      continue;
    }
    let entity;
    if (name[0] === "#") {
      const hex = name[1] === "x" || name[1] === "X";
      const digits = name.slice(hex ? 2 : 1);
      const code = (hex ? /^[\da-fA-F]+$/ : /^\d+$/).test(digits)
        ? parseInt(digits, hex ? 16 : 10)
        : undefined;
      if (code !== undefined && code <= 0x10ffff) entity = String.fromCodePoint(code);
    } else {
      entity = XHTML_ENTITIES.get(name);
    }
    return entity === undefined ? undefined : [entity, index + 1];
  }
  return undefined;
}

/**
 * `raw` with its character references decoded, and with each CRLF read as LF
 * when `lineFeeds` is set, as acorn reads an element's text.
 */
function decodeCharacterReferences(raw, lineFeeds) {
  let value = "";
  let chunk = 0;
  let index = 0;
  while (index < raw.length) {
    const ch = raw.charCodeAt(index);
    if (ch === 38) {
      const reference = readCharacterReference(raw, index);
      if (reference !== undefined) {
        value += raw.slice(chunk, index) + reference[0];
        index = chunk = reference[1];
        continue;
      }
    } else if (ch === 13 && lineFeeds && raw.charCodeAt(index + 1) === 10) {
      value += raw.slice(chunk, index) + "\n";
      index = chunk = index + 2;
      continue;
    }
    index++;
  }
  return value + raw.slice(chunk);
}

/**
 * Gives every `JSXText` and string `JSXAttribute` value in `program` the
 * `value` and `raw` `@tsrx/core`'s parseModule gives them: `value` with its
 * character references decoded by acorn-typescript's `jsx_readEntity`, `raw`
 * as written. A text's `value` also reads each CRLF as LF; an attribute's
 * keeps it. Each text is decoded on its own, so a reference cut off by a child
 * or a comment is text. Skips the walk when `text` holds no `&` and no `\r`.
 */
export function decodeJsxReferences(program, text) {
  if (!text.includes("&") && !text.includes("\r")) return;
  forEachNode(
    program,
    (node) =>
      node.type === "JSXText" ||
      (node.type === "JSXAttribute" && typeof node.value?.value === "string"),
    (node) => {
      if (node.type === "JSXText") {
        const raw = text.slice(node.start, node.end);
        if (!raw.includes("&") && !raw.includes("\r")) return;
        node.raw = raw;
        node.value = decodeCharacterReferences(raw, true);
        return;
      }
      const literal = node.value;
      if (literal.type !== "Literal" || !literal.raw.includes("&")) return;
      literal.value = decodeCharacterReferences(literal.raw.slice(1, -1), false);
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

// The field `@tsrx/core` names a control-flow expression's statement after,
// for each dialect wrapper.
const STATEMENT_TYPES = {
  JSXIfExpression: "IfStatement",
  JSXSwitchExpression: "SwitchStatement",
  JSXTryExpression: "TryStatement",
};

// The fields core puts on a control-flow expression itself, for the statement
// yuku keeps under `statement`: a `@for`'s `await` among them.
const STATEMENT_FIELDS = {
  ForOfStatement: ["await", "left", "right", "index", "key", "body"],
  // Core rejects `index` and `key` on a for-in loop, which yuku reads.
  ForInStatement: ["left", "right", "index", "key", "body"],
  ForStatement: ["init", "test", "update", "body"],
  SwitchStatement: ["discriminant", "cases"],
  TryStatement: ["block", "handler", "finalizer"],
};

// The signatures core reads with acorn-typescript's names: `parameters` for
// typescript-estree's `params` and `typeAnnotation` for its `returnType`.
const SIGNATURE_TYPES = new Set([
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSMethodSignature",
  "TSFunctionType",
  "TSConstructorType",
]);

// typescript-estree's class members, and the core type and flags each is.
const CLASS_MEMBERS = {
  TSAbstractMethodDefinition: ["MethodDefinition", { abstract: true }],
  TSAbstractPropertyDefinition: ["PropertyDefinition", { abstract: true }],
  AccessorProperty: ["PropertyDefinition", { accessor: true }],
  TSAbstractAccessorProperty: ["PropertyDefinition", { abstract: true, accessor: true }],
};

/**
 * Defines `name` on `node` as an accessor that reads and writes
 * `target[field]`, so an edit through either name reaches both.
 */
function alias(node, name, target, field, enumerable) {
  if (Object.hasOwn(node, name)) return;
  Object.defineProperty(node, name, {
    configurable: true,
    enumerable,
    get: () => target[field],
    set: (value) => {
      target[field] = value;
    },
  });
}

/**
 * The `{ start, end }` of the `@keyword` that the source reads first at or
 * after `offset`, past whitespace and comments, as core records it; or
 * `undefined` when the text there is not one.
 */
function keywordAt(text, offset) {
  const pattern = /(?:\s+|\/\/[^\n\r\u2028\u2029]*|\/\*[\s\S]*?\*\/)*(@[A-Za-z]+)/y;
  pattern.lastIndex = offset;
  const match = pattern.exec(text);
  if (match === null) return undefined;
  const end = pattern.lastIndex;
  return { start: end - match[1].length, end };
}

function setKeyword(node, name, text, offset) {
  // a recovered tree can lack the part the keyword follows
  if (typeof offset !== "number") return;
  const keyword = keywordAt(text, offset);
  if (keyword !== undefined) node[name] = keyword;
}

/** Gives a control-flow expression core's flat fields, its `statementType` and its keyword spans. */
function addControlFlowFields(node, text) {
  const { statement } = node;
  if (node.type === "JSXIfExpression") {
    node.statementType = STATEMENT_TYPES.JSXIfExpression;
    if (node.alternate) setKeyword(node, "alternateKeyword", text, node.consequent?.end);
    return;
  }
  if (!statement || typeof statement !== "object") return;
  // Core's fields are the node's children, and `statement` stays readable but
  // unlisted, so a walker or serializer sees each child once, under core's name.
  // A statement of a kind this doesn't know stays the listed child.
  const fields = STATEMENT_FIELDS[statement.type];
  if (fields !== undefined) {
    for (const field of fields) {
      if (field in statement) alias(node, field, statement, field, true);
    }
    Object.defineProperty(node, "statement", { enumerable: false });
  }
  node.statementType = statement.type;
  switch (node.type) {
    case "JSXForExpression":
      if (node.empty) setKeyword(node, "emptyKeyword", text, statement.body?.end);
      break;
    case "JSXSwitchExpression":
      for (const arm of statement.cases ?? []) setKeyword(arm, "keyword", text, arm.start);
      break;
    case "JSXTryExpression":
      if (node.pending) setKeyword(node, "pendingKeyword", text, statement.block?.end);
      if (statement.handler) setKeyword(node, "handlerKeyword", text, statement.handler.start);
      break;
  }
}

/**
 * Gives `program` the node shapes `@tsrx/core`'s parseModule gives, where
 * yuku's decoder has typescript-estree's:
 *
 * - A control-flow expression (`@if`, `@for`, `@switch`, `@try` read as an
 *   expression) has core's `statementType`, a `@for`'s `await`, and the
 *   `@else`/`@empty`/`@pending`/`@catch`/`@case` keyword spans. The fields of
 *   the statement yuku keeps under `statement` are the node's own, as core has
 *   them, and `statement` stays on the node, unlisted.
 * - A call, construct or method signature and a function or constructor type
 *   has `parameters` and `typeAnnotation` (its return type), with `params` and
 *   `returnType` kept as non-enumerable aliases for the encoder.
 * - A `JSXMemberExpression` has `computed: false`.
 * - An abstract or `accessor` class member is a `MethodDefinition` or
 *   `PropertyDefinition` flagged `abstract`/`accessor`, and a method without a
 *   body has a `TSDeclareMethod` value. `encode` reads them back.
 */
export function addCoreNodeShapes(program, text, { preserveParens = false } = {}) {
  const unwrap = !preserveParens && text.includes("(");
  forEachNode(
    program,
    (node) => typeof node.type === "string",
    (node) => {
      addCoreNodeShape(node, text);
      if (unwrap) unwrapParentheses(node);
    },
  );
}

function addCoreNodeShape(node, text) {
  const { type } = node;
  if (type === "JSXMemberExpression") {
    node.computed = false;
  } else if (type === "JSXForExpression" || Object.hasOwn(STATEMENT_TYPES, type)) {
    addControlFlowFields(node, text);
  } else if (SIGNATURE_TYPES.has(type)) {
    if (!Object.hasOwn(node, "parameters")) {
      node.parameters = node.params;
      node.typeAnnotation = node.returnType ?? null;
      node.typeParameters ??= null;
      delete node.params;
      delete node.returnType;
      alias(node, "params", node, "parameters", false);
      alias(node, "returnType", node, "typeAnnotation", false);
    }
  } else if (Object.hasOwn(CLASS_MEMBERS, type)) {
    const [coreType, flags] = CLASS_MEMBERS[type];
    node.type = coreType;
    Object.assign(node, flags);
  } else if (type === "TSEmptyBodyFunctionExpression") {
    node.type = "TSDeclareMethod";
  }
}

/**
 * The expression inside `node`'s parentheses, or `node` itself. Comments
 * attached to the parentheses move to that expression, in source order.
 */
function unparenthesized(node) {
  const levels = [];
  let inner = node;
  while (inner?.type === "ParenthesizedExpression") {
    levels.push(inner.comments ?? []);
    inner = inner.expression;
  }
  if (levels.some((comments) => comments.length > 0)) {
    const before = (comment) => comment.position === "before";
    const after = (comment) => comment.position !== "before";
    const own = inner.comments ?? [];
    inner.comments = [
      ...levels.flatMap((comments) => comments.filter(before)),
      ...own.filter(before),
      ...own.filter(after),
      ...levels.reverse().flatMap((comments) => comments.filter(after)),
    ];
  }
  return inner;
}

/**
 * Replaces each `ParenthesizedExpression` among `node`'s children with the
 * expression inside it, as acorn reads it. A type's parentheses stay a
 * `TSParenthesizedType`, as core has them.
 */
function unwrapParentheses(node) {
  for (const key in node) {
    if (key === "comments") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        if (value[index]?.type === "ParenthesizedExpression") {
          value[index] = unparenthesized(value[index]);
        }
      }
    } else if (value?.type === "ParenthesizedExpression") {
      node[key] = unparenthesized(value);
    }
  }
}

// The typescript-estree type the encoder reads for each class member in core's shape.
function estreeClassMemberType(node) {
  if (node.type === "TSDeclareMethod") return "TSEmptyBodyFunctionExpression";
  if (node.type === "MethodDefinition") {
    return node.abstract === true ? "TSAbstractMethodDefinition" : undefined;
  }
  if (node.type !== "PropertyDefinition") return undefined;
  if (node.accessor === true) {
    return node.abstract === true ? "TSAbstractAccessorProperty" : "AccessorProperty";
  }
  return node.abstract === true ? "TSAbstractPropertyDefinition" : undefined;
}

// The statement a control-flow expression in core's shape holds, rebuilt from
// its own fields, for a copy that lost the unlisted `statement` (a JSON or
// structured clone, say).
function rebuiltStatement(node) {
  const type = node.statementType;
  const fields = STATEMENT_FIELDS[type];
  if (fields === undefined || node.type === "JSXIfExpression") return undefined;
  const statement = { type, start: node.start + 1, end: node.end };
  for (const field of fields) if (field in node) statement[field] = node[field];
  // a loop's statement ends at its body, before any `@empty`
  if (node.type === "JSXForExpression") statement.end = node.body?.end ?? node.end;
  return statement;
}

/**
 * Runs `callback` with every node in `program` that has a shape of core's the
 * encoder doesn't read (see `addCoreNodeShapes`) in typescript-estree's shape,
 * and restores core's afterwards. A class member is typed as typescript-estree
 * types it. A signature or control-flow expression that lost its unlisted
 * `params`, `returnType` or `statement` in a copy gets them back from core's
 * fields.
 *
 * @template T
 * @param {object} program
 * @param {() => T} callback
 * @returns {T}
 */
export function withEstreeShapes(program, callback) {
  const undo = [];
  forEachNode(
    program,
    (node) => typeof node.type === "string",
    (node) => {
      const type = estreeClassMemberType(node);
      if (type !== undefined) {
        const coreType = node.type;
        node.type = type;
        undo.push(() => {
          node.type = coreType;
        });
      } else if (SIGNATURE_TYPES.has(node.type)) {
        if (node.params === undefined && Array.isArray(node.parameters)) {
          node.params = node.parameters;
          node.returnType = node.typeAnnotation ?? null;
          undo.push(() => {
            delete node.params;
            delete node.returnType;
          });
        }
      } else if (node.statement === undefined && typeof node.statementType === "string") {
        const statement = rebuiltStatement(node);
        if (statement !== undefined) {
          node.statement = statement;
          undo.push(() => {
            delete node.statement;
          });
        }
      }
    },
  );
  try {
    return callback();
  } finally {
    for (const restore of undo) restore();
  }
}
