//! TSRX as a Yuku dialect (https://yuku.fyi/parser/dialect/), following the [TSRX specification](https://tsrx.dev/specification).

const std = @import("std");
const yuku = @import("parser");

const ast = yuku.ast;
const dialect = yuku.dialect;

const Claim = dialect.Claim;
const Error = dialect.Error;
const NodeIndex = ast.NodeIndex;
const Parser = dialect.Parser;
const Token = ast.Token;

pub const files: []const dialect.File = &.{.{ .extension = ".tsrx", .lang = .tsx }};

pub const Node = enum {
    code_block,
    template,
    @"if",
    else_if,
    @"for",
    for_await,
    @"switch",
    case,
    @"try",
    @"catch",
    style,
    shorthand,

    pub fn shape(node: Node) dialect.Shape {
        return switch (node) {
            .code_block => .{
                .type = "JSXCodeBlock",
                .fields = &.{ "body[]", "render" },
                .block_scope = true,
            },
            .template => .{ .type = "BlockStatement", .fields = &.{"body[]"}, .block_scope = true },
            .@"if" => .{
                .type = "JSXIfExpression",
                .fields = &.{ "test", "consequent", "alternate" },
                .properties = "{\"statementType\":\"IfStatement\"}",
            },
            .else_if => .{
                .type = "IfStatement",
                .fields = &.{ "test", "consequent", "alternate" },
            },
            .@"for", .for_await => .{
                .type = "JSXForExpression",
                .fields = &.{ "left", "right", "index", "key", "body", "empty" },
                .properties = if (node == .for_await)
                    "{\"await\":true,\"statementType\":\"ForOfStatement\"}"
                else
                    "{\"await\":false,\"statementType\":\"ForOfStatement\"}",
                .block_scope = true,
                .lexical_bindings = true,
                .iteration = true,
            },
            .@"switch" => .{
                .type = "JSXSwitchExpression",
                .fields = &.{ "discriminant", "cases[]" },
                .properties = "{\"statementType\":\"SwitchStatement\"}",
            },
            .case => .{ .type = "SwitchCase", .fields = &.{ "test", "consequent[]" } },
            .@"try" => .{
                .type = "JSXTryExpression",
                .fields = &.{ "block", "pending", "handler" },
                .properties = "{\"finalizer\":null,\"statementType\":\"TryStatement\"}",
            },
            .@"catch" => .{
                .type = "CatchClause",
                .fields = &.{ "param", "resetParam", "body" },
                .block_scope = true,
                .catch_bindings = true,
            },
            .style => .{
                .type = "JSXStyleElement",
                .fields = &.{ "openingElement", "children[]", "closingElement" },
            },
            .shorthand => .{
                .type = "JSXAttribute",
                .fields = &.{ "name", "value" },
                .properties = "{\"shorthand\":true}",
            },
        };
    }
};

/// A code block, a directive, or an element at the start of a statement, which needs no `;`
/// before a tag, as in `<a /> <b />`.
pub fn statement(p: *Parser) Error!Claim {
    const token = p.token();
    if (constructAt(p, token) == null and !opensTagAt(p, token)) return .decline;
    const start = token.span.start;

    const value = try p.parseExpression(ast.Precedence.Lowest) orelse return .failed;
    const value_end = p.tree().span(value).end;
    const end = if (isOutput(p.tree(), value) and opensTagAt(p, p.token()))
        value_end
    else
        try p.semicolon(value_end) orelse return .failed;
    return claimed(try p.tree().addNode(
        .{ .expression_statement = .{ .expression = value } },
        .{ .start = start, .end = end },
    ));
}

/// A code block, a directive, or a `<style>` element as a value.
pub fn expression(p: *Parser) Error!Claim {
    const token = p.token();
    const value = switch (token.tag) {
        .at => try parseConstruct(p, constructAt(p, token) orelse return .decline),
        .less_than => if (opensStyle(p, token.span.end)) try parseElement(p) else return .decline,
        else => return .decline,
    } orelse return .failed;
    if (!try p.advance()) return .failed;
    return claimed(value);
}

/// A tag at the start of a line, or after output, starts an element.
pub fn operator(p: *Parser, left: NodeIndex, _: u8) Error!Claim {
    const token = p.token();
    if (!token.hasLineTerminatorBefore() and !isOutput(p.tree(), left)) return .decline;
    return if (opensTagAt(p, token)) .end else .decline;
}

