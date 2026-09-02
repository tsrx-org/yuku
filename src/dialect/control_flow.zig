const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");
const patterns = @import("patterns.zig");
const jsx_text = @import("text.zig");

pub fn statement(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    return dispatch(Host, parser, false);
}

pub fn expression(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    return dispatch(Host, parser, false);
}

pub fn jsxChild(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    return dispatch(Host, parser, true);
}

fn dispatch(comptime Host: type, parser: anytype, comptime jsx_keyword_boundary: bool) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (Host.currentToken(parser) != .at) return .unhandled;
    if (matchesDirective(Host, parser, "if", jsx_keyword_boundary)) return .{ .handled = try parseIf(Host, parser) };
    if (matchesDirective(Host, parser, "for", jsx_keyword_boundary)) return .{ .handled = try parseFor(Host, parser) };
    if (matchesDirective(Host, parser, "switch", jsx_keyword_boundary)) return .{ .handled = try parseSwitch(Host, parser) };
    if (matchesDirective(Host, parser, "try", jsx_keyword_boundary)) return .{ .handled = try parseTry(Host, parser) };
    return .unhandled;
}

fn matchesDirective(comptime Host: type, parser: anytype, expected: []const u8, comptime keyword_boundary: bool) bool {
    return if (keyword_boundary) directive(Host, parser, expected) else directivePrefix(Host, parser, expected);
}

fn directive(comptime Host: type, parser: anytype, expected: []const u8) bool {
    const span = Host.currentSpan(parser);
    return jsx_text.keywordAfterAt(Host.source(parser), span.start, expected);
}

fn directivePrefix(comptime Host: type, parser: anytype, expected: []const u8) bool {
    const span = Host.currentSpan(parser);
    const source = Host.source(parser);
    if (span.end + expected.len > source.len) return false;
    return std.mem.eql(u8, source[span.end .. span.end + expected.len], expected);
}

fn contextual(comptime Host: type, parser: anytype, expected: []const u8) bool {
    return std.mem.eql(u8, Host.sourceText(parser, Host.currentSpan(parser)), expected);
}

fn consume(comptime Host: type, parser: anytype, comptime token: Host.Token, message: []const u8, help: ?[]const u8) Host.ErrorType!bool {
    if (Host.currentToken(parser) != token) {
        if (help) |text| try Host.reportWithHelp(parser, Host.currentSpan(parser), message, text) else try Host.report(parser, Host.currentSpan(parser), message);
        return false;
    }
    return Host.advance(parser);
}

fn parseIf(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    return parseIfFromCurrent(Host, parser, start);
}

fn parseIfFromCurrent(comptime Host: type, parser: anytype, start: u32) Host.ErrorType!?Host.NodeIndex {
    if (!try consume(Host, parser, .@"if", "Expected 'if' after '@'", "TSRX if directives are written '@if (...) { ... }'")) return null;
    if (!try consume(Host, parser, .left_paren, "Expected '(' after '@if'", null)) return null;
    const condition = try header(Host, parser, ")", "Expected a condition after '@if ('") orelse return null;
    if (!try consume(Host, parser, .right_paren, "Expected ')' after '@if' condition", null)) return null;
    const consequent = try templateBlock(Host, parser, false) orelse return null;

    var alternate = Host.NodeIndex.null;
    if (directive(Host, parser, "else")) {
        if (!try Host.advance(parser)) return null;
        if (!try consume(Host, parser, .@"else", "Expected 'else' after '@'", "TSRX else clauses are written '@else { ... }'")) return null;
        alternate = if (Host.currentToken(parser) == .@"if")
            try parseIfFromCurrent(Host, parser, Host.currentSpan(parser).start) orelse return null
        else if (directive(Host, parser, "if"))
            try parseIf(Host, parser) orelse return null
        else
            try templateBlock(Host, parser, false) orelse return null;
    }
    const end = if (alternate != .null) Host.nodeSpan(parser, alternate).end else Host.nodeSpan(parser, consequent).end;
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_if_expression = .{
        .@"test" = abi.NodeRef.init(@intFromEnum(condition)),
        .consequent = abi.NodeRef.init(@intFromEnum(consequent)),
        .alternate = abi.OptionalNodeRef.init(@intFromEnum(alternate)),
    } }, .{ .start = start, .end = end }));
}

