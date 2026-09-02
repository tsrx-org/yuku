const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

pub fn afterOpen(comptime Host: type, parser: anytype, opening: Host.NodeIndex, comptime context: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    const opening_data = switch (Host.data(parser, opening)) {
        .jsx_opening_element => |data| data,
        else => return .unhandled,
    };
    const name_value = switch (Host.data(parser, opening_data.name)) {
        .jsx_identifier => |data| data.name,
        else => return .unhandled,
    };
    if (!std.mem.eql(u8, Host.string(parser, name_value), "script")) return .unhandled;

    const opening_span = Host.nodeSpan(parser, opening);
    if (opening_data.self_closing) {
        return .{ .handled = try Host.addDialectNode(parser, schema.Record{ .jsx_script_element = .{
            .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
            .children = .{ .start = 0, .len = 0 },
            .closing_element = abi.OptionalNodeRef.init(@intFromEnum(Host.NodeIndex.null)),
            .raw = .{ .start = 0, .end = 0 },
        } }, opening_span) };
    }

    const source = Host.source(parser);
    const close = "</script>";
    const close_index = std.mem.indexOfPos(u8, source, opening_span.end, close) orelse {
        try Host.reportWithHelp(
            parser,
            .{ .start = opening_span.end, .end = opening_span.end },
            "Unclosed TSRX script element",
            "Add '</script>' before the end of the template.",
        );
        return .{ .handled = null };
    };
    const close_start: u32 = @intCast(close_index);
    const close_end: u32 = @intCast(close_index + close.len);
    const raw = Host.sourceSlice(parser, opening_span.end, close_start);
    const raw_child = try Host.addNode(parser, Host.NodeData{ .jsx_text = .{ .value = raw } }, .{
        .start = opening_span.end,
        .end = close_start,
    });
    const children = try Host.addExtra(parser, &.{raw_child});

    const closing_name_span: Host.Span = .{ .start = close_start + 2, .end = close_start + 8 };
    const closing_name = try Host.addNode(parser, Host.NodeData{ .jsx_identifier = .{
        .name = Host.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    const closing = try Host.addNode(parser, Host.NodeData{ .jsx_closing_element = .{
        .name = closing_name,
    } }, .{ .start = close_start, .end = close_end });

    const node = try Host.addDialectNode(parser, schema.Record{ .jsx_script_element = .{
        .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
        .children = .{ .start = children.start, .len = children.len },
        .closing_element = abi.OptionalNodeRef.init(@intFromEnum(closing)),
        .raw = .{ .start = raw.start, .end = raw.end },
    } }, .{ .start = opening_span.start, .end = close_end });
    if (!try Host.resumeAfterRawSpan(parser, close_end, context)) return .{ .handled = null };
    return .{ .handled = node };
}