/// A code block as the body of a function, method, or arrow function.
pub fn function_body(p: *Parser) Error!Claim {
    if (constructAt(p, p.token()) != .code_block) return .decline;

    const body = try parseCodeBlock(p, .any) orelse return .failed;
    if (!try p.advance()) return .failed;
    return claimed(body);
}

/// Template text with its comments, constructs, and `<style>` elements, and the raw bodies of
/// `<style>` and `<script>`.
pub fn jsx_child(p: *Parser, offset: u32, parent: NodeIndex) Error!Claim {
    if (offset == p.tree().span(parent).end) {
        if (try rawBodyEnd(p, parent, offset)) |end| {
            const text = p.tree().sourceSlice(offset, end);
            return claimed(try p.tree().addNode(
                .{ .jsx_text = .{ .value = text, .raw = text } },
                .{ .start = offset, .end = end },
            ));
        }
    }

    const source = p.source();
    switch (source[offset]) {
        '@' => if (constructAt(p, p.tokenAt(offset))) |construct| {
            if (!try p.seek(offset)) return .failed;
            return claimed(try parseConstruct(p, construct) orelse return .failed);
        },
        '<' => if (opensStyle(p, offset + 1)) {
            if (!try p.seek(offset)) return .failed;
            return claimed(try parseElement(p) orelse return .failed);
        },
        '/' => if (commentAt(source, offset, offset)) |comment| {
            try p.addComment(comment.type, comment.span);
            const empty = try p.tree().addNode(.{ .jsx_empty_expression = .{} }, comment.span);
            return claimed(try p.tree().addNode(
                .{ .jsx_expression_container = .{ .expression = empty } },
                comment.span,
            ));
        },
        else => {},
    }

    const end = textEnd(p, offset);
    if (end == offset) return .decline;
    return claimed(try p.addJsxText(.{ .start = offset, .end = end }));
}

/// `{name}` as an attribute, short for `name={name}`.
pub fn jsx_attribute(p: *Parser) Error!Claim {
    if (p.tokenAt(p.token().span.end).tag == .spread) return .decline;

    const container = try p.parseJsxExpressionContainer() orelse return .failed;
    const value = p.tree().data(container).jsx_expression_container.expression;
    if (p.tree().data(value) != .identifier_reference) {
        try p.report(p.tree().span(container), "A shorthand attribute names one identifier");
        return .failed;
    }
    const name = try p.tree().addNode(.{ .jsx_identifier = .{
        .name = p.tree().data(value).identifier_reference.name,
    } }, p.tree().span(value));
    return claimed(try p.addNode(.shorthand, &.{ name, container }, p.tree().span(container)));
}

/// `<{expression}>`, a tag chosen at runtime, where TSRX has no namespaced tags.
pub fn jsx_element_name(p: *Parser) Error!Claim {
    const token = p.token();
    if (token.tag == .jsx_identifier) {
        if (p.tokenAt(token.span.end).tag != .colon) return .decline;
        try p.report(token.span, "TSRX1005: Namespaced elements are not supported in TSRX " ++
            "templates.");
        return .failed;
    }
    if (token.tag != .left_brace) return .decline;

    const container = try p.parseJsxExpressionContainer() orelse return .failed;
    const tag = p.tree().data(container).jsx_expression_container.expression;
    if (!isTagExpression(p.tree(), tag)) {
        try p.report(p.tree().span(tag), "TSRX2014: A dynamic tag expression must be an " ++
            "identifier, a member access such as `props.as` or `registry[name]`, or a " ++
            "string literal.");
        return .failed;
    }
    return claimed(container);
}

/// A submodule named by an identifier, as in `import { load } from server`.
pub fn module_specifier(p: *Parser) Error!Claim {
    const token = p.token();
    if (token.tag != .identifier) return .decline;

    const name = p.tree().sourceSlice(token.span.start, token.span.end);
    const reference: ast.NodeData = .{ .identifier_reference = .{ .name = name } };
    const specifier = try p.tree().addNode(reference, token.span);
    if (!try p.advance()) return .failed;
    return claimed(specifier);
}

const Construct = enum { code_block, @"if", @"for", @"switch", @"try" };