fn parseFor(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (comptime @hasDecl(Host, "parseStatement") or @hasDecl(Host, "parseStatementNode")) {
        if (forInTailOperator(Host.source(parser), start)) |operator| {
            var source = try Host.allocator(parser).dupe(u8, Host.source(parser));
            defer Host.allocator(parser).free(source);
            source[operator] = 'o';
            source[operator + 1] = 'f';
            const original_source = parser.source;
            const original_lexer_source = parser.lexer.source;
            parser.source = source;
            parser.lexer.source = source;
            defer {
                parser.source = original_source;
                parser.lexer.source = original_lexer_source;
            }
            return parseHostFor(Host, parser, start, true);
        }
        return parseHostFor(Host, parser, start, false);
    }
    return parseSimpleJsxFor(Host, parser, start);
}

fn parseHostFor(comptime Host: type, parser: anytype, start: u32, rewritten_for_in: bool) Host.ErrorType!?Host.NodeIndex {
    if (!try Host.advance(parser)) return null;
    if (Host.currentToken(parser) != .@"for") {
        try Host.report(parser, Host.currentSpan(parser), "Expected 'for' after '@'");
        return null;
    }
    const parsed = if (comptime @hasDecl(Host, "parseStatement"))
        try Host.parseStatement(parser) orelse return null
    else
        try Host.parseStatementNode(parser) orelse return null;
    const statement_node = try transformForBody(Host, parser, parsed, rewritten_for_in) orelse return null;
    return wrapFor(Host, parser, start, statement_node);
}

fn forInTailOperator(source: []const u8, start: u32) ?usize {
    var cursor: usize = start;
    var depth: u32 = 0;
    var operator: ?usize = null;
    var quote: u8 = 0;
    var escaped = false;
    while (cursor < source.len) : (cursor += 1) {
        const byte = source[cursor];
        if (quote != 0) {
            if (escaped) escaped = false else if (byte == '\\') escaped = true else if (byte == quote) quote = 0;
            continue;
        }
        if (byte == '\'' or byte == '"' or byte == '`') {
            quote = byte;
            continue;
        }
        if (byte == '/' and cursor + 1 < source.len and source[cursor + 1] == '/') {
            cursor += 2;
            while (cursor < source.len and source[cursor] != '\n') cursor += 1;
            continue;
        }
        if (byte == '/' and cursor + 1 < source.len and source[cursor + 1] == '*') {
            cursor += 2;
            while (cursor + 1 < source.len and !(source[cursor] == '*' and source[cursor + 1] == '/')) cursor += 1;
            cursor += 1;
            continue;
        }
        switch (byte) {
            '(' => depth += 1,
            ')' => {
                if (depth == 1) return null;
                depth -= 1;
            },
            ';' => if (depth == 1 and operator != null and tailClauseAfter(source, cursor + 1)) return operator,
            'i' => if (depth == 1 and operator == null and cursor + 1 < source.len and source[cursor + 1] == 'n' and
                (cursor == 0 or !std.ascii.isAlphanumeric(source[cursor - 1]) and source[cursor - 1] != '_') and
                (cursor + 2 == source.len or !std.ascii.isAlphanumeric(source[cursor + 2]) and source[cursor + 2] != '_'))
            {
                operator = cursor;
                cursor += 1;
            },
            else => {},
        }
    }
    return null;
}

fn tailClauseAfter(source: []const u8, from: usize) bool {
    var cursor = from;
    while (cursor < source.len) {
        while (cursor < source.len and std.ascii.isWhitespace(source[cursor])) cursor += 1;
        if (cursor + 1 < source.len and source[cursor] == '/' and source[cursor + 1] == '/') {
            cursor += 2;
            while (cursor < source.len and source[cursor] != '\n') cursor += 1;
            continue;
        }
        if (cursor + 1 < source.len and source[cursor] == '/' and source[cursor + 1] == '*') {
            cursor += 2;
            while (cursor + 1 < source.len and !(source[cursor] == '*' and source[cursor + 1] == '/')) cursor += 1;
            cursor += 2;
            continue;
        }
        return std.mem.startsWith(u8, source[cursor..], "index") or std.mem.startsWith(u8, source[cursor..], "key");
    }
    return false;
}

