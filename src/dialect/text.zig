const std = @import("std");
const abi = @import("dialect_abi");

pub fn boundary(comptime Host: type, source: []const u8, cursor: u32) abi.Decision(bool) {
    _ = Host;
    return .{ .handled = startsDirective(source, cursor) };
}

pub fn startsDirective(source: []const u8, cursor: u32) bool {
    if (cursor >= source.len or source[cursor] != '@') return false;
    const after_at = cursor + 1;
    if (after_at < source.len and source[after_at] == '{') return true;
    inline for (.{ "if", "for", "switch", "try", "else", "empty", "case", "default", "pending", "catch" }) |keyword| {
        if (keywordAfterAt(source, cursor, keyword)) return true;
    }
    return false;
}

pub fn keywordAfterAt(source: []const u8, cursor: u32, keyword: []const u8) bool {
    if (cursor >= source.len or source[cursor] != '@') return false;
    const start: usize = cursor + 1;
    const end = start + keyword.len;
    if (end > source.len or !std.mem.eql(u8, source[start..end], keyword)) return false;
    return end == source.len or !isIdentifierByte(source[end]);
}

fn isIdentifierByte(byte: u8) bool {
    return std.ascii.isAlphanumeric(byte) or byte == '_' or byte == '$' or byte >= 0x80;
}

/// The text's value: comments left out when `comments_are_comments` (a `.tsrx`
/// file), then character references decoded.
pub fn value(comptime Host: type, parser: anytype, span: anytype, comments_are_comments: bool) Host.ErrorType!abi.Decision(Host.Value) {
    const written = Host.sourceText(parser, span);
    const has_comment = comments_are_comments and hasComment(written);
    if (!has_comment and std.mem.indexOfScalar(u8, written, '&') == null) return .unhandled;
    var uncommented: std.ArrayList(u8) = .empty;
    defer uncommented.deinit(Host.allocator(parser));
    const source = if (has_comment) blk: {
        try withoutComments(Host.allocator(parser), written, &uncommented);
        break :blk uncommented.items;
    } else written;
    if (std.mem.indexOfScalar(u8, source, '&') == null) return .{ .handled = try Host.addString(parser, source) };
    var decoded: std.ArrayList(u8) = .empty;
    defer decoded.deinit(Host.allocator(parser));
    var cursor: usize = 0;
    while (cursor < source.len) {
        if (source[cursor] != '&') {
            try decoded.append(Host.allocator(parser), source[cursor]);
            cursor += 1;
            continue;
        }
        const semicolon = std.mem.indexOfScalarPos(u8, source, cursor, ';') orelse {
            try decoded.append(Host.allocator(parser), '&');
            cursor += 1;
            continue;
        };
        const entity = source[cursor + 1 .. semicolon];
        const replacement: ?u8 = if (std.mem.eql(u8, entity, "quot")) '"' else if (std.mem.eql(u8, entity, "amp")) '&' else if (std.mem.eql(u8, entity, "lt")) '<' else if (std.mem.eql(u8, entity, "gt")) '>' else if (std.mem.eql(u8, entity, "apos")) '\'' else if (std.mem.startsWith(u8, entity, "#x")) std.fmt.parseInt(u8, entity[2..], 16) catch null else if (std.mem.startsWith(u8, entity, "#")) std.fmt.parseInt(u8, entity[1..], 10) catch null else null;
        if (replacement) |byte| try decoded.append(Host.allocator(parser), byte) else try decoded.appendSlice(Host.allocator(parser), source[cursor .. semicolon + 1]);
        cursor = semicolon + 1;
    }
    return .{ .handled = try Host.addString(parser, decoded.items) };
}

/// Where a comment in JSX text starts at `index`, and where it ends, or null
/// when the text at `index` is not a comment. `@tsrx/core` 0.5.0 reads a
/// comment in JSX text as a comment, in templates and plain JSX alike, and
/// leaves it out of the text's `value` and `raw`:
///
///   * `/*` starts a block comment anywhere; it ends after `*/`, or with the
///     text when it is unterminated.
///   * `//` starts a line comment only when nothing but spaces and tabs
///     precede it on its line or since the text began, so `a // b` and
///     `https://x` stay text. It ends before the line break.
///
/// An escaped opener (`&#47;*`) is not a comment: comments are found in the
/// text as written, before character references are decoded.
pub fn commentEnd(text: []const u8, index: usize) ?usize {
    if (index + 1 >= text.len or text[index] != '/') return null;
    switch (text[index + 1]) {
        '*' => {
            const close = std.mem.indexOfPos(u8, text, index + 2, "*/") orelse return text.len;
            return close + 2;
        },
        '/' => {
            var back = index;
            while (back > 0) : (back -= 1) {
                switch (text[back - 1]) {
                    ' ', '\t' => {},
                    '\n', '\r' => break,
                    else => return null,
                }
            }
            var end = index + 2;
            while (end < text.len and text[end] != '\n' and text[end] != '\r') end += 1;
            return end;
        },
        else => return null,
    }
}

/// Where the text run that began at `run_start` resumes when a comment starts at
/// `cursor`: past the comment, whatever it holds. Null when no comment starts
/// there.
pub fn skip(source: []const u8, run_start: u32, cursor: u32) ?u32 {
    std.debug.assert(run_start <= cursor);
    std.debug.assert(cursor < source.len);
    if (source[cursor] != '/') return null;
    // A run the dialect resumed past a `<` that opens no tag (`3 < x`) goes on
    // from that `<`, which is text: no run starts right after a `<` otherwise.
    const start = if (run_start > 0 and source[run_start - 1] == '<') run_start - 1 else run_start;
    const end = commentEnd(source[start..], cursor - start) orelse return null;
    std.debug.assert(start + end > cursor);
    return @intCast(start + end);
}

pub fn hasComment(text: []const u8) bool {
    var index: usize = 0;
    while (std.mem.indexOfScalarPos(u8, text, index, '/')) |slash| {
        if (commentEnd(text, slash) != null) return true;
        index = slash + 1;
    }
    return false;
}

/// Appends `text` to `out` with every comment left out.
pub fn withoutComments(allocator: std.mem.Allocator, text: []const u8, out: *std.ArrayList(u8)) std.mem.Allocator.Error!void {
    var index: usize = 0;
    var copied: usize = 0;
    while (index < text.len) {
        if (commentEnd(text, index)) |end| {
            try out.appendSlice(allocator, text[copied..index]);
            index = end;
            copied = end;
            continue;
        }
        index += 1;
    }
    try out.appendSlice(allocator, text[copied..]);
}

test "comments in JSX text are left out" {
    const cases = [_][2][]const u8{
        .{ "\n\t\ta\n\t\t// note\n\t\tb\n\t", "\n\t\ta\n\t\t\n\t\tb\n\t" },
        .{ "a /* note */ b", "a  b" },
        .{ "// only", "" },
        .{ "a // note", "a // note" },
        .{ "a // note\n b", "a // note\n b" },
        .{ "https://x.dev", "https://x.dev" },
        .{ "a &#47;* note *&#47; b", "a &#47;* note *&#47; b" },
        .{ "a /* open", "a " },
        .{ "  // one\r\n  // two\n x", "  \r\n  \n x" },
    };
    for (cases) |case| {
        var out: std.ArrayList(u8) = .empty;
        defer out.deinit(std.testing.allocator);
        try withoutComments(std.testing.allocator, case[0], &out);
        try std.testing.expectEqualStrings(case[1], out.items);
        try std.testing.expectEqual(!std.mem.eql(u8, case[0], case[1]), hasComment(case[0]));
    }
}
