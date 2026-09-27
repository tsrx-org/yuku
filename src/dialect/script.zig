const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

/// A `<script>` body is raw text, as in HTML: everything between the opening
/// tag's `>` and the closing tag is the element's `content`, as written, and
/// the element has no children (`@tsrx/core` 0.5.0, tsrx-org/tsrx#708 and
/// #790). `{`, `<`, comments and character references in it are text.
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
            .content = .{ .start = 0, .end = 0 },
        } }, opening_span) };
    }

    const source = Host.source(parser);
    const close = try findBodyEnd(Host, parser, source, opening_span.end) orelse {
        try Host.reportWithHelp(
            parser,
            .{ .start = opening_span.end, .end = opening_span.end },
            "Unclosed TSRX script element",
            "Add '</script>' before the end of the template.",
        );
        return .{ .handled = null };
    };
    const content = Host.sourceSlice(parser, opening_span.end, close.start);

    const closing_name_span: Host.Span = .{ .start = close.start + 2, .end = close.start + 8 };
    const closing_name = try Host.addNode(parser, Host.NodeData{ .jsx_identifier = .{
        .name = Host.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    const closing = try Host.addNode(parser, Host.NodeData{ .jsx_closing_element = .{
        .name = closing_name,
    } }, close);

    const node = try Host.addDialectNode(parser, schema.Record{ .jsx_script_element = .{
        .opening_element = abi.NodeRef.init(@intFromEnum(opening)),
        .children = .{ .start = 0, .len = 0 },
        .closing_element = abi.OptionalNodeRef.init(@intFromEnum(closing)),
        .content = .{ .start = content.start, .end = content.end },
    } }, .{ .start = opening_span.start, .end = close.end });
    if (!try Host.resumeAfterRawSpan(parser, close.end, context)) return .{ .handled = null };
    return .{ .handled = node };
}

/// Where a `<script>` body ends: at `</script`, optional HTML whitespace, then
/// `>`. HTML ends a script at any `</script` followed by whitespace, `/` or
/// `>`, in any letter case, so every other `</script` in the body is reported
/// with code `tsrx-script-end-tag-in-body` over its 8 characters as written,
/// and the scan goes on to the real closing tag. Returns the closing tag's
/// span, or null when the body is unclosed.
pub fn findBodyEnd(comptime Host: type, parser: anytype, source: []const u8, content_start: u32) Host.ErrorType!?Host.Span {
    var cursor: usize = content_start;
    while (endTagAt(source, cursor)) |written| : (cursor += 1) {
        if (written.len == 0) continue;
        if (closingTagEnd(source, cursor)) |end| return .{ .start = @intCast(cursor), .end = end };
        try Host.report(
            parser,
            .{ .start = @intCast(cursor), .end = @intCast(cursor + end_tag.len) },
            try endTagInBodyMessage(Host.allocator(parser), written),
        );
        cursor += end_tag.len - 1;
    }
    return null;
}

const end_tag = "</script";

/// At `cursor`: the `</script` written there in any letter case, an empty
/// slice when there is none, or null past the last place one could start.
fn endTagAt(source: []const u8, cursor: usize) ?[]const u8 {
    if (cursor + end_tag.len > source.len) return null;
    const written = source[cursor .. cursor + end_tag.len];
    return if (std.ascii.eqlIgnoreCase(written, end_tag)) written else written[0..0];
}

/// When the script's closing tag starts at `cursor` -- `</script`, optional
/// HTML whitespace, `>` -- the offset just past its `>`.
fn closingTagEnd(source: []const u8, cursor: usize) ?u32 {
    if (cursor + end_tag.len > source.len) return null;
    if (!std.mem.eql(u8, source[cursor .. cursor + end_tag.len], end_tag)) return null;
    var index = cursor + end_tag.len;
    while (index < source.len and isHtmlWhitespace(source[index])) index += 1;
    if (index >= source.len or source[index] != '>') return null;
    return @intCast(index + 1);
}

/// Offset just past the closing tag of a script body that starts at `from`,
/// found by the same rule as `findBodyEnd`, without reporting anything.
pub fn bodyEnd(source: []const u8, from: u32) ?u32 {
    var cursor: usize = from;
    while (cursor < source.len) : (cursor += 1) {
        if (source[cursor] != '<') continue;
        if (closingTagEnd(source, cursor)) |end| return end;
    }
    return null;
}

/// `@tsrx/core`'s message for a `</script` inside a script body, naming the
/// tag as written.
pub fn endTagInBodyMessage(allocator: std.mem.Allocator, written: []const u8) std.mem.Allocator.Error![]u8 {
    return std.fmt.allocPrint(
        allocator,
        "'{s}' can end a script in HTML, so a '<script>' body can't contain it. Write '<\\/{s}' instead.",
        .{ written, written[2..] },
    );
}

pub fn isEndTagInBodyMessage(message: []const u8) bool {
    return message.len > end_tag.len + 2 and message[0] == '\'' and
        std.ascii.eqlIgnoreCase(message[1 .. 1 + end_tag.len], end_tag) and
        std.mem.endsWith(u8, message, "' instead.") and
        std.mem.indexOf(u8, message, " can end a script in HTML, ") != null;
}

/// HTML's whitespace: tab, line feed, form feed, carriage return, and space.
fn isHtmlWhitespace(byte: u8) bool {
    return switch (byte) {
        '\t', '\n', 0x0c, '\r', ' ' => true,
        else => false,
    };
}