fn wrapFor(comptime Host: type, parser: anytype, start: u32, statement_node: Host.NodeIndex) Host.ErrorType!?Host.NodeIndex {
    var empty = Host.NodeIndex.null;
    if (directivePrefix(Host, parser, "empty")) {
        if (!try Host.advance(parser)) return null;
        if (!contextual(Host, parser, "empty")) {
            try Host.reportWithHelp(parser, Host.currentSpan(parser), "Expected 'empty' after '@'", "TSRX empty clauses are written '@empty { ... }'.");
            return null;
        }
        if (!try Host.advance(parser)) return null;
        empty = try templateBlock(Host, parser, false) orelse return null;
    }
    const end = if (empty != .null) Host.nodeSpan(parser, empty).end else Host.nodeSpan(parser, statement_node).end;
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_for_expression = .{
        .statement = abi.NodeRef.init(@intFromEnum(statement_node)),
        .empty = abi.OptionalNodeRef.init(@intFromEnum(empty)),
    } }, .{ .start = start, .end = end }));
}

fn parseSimpleJsxFor(comptime Host: type, parser: anytype, start: u32) Host.ErrorType!?Host.NodeIndex {
    if (!try Host.advance(parser)) return null;
    const for_start = Host.currentSpan(parser).start;
    if (!try consume(Host, parser, .@"for", "Expected 'for' after '@'", null)) return null;
    if (!try consume(Host, parser, .left_paren, "Expected '(' after 'for'", null)) return null;
    const declaration_start = Host.currentSpan(parser).start;
    const left = if (Host.currentToken(parser) == .identifier) blk: {
        const binding_span = Host.currentSpan(parser);
        const binding_name = Host.sourceSlice(parser, binding_span.start, binding_span.end);
        const binding = try Host.addNode(parser, Host.NodeData{ .identifier_reference = .{ .name = binding_name } }, binding_span);
        if (!try Host.advance(parser)) return null;
        break :blk binding;
    } else blk: {
        if (!try consume(Host, parser, .@"const", "Expected declaration in TSRX for header", null)) return null;
        const binding_span = Host.currentSpan(parser);
        const binding_name = Host.sourceSlice(parser, binding_span.start, binding_span.end);
        const binding = try Host.addNode(parser, Host.NodeData{ .binding_identifier = .{ .name = binding_name } }, binding_span);
        if (!try Host.advance(parser)) return null;
        const declarator = try Host.addNode(parser, Host.NodeData{ .variable_declarator = .{ .id = binding, .init = .null } }, binding_span);
        const declarations = try Host.addExtra(parser, &.{declarator});
        const declaration = try Host.addNode(parser, Host.NodeData{ .variable_declaration = .{
            .declarators = declarations,
            .kind = .@"const",
        } }, .{ .start = declaration_start, .end = binding_span.end });
        break :blk declaration;
    };
    if (!try consume(Host, parser, .of, "Expected 'of' in TSRX for header", null)) return null;
    const right = try parseValueUntil(Host, parser, ");") orelse return null;
    var index = Host.NodeIndex.null;
    var key = Host.NodeIndex.null;
    if (Host.currentToken(parser) == .semicolon) {
        if (!try Host.advance(parser)) return null;
        if (contextual(Host, parser, "index")) {
            if (!try Host.advance(parser)) return null;
            index = try parseValueUntil(Host, parser, ");") orelse return null;
            if (Host.currentToken(parser) == .semicolon and !try Host.advance(parser)) return null;
        }
        if (contextual(Host, parser, "key")) {
            if (!try Host.advance(parser)) return null;
            key = try parseValueUntil(Host, parser, ");") orelse return null;
        }
    }
    if (!try consume(Host, parser, .right_paren, "Expected ')' after for-of expression", null)) return null;
    const body = try templateBlock(Host, parser, false) orelse return null;
    const statement_node = try Host.addNode(parser, Host.NodeData{ .for_of_statement = .{
        .left = left,
        .right = right,
        .body = body,
        .await = false,
    } }, .{ .start = for_start, .end = Host.nodeSpan(parser, body).end });
    const overlay = try Host.addRecord(parser, schema.Record{ .for_of = .{
        .host_node = abi.OverlayHost.init(@intFromEnum(statement_node)),
        .index = abi.OptionalNodeRef.init(@intFromEnum(index)),
        .key = abi.OptionalNodeRef.init(@intFromEnum(key)),
    } });
    try Host.addOverlay(parser, statement_node, overlay);
    return wrapFor(Host, parser, start, statement_node);
}