// the construct an `@` opens, its word touching it, as in `@{`, `@if (`, and `@for await (`
fn constructAt(p: *const Parser, at: Token) ?Construct {
    if (at.tag != .at) return null;
    const word = p.tokenAt(at.span.end);
    if (word.span.start != at.span.end or word.isEscaped()) return null;
    const next = p.tokenAt(word.span.end);
    return switch (word.tag) {
        .left_brace => .code_block,
        .@"try" => if (next.tag == .left_brace) .@"try" else null,
        .@"if" => if (next.tag == .left_paren) .@"if" else null,
        .@"switch" => if (next.tag == .left_paren) .@"switch" else null,
        .@"for" => switch (next.tag) {
            .left_paren => .@"for",
            .await => if (p.tokenAt(next.span.end).tag == .left_paren) .@"for" else null,
            else => null,
        },
        else => null,
    };
}

// a construct leaves its last `}` current, so a JSX child ends on it
fn parseConstruct(p: *Parser, construct: Construct) Error!?NodeIndex {
    std.debug.assert(p.token().tag == .at);
    return switch (construct) {
        .code_block => parseCodeBlock(p, .no_return),
        .@"if" => parseIf(p),
        .@"for" => parseFor(p),
        .@"switch" => parseSwitch(p),
        .@"try" => parseTry(p),
    };
}

fn parseCodeBlock(p: *Parser, rule: Rule) Error!?NodeIndex {
    const start = p.token().span.start;
    if (!try p.advance()) return null;

    var items = p.list();
    defer items.reset();
    const render = try parseTemplateItems(p, &items, rule) orelse return null;
    if (render == .null) try items.append(.null);
    return try p.addNode(.code_block, items.items(), .{
        .start = start,
        .end = p.token().span.end,
    });
}

fn parseTemplate(p: *Parser, rule: Rule) Error!?NodeIndex {
    const open = p.token();
    if (open.tag != .left_brace) {
        try p.report(open.span, "TSRX1008: Expected `{` after JSX control-flow directive.");
        return null;
    }

    var items = p.list();
    defer items.reset();
    _ = try parseTemplateItems(p, &items, rule) orelse return null;
    return try p.addNode(.template, items.items(), .{
        .start = open.span.start,
        .end = p.token().span.end,
    });
}

// what a template's statements may not do, as @tsrx/core reports while parsing. its analysis
// checks the bodies of `@if` and `@for`
const Rule = enum {
    any,
    /// TSRX2001, a `return` outside loops and nested functions
    no_return,
    /// TSRX2008 and TSRX2009, a `break` or `return` statement of an `@case`
    case,
};

// statements, then at most one output, between braces, leaving the `}` current. returns the
// output, `.null` without one
fn parseTemplateItems(p: *Parser, items: *const dialect.List, rule: Rule) Error!?NodeIndex {
    std.debug.assert(p.token().tag == .left_brace);
    if (!try p.advance()) return null;

    var output: NodeIndex = .null;
    while (p.token().tag != .right_brace) {
        const token = p.token();
        if (token.tag == .eof) {
            try p.report(token.span, "Expected '}' to close the template");
            return null;
        }
        const construct = constructAt(p, token);
        const opens_output = construct != null or opensTagAt(p, token);
        if (output != .null) {
            try p.report(token.span, if (opens_output)
                "TSRX2011: A code block renders a single node; wrap multiple nodes or text " ++
                    "in a fragment '<>…</>'."
            else
                "TSRX2012: Code must be at the top of '@{ }'; statements cannot follow the " ++
                    "rendered output.");
            return null;
        }
        if (!opens_output) {
            const statement_node = try p.parseStatement() orelse return null;
            if (try reportedStatement(p, statement_node, rule)) return null;
            try items.append(statement_node);
            continue;
        }
        output = if (construct) |opened|
            try parseConstruct(p, opened) orelse return null
        else
            try parseElement(p) orelse return null;
        try items.append(output);
        if (!try p.advance()) return null;
        if (p.token().tag == .semicolon and !try p.advance()) return null;
    }
    return output;
}

