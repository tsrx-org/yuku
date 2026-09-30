const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");
const returns = @import("returns.zig");

pub fn statement(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    return .{ .handled = try parse(Host, parser, false) };
}

pub fn expression(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (!startsBlock(Host, parser)) return .unhandled;
    // an arrow's `@{ }` body is the function's body, as in core
    return .{ .handled = try parse(Host, parser, afterArrow(Host.source(parser), Host.currentSpan(parser).start)) };
}

/// Whether `=>`, give or take whitespace, ends right before `at`.
fn afterArrow(source: []const u8, at: u32) bool {
    var index: usize = at;
    while (index > 0 and std.ascii.isWhitespace(source[index - 1])) index -= 1;
    return index >= 2 and source[index - 2] == '=' and source[index - 1] == '>';
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
    Host.enterTemplateBody(parser);
    const parsed = parsed: {
        defer Host.leaveTemplateBody(parser);
        break :parsed try Host.parseBlockWithTemporaryReturn(parser, true);
    };
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

    const range = switch (Host.data(parser, block)) {
        .block_statement => |data| data.body,
        .function_body => |data| data.body,
        else => return null,
    };
    const items = Host.extra(parser, range);
    try reportRenderOutputs(Host, parser, items);
    var body_len = items.len;
    var render = Host.NodeIndex.null;
    if (body_len > 0) {
        const last = items[body_len - 1];
        render = renderNode(Host, parser, last);
        if (render != .null) body_len -= 1;
    }
    // core reports a `return` in the statements before the rendered node
    if (!allow_return) try returns.report(Host, parser, items[0..body_len]);
    const body = try addUnwrappedBody(Host, parser, items[0..body_len]);
    const end = Host.nodeSpan(parser, block).end;
    return @as(?Host.NodeIndex, try Host.addDialectNode(parser, schema.Record{ .jsx_code_block = .{
        .body = .{ .start = body.start, .len = body.len },
        .render = abi.OptionalNodeRef.init(@intFromEnum(render)),
    } }, .{ .start = start, .end = end }));
}

pub const single_output_message = "A code block renders a single node; wrap multiple nodes or text in a fragment '<>…</>'.";
pub const statement_after_output_message = "Code must be at the top of '@{ }'; statements cannot follow the rendered output.";

/// Report what `@tsrx/core` reports in a template body's statements (a `@{ }`
/// body, or a directive's `{ }`): every render node after the first, which
/// is one too many, and every statement after one, which must come before it.
/// A stray `;` is neither.
pub fn reportRenderOutputs(comptime Host: type, parser: anytype, items: []const Host.NodeIndex) Host.ErrorType!void {
    var rendered = false;
    for (items) |item| {
        if (Host.data(parser, item) == .empty_statement and !Host.isDialectNode(parser, item)) continue;
        const render = renderNode(Host, parser, item);
        if (render != .null) {
            if (rendered) try Host.report(parser, Host.nodeSpan(parser, render), single_output_message);
            rendered = true;
        } else if (rendered) {
            try Host.report(parser, Host.nodeSpan(parser, item), statement_after_output_message);
        }
    }
}

/// `items` as a template body's statement list: a render node before the last
/// statement, which `reportRenderOutputs` reported, is its bare element, as in
/// `@tsrx/core`, not an expression statement around it.
pub fn addUnwrappedBody(comptime Host: type, parser: anytype, items: []const Host.NodeIndex) Host.ErrorType!Host.IndexRange {
    var wrapped = false;
    for (items) |item| {
        if (Host.data(parser, item) == .expression_statement and renderNode(Host, parser, item) != .null) wrapped = true;
    }
    if (!wrapped) return Host.addExtra(parser, items);
    var unwrapped: std.ArrayList(Host.NodeIndex) = .empty;
    defer unwrapped.deinit(Host.allocator(parser));
    for (items) |item| {
        const render = if (Host.data(parser, item) == .expression_statement) renderNode(Host, parser, item) else .null;
        try unwrapped.append(Host.allocator(parser), if (render != .null) render else item);
    }
    return Host.addExtra(parser, unwrapped.items);
}

pub fn renderNode(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.NodeIndex {
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