pub fn forOfTail(comptime Host: type, parser: anytype, context: Host.Context) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    var index = Host.NodeIndex.null;
    var key = Host.NodeIndex.null;
    if (Host.currentToken(parser) == .semicolon) {
        if (!try Host.advance(parser)) return .{ .handled = null };
        var saw_index = false;
        var saw_key = false;
        while (true) {
            const is_index = contextual(Host, parser, "index");
            const is_key = contextual(Host, parser, "key");
            if (!is_index and !is_key) {
                _ = try Host.expect(parser, .right_paren, "Expected 'index' or 'key' after ';' in for-of expression");
                return .{ .handled = null };
            }
            if ((is_index and (saw_index or saw_key)) or (is_key and saw_key)) {
                _ = try Host.expect(parser, .right_paren, "Expected unique 'index' then 'key' clauses in for-of expression");
                return .{ .handled = null };
            }
            if (!try Host.advance(parser)) return .{ .handled = null };
            const value = try parseValueUntil(Host, parser, ");") orelse {
                try Host.report(parser, Host.currentSpan(parser), "Expected an expression after a for-of tail clause");
                return .{ .handled = null };
            };
            if (is_index) {
                index = value;
                saw_index = true;
            } else {
                key = value;
                saw_key = true;
            }
            if (Host.currentToken(parser) != .semicolon) break;
            if (!try Host.advance(parser)) return .{ .handled = null };
        }
    }
    if (!try Host.expect(parser, .right_paren, "Expected ')' after for-of expression")) return .{ .handled = null };
    const body = try Host.parseStatement(parser) orelse return .{ .handled = null };
    const node = try Host.addForOf(parser, context, body);
    const record = try Host.addRecord(parser, schema.Record{ .for_of = .{
        .host_node = abi.OverlayHost.init(@intFromEnum(node)),
        .index = abi.OptionalNodeRef.init(@intFromEnum(index)),
        .key = abi.OptionalNodeRef.init(@intFromEnum(key)),
    } });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}

fn transformForBody(comptime Host: type, parser: anytype, node: Host.NodeIndex, rewritten_for_in: bool) Host.ErrorType!?Host.NodeIndex {
    const span = Host.nodeSpan(parser, node);
    return switch (Host.data(parser, node)) {
        .for_of_statement => |data| blk: {
            const body = try transformParsedBlock(Host, parser, data.body) orelse return null;
            // Plain for-of loops still need null index/key fields on their replacement overlay.
            const none = abi.OptionalNodeRef.init(@intFromEnum(Host.NodeIndex.null));
            var carried_index = none;
            var carried_key = none;
            if (Host.overlayRecord(parser, node)) |source_overlay| switch (source_overlay) {
                .for_of => |record| {
                    carried_index = record.index;
                    carried_key = record.key;
                },
                else => return null,
            };
            const replacement = if (rewritten_for_in)
                try Host.addNode(parser, Host.NodeData{ .for_in_statement = .{
                    .left = data.left,
                    .right = data.right,
                    .body = body,
                } }, span)
            else
                try Host.addNode(parser, Host.NodeData{ .for_of_statement = .{
                    .left = data.left,
                    .right = data.right,
                    .body = body,
                    .await = data.await,
                } }, span);
            if (comptime @hasDecl(Host, "addRecord")) {
                const record = try Host.addRecord(parser, schema.Record{ .for_of = .{
                    .host_node = abi.OverlayHost.init(@intFromEnum(replacement)),
                    .index = carried_index,
                    .key = carried_key,
                } });
                try Host.addOverlay(parser, replacement, record);
            }
            break :blk replacement;
        },
        .for_statement => |data| blk: {
            const body = try transformParsedBlock(Host, parser, data.body) orelse return null;
            break :blk try Host.addNode(parser, Host.NodeData{ .for_statement = .{
                .init = data.init,
                .@"test" = data.@"test",
                .update = data.update,
                .body = body,
            } }, span);
        },
        .for_in_statement => |data| blk: {
            const body = try transformParsedBlock(Host, parser, data.body) orelse return null;
            break :blk try Host.addNode(parser, Host.NodeData{ .for_in_statement = .{
                .left = data.left,
                .right = data.right,
                .body = body,
            } }, span);
        },
        else => {
            try Host.report(parser, span, "Expected 'for (...) { ... }' after '@'");
            return null;
        },
    };
}