// reports a statement the rule forbids
fn reportedStatement(p: *Parser, node: NodeIndex, rule: Rule) Error!bool {
    const tree = p.tree();
    switch (rule) {
        .any => return false,
        .no_return => {
            const found = templateReturn(tree, node);
            if (found == .null) return false;
            try p.report(tree.span(found), "TSRX2001: Return statements are not allowed inside " ++
                "TSRX templates. Move the return before the TSRX return value, or use " ++
                "conditional rendering instead.");
        },
        .case => switch (tree.data(node)) {
            .break_statement => try p.report(
                tree.span(node),
                "TSRX2008: `break` is invalid inside `@switch` cases.",
            ),
            .return_statement => try p.report(
                tree.span(node),
                "TSRX2009: `return` is invalid inside `@switch` cases.",
            ),
            else => return false,
        },
    }
    return true;
}

// the first `return` of a statement outside loops and nested functions, `.null` without one
fn templateReturn(tree: *const ast.Tree, node: NodeIndex) NodeIndex {
    if (node == .null) return .null;
    switch (tree.data(node)) {
        .return_statement => return node,
        .block_statement => |block| return firstTemplateReturn(tree, tree.extra(block.body)),
        .labeled_statement => |labeled| return templateReturn(tree, labeled.body),
        .with_statement => |scoped| return templateReturn(tree, scoped.body),
        .catch_clause => |clause| return templateReturn(tree, clause.body),
        .if_statement => |branch| {
            const found = templateReturn(tree, branch.consequent);
            return if (found != .null) found else templateReturn(tree, branch.alternate);
        },
        .try_statement => |attempt| return firstTemplateReturn(
            tree,
            &.{ attempt.block, attempt.handler, attempt.finalizer },
        ),
        .switch_statement => |selection| {
            for (tree.extra(selection.cases)) |case| {
                const consequent = tree.extra(tree.data(case).switch_case.consequent);
                const found = firstTemplateReturn(tree, consequent);
                if (found != .null) return found;
            }
            return .null;
        },
        else => return .null,
    }
}

fn firstTemplateReturn(tree: *const ast.Tree, statements: []const NodeIndex) NodeIndex {
    for (statements) |statement_node| {
        const found = templateReturn(tree, statement_node);
        if (found != .null) return found;
    }
    return .null;
}

fn parseIf(p: *Parser) Error!?NodeIndex {
    const start = p.token().span.start;
    if (!try p.advance()) return null;
    return parseIfRest(p, .@"if", start);
}

// from the `if` of `@if` or of `@else if`
fn parseIfRest(p: *Parser, kind: Node, start: u32) Error!?NodeIndex {
    std.debug.assert(p.token().tag == .@"if");
    if (!try p.advance()) return null;

    const condition = try parseHead(p) orelse return null;
    const consequent = try parseTemplate(p, .any) orelse return null;
    var alternate: NodeIndex = .null;
    if (hasClause(p, "else")) {
        if (!try enterClause(p)) return null;
        alternate = if (p.token().tag == .@"if")
            try parseIfRest(p, .else_if, p.token().span.start) orelse return null
        else
            try parseTemplate(p, .any) orelse return null;
    } else if (try reportedBareClause(p, "else", "if")) {
        return null;
    }
    return try p.addNode(kind, &.{ condition, consequent, alternate }, .{
        .start = start,
        .end = p.token().span.end,
    });
}

fn parseFor(p: *Parser) Error!?NodeIndex {
    const start = p.token().span.start;
    if (!try p.advance() or !try p.advance()) return null;
    const kind: Node = if (p.token().tag == .await) .for_await else .@"for";
    if (kind == .for_await and !try p.advance()) return null;
    if (!try p.expect(.left_paren, "Expected '(' after `@for`")) return null;

    const left = try parseForLeft(p) orelse return null;
    if (p.token().tag != .of) {
        try p.report(p.token().span, "TSRX2015: TSRX `@for` currently supports `for...of` " ++
            "loops in template output.");
        return null;
    }
    if (!try p.advance()) return null;
    const right = try p.parseExpression(ast.Precedence.Assignment) orelse return null;

    var index: NodeIndex = .null;
    if (try enterForOption(p, "index")) index = try p.parseBindingPattern() orelse return null;
    var key: NodeIndex = .null;
    if (try enterForOption(p, "key")) {
        key = try p.parseExpression(ast.Precedence.Assignment) orelse return null;
    }
    if (!try p.expect(.right_paren, "Expected ')' to close the `@for` head")) return null;

    const body = try parseTemplate(p, .any) orelse return null;
    var empty: NodeIndex = .null;
    if (hasClause(p, "empty")) {
        if (!try enterClause(p)) return null;
        empty = try parseTemplate(p, .any) orelse return null;
    } else if (try reportedBareClause(p, "empty", "for")) {
        return null;
    }
    return try p.addNode(kind, &.{ left, right, index, key, body, empty }, .{
        .start = start,
        .end = p.token().span.end,
    });
}

