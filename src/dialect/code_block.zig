const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

pub fn statement(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn expression(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn jsxChild(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn functionBodyStarts(comptime Host: type, parser: anytype) abi.Decision(bool) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = true };
}

pub fn functionBody(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, true) };
}

fn startsBlock(comptime Host: type, parser: anytype) bool {
    if (Host.currentToken(parser) != .at) return false;
    const span = Host.currentSpan(parser);
    const source = Host.source(parser);
    return span.end < source.len and source[span.end] == '{';
}

fn parse(comptime Host: type, parser: anytype, allow_return: bool) Host.ErrorType!?Host.NodeIndex {
    const start = Host.currentSpan(parser).start;
    const extras_start = (try Host.addExtra(parser, &.{})).start;
    if (!try Host.advance(parser)) return null;
    // Parse with return enabled; expression blocks validate returns below.
    const parsed = try Host.parseBlockWithTemporaryReturn(parser, true);
    const block = parsed orelse blk: {
        if (Host.currentToken(parser) != .eof) return null;
        const extras_end = (try Host.addExtra(parser, &.{})).start;
        const produced_range: Host.IndexRange = .{
            .start = extras_start,
            .len = extras_end - extras_start,
        };
        const produced = Host.extra(parser, produced_range);
        var body_start = produced.len;
        var next_start: u32 = @intCast(Host.source(parser).len);
        while (body_start > 0) {
            const node = produced[body_start - 1];
            if (!Host.data(parser, node).isStatement()) break;
            const span = Host.nodeSpan(parser, node);
            if (span.start < start + 2 or span.end > next_start) break;
            body_start -= 1;
            next_start = span.start;
        }
        const body = try Host.addExtra(parser, produced[body_start..]);
        try Host.report(parser, .{ .start = start, .end = start + 2 }, "Unclosed '@{' code block");
        break :blk try Host.addNode(parser, Host.NodeData{ .block_statement = .{
            .body = body,
        } }, .{ .start = start + 1, .end = @intCast(Host.source(parser).len) });
    };
    if (!allow_return) try reportReturns(Host, parser, block, 0);

    const range = switch (Host.data(parser, block)) {
        .block_statement => |data| data.body,
        .function_body => |data| data.body,
        else => return null,
    };
    const items = Host.extra(parser, range);
    var body_len = items.len;
    var render = Host.NodeIndex.null;
    if (body_len > 0) {
        const last = items[body_len - 1];
        render = renderNode(Host, parser, last);
        if (render != .null) body_len -= 1;
    }
    const body = try Host.addExtra(parser, items[0..body_len]);
    const end = Host.nodeSpan(parser, block).end;
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_code_block = .{
        .body = .{ .start = body.start, .len = body.len },
        .render = abi.OptionalNodeRef.init(@intFromEnum(render)),
    } }, .{ .start = start, .end = end }));
}

fn renderNode(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.NodeIndex {
    return switch (Host.data(parser, node)) {
        .expression_statement => |data| switch (Host.data(parser, data.expression)) {
            .jsx_element, .jsx_fragment => data.expression,
            .empty_statement => if (Host.isDialectNode(parser, data.expression)) data.expression else .null,
            else => .null,
        },
        .empty_statement => if (Host.isDialectNode(parser, node)) node else .null,
        else => .null,
    };
}

fn reportReturns(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u8) Host.ErrorType!void {
    if (depth == 64) return;
    switch (Host.data(parser, node)) {
        .return_statement => try Host.reportWithHelp(
            parser,
            Host.nodeSpan(parser, node),
            "`return` is invalid inside TSRX template blocks",
            "Use rendered output as the final expression instead.",
        ),
        .block_statement => |data| for (Host.extra(parser, data.body)) |child| {
            try reportReturns(Host, parser, child, depth + 1);
        },
        .if_statement => |data| {
            try reportReturns(Host, parser, data.consequent, depth + 1);
            if (data.alternate != .null) try reportReturns(Host, parser, data.alternate, depth + 1);
        },
        else => {},
    }
}