fn parseSwitch(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    const switch_start = Host.currentSpan(parser).start;
    if (!try consume(Host, parser, .@"switch", "Expected 'switch' after '@'", "TSRX switch directives are written '@switch (...) { ... }'")) return null;
    if (!try consume(Host, parser, .left_paren, "Expected '(' after '@switch'", null)) return null;
    const discriminant = try header(Host, parser, ")", "Expected an expression after '@switch ('") orelse return null;
    if (!try consume(Host, parser, .right_paren, "Expected ')' after '@switch' expression", null)) return null;
    if (!try consume(Host, parser, .left_brace, "Expected '{' to start TSRX switch body", "TSRX switch bodies contain '@case' and '@default' clauses.")) return null;

    var cases: std.ArrayList(Host.NodeIndex) = .empty;
    defer cases.deinit(Host.allocator(parser));
    while (Host.currentToken(parser) != .right_brace and Host.currentToken(parser) != .eof) {
        if (Host.currentToken(parser) != .at or (!directive(Host, parser, "case") and !directive(Host, parser, "default"))) {
            try Host.reportWithHelp(parser, Host.currentSpan(parser), "Expected '@case' or '@default' in TSRX switch body", "TSRX switch bodies contain '@case' and '@default' clauses.");
            return null;
        }
        const case_start = Host.currentSpan(parser).start;
        const is_default = directive(Host, parser, "default");
        if (!try Host.advance(parser)) return null;
        var case_test = Host.NodeIndex.null;
        if (is_default) {
            if (!try consume(Host, parser, .default, "Expected 'default' after '@'", null)) return null;
        } else {
            if (!try consume(Host, parser, .case, "Expected 'case' after '@'", null)) return null;
            case_test = try header(Host, parser, ":", "Expected a value after '@case'") orelse return null;
        }
        if (!try consume(Host, parser, .colon, "Expected ':' after TSRX switch clause", null)) return null;
        const body = try templateBlock(Host, parser, true) orelse return null;
        const body_data = Host.data(parser, body).block_statement;
        try validateSwitch(Host, parser, body_data.body, false, 0);
        const case_node = try Host.addNode(parser, Host.NodeData{ .switch_case = .{
            .@"test" = case_test,
            .consequent = body_data.body,
        } }, .{ .start = case_start, .end = Host.nodeSpan(parser, body).end });
        try cases.append(Host.allocator(parser), case_node);
    }
    const switch_end = Host.currentSpan(parser).end;
    if (!try consume(Host, parser, .right_brace, "Expected '}' to close TSRX switch body", "Add '}' after the last TSRX switch clause.")) return null;
    const range = try Host.addExtra(parser, cases.items);
    const switch_node = try Host.addNode(parser, Host.NodeData{ .switch_statement = .{
        .discriminant = discriminant,
        .cases = range,
    } }, .{ .start = switch_start, .end = switch_end });
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_switch_expression = .{
        .statement = abi.NodeRef.init(@intFromEnum(switch_node)),
    } }, .{ .start = start, .end = switch_end }));
}