fn parseForLeft(p: *Parser) Error!?NodeIndex {
    const token = p.token();
    const kind: ast.VariableKind = switch (token.tag) {
        .@"const" => .@"const",
        .let => .let,
        .@"var" => .@"var",
        else => return p.parseExpression(ast.Precedence.Assignment),
    };
    if (!try p.advance()) return null;

    const id = try p.parseBindingPattern() orelse return null;
    const declarator = try p.tree().addNode(
        .{ .variable_declarator = .{ .id = id, .init = .null } },
        p.tree().span(id),
    );
    return try p.tree().addNode(.{ .variable_declaration = .{
        .kind = kind,
        .declarators = try p.tree().addExtra(&.{declarator}),
    } }, .{ .start = token.span.start, .end = p.tree().span(id).end });
}

// moves past `; word` in a `@for` head
fn enterForOption(p: *Parser, word: []const u8) Error!bool {
    if (p.token().tag != .semicolon) return false;
    if (!isWord(p, p.tokenAt(p.token().span.end), word)) return false;
    return try p.advance() and try p.advance();
}

fn parseSwitch(p: *Parser) Error!?NodeIndex {
    const start = p.token().span.start;
    if (!try p.advance() or !try p.advance()) return null;
    const discriminant = try parseHead(p) orelse return null;
    if (!try p.expect(.left_brace, "Expected '{' to open the `@switch` body")) return null;

    var children = p.list();
    defer children.reset();
    try children.append(discriminant);
    while (p.token().tag != .right_brace) {
        try children.append(try parseCase(p) orelse return null);
        if (!try p.advance()) return null;
    }
    return try p.addNode(.@"switch", children.items(), .{
        .start = start,
        .end = p.token().span.end,
    });
}

fn parseCase(p: *Parser) Error!?NodeIndex {
    const at = p.token();
    const word = p.tokenAt(at.span.end);
    const is_case = isWord(p, word, "case");
    if (at.tag != .at or word.span.start != at.span.end or
        !(is_case or isWord(p, word, "default")))
    {
        try p.report(at.span, "Expected `@case` or `@default` in a `@switch` body");
        return null;
    }
    if (!try p.advance() or !try p.advance()) return null;

    var condition: NodeIndex = .null;
    if (is_case) condition = try p.parseExpression(ast.Precedence.Lowest) orelse return null;
    if (!try p.expect(.colon, "Expected ':' after the case")) return null;

    const body = try parseTemplate(p, .case) orelse return null;
    return try p.addNode(.case, &.{ condition, body }, .{
        .start = at.span.start,
        .end = p.token().span.end,
    });
}

fn parseTry(p: *Parser) Error!?NodeIndex {
    const start = p.token().span.start;
    if (!try p.advance() or !try p.advance()) return null;
    const block = try parseTemplate(p, .no_return) orelse return null;

    var pending: NodeIndex = .null;
    if (hasClause(p, "pending")) {
        if (!try enterClause(p)) return null;
        pending = try parseTemplate(p, .no_return) orelse return null;
    }
    var handler: NodeIndex = .null;
    if (hasClause(p, "catch")) {
        handler = try parseCatch(p) orelse return null;
    } else if (try reportedBareClause(p, "catch", "try")) {
        return null;
    }
    if (pending == .null and handler == .null) {
        if (try reportedBareClause(p, "pending", "try")) return null;
        try p.report(
            .{ .start = start, .end = p.token().span.end },
            "TSRX1010: Missing `@catch` or `@pending` after `@try` block.",
        );
        return null;
    }
    return try p.addNode(.@"try", &.{ block, pending, handler }, .{
        .start = start,
        .end = p.token().span.end,
    });
}

