const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

pub fn lazyAssignment(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (Host.currentToken(parser) != .bitwise_and) return .unhandled;
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return .{ .handled = null };
    return lazyPattern(Host, parser, start, true);
}

pub fn binding(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (Host.currentToken(parser) != .bitwise_and) return .unhandled;
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return .{ .handled = null };
    return lazyPattern(Host, parser, start, true);
}

pub fn nested(comptime Host: type, parser: anytype) Host.ErrorType!?Host.NodeIndex {
    if (Host.currentToken(parser) != .bitwise_and) return null;
    const start = Host.currentSpan(parser).start;
    if (!try Host.advance(parser)) return null;
    return switch (try lazyPattern(Host, parser, start, false)) {
        .unhandled => null,
        .handled => |node| node,
    };
}

fn lazyPattern(comptime Host: type, parser: anytype, start: u32, check_loop_tail: bool) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    const open = Host.currentToken(parser);
    if (open != .left_bracket and open != .left_brace) {
        try Host.reportWithHelp(parser, Host.currentSpan(parser), "Expected '[' or '{' after '&'", "TSRX lazy patterns are written '&[a, b]' or '&{ a, b }'.");
        return .{ .handled = null };
    }
    const node = try Host.parseLazyPattern(parser) orelse return .{ .handled = null };
    Host.extendNodeStart(parser, node, start);
    if (check_loop_tail and Host.currentToken(parser) == .semicolon) {
        try Host.report(parser, Host.nodeSpan(parser, node), "A lazy pattern needs 'of' or 'in' after it");
    }
    const record = try Host.addRecord(parser, switch (open) {
        .left_bracket => schema.Record{ .array_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        .left_brace => schema.Record{ .object_pattern = .{
            .host_node = abi.OverlayHost.init(@intFromEnum(node)),
            .lazy = true,
        } },
        else => unreachable,
    });
    try Host.addOverlay(parser, node, record);
    return .{ .handled = node };
}

pub fn canStartBinding(comptime Host: type, token: Host.Token) abi.Decision(bool) {
    return if (token == .bitwise_and) .{ .handled = true } else .unhandled;
}