fn parseTry(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    const try_start = Host.currentSpan(parser).start;
    if (!try consume(Host, parser, .@"try", "Expected 'try' after '@'", "TSRX try directives are written '@try { ... }'.")) return null;
    const block = try templateBlock(Host, parser, false) orelse return null;
    var pending = Host.NodeIndex.null;
    if (directivePrefix(Host, parser, "pending")) {
        if (!try Host.advance(parser)) return null;
        if (!contextual(Host, parser, "pending")) {
            try Host.reportWithHelp(parser, Host.currentSpan(parser), "Expected 'pending' after '@'", "TSRX pending clauses are written '@pending { ... }'.");
            return null;
        }
        if (!try Host.advance(parser)) return null;
        pending = try templateBlock(Host, parser, false) orelse return null;
    }
    var handler = Host.NodeIndex.null;
    if (directive(Host, parser, "catch")) handler = try parseCatch(Host, parser) orelse return null;
    if (pending == .null and handler == .null) {
        try Host.report(parser, .{ .start = start, .end = Host.nodeSpan(parser, block).end }, "TSRX try directive requires '@pending' or '@catch'");
        return null;
    }
    const end = if (handler != .null) Host.nodeSpan(parser, handler).end else Host.nodeSpan(parser, pending).end;
    const statement_node = try Host.addNode(parser, Host.NodeData{ .try_statement = .{
        .block = block,
        .handler = handler,
        .finalizer = .null,
    } }, .{ .start = try_start, .end = end });
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_try_expression = .{
        .statement = abi.NodeRef.init(@intFromEnum(statement_node)),
        .pending = abi.OptionalNodeRef.init(@intFromEnum(pending)),
    } }, .{ .start = start, .end = end }));
}

fn parseCatch(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    if (!try consume(Host, parser, .@"catch", "Expected 'catch' after '@'", "TSRX catch clauses are written '@catch { ... }' or '@catch (error) { ... }'.")) return null;
    var param = Host.NodeIndex.null;
    var reset = Host.NodeIndex.null;
    if (Host.currentToken(parser) == .left_paren) {
        if (!try Host.advance(parser)) return null;
        param = try parseCatchParam(Host, parser) orelse return null;
        if (Host.currentToken(parser) == .comma) {
            if (!try Host.advance(parser)) return null;
            reset = try parseBinding(Host, parser) orelse return null;
        }
        if (!try consume(Host, parser, .right_paren, "Expected ')' after catch parameter", null)) return null;
    }
    const body = try templateBlock(Host, parser, false) orelse return null;
    const node = try Host.addNode(parser, Host.NodeData{ .catch_clause = .{ .param = param, .body = body } }, .{ .start = start, .end = Host.nodeSpan(parser, body).end });
    if (comptime @hasDecl(Host, "addRecord")) {
        const record = try Host.addRecord(parser, schema.Record{ .catch_clause = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .reset_param = abi.OptionalNodeRef.init(@intFromEnum(reset)),
        } });
        try Host.addOverlay(parser, node, record);
    }
    return node;
}

fn parseCatchParam(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const param = switch (Host.currentToken(parser)) {
        .bitwise_and => switch (try patterns.binding(Host, parser)) {
            .unhandled => unreachable,
            .handled => |node| node orelse return null,
        },
        .left_brace, .left_bracket => try Host.parseOrdinaryBinding(parser) orelse return null,
        else => try parseBindingIdentifier(Host, parser) orelse return null,
    };
    if (Host.currentToken(parser) == .colon) {
        _ = try parser.parseTypeAnnotation(param) orelse return null;
    }
    return param;
}

fn parseBindingIdentifier(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const name_span = Host.currentSpan(parser);
    const name = try stringValue(Host, parser, name_span);
    if (!try Host.advance(parser)) return null;
    return @as(?Host.NodeIndex, try Host.addNode(parser, Host.NodeData{ .binding_identifier = .{ .name = name, .type_annotation = .null } }, name_span));
}