fn parseCatch(p: *Parser) Error!?NodeIndex {
    const start = p.tokenAt(p.token().span.end).span.start;
    if (!try enterClause(p)) return null;

    var param: NodeIndex = .null;
    var reset: NodeIndex = .null;
    if (p.token().tag == .left_paren) {
        if (!try p.advance()) return null;
        if (p.token().tag != .right_paren) {
            param = try p.parseBindingPattern() orelse return null;
            if (p.token().tag == .comma) {
                if (!try p.advance()) return null;
                reset = try p.parseBindingPattern() orelse return null;
            }
        }
        if (!try p.expect(.right_paren, "Expected ')' to close the `@catch` parameters")) {
            return null;
        }
    }
    const body = try parseTemplate(p, .no_return) orelse return null;
    return try p.addNode(.@"catch", &.{ param, reset, body }, .{
        .start = start,
        .end = p.token().span.end,
    });
}

// `( Expression )`, leaving the token after the `)` current
fn parseHead(p: *Parser) Error!?NodeIndex {
    if (!try p.expect(.left_paren, "Expected '(' after the directive")) return null;
    const head = try p.parseExpression(ast.Precedence.Lowest) orelse return null;
    if (!try p.expect(.right_paren, "Expected ')' to close the directive head")) return null;
    return head;
}

// whether the clause `@word` follows the current `}`
fn hasClause(p: *const Parser, word: []const u8) bool {
    const at = p.tokenAt(p.token().span.end);
    if (at.tag != .at) return false;
    const name = p.tokenAt(at.span.end);
    return name.span.start == at.span.end and isWord(p, name, word);
}

// moves past the `}` before a clause, its `@`, and its word
fn enterClause(p: *Parser) Error!bool {
    return try p.advance() and try p.advance() and try p.advance();
}

// TSRX1009, a clause written without its `@`
fn reportedBareClause(
    p: *Parser,
    comptime word: []const u8,
    comptime directive: []const u8,
) Error!bool {
    const name = p.tokenAt(p.token().span.end);
    if (!isWord(p, name, word)) return false;
    switch (p.tokenAt(name.span.end).tag) {
        .left_brace, .left_paren, .@"if" => {},
        else => return false,
    }
    try p.report(name.span, "TSRX1009: Expected `@" ++ word ++ "` after `@" ++ directive ++
        "` block.");
    return true;
}

// a `<style>` with CSS or no body is a JSXStyleElement, and `<style>{css}</style>` an element
fn parseElement(p: *Parser) Error!?NodeIndex {
    const element = try p.parseJsxElement() orelse return null;
    if (p.tree().data(element) != .jsx_element) return element;
    const parts = p.tree().data(element).jsx_element;
    if (rawElement(p.tree(), parts.opening_element) != .style) return element;
    const children = p.tree().extra(parts.children);
    for (children) |child| if (p.tree().data(child) != .jsx_text) return element;

    var items = p.list();
    defer items.reset();
    try items.append(parts.opening_element);
    for (children) |child| try items.append(child);
    try items.append(parts.closing_element);
    return try p.addNode(.style, items.items(), p.tree().span(element));
}

// where the CSS of a `<style>` or the script of a `<script>` ends, kept as written
fn rawBodyEnd(p: *Parser, opening: NodeIndex, start: u32) Error!?u32 {
    const source = p.source();
    const end: u32 = switch (rawElement(p.tree(), opening)) {
        .none => return null,
        .style => end: {
            if (p.tokenAt(start).tag == .left_brace) return null;
            break :end @intCast(std.mem.findPos(u8, source, start, "</style>") orelse source.len);
        },
        .script => try scriptEnd(p, start),
    };
    return if (end > start) end else null;
}

const RawElement = enum { none, style, script };

fn rawElement(tree: *const ast.Tree, opening: NodeIndex) RawElement {
    if (tree.data(opening) != .jsx_opening_element) return .none;
    const name = tree.data(opening).jsx_opening_element.name;
    if (tree.data(name) != .jsx_identifier) return .none;
    const text = tree.string(tree.data(name).jsx_identifier.name);
    if (std.mem.eql(u8, text, "style")) return .style;
    if (std.mem.eql(u8, text, "script")) return .script;
    return .none;
}

