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

pub fn value(comptime Host: type, parser: anytype, span: anytype) Host.ErrorType!abi.Decision(Host.Value) {
    const source = Host.sourceText(parser, span);
    if (std.mem.indexOfScalar(u8, source, '&') == null) return .unhandled;
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

/// Where the comment that starts at `index` in JSX text ends, or null when none
/// starts there, as `@tsrx/core` reads it: `/*` anywhere, running past `*/` or
/// to the end of the source, and `//` at the start of a text run (`run_start`)
/// or after whitespace, running to the line break. `a//b` and `https://x` are
/// text. With `js`, where core reads the text as code (right after a block's
/// `}`), U+2028 and U+2029 end a line comment too.
pub fn commentEnd(source: []const u8, index: usize, run_start: usize, js: bool) ?u32 {
    if (index + 1 >= source.len or source[index] != '/') return null;
    if (source[index + 1] == '*') {
        const close = std.mem.indexOfPos(u8, source, index + 2, "*/") orelse return @intCast(source.len);
        return @intCast(close + 2);
    }
    if (source[index + 1] != '/') return null;
    if (index != run_start and std.mem.indexOfScalar(u8, " \t\r\n", source[index - 1]) == null) return null;
    var end = std.mem.indexOfAnyPos(u8, source, index, "\r\n") orelse source.len;
    if (js) for ([_][]const u8{ "\u{2028}", "\u{2029}" }) |separator| {
        end = std.mem.indexOfPos(u8, source[0..end], index, separator) orelse end;
    };
    return @intCast(end);
}