fn parseBinding(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    const binding = try parseBindingIdentifier(Host, parser) orelse return null;
    if (Host.currentToken(parser) == .colon) {
        _ = try parser.parseTypeAnnotation(binding) orelse return null;
    }
    return binding;
}

/// `parseValueUntil` for a committed directive: a missing expression is reported, never declined.
fn header(comptime Host: type, parser: anytype, stops: []const u8, message: []const u8) Host.ErrorType!?Host.NodeIndex {
    return try parseValueUntil(Host, parser, stops) orelse {
        try Host.report(parser, Host.currentSpan(parser), message);
        return null;
    };
}

/// Parse a directive-header expression that ends at one of `stops`.
///
/// Every TSRX header sits between a directive keyword and a byte that closes
/// it - `)` for `@if` and `@switch`, `:` for `@case`, `;` or `)` for a for-of
/// tail clause - so handing that byte to the host lets it parse the header
/// with the full expression grammar instead of a local sketch of one.
fn parseValueUntil(comptime Host: type, parser: anytype, stops: []const u8) Host.ErrorType!?Host.NodeIndex {
    if (comptime @hasDecl(Host, "parseExpressionUntil")) {
        return Host.parseExpressionUntil(parser, stops);
    }
    return parseValue(Host, parser);
}

fn parseValue(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    if (comptime @hasDecl(Host, "parseExpression")) {
        return Host.parseExpression(parser);
    } else {
        const span = Host.currentSpan(parser);
        const node = switch (Host.currentToken(parser)) {
            .identifier => try Host.addNode(parser, Host.NodeData{ .identifier_reference = .{
                .name = try stringValue(Host, parser, span),
            } }, span),
            .string_literal => try Host.addNode(parser, Host.NodeData{ .string_literal = .{
                .value = try stringValue(Host, parser, .{ .start = span.start + 1, .end = span.end - 1 }),
            } }, span),
            else => return null,
        };
        if (!try Host.advance(parser)) return null;
        return node;
    }
}

fn stringValue(comptime Host: type, parser: anytype, span: Host.Span) Host.ErrorType!Host.Value {
    if (comptime @hasDecl(Host, "sourceSlice")) return Host.sourceSlice(parser, span.start, span.end);
    return Host.addString(parser, Host.sourceText(parser, span));
}

fn templateBlock(comptime Host: type, parser: anytype, allow_return: bool) Host.ErrorType!?Host.NodeIndex {
    if (Host.currentToken(parser) != .left_brace) {
        try Host.reportWithHelp(parser, Host.currentSpan(parser), "Expected '{' after TSRX control-flow directive", "TSRX control-flow bodies are written with braces.");
        return null;
    }
    const parsed = try Host.parseBlockWithTemporaryReturn(parser, true) orelse return null;
    const block = try transformParsedBlock(Host, parser, parsed) orelse return null;
    if (!allow_return) {
        const data = Host.data(parser, block).block_statement;
        try validateReturns(Host, parser, data.body, 0);
    }
    return block;
}

fn transformParsedBlock(comptime Host: type, parser: anytype, block: Host.NodeIndex) Host.ErrorType!?Host.NodeIndex {
    const data = switch (Host.data(parser, block)) {
        .block_statement => |value| value,
        .expression_statement => |value| {
            try Host.reportWithHelp(parser, Host.nodeSpan(parser, value.expression), "Expected '{' after TSRX control-flow directive", "TSRX control-flow bodies are written with braces.");
            return null;
        },
        else => {
            try Host.reportWithHelp(parser, Host.nodeSpan(parser, block), "Expected '{' after TSRX control-flow directive", "TSRX control-flow bodies are written with braces.");
            return null;
        },
    };
    const items = Host.extra(parser, data.body);
    var end = items.len;
    while (end > 0 and Host.data(parser, items[end - 1]) == .empty_statement) {
        if (Host.isDialectNode(parser, items[end - 1])) break;
        end -= 1;
    }
    var body_len = end;
    var render = Host.NodeIndex.null;
    if (end > 0) {
        render = switch (Host.data(parser, items[end - 1])) {
            .expression_statement => |value| if (isRender(Host, parser, value.expression)) value.expression else .null,
            .empty_statement => if (Host.isDialectNode(parser, items[end - 1])) items[end - 1] else .null,
            else => .null,
        };
        if (render != .null) body_len -= 1;
    }
    var rebuilt: std.ArrayList(Host.NodeIndex) = .empty;
    defer rebuilt.deinit(Host.allocator(parser));
    try rebuilt.appendSlice(Host.allocator(parser), items[0..body_len]);
    if (render != .null) try rebuilt.append(Host.allocator(parser), render);
    const range = try Host.addExtra(parser, rebuilt.items);
    return @as(?Host.NodeIndex, try Host.addNode(parser, Host.NodeData{ .block_statement = .{ .body = range } }, Host.nodeSpan(parser, block)));
}