// TSRX1004, a script ends at `</script`, whitespace, and `>`, in any letter case, and holds no
// other `</script`
fn scriptEnd(p: *Parser, start: u32) Error!u32 {
    const source = p.source();
    const tag = "</script";
    var index = start;
    while (std.mem.findPos(u8, source, index, "</")) |found| : (index = @intCast(found + 2)) {
        if (!std.ascii.startsWithIgnoreCase(source[found..], tag)) continue;
        const after = std.mem.findNonePos(u8, source, found + tag.len, &std.ascii.whitespace);
        if (after != null and source[after.?] == '>') return @intCast(found);
        try p.report(
            .{ .start = @intCast(found), .end = @intCast(found + tag.len) },
            "TSRX1004: '</script' can end a script in HTML, so a '<script>' body can't " ++
                "contain it.",
        );
    }
    return @intCast(source.len);
}

// an identifier, a member chain from an identifier or `this`, or a string
fn isTagExpression(tree: *const ast.Tree, node: NodeIndex) bool {
    return switch (tree.data(node)) {
        .identifier_reference, .string_literal => true,
        .member_expression => |member| !member.optional and
            (tree.data(member.object) == .this_expression or
                isTagExpression(tree, member.object)) and
            (!member.computed or isTagKey(tree, member.property)),
        else => false,
    };
}

fn isTagKey(tree: *const ast.Tree, node: NodeIndex) bool {
    return switch (tree.data(node)) {
        .identifier_reference, .string_literal, .numeric_literal => true,
        .member_expression => isTagExpression(tree, node),
        else => false,
    };
}

// whether a name, `/`, `>`, or `{` touches the `<` ending at `offset`, opening a tag. an ASCII
// byte decides without lexing, which also keeps `<>=` a fragment
fn opensTag(p: *const Parser, offset: u32) bool {
    if (offset == p.source().len) return false;
    switch (p.source()[offset]) {
        'a'...'z', 'A'...'Z', '/', '>', '{' => return true,
        else => {
            const name = p.tokenAt(offset);
            return name.span.start == offset and name.tag.isIdentifierLike();
        },
    }
}

fn opensTagAt(p: *const Parser, token: Token) bool {
    return token.tag == .less_than and opensTag(p, token.span.end);
}

// an element, a fragment, or a construct
fn isOutput(tree: *const ast.Tree, node: NodeIndex) bool {
    return switch (tree.data(node)) {
        .jsx_element, .jsx_fragment, .dialect => true,
        else => false,
    };
}

// whether a `<style` tag follows the `<` ending at `offset`, its name read whole by `parseElement`
fn opensStyle(p: *const Parser, offset: u32) bool {
    if (!std.mem.startsWith(u8, p.source()[offset..], "style")) return false;
    const name = p.tokenAt(offset);
    return name.span.start == offset and isWord(p, name, "style");
}

// a word as written, so an escaped keyword is not one
fn isWord(p: *const Parser, token: Token, word: []const u8) bool {
    return std.mem.eql(u8, token.text(p.source()), word);
}

const Comment = struct { type: ast.Comment.Type, span: ast.Span };

// a closed `/*` anywhere, or a `//` starting a run or after whitespace, so `a//b` stays text
fn commentAt(source: []const u8, index: u32, run_start: u32) ?Comment {
    if (index + 1 >= source.len) return null;
    switch (source[index + 1]) {
        '*' => {
            const close = std.mem.findPos(u8, source, index + 2, "*/") orelse return null;
            return .{ .type = .block, .span = .{ .start = index, .end = @intCast(close + 2) } };
        },
        '/' => {
            if (index != run_start and !std.ascii.isWhitespace(source[index - 1])) return null;
            const end = std.mem.findAnyPos(u8, source, index, "\r\n") orelse source.len;
            return .{ .type = .line, .span = .{ .start = index, .end = @intCast(end) } };
        },
        else => return null,
    }
}

// where a run of template text ends
fn textEnd(p: *const Parser, start: u32) u32 {
    const source = p.source();
    var index = start;
    while (std.mem.findAnyPos(u8, source, index, "{}<@/")) |found| : (index += 1) {
        index = @intCast(found);
        const ends = switch (source[index]) {
            '{', '}' => true,
            '<' => opensTag(p, index + 1),
            '@' => constructAt(p, p.tokenAt(index)) != null,
            '/' => commentAt(source, index, start) != null,
            else => unreachable,
        };
        if (ends) return index;
    }
    return @intCast(source.len);
}

inline fn claimed(node: NodeIndex) Claim {
    return .{ .node = node };
}