fn isRender(comptime Host: type, parser: anytype, node: Host.NodeIndex) bool {
    return switch (Host.data(parser, node)) {
        .jsx_element, .jsx_fragment => true,
        .empty_statement => Host.isDialectNode(parser, node),
        else => false,
    };
}

fn validateReturns(comptime Host: type, parser: anytype, range: Host.IndexRange, depth: u8) Host.ErrorType!void {
    if (depth == 64) return;
    for (Host.extra(parser, range)) |node| switch (Host.data(parser, node)) {
        .return_statement => try Host.reportWithHelp(parser, Host.nodeSpan(parser, node), "`return` is invalid inside TSRX template blocks", "Use rendered output as the final expression instead."),
        .block_statement => |data| try validateReturns(Host, parser, data.body, depth + 1),
        .if_statement => |data| {
            try validateNodeReturns(Host, parser, data.consequent, depth + 1);
            if (data.alternate != .null) try validateNodeReturns(Host, parser, data.alternate, depth + 1);
        },
        else => {},
    };
}

fn validateNodeReturns(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u8) Host.ErrorType!void {
    switch (Host.data(parser, node)) {
        .block_statement => |data| try validateReturns(Host, parser, data.body, depth),
        .return_statement => try Host.reportWithHelp(parser, Host.nodeSpan(parser, node), "`return` is invalid inside TSRX template blocks", "Use rendered output as the final expression instead."),
        else => {},
    }
}

fn validateSwitch(comptime Host: type, parser: anytype, range: Host.IndexRange, inside_loop: bool, depth: u8) Host.ErrorType!void {
    if (depth == 64) return;
    for (Host.extra(parser, range)) |node| switch (Host.data(parser, node)) {
        .break_statement => if (!inside_loop) try Host.report(parser, Host.nodeSpan(parser, node), "`break` is invalid inside `@switch` cases."),
        .return_statement => try Host.report(parser, Host.nodeSpan(parser, node), "`return` is invalid inside `@switch` cases."),
        .block_statement => |data| try validateSwitch(Host, parser, data.body, inside_loop, depth + 1),
        .if_statement => |data| {
            try validateSwitchNode(Host, parser, data.consequent, inside_loop, depth + 1);
            if (data.alternate != .null) try validateSwitchNode(Host, parser, data.alternate, inside_loop, depth + 1);
        },
        .for_statement => |data| try validateSwitchNode(Host, parser, data.body, true, depth + 1),
        .for_in_statement => |data| try validateSwitchNode(Host, parser, data.body, true, depth + 1),
        .for_of_statement => |data| try validateSwitchNode(Host, parser, data.body, true, depth + 1),
        else => {},
    };
}

fn validateSwitchNode(comptime Host: type, parser: anytype, node: Host.NodeIndex, inside_loop: bool, depth: u8) Host.ErrorType!void {
    switch (Host.data(parser, node)) {
        .block_statement => |data| try validateSwitch(Host, parser, data.body, inside_loop, depth),
        .break_statement => if (!inside_loop) try Host.report(parser, Host.nodeSpan(parser, node), "`break` is invalid inside `@switch` cases."),
        .return_statement => try Host.report(parser, Host.nodeSpan(parser, node), "`return` is invalid inside `@switch` cases."),
        else => {},
    }
}
