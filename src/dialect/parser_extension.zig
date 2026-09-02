//! Local specialization for the frozen Yuku parser-extension calls.
//!
//! This module deliberately imports no parser module. Every parser and AST type
//! is derived from the concrete pointer supplied by Yuku, which keeps one
//! Parser identity and lets the owning Container recover its local Store.
const std = @import("std");
const abi = @import("dialect_abi");
const schema = @import("dialect_schema");

const code_block = @import("code_block.zig");
const control_flow = @import("control_flow.zig");
const jsx = @import("jsx.zig");
const modules = @import("modules.zig");
const patterns = @import("patterns.zig");
const style = @import("style.zig");
const text = @import("text.zig");

pub const Association = struct { anchor: u32, record_index: u32 };
pub const OverlayPair = struct { host_node: u32, record_index: u32 };

pub const Store = struct {
    records: std.ArrayList(schema.Record) = .empty,
    associations: std.ArrayList(Association) = .empty,
    overlays: std.ArrayList(OverlayPair) = .empty,
    active_records: std.ArrayList(u32) = .empty,

    pub const Checkpoint = struct {
        records: usize,
        associations: usize,
        overlays: usize,
        active_records: usize,
    };

    pub fn checkpoint(self: *const Store) Checkpoint {
        return .{
            .records = self.records.items.len,
            .associations = self.associations.items.len,
            .overlays = self.overlays.items.len,
            .active_records = self.active_records.items.len,
        };
    }

    pub fn rewind(self: *Store, saved: Checkpoint) void {
        std.debug.assert(saved.records <= self.records.items.len);
        std.debug.assert(saved.associations <= self.associations.items.len);
        std.debug.assert(saved.overlays <= self.overlays.items.len);
        std.debug.assert(saved.active_records <= self.active_records.items.len);
        self.records.shrinkRetainingCapacity(saved.records);
        self.associations.shrinkRetainingCapacity(saved.associations);
        self.overlays.shrinkRetainingCapacity(saved.overlays);
        self.active_records.shrinkRetainingCapacity(saved.active_records);
    }

    pub fn enter(self: *Store, allocator: std.mem.Allocator, record_index: u32) !void {
        if (self.active_records.items.len >= 64) return error.OutOfMemory;
        for (self.active_records.items) |active| if (active == record_index) return error.OutOfMemory;
        try self.active_records.append(allocator, record_index);
    }

    pub fn leave(self: *Store, record_index: u32) void {
        std.debug.assert(self.active_records.getLastOrNull() == record_index);
        _ = self.active_records.pop();
    }

    pub fn addRecord(self: *Store, allocator: std.mem.Allocator, record: schema.Record) !u32 {
        if (self.records.items.len >= 1 << 20) return error.OutOfMemory;
        const index: u32 = @intCast(self.records.items.len);
        try self.records.append(allocator, record);
        return index;
    }

    pub fn addAssociation(self: *Store, allocator: std.mem.Allocator, anchor: u32, record_index: u32) !void {
        if (record_index >= self.records.items.len) return error.OutOfMemory;
        if (self.associations.getLastOrNull()) |last| if (anchor <= last.anchor) return error.OutOfMemory;
        try self.associations.append(allocator, .{ .anchor = anchor, .record_index = record_index });
    }

    pub fn addOverlay(self: *Store, allocator: std.mem.Allocator, host: u32, record_index: u32) !void {
        if (record_index >= self.records.items.len) return error.OutOfMemory;
        if (self.overlays.getLastOrNull()) |last| if (host <= last.host_node) return error.OutOfMemory;
        try self.overlays.append(allocator, .{ .host_node = host, .record_index = record_index });
    }

    pub fn findAssociation(self: *const Store, anchor: u32) ?u32 {
        var lo: usize = 0;
        var hi = self.associations.items.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            if (self.associations.items[mid].anchor < anchor) lo = mid + 1 else hi = mid;
        }
        return if (lo < self.associations.items.len and self.associations.items[lo].anchor == anchor)
            self.associations.items[lo].record_index
        else
            null;
    }

    pub fn findOverlay(self: *const Store, host: u32) ?u32 {
        var lo: usize = 0;
        var hi = self.overlays.items.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            if (self.overlays.items[mid].host_node < host) lo = mid + 1 else hi = mid;
        }
        return if (lo < self.overlays.items.len and self.overlays.items[lo].host_node == host)
            self.overlays.items[lo].record_index
        else
            null;
    }
};

pub const LocalOptions = struct { loose: bool = false };

pub fn Container(comptime Parser: type) type {
    return struct {
        parser: Parser,
        store: Store = .{},
        options: LocalOptions = .{},
    };
}

fn container(parser: anytype) *Container(@TypeOf(parser.*)) {
    const C = Container(@TypeOf(parser.*));
    comptime std.debug.assert(@offsetOf(C, "parser") == 0);
    return @fieldParentPtr("parser", parser);
}

pub fn Host(comptime Parser: type) type {
    return struct {
        const Self = @This();
        const P = Parser;
        pub const ErrorType = @typeInfo(@typeInfo(@TypeOf(P.parse)).@"fn".return_type.?).error_union.error_set;
        const Tree = @FieldType(P, "tree");
        const TokenValue = @FieldType(P, "current_token");
        pub const NodeIndex = @FieldType(Tree, "root");
        pub const NodeData = @typeInfo(@TypeOf(Tree.data)).@"fn".return_type.?;
        pub const Span = @FieldType(TokenValue, "span");
        pub const Token = @FieldType(TokenValue, "tag");
        pub const Value = @typeInfo(@TypeOf(Tree.sourceSlice)).@"fn".return_type.?;
        pub const IndexRange = @FieldType(@FieldType(NodeData, "program"), "body");
        pub const Context = struct {
            start: u32,
            left: NodeIndex,
            right: NodeIndex,
            is_for_await: bool,
        };

        pub inline fn currentToken(p: *P) Token {
            return p.current_token.tag;
        }
        pub inline fn currentSpan(p: *P) Span {
            return p.current_token.span;
        }
        pub inline fn source(p: *P) []const u8 {
            return p.source;
        }
        pub inline fn sourceText(p: *const P, span: Span) []const u8 {
            return p.spanText(span);
        }
        pub inline fn sourceSlice(p: *P, start: u32, end: u32) Value {
            return p.tree.sourceSlice(start, end);
        }
        pub inline fn allocator(p: *P) std.mem.Allocator {
            return p.allocator();
        }
        pub inline fn data(p: *const P, node: NodeIndex) NodeData {
            return p.tree.data(node);
        }
        pub inline fn nodeSpan(p: *const P, node: NodeIndex) Span {
            return p.tree.span(node);
        }
        pub inline fn extra(p: *const P, range: anytype) []const NodeIndex {
            return p.tree.extra(range);
        }
        pub inline fn string(p: *const P, value: Value) []const u8 {
            return p.tree.string(value);
        }
        pub inline fn advance(p: *P) ErrorType!bool {
            try p.advance() orelse return false;
            return true;
        }
        pub inline fn expect(p: *P, comptime tag: Token, message: []const u8) ErrorType!bool {
            return p.expect(tag, message, null);
        }
        pub inline fn addNode(p: *P, value: NodeData, span: Span) ErrorType!NodeIndex {
            return p.tree.addNode(value, span);
        }
        pub inline fn addExtra(p: *P, values: []const NodeIndex) ErrorType!@TypeOf(p.tree.data(NodeIndex.null).program.body) {
            const start: u32 = @intCast(p.tree.extras.items.len);
            try p.tree.extras.appendSlice(p.allocator(), values);
            return .{ .start = start, .len = @intCast(values.len) };
        }
        pub inline fn addString(p: *P, value: []const u8) ErrorType!Value {
            return p.tree.addString(value);
        }
        pub inline fn report(p: *P, span: Span, message: []const u8) ErrorType!void {
            return p.report(span, message, .{});
        }
        pub inline fn reportWithHelp(p: *P, span: Span, message: []const u8, help: []const u8) ErrorType!void {
            return p.report(span, message, .{ .help = help });
        }
        pub inline fn extendNodeStart(p: *P, node: NodeIndex, start: u32) void {
            var span = p.tree.span(node);
            span.start = start;
            p.tree.setSpan(node, span);
        }
        pub inline fn setLexerMode(p: *P, comptime mode: anytype) void {
            p.setLexerMode(mode);
        }
        pub inline fn reScanJsxText(p: *P, start: u32) TokenValue {
            return p.lexer.reScanJsxText(start);
        }
        pub inline fn advanceWithRescannedToken(p: *P, token: TokenValue) ErrorType!bool {
            try p.advanceWithRescannedToken(token) orelse return false;
            return true;
        }

        pub fn addRecord(p: *P, record_value: schema.Record) ErrorType!u32 {
            return container(p).store.addRecord(p.allocator(), record_value);
        }
        pub fn addOverlay(p: *P, node: NodeIndex, record_index: u32) ErrorType!void {
            return container(p).store.addOverlay(p.allocator(), @intFromEnum(node), record_index);
        }
        pub fn overlayRecord(p: *P, node: NodeIndex) ?schema.Record {
            const c = container(p);
            const index = c.store.findOverlay(@intFromEnum(node)) orelse return null;
            return c.store.records.items[index];
        }
        pub fn record(p: *P, node: NodeIndex) ?schema.Record {
            const c = container(p);
            const index = c.store.findAssociation(@intFromEnum(node)) orelse return null;
            return c.store.records.items[index];
        }
        pub fn isDialectNode(p: *P, node: NodeIndex) bool {
            return record(p, node) != null;
        }
        pub fn addDialectNode(p: *P, record_value: schema.Record, span: Span) ErrorType!NodeIndex {
            const record_index = try addRecord(p, record_value);
            const anchor = try p.tree.addNode(.{ .empty_statement = .{} }, span);
            try container(p).store.addAssociation(p.allocator(), @intFromEnum(anchor), record_index);
            return anchor;
        }

        pub fn parseBlockWithTemporaryReturn(p: *P, allow_return: bool) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            if (!try p.expect(.left_brace, "Expected '{' to start block statement", "Block statements must be enclosed in braces")) return null;
            const previous = p.context.@"return";
            p.context.@"return" = allow_return;
            defer p.context.@"return" = previous;
            const body = try p.parseBody(.right_brace, .other);
            const end = p.current_token.span.end;
            if (!try p.expect(.right_brace, "Expected '}' to close block statement", null)) return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .block_statement = .{ .body = body } }, .{ .start = start, .end = end }));
        }

        pub fn parseIdentifier(p: *P) ErrorType!?NodeIndex {
            if (!p.current_token.tag.isIdentifierLike()) return null;
            const token = p.current_token;
            const name = try p.identifierName(token);
            try p.advance() orelse return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .identifier_reference = .{ .name = name } }, token.span));
        }

        pub fn parseTagExpressionContainer(p: *P) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            p.setLexerMode(.normal);
            if (!try p.expect(.left_brace, "Expected '{'", null)) return null;
            var expression = try parseSimpleExpression(p);
            if (expression == null or p.current_token.tag != .right_brace) {
                const close = matchingBrace(p.source, start) orelse {
                    try p.reportExpected(p.current_token.span, "Expected '}' to close TSRX dynamic tag expression", .{});
                    return null;
                };
                const inner: Span = .{ .start = start + 1, .end = close };
                expression = try p.tree.addNode(.{ .numeric_literal = .{
                    .kind = .decimal,
                    .raw = p.tree.sourceSlice(inner.start, inner.end),
                } }, inner);
                p.lexer.rewindTo(close);
                p.current_token = p.lexer.nextToken() catch return null;
            }
            const end = p.current_token.span.end;
            p.setLexerMode(.jsx_tag);
            if (!try p.expect(.right_brace, "Expected '}'", null)) return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .jsx_expression_container = .{ .expression = expression.? } }, .{ .start = start, .end = end }));
        }

        fn matchingBrace(bytes: []const u8, start: u32) ?u32 {
            var cursor: usize = start + 1;
            var depth: u32 = 0;
            var quote: u8 = 0;
            var escaped = false;
            while (cursor < bytes.len) : (cursor += 1) {
                const byte = bytes[cursor];
                if (quote != 0) {
                    if (escaped) escaped = false else if (byte == '\\') escaped = true else if (byte == quote) quote = 0;
                    continue;
                }
                if (byte == '\'' or byte == '"' or byte == '`') {
                    quote = byte;
                } else if (byte == '{') {
                    depth += 1;
                } else if (byte == '}') {
                    if (depth == 0) return @intCast(cursor);
                    depth -= 1;
                }
            }
            return null;
        }

        pub fn resumeAfterRawSpan(p: *P, end: u32, comptime context: anytype) ErrorType!bool {
            if (end > p.source.len) return false;
            p.lexer.rewindTo(end);
            p.current_token = TokenValue.eof(end);
            p.prev_token_end = end;
            if (comptime std.mem.eql(u8, @tagName(context), "child")) {
                p.setLexerMode(.normal);
                return true;
            }
            if (comptime std.mem.eql(u8, @tagName(context), "attribute")) {
                p.setLexerMode(.jsx_tag);
            } else {
                p.setLexerMode(.normal);
            }
            try p.advance() orelse return false;
            return true;
        }

        fn parseSimpleExpression(p: *P) ErrorType!?NodeIndex {
            const first = try parsePrimary(p) orelse return null;
            var left = first;
            while (p.current_token.tag == .dot) {
                try p.advance() orelse return null;
                const property_token = p.current_token;
                if (!property_token.tag.isIdentifierLike()) return null;
                const name = try p.identifierName(property_token);
                const property = try p.tree.addNode(.{ .identifier_name = .{ .name = name } }, property_token.span);
                try p.advance() orelse return null;
                left = try p.tree.addNode(.{ .member_expression = .{ .object = left, .property = property, .computed = false, .optional = false } }, .{ .start = p.tree.span(left).start, .end = property_token.span.end });
            }
            if (p.current_token.tag == .greater_than) {
                try p.advance() orelse return null;
                const right = try parsePrimary(p) orelse return null;
                left = try p.tree.addNode(.{ .binary_expression = .{
                    .left = left,
                    .right = right,
                    .operator = .greater_than,
                } }, .{ .start = p.tree.span(left).start, .end = p.tree.span(right).end });
            }
            return left;
        }

        pub fn parseExpression(p: *P) ErrorType!?NodeIndex {
            return parseSimpleExpression(p);
        }

        /// Parse one TSRX directive-header expression, delegating to the host
        /// parser so the header accepts the whole JavaScript expression
        /// grammar rather than the identifier/member/`>` sketch that
        /// `parseSimpleExpression` recognises.
        ///
        /// `stops` lists the bytes that can close this particular header:
        /// `")"` for `@if`/`@switch`, `":"` for `@case`, `");"` for a for-of
        /// tail clause.  The first such byte outside quotes, brackets and a
        /// pending `?:` is where the header ends.
        pub fn parseExpressionUntil(p: *P, stops: []const u8) ErrorType!?NodeIndex {
            if (headerExpressionEnd(p, stops)) |end| {
                if (try parseDelegatedExpression(p, end)) |node| return node;
            }
            return parseSimpleExpression(p);
        }

        /// Source offset of the byte that closes the header starting at the
        /// current token, or null when no unnested `stops` byte follows.
        fn headerExpressionEnd(p: *P, stops: []const u8) ?u32 {
            const bytes = p.source;
            var cursor: usize = p.current_token.span.start;
            var depth: u32 = 0;
            var conditional: u32 = 0;
            var quote: u8 = 0;
            var escaped = false;
            while (cursor < bytes.len) : (cursor += 1) {
                const byte = bytes[cursor];
                if (quote != 0) {
                    if (escaped) {
                        escaped = false;
                    } else if (byte == '\\') {
                        escaped = true;
                    } else if (byte == quote) {
                        quote = 0;
                    }
                    continue;
                }
                switch (byte) {
                    '\'', '"', '`' => quote = byte,
                    '(', '[', '{' => depth += 1,
                    ')', ']', '}' => {
                        if (depth > 0) {
                            depth -= 1;
                        } else if (std.mem.indexOfScalar(u8, stops, byte) != null) {
                            return @intCast(cursor);
                        } else {
                            return null;
                        }
                    },
                    // `?.` and `??` are not conditional expressions, so only a
                    // lone `?` claims the `:` that follows it.
                    '?' => if (depth == 0) {
                        const next = if (cursor + 1 < bytes.len) bytes[cursor + 1] else 0;
                        if (next == '?') {
                            cursor += 1;
                        } else if (next != '.') {
                            conditional += 1;
                        }
                    },
                    ':' => if (depth == 0) {
                        if (conditional > 0) {
                            conditional -= 1;
                        } else if (std.mem.indexOfScalar(u8, stops, byte) != null) {
                            return @intCast(cursor);
                        }
                    },
                    ';' => if (depth == 0 and std.mem.indexOfScalar(u8, stops, byte) != null) {
                        return @intCast(cursor);
                    },
                    else => {},
                }
            }
            return null;
        }

        /// Parse `[current token, end)` with the host parser and recover the
        /// single expression it produced.
        ///
        /// Yuku publishes no expression entry point, only `parseBody`, whose
        /// statement parser demands a semicolon - real or ASI-inserted - after
        /// an expression statement.  A header stops at `)` or `:`, where ASI
        /// never applies, so hiding the rest of the source from the lexer is
        /// what makes the header a complete body: the statement then ends at
        /// end-of-input, where a semicolon is always implied.
        fn parseDelegatedExpression(p: *P, end: u32) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            if (end <= start or end > p.source.len) return null;

            const saved = p.checkpoint();
            const saved_store = container(p).store.checkpoint();
            const whole_source = p.lexer.source;
            p.lexer.source = whole_source[0..end];
            const body = p.parseBody(null, .other) catch |err| {
                p.lexer.source = whole_source;
                return err;
            };
            p.lexer.source = whole_source;

            const nodes = p.tree.extra(body);
            var expression = NodeIndex.null;
            if (nodes.len == 1) switch (p.tree.data(nodes[0])) {
                .expression_statement => |value| expression = value.expression,
                else => {},
            };
            const parsed_exactly_one = expression != .null and
                p.diagnostics.items.len == saved.diagnostics_len and
                p.tree.span(expression).start == start and
                p.tree.span(expression).end <= end;
            if (!parsed_exactly_one) {
                p.rewind(saved);
                container(p).store.rewind(saved_store);
                return null;
            }

            // Keep the nodes this parse produced - the caller is about to hang
            // the header off them - but put every other piece of parser state
            // back, then resume lexing at the byte that closes the header so
            // the caller still sees the terminator it expects.
            var restore = saved;
            restore.nodes_len = p.tree.nodes.len;
            restore.extra_len = p.tree.extras.items.len;
            p.rewind(restore);
            p.lexer.rewindTo(end);
            p.current_token = TokenValue.eof(end);
            p.prev_token_end = end;
            try p.advance() orelse return null;
            return @as(?NodeIndex, expression);
        }

        /// Parse the JSX element or fragment child that begins at the current
        /// `<` with the host parser, then leave the cursor on its last byte so
        /// the children loop can resume its text scan there.
        ///
        /// Yuku publishes no JSX entry point - `parseJsxElement` is private and
        /// only reachable through a statement - so this borrows the trick
        /// `parseDelegatedExpression` uses for directive headers: hide every
        /// byte past the child's balanced end from the lexer, which turns the
        /// child into a complete body whose sole statement ends at
        /// end-of-input, where a semicolon is always implied.
        ///
        /// Anything the raw scan or the host parse disagrees about - a span
        /// that does not end exactly at the scanned end, a diagnostic, a
        /// statement that is not one JSX node - rewinds and declines, leaving
        /// the token position untouched for the caller to fall back on.
        pub fn parseJsxChildElement(p: *P) ErrorType!?NodeIndex {
            if (p.current_token.tag != .less_than) return null;
            const start = p.current_token.span.start;
            const end = jsxElementEnd(p.source, start, 0) orelse return null;
            if (end <= start or end > p.source.len) return null;

            const saved = p.checkpoint();
            const saved_store = container(p).store.checkpoint();
            const whole_source = p.source;
            p.source = whole_source[0..end];
            p.lexer.source = whole_source[0..end];
            const body = p.parseBody(null, .other) catch |err| {
                p.source = whole_source;
                p.lexer.source = whole_source;
                return err;
            };
            p.source = whole_source;
            p.lexer.source = whole_source;

            const nodes = p.tree.extra(body);
            var child = NodeIndex.null;
            if (nodes.len == 1) switch (p.tree.data(nodes[0])) {
                .expression_statement => |value| switch (p.tree.data(value.expression)) {
                    .jsx_element, .jsx_fragment => child = value.expression,
                    // A raw-text element the dialect owns - `<style>` - comes
                    // back from the after-open hook as a dialect record hung on
                    // an anchor statement rather than a host jsx node, and is
                    // still exactly one child element.
                    else => if (record(p, value.expression)) |value_record| switch (value_record) {
                        .jsx_style_element => child = value.expression,
                        else => {},
                    },
                },
                else => {},
            };
            const parsed_exactly_one = child != .null and
                p.diagnostics.items.len == saved.diagnostics_len and
                p.tree.span(child).start == start and
                p.tree.span(child).end == end;
            if (!parsed_exactly_one) {
                p.rewind(saved);
                container(p).store.rewind(saved_store);
                return null;
            }

            // Keep the nodes - and the dialect records any nested directive
            // just registered - but put the rest of the parser state back and
            // resume at the child's end in the children lexer mode.
            var restore = saved;
            restore.nodes_len = p.tree.nodes.len;
            restore.extra_len = p.tree.extras.items.len;
            p.rewind(restore);
            if (!try resumeAfterRawSpan(p, end, .child)) return null;
            return @as(?NodeIndex, child);
        }

        /// Parse the JSX expression container child that begins at the current
        /// `{` with the host parser, then leave the cursor just past its
        /// closing `}` so the children loop can resume its text scan there.
        ///
        /// Yuku's own child-container parser is private, so this borrows the
        /// trick `parseJsxChildElement` uses: the balanced `}` is located by
        /// raw scan - the same scan the children gate already walks, so the two
        /// can never disagree about where the container ends - every byte from
        /// that brace on is hidden from the lexer, and the inner expression
        /// comes back from `parseBody` as the sole statement of a body that
        /// ends at end-of-input, where a semicolon is always implied.
        ///
        /// The container node itself is the one piece built here rather than
        /// delegated: the host exposes no entry point that produces one.
        ///
        /// Anything the raw scan and the host parse disagree about - a
        /// diagnostic, more than one statement, an expression that starts
        /// somewhere other than just past the `{` or runs past the scanned
        /// brace - rewinds and declines, leaving the token position untouched
        /// for the caller to fall back on.
        pub fn parseJsxChildExpressionContainer(p: *P) ErrorType!?NodeIndex {
            if (p.current_token.tag != .left_brace) return null;
            const start = p.current_token.span.start;
            const close = skipBracedRegion(p.source, start) orelse return null;
            const end = close + 1;
            if (end > p.source.len) return null;

            const saved = p.checkpoint();
            const saved_store = container(p).store.checkpoint();
            var owned = false;
            defer if (!owned) {
                p.rewind(saved);
                container(p).store.rewind(saved_store);
            };

            p.setLexerMode(.normal);
            try p.advance() orelse return null;

            var expression = NodeIndex.null;
            if (p.current_token.tag == .right_brace and p.current_token.span.start == close) {
                // `{}` - and `{ }`, and a container holding only comments -
                // carries no expression at all.
                expression = try p.tree.addNode(.{ .jsx_empty_expression = .{} }, .{
                    .start = start + 1,
                    .end = close,
                });
            } else {
                const inner_start = p.current_token.span.start;
                const whole_source = p.source;
                p.source = whole_source[0..close];
                p.lexer.source = whole_source[0..close];
                const body = p.parseBody(null, .other) catch |err| {
                    p.source = whole_source;
                    p.lexer.source = whole_source;
                    return err;
                };
                p.source = whole_source;
                p.lexer.source = whole_source;

                const nodes = p.tree.extra(body);
                if (nodes.len == 1) switch (p.tree.data(nodes[0])) {
                    .expression_statement => |value| expression = value.expression,
                    else => {},
                };
                const parsed_exactly_one = expression != .null and
                    p.diagnostics.items.len == saved.diagnostics_len and
                    p.tree.span(expression).start == inner_start and
                    p.tree.span(expression).end <= close;
                if (!parsed_exactly_one) return null;
            }

            // Keep the nodes this parse produced - and the dialect records any
            // directive nested inside the expression just registered - but put
            // the rest of the parser state back before hanging the container
            // off them and resuming at the brace that closed it.
            var restore = saved;
            restore.nodes_len = p.tree.nodes.len;
            restore.extra_len = p.tree.extras.items.len;
            p.rewind(restore);

            const node = try p.tree.addNode(.{ .jsx_expression_container = .{
                .expression = expression,
            } }, .{ .start = start, .end = end });
            if (!try resumeAfterRawSpan(p, end, .child)) return null;
            owned = true;
            return @as(?NodeIndex, node);
        }

        pub fn parseStatementExpression(p: *P) ErrorType!?NodeIndex {
            const expression = try parseExpression(p) orelse return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .expression_statement = .{
                .expression = expression,
            } }, p.tree.span(expression)));
        }

        pub fn parseBlock(p: *P) ErrorType!?NodeIndex {
            return parseBlockWithTemporaryReturn(p, true);
        }

        pub fn parseBody(p: *P) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            if (!try p.expect(.left_brace, "Expected '{' to start function body", null)) return null;
            const body = try p.parseBody(.right_brace, .function);
            const end = p.current_token.span.end;
            if (!try p.expect(.right_brace, "Expected '}' to close function body", null)) return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .function_body = .{ .body = body } }, .{
                .start = start,
                .end = end,
            }));
        }

        pub fn parseArrayCover(p: *P) ErrorType!?NodeIndex {
            return parseLazyPattern(p);
        }

        pub fn parseObjectCover(p: *P) ErrorType!?NodeIndex {
            return parseLazyPattern(p);
        }

        pub fn expressionToAssignablePattern(_: *P, _: NodeIndex) ErrorType!void {}

        pub fn parseOrdinaryBinding(p: *P) ErrorType!?NodeIndex {
            return parseLazyPattern(p);
        }

        pub fn parseChild(p: *P) ErrorType!?NodeIndex {
            return parseTagExpressionContainer(p);
        }

        pub fn namesEqual(p: *const P, left: NodeIndex, right: NodeIndex) bool {
            return std.mem.eql(u8, p.spanText(p.tree.span(left)), p.spanText(p.tree.span(right)));
        }

        pub fn isIdentifierLike(token: Token) bool {
            return token.isIdentifierLike();
        }

        pub fn currentReturnContext(p: *const P) bool {
            return p.context.@"return";
        }

        pub fn parseStatement(p: *P) ErrorType!?NodeIndex {
            if (p.current_token.tag == .left_brace) return parseBlockWithTemporaryReturn(p, true);

            // Parser.parseBody is the frozen parser's public full-statement
            // entry point.  A TSRX directive needs exactly one statement, so
            // select the token immediately following its balanced body as a
            // temporary terminator and recover the sole parsed node.
            const head = p.current_token.span;
            const body_end = balancedBodyEnd(p);
            const terminator: Token = statementTerminator(p, body_end);
            const saved = p.checkpoint();
            const saved_store = container(p).store.checkpoint();
            const body = try p.parseBody(terminator, .other);
            const nodes = p.tree.extra(body);
            if (nodes.len == 0) {
                // The caller committed at `@`: diagnostics must outlive the rewind.
                if (p.diagnostics.items.len == saved.diagnostics_len) {
                    try p.report(head, "Expected a statement after '@'", .{});
                }
                var restore = saved;
                restore.diagnostics_len = p.diagnostics.items.len;
                p.rewind(restore);
                container(p).store.rewind(saved_store);
                return null;
            }
            const first = nodes[0];
            const end = p.tree.span(first).end;
            if (nodes.len == 1 and (body_end == null or end == body_end.?)) return first;
            // Terminator guess was wrong (unbraced body, brace inside a comment): keep the first statement, resume after it.
            var comments_len = saved.lexer_comments_len;
            while (comments_len < p.lexer.comments.items.len and
                p.lexer.comments.items[comments_len].span.start < end) comments_len += 1;
            var restore = saved;
            restore.nodes_len = p.tree.nodes.len;
            restore.extra_len = p.tree.extras.items.len;
            restore.diagnostics_len = p.diagnostics.items.len;
            restore.lexer_comments_len = comments_len;
            p.rewind(restore);
            if (!try resumeAfterRawSpan(p, end, .statement)) return null;
            return first;
        }

        /// Source offset just past the balanced `{ ... }` body that follows the
        /// current token, or null when the directive has no braced body.
        fn balancedBodyEnd(p: *P) ?u32 {
            const bytes = p.source;
            var cursor: usize = p.current_token.span.start;
            var parens: u32 = 0;
            var braces: u32 = 0;
            var saw_body = false;
            var quote: u8 = 0;
            var escaped = false;
            while (cursor < bytes.len) : (cursor += 1) {
                const byte = bytes[cursor];
                if (quote != 0) {
                    if (escaped) {
                        escaped = false;
                    } else if (byte == '\\') {
                        escaped = true;
                    } else if (byte == quote) {
                        quote = 0;
                    }
                    continue;
                }
                if (byte == '\'' or byte == '"' or byte == '`') {
                    quote = byte;
                    continue;
                }
                switch (byte) {
                    '(' => parens += 1,
                    ')' => if (parens > 0) {
                        parens -= 1;
                    },
                    '{' => if (parens == 0) {
                        braces += 1;
                        saw_body = true;
                    },
                    '}' => if (parens == 0 and braces > 0) {
                        braces -= 1;
                        if (saw_body and braces == 0) return @intCast(cursor + 1);
                    },
                    else => {},
                }
            }
            return null;
        }

        /// The tag of the first real token after the directive body.  Lexing it
        /// rather than classifying its first byte is what lets a directive that
        /// is followed by ordinary JSX text stop at its own closing brace: the
        /// byte-level guess collapsed every such case to `.semicolon`, which
        /// made `parseBody` run on through the rest of the template.
        fn statementTerminator(p: *P, body_end: ?u32) Token {
            const end = body_end orelse return .semicolon;
            const saved = p.checkpoint();
            defer p.rewind(saved);
            p.setLexerMode(.normal);
            p.lexer.rewindTo(end);
            const token = p.lexer.nextToken() catch return .semicolon;
            return token.tag;
        }

        pub fn addForOf(p: *P, value: Context, body: NodeIndex) ErrorType!NodeIndex {
            return p.tree.addNode(.{ .for_of_statement = .{
                .left = value.left,
                .right = value.right,
                .body = body,
                .await = value.is_for_await,
            } }, .{ .start = value.start, .end = p.tree.span(body).end });
        }

        pub fn parseLazyPattern(p: *P) ErrorType!?NodeIndex {
            return parsePattern(p);
        }

        fn parsePattern(p: *P) ErrorType!?NodeIndex {
            return switch (p.current_token.tag) {
                .left_brace => parseObjectPattern(p),
                .left_bracket => parseArrayPattern(p),
                else => parseBindingIdentifier(p),
            };
        }

        fn parseBindingIdentifier(p: *P) ErrorType!?NodeIndex {
            if (!p.current_token.tag.isIdentifierLike()) return null;
            const token = p.current_token;
            const name = try p.identifierName(token);
            try p.advance() orelse return null;
            return @as(?NodeIndex, try p.tree.addNode(.{ .binding_identifier = .{ .name = name } }, token.span));
        }

        fn parseObjectPattern(p: *P) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            try p.advance() orelse return null;
            var properties: std.ArrayList(NodeIndex) = .empty;
            defer properties.deinit(p.allocator());
            while (p.current_token.tag != .right_brace and p.current_token.tag != .eof) {
                const key_token = p.current_token;
                if (!key_token.tag.isIdentifierLike()) {
                    try p.reportExpected(key_token.span, "Expected a property name in TSRX lazy object pattern", .{});
                    return null;
                }
                const name = try p.identifierName(key_token);
                const key = try p.tree.addNode(.{ .identifier_name = .{ .name = name } }, key_token.span);
                try p.advance() orelse return null;
                var value: NodeIndex = undefined;
                var shorthand = true;
                if (p.current_token.tag == .colon) {
                    shorthand = false;
                    try p.advance() orelse return null;
                    value = try parseBindingIdentifier(p) orelse {
                        try p.reportExpected(p.current_token.span, "Expected an identifier after ':' in TSRX lazy object pattern", .{});
                        return null;
                    };
                } else {
                    value = try p.tree.addNode(.{ .binding_identifier = .{ .name = name } }, key_token.span);
                }
                if (p.current_token.tag == .assign) {
                    try p.advance() orelse return null;
                    const right = try parseSimpleExpression(p) orelse {
                        try p.reportExpected(p.current_token.span, "Expected a default value after '=' in TSRX lazy object pattern", .{});
                        return null;
                    };
                    value = try p.tree.addNode(.{ .assignment_pattern = .{ .left = value, .right = right } }, .{
                        .start = p.tree.span(value).start,
                        .end = p.tree.span(right).end,
                    });
                }
                const property = try p.tree.addNode(.{ .binding_property = .{
                    .key = key,
                    .value = value,
                    .shorthand = shorthand,
                    .computed = false,
                } }, .{ .start = key_token.span.start, .end = p.tree.span(value).end });
                try properties.append(p.allocator(), property);
                if (p.current_token.tag != .comma) break;
                try p.advance() orelse return null;
            }
            const end = p.current_token.span.end;
            if (!try p.expect(.right_brace, "Expected '}' to close object pattern", null)) return null;
            const range = try addExtra(p, properties.items);
            return @as(?NodeIndex, try p.tree.addNode(.{ .object_pattern = .{
                .properties = range,
                .rest = .null,
            } }, .{ .start = start, .end = end }));
        }

        fn parseArrayPattern(p: *P) ErrorType!?NodeIndex {
            const start = p.current_token.span.start;
            try p.advance() orelse return null;
            var elements: std.ArrayList(NodeIndex) = .empty;
            defer elements.deinit(p.allocator());
            var rest = NodeIndex.null;
            while (p.current_token.tag != .right_bracket and p.current_token.tag != .eof) {
                if (p.current_token.tag == .comma) {
                    try elements.append(p.allocator(), .null);
                    try p.advance() orelse return null;
                    continue;
                }
                if (p.current_token.tag == .spread) {
                    const rest_start = p.current_token.span.start;
                    try p.advance() orelse return null;
                    const argument = try parseBindingIdentifier(p) orelse {
                        try p.reportExpected(p.current_token.span, "Expected an identifier after '...' in TSRX lazy array pattern", .{});
                        return null;
                    };
                    rest = try p.tree.addNode(.{ .binding_rest_element = .{ .argument = argument } }, .{
                        .start = rest_start,
                        .end = p.tree.span(argument).end,
                    });
                    break;
                }
                try elements.append(p.allocator(), try parseBindingIdentifier(p) orelse {
                    try p.reportExpected(p.current_token.span, "Expected an identifier in TSRX lazy array pattern", .{});
                    return null;
                });
                if (p.current_token.tag != .comma) break;
                try p.advance() orelse return null;
            }
            const end = p.current_token.span.end;
            if (!try p.expect(.right_bracket, "Expected ']' to close array pattern", null)) return null;
            const range = try addExtra(p, elements.items);
            return @as(?NodeIndex, try p.tree.addNode(.{ .array_pattern = .{
                .elements = range,
                .rest = rest,
            } }, .{ .start = start, .end = end }));
        }

        fn parsePrimary(p: *P) ErrorType!?NodeIndex {
            const token = p.current_token;
            if (token.tag.isIdentifierLike()) {
                const name = try p.identifierName(token);
                try p.advance() orelse return null;
                return @as(?NodeIndex, try p.tree.addNode(.{ .identifier_reference = .{ .name = name } }, token.span));
            }
            if (token.tag == .string_literal) {
                const value = try p.stringValue(token);
                try p.advance() orelse return null;
                return @as(?NodeIndex, try p.tree.addNode(.{ .string_literal = .{ .value = value } }, token.span));
            }
            if (token.tag.isNumericLiteral()) {
                try p.advance() orelse return null;
                return @as(?NodeIndex, try p.tree.addNode(.{ .numeric_literal = .{
                    .kind = .decimal,
                    .raw = p.tree.sourceSlice(token.span.start, token.span.end),
                } }, token.span));
            }
            return null;
        }
    };
}

fn decisionNode(comptime Result: type, decision: anytype) Result {
    return switch (decision) {
        .unhandled => null,
        .handled => |value| @as(?@TypeOf(value), value),
    };
}

fn hookNode(comptime Result: type, parser: anytype, comptime function: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    return decisionNode(Result, try function(H, parser));
}

pub fn statement_at_code_block(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, code_block.statement);
}
pub fn statement_at_control_flow(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, control_flow.statement);
}
pub fn expression_at_code_block(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, code_block.expression);
}
pub fn expression_at_control_flow(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, control_flow.expression);
}
pub fn lazy_assignment_pattern(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, patterns.lazyAssignment);
}
pub fn function_body(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, code_block.functionBody);
}
pub fn for_of_tail(comptime Result: type, parser: anytype, context: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    return decisionNode(Result, try control_flow.forOfTail(H, parser, .{
        .start = context.start,
        .left = context.left,
        .right = context.right,
        .is_for_await = context.is_for_await,
    }));
}
pub fn binding_pattern(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, patterns.binding);
}
pub fn module_specifier(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, modules.specifier);
}
pub fn jsx_child_at_code_block(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, code_block.jsxChild);
}
pub fn jsx_child_at_control_flow(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, control_flow.jsxChild);
}
pub fn jsx_element_name(comptime Result: type, parser: anytype) Result {
    return hookNode(Result, parser, jsx.elementName);
}

pub fn function_body_starts(parser: anytype) ?bool {
    const H = Host(@TypeOf(parser.*));
    return switch (code_block.functionBodyStarts(H, parser)) {
        .unhandled => null,
        .handled => |value| value,
    };
}
pub fn can_start_binding(tag: anytype) ?bool {
    const DummyHost = struct {
        pub const Token = @TypeOf(tag);
    };
    return switch (patterns.canStartBinding(DummyHost, tag)) {
        .unhandled => null,
        .handled => |value| value,
    };
}
pub fn jsx_element_after_open(comptime Result: type, parser: anytype, opening: anytype, comptime context: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    const styled = try style.afterOpen(H, parser, opening, context);
    switch (styled) {
        .handled => return decisionNode(Result, styled),
        .unhandled => {},
    }
    const node = try parseExtendedJsxElement(H, parser, opening, context) orelse return null;
    return decisionNode(Result, abi.Decision(?H.NodeIndex){ .handled = node });
}
pub fn jsx_fragment_after_open(comptime Result: type, parser: anytype, opening: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    const node = try parseExtendedJsxFragment(H, parser, opening) orelse return null;
    return decisionNode(Result, abi.Decision(?H.NodeIndex){ .handled = node });
}
pub fn validate_jsx_element_name(comptime Result: type, parser: anytype, name: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    _ = try jsx.validateElementName(H, parser, name);
}
pub fn jsx_names_match(parser: anytype, a: anytype, b: anytype) ?bool {
    const H = Host(@TypeOf(parser.*));
    return switch (jsx.namesMatch(H, parser, a, b)) {
        .unhandled => null,
        .handled => |value| value,
    };
}
pub fn jsx_text_boundary(source: anytype, cursor: u32) ?bool {
    const Dummy = struct {};
    return switch (text.boundary(Dummy, source, cursor)) {
        .unhandled => null,
        .handled => |value| value,
    };
}
pub fn jsx_text_value(comptime Result: type, parser: anytype, span: anytype) Result {
    const H = Host(@TypeOf(parser.*));
    return switch (try text.value(H, parser, span)) {
        .unhandled => null,
        .handled => |value| value,
    };
}

pub const schema_module = schema;

/// Bound on nested JSX the raw scanners walk before giving up, so a
/// pathological source cannot recurse the scan off the stack.
const max_jsx_scan_depth = 64;

fn isJsxSpace(byte: u8) bool {
    return byte == ' ' or byte == '\t' or byte == '\r' or byte == '\n';
}

fn skipBracedRegion(source: []const u8, start: u32) ?u32 {
    return skipDelimited(source, start, '{', '}');
}

fn skipParenRegion(source: []const u8, start: u32) ?u32 {
    return skipDelimited(source, start, '(', ')');
}

/// Offset of the delimiter that closes the region starting at `start`, which
/// must be `open`. Strings, template literals and comments inside it are
/// skipped so their delimiters do not count.
fn skipDelimited(source: []const u8, start: u32, comptime open: u8, comptime close: u8) ?u32 {
    if (start >= source.len or source[start] != open) return null;
    var cursor: usize = start;
    var depth: u32 = 0;
    var quote: u8 = 0;
    var escaped = false;
    while (cursor < source.len) : (cursor += 1) {
        const byte = source[cursor];
        if (quote != 0) {
            if (escaped) {
                escaped = false;
            } else if (byte == '\\') {
                escaped = true;
            } else if (byte == quote) {
                quote = 0;
            }
            continue;
        }
        switch (byte) {
            '\'', '"', '`' => quote = byte,
            '/' => {
                const next = if (cursor + 1 < source.len) source[cursor + 1] else 0;
                if (next == '/') {
                    while (cursor < source.len and source[cursor] != '\n') cursor += 1;
                    if (cursor == source.len) return null;
                } else if (next == '*') {
                    cursor += 2;
                    while (cursor + 1 < source.len and
                        !(source[cursor] == '*' and source[cursor + 1] == '/')) cursor += 1;
                    if (cursor + 1 >= source.len) return null;
                    cursor += 1;
                }
            },
            open => depth += 1,
            close => {
                if (depth == 0) return null;
                depth -= 1;
                if (depth == 0) return @intCast(cursor);
            },
            else => {},
        }
    }
    return null;
}

/// Closing tag of the one raw-text element the dialect owns. `style.afterOpen`
/// finds the body's end with this exact byte sequence, so the raw scanners must
/// use it too: a scan that ended anywhere else would disagree with the node the
/// host hook builds, and the exact-span check would decline the whole element.
const raw_text_close = "</style>";

const TagScan = struct {
    end: u32,
    closing: bool,
    self_closing: bool,
    /// this opening tag's children are raw text - CSS - rather than JSX, so
    /// `{`, `<` and `@` inside them are not the syntax the scanners model
    raw_text: bool,
};

/// True for a tag name whose element body is raw text rather than JSX children.
fn isRawTextTagName(name: []const u8) bool {
    return std.mem.eql(u8, name, "style");
}

fn isJsxTagNameByte(byte: u8) bool {
    return std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or
        byte == '.' or byte == ':' or byte == '$';
}

/// True when `byte` - the one directly after a `<` in child position - can begin
/// a tag: a name start, `/` for a closing tag, `>` for a fragment, `{` for a
/// TSRX dynamic tag name, or whitespace, which the tag lexer skips before the
/// name. A byte >= 0x80 starts a non-ASCII identifier and counts as a name.
fn canOpenJsxTag(byte: u8) bool {
    return std.ascii.isAlphabetic(byte) or byte == '_' or byte == '$' or byte >= 0x80 or
        byte == '/' or byte == '>' or byte == '{' or isJsxSpace(byte);
}

/// True when the byte at `at` is a `<` that cannot open a tag, so TSRX - like
/// HTML, and like @tsrx/core - reads it as literal text: `<3`, `<= arrow`.
fn literalLessThan(source: []const u8, at: u32) bool {
    if (at >= source.len or source[at] != '<') return false;
    const next: u8 = if (@as(usize, at) + 1 < source.len) source[@as(usize, at) + 1] else 0;
    return !canOpenJsxTag(next);
}

/// Offset just past the `</style>` that closes a raw-text element whose opening
/// tag ended at `from`.
fn rawTextElementEnd(source: []const u8, from: u32) ?u32 {
    const index = std.mem.indexOfPos(u8, source, from, raw_text_close) orelse return null;
    return @intCast(index + raw_text_close.len);
}

/// Scan the single JSX tag - opening, closing, self-closing or fragment - that
/// starts at the `<` at `start`, up to and including its `>`.
fn scanJsxTag(source: []const u8, start: u32) ?TagScan {
    if (start >= source.len or source[start] != '<') return null;
    var cursor: usize = start + 1;
    while (cursor < source.len and isJsxSpace(source[cursor])) cursor += 1;
    var closing = false;
    if (cursor < source.len and source[cursor] == '/') {
        closing = true;
        cursor += 1;
    }
    const name_start = cursor;
    var name_end = cursor;
    while (name_end < source.len and isJsxTagNameByte(source[name_end])) name_end += 1;
    const raw_text = !closing and isRawTextTagName(source[name_start..name_end]);
    var quote: u8 = 0;
    var escaped = false;
    while (cursor < source.len) : (cursor += 1) {
        const byte = source[cursor];
        if (quote != 0) {
            if (escaped) {
                escaped = false;
            } else if (byte == '\\') {
                escaped = true;
            } else if (byte == quote) {
                quote = 0;
            }
            continue;
        }
        switch (byte) {
            '\'', '"' => quote = byte,
            '{' => cursor = skipBracedRegion(source, @intCast(cursor)) orelse return null,
            // a second '<' before this tag closed is not JSX the scan models,
            // such as a type argument list; decline rather than guess
            '<' => return null,
            '>' => {
                var back = cursor;
                while (back > start + 1 and isJsxSpace(source[back - 1])) back -= 1;
                const slash = back > start + 1 and source[back - 1] == '/';
                const self_closing = slash and !closing;
                return .{
                    .end = @intCast(cursor + 1),
                    .closing = closing,
                    .self_closing = self_closing,
                    .raw_text = raw_text and !self_closing,
                };
            },
            else => {},
        }
    }
    return null;
}

const ChildrenScan = struct {
    /// offset of the `<` that opens the enclosing element's closing tag
    close: u32,
    /// a `@` appeared in child position of this very region, rather than
    /// inside one of its child elements
    directive: bool,
    /// a `<` that cannot open a tag appeared in child position of this very
    /// region; the host children loop would reject it, so the dialect owns
    /// the element and reads that `<` as text
    literal_lt: bool,
};

/// Walk a JSX children region from `from` to the closing tag of the element
/// that encloses it, reporting whether that region holds a TSRX directive or a
/// literal `<` of its own.
fn scanJsxChildren(source: []const u8, from: u32, depth: u32) ?ChildrenScan {
    if (depth > max_jsx_scan_depth) return null;
    var cursor: usize = from;
    var directive = false;
    var literal_lt = false;
    while (cursor < source.len) {
        switch (source[cursor]) {
            '<' => {
                if (literalLessThan(source, @intCast(cursor))) {
                    literal_lt = true;
                    cursor += 1;
                    continue;
                }
                const tag = scanJsxTag(source, @intCast(cursor)) orelse return null;
                if (tag.closing) return .{
                    .close = @intCast(cursor),
                    .directive = directive,
                    .literal_lt = literal_lt,
                };
                if (tag.self_closing) {
                    cursor = tag.end;
                    continue;
                }
                if (tag.raw_text) {
                    cursor = rawTextElementEnd(source, tag.end) orelse return null;
                    continue;
                }
                const inner = scanJsxChildren(source, tag.end, depth + 1) orelse return null;
                const inner_close = scanJsxTag(source, inner.close) orelse return null;
                cursor = inner_close.end;
            },
            '{' => cursor = @as(usize, skipBracedRegion(source, @intCast(cursor)) orelse return null) + 1,
            '@' => {
                directive = true;
                cursor = skipDirectiveHeader(source, @intCast(cursor));
            },
            else => cursor += 1,
        }
    }
    return null;
}

/// Step past `@name (...)` so a header's own `<`, `{` or `>` - as in
/// `@for (let i = 0; i < total; i++)` - is never mistaken for child syntax.
/// The braced body that follows is left to the caller's `{` handling.
fn skipDirectiveHeader(source: []const u8, at: u32) usize {
    var cursor: usize = @as(usize, at) + 1;
    while (cursor < source.len and std.ascii.isAlphabetic(source[cursor])) cursor += 1;
    var header = cursor;
    while (header < source.len and isJsxSpace(source[header])) header += 1;
    if (header < source.len and source[header] == '(') {
        if (skipParenRegion(source, @intCast(header))) |close| return @as(usize, close) + 1;
    }
    return cursor;
}

/// Offset just past the JSX element or fragment that starts at `start`.
fn jsxElementEnd(source: []const u8, start: u32, depth: u32) ?u32 {
    if (depth > max_jsx_scan_depth) return null;
    const tag = scanJsxTag(source, start) orelse return null;
    if (tag.closing) return null;
    if (tag.self_closing) return tag.end;
    if (tag.raw_text) return rawTextElementEnd(source, tag.end);
    const children = scanJsxChildren(source, tag.end, depth + 1) orelse return null;
    const closing = scanJsxTag(source, children.close) orelse return null;
    if (!closing.closing) return null;
    return closing.end;
}

/// True when the `<` at `less_than` opens a closing tag rather than a child.
fn closesJsxElement(source: []const u8, less_than: u32) bool {
    var cursor: usize = @as(usize, less_than) + 1;
    while (cursor < source.len and isJsxSpace(source[cursor])) cursor += 1;
    return cursor < source.len and source[cursor] == '/';
}

/// Parse the children of an element the dialect owns, interleaving TSRX
/// directives with element children the host parser produces.
///
/// Returns true with the parser sitting on the `<` of the enclosing closing
/// tag, or false to decline - the caller rewinds to its entry checkpoint.
fn parseExtendedJsxChildren(
    comptime H: type,
    parser: anytype,
    children: *std.ArrayList(H.NodeIndex),
    from: u32,
) H.ErrorType!bool {
    var scan_from = from;
    while (true) {
        H.setLexerMode(parser, .normal);
        const text_start = scan_from;
        var text_token = H.reScanJsxText(parser, scan_from);
        // The host lexer ends a text run at every `<`. TSRX only ends it at a
        // `<` that can open a tag, so one that cannot - `<3`, `<= arrow` - is
        // stepped over and the surrounding run stays a single text child.
        while (literalLessThan(H.source(parser), text_token.span.end)) {
            text_token = H.reScanJsxText(parser, text_token.span.end + 1);
        }
        const text_span: H.Span = .{ .start = text_start, .end = text_token.span.end };
        if (text_span.end > text_span.start) {
            var value = H.sourceSlice(parser, text_span.start, text_span.end);
            switch (try text.value(H, parser, text_span)) {
                .handled => |decoded| value = decoded,
                .unhandled => {},
            }
            const text_node = try H.addNode(parser, H.NodeData{ .jsx_text = .{ .value = value } }, text_span);
            try children.append(H.allocator(parser), text_node);
        }
        if (!try H.advanceWithRescannedToken(parser, text_token)) return false;

        const child = switch (H.currentToken(parser)) {
            .less_than => blk: {
                if (closesJsxElement(H.source(parser), H.currentSpan(parser).start)) return true;
                break :blk try H.parseJsxChildElement(parser) orelse return false;
            },
            .left_brace => try H.parseJsxChildExpressionContainer(parser) orelse return false,
            .at => switch (try code_block.jsxChild(H, parser)) {
                .handled => |node| node orelse return false,
                .unhandled => switch (try control_flow.jsxChild(H, parser)) {
                    .handled => |node| node orelse return false,
                    .unhandled => return false,
                },
            },
            else => return false,
        };
        try children.append(H.allocator(parser), child);
        // every child's span end is the next text scan's cursor, so a child
        // that misreports it truncates each sibling that follows
        scan_from = H.nodeSpan(parser, child).end;
    }
}

fn ClosingElementName(comptime H: type) type {
    return struct { node: H.NodeIndex, span: H.Span };
}

/// Parse a closing tag's name - `a`, or the `a.b.c` member chain an opening tag
/// accepts - leaving the parser on the token that follows it. The member shape
/// mirrors the host's own element-name parse so an owned element's closing name
/// is the node the host would have built.
fn parseClosingElementName(comptime H: type, parser: anytype) H.ErrorType!?ClosingElementName(H) {
    if (H.currentToken(parser) != .jsx_identifier) return null;
    const head_span = H.currentSpan(parser);
    var node = try H.addNode(parser, H.NodeData{ .jsx_identifier = .{
        .name = H.sourceSlice(parser, head_span.start, head_span.end),
    } }, head_span);
    var span = head_span;
    if (!try H.advance(parser)) return null;
    while (H.currentToken(parser) == .dot) {
        if (!try H.advance(parser)) return null;
        if (H.currentToken(parser) != .jsx_identifier) return null;
        const property_span = H.currentSpan(parser);
        const property = try H.addNode(parser, H.NodeData{ .jsx_identifier = .{
            .name = H.sourceSlice(parser, property_span.start, property_span.end),
        } }, property_span);
        span = .{ .start = head_span.start, .end = property_span.end };
        node = try H.addNode(parser, H.NodeData{ .jsx_member_expression = .{
            .object = node,
            .property = property,
        } }, span);
        if (!try H.advance(parser)) return null;
    }
    return .{ .node = node, .span = span };
}

fn parseExtendedJsxElement(comptime H: type, parser: anytype, opening: H.NodeIndex, comptime context: anytype) H.ErrorType!?H.NodeIndex {
    const opening_data = switch (H.data(parser, opening)) {
        .jsx_opening_element => |value| value,
        else => return null,
    };
    if (opening_data.self_closing) return null;
    if (try parseLooseAncestorClose(H, parser, opening, opening_data.name)) |node| return node;
    const opening_span = H.nodeSpan(parser, opening);
    const name_span = H.nodeSpan(parser, opening_data.name);
    const name = H.sourceText(parser, name_span);
    const source = H.source(parser);
    // Own this element only when a directive - or a `<` the host would reject
    // and TSRX keeps as text - sits directly among its own children: one nested
    // inside a child element belongs to that child, which re-enters this hook
    // when the host parses it.
    const region = scanJsxChildren(source, opening_span.end, 0) orelse return null;
    if (!region.directive and !region.literal_lt) return null;

    // Declining halfway through leaves the host holding a parser that has
    // already consumed children, so every failure below rewinds to entry.
    const entry_parser = parser.checkpoint();
    const entry_store = container(parser).store.checkpoint();
    var owned = false;
    defer if (!owned) {
        parser.rewind(entry_parser);
        container(parser).store.rewind(entry_store);
    };

    var children: std.ArrayList(H.NodeIndex) = .empty;
    defer children.deinit(H.allocator(parser));
    if (!try parseExtendedJsxChildren(H, parser, &children, opening_span.end)) return null;

    const closing_start = H.currentSpan(parser).start;
    H.setLexerMode(parser, .jsx_tag);
    if (!try H.advance(parser)) return null;
    if (!try H.expect(parser, .slash, "Expected '/' in JSX closing element")) return null;
    const closing_element_name = try parseClosingElementName(H, parser) orelse return null;
    const closing_name = closing_element_name.node;
    const closing_name_span = closing_element_name.span;
    if (!std.mem.eql(u8, std.mem.trim(u8, name, " \t\r\n"), std.mem.trim(u8, H.sourceText(parser, closing_name_span), " \t\r\n"))) return null;
    const closing_end = H.currentSpan(parser).end;
    if (H.currentToken(parser) != .greater_than) {
        try H.report(parser, H.currentSpan(parser), "Expected '>' to close JSX closing element");
        return null;
    }
    if (comptime std.mem.eql(u8, @tagName(context), "child")) {
        H.setLexerMode(parser, .normal);
    } else if (comptime std.mem.eql(u8, @tagName(context), "attribute")) {
        H.setLexerMode(parser, .jsx_tag);
        if (!try H.advance(parser)) return null;
    } else {
        H.setLexerMode(parser, .normal);
        if (!try H.advance(parser)) return null;
    }
    const closing = try H.addNode(parser, H.NodeData{ .jsx_closing_element = .{ .name = closing_name } }, .{
        .start = closing_start,
        .end = closing_end,
    });
    const child_range = try H.addExtra(parser, children.items);
    owned = true;
    return @as(?H.NodeIndex, try H.addNode(parser, H.NodeData{ .jsx_element = .{
        .opening_element = opening,
        .children = child_range,
        .closing_element = closing,
    } }, .{ .start = opening_span.start, .end = closing_end }));
}

/// collects jsx text and `@` directive children from `from` up to the `<` that opens
/// the closing tag, which the caller parses; false declines the whole host node.
fn parseExtendedJsxFragment(comptime H: type, parser: anytype, opening: H.NodeIndex) H.ErrorType!?H.NodeIndex {
    switch (H.data(parser, opening)) {
        .jsx_opening_fragment => {},
        else => return null,
    }
    const opening_span = H.nodeSpan(parser, opening);
    const source = H.source(parser);
    const region = scanJsxChildren(source, opening_span.end, 0) orelse return null;
    if (!region.directive and !region.literal_lt) return null;

    const entry_parser = parser.checkpoint();
    const entry_store = container(parser).store.checkpoint();
    var owned = false;
    defer if (!owned) {
        parser.rewind(entry_parser);
        container(parser).store.rewind(entry_store);
    };

    var children: std.ArrayList(H.NodeIndex) = .empty;
    defer children.deinit(H.allocator(parser));
    if (!try parseExtendedJsxChildren(H, parser, &children, opening_span.end)) return null;

    const closing_start = H.currentSpan(parser).start;
    H.setLexerMode(parser, .jsx_tag);
    if (!try H.advance(parser)) return null;
    if (!try H.expect(parser, .slash, "Expected '/' in JSX closing fragment")) return null;
    const closing_end = H.currentSpan(parser).end;
    // leave jsx_tag before consuming '>' so the token after the fragment is plain javascript
    H.setLexerMode(parser, .normal);
    if (!try H.expect(parser, .greater_than, "Expected '>' to close JSX closing fragment")) return null;

    const closing = try H.addNode(parser, H.NodeData{ .jsx_closing_fragment = .{} }, .{
        .start = closing_start,
        .end = closing_end,
    });
    const child_range = try H.addExtra(parser, children.items);
    owned = true;
    return @as(?H.NodeIndex, try H.addNode(parser, H.NodeData{ .jsx_fragment = .{
        .opening_fragment = opening,
        .children = child_range,
        .closing_fragment = closing,
    } }, .{ .start = opening_span.start, .end = closing_end }));
}

pub fn parseLooseAncestorClose(
    comptime H: type,
    parser: anytype,
    opening: H.NodeIndex,
    opening_name: H.NodeIndex,
) H.ErrorType!?H.NodeIndex {
    if (!container(parser).options.loose) return null;

    const opening_span = H.nodeSpan(parser, opening);
    const source = H.source(parser);
    const closing_start: u32 = @intCast(
        std.mem.indexOfPos(u8, source, opening_span.end, "</") orelse return null,
    );
    if (std.mem.indexOfScalarPos(u8, source, opening_span.end, '<')) |nested_start| {
        if (nested_start < closing_start) return null;
    }

    const entry_parser = parser.checkpoint();
    const entry_store = container(parser).store.checkpoint();
    var recovered = false;
    defer if (!recovered) {
        parser.rewind(entry_parser);
        container(parser).store.rewind(entry_store);
    };

    var children: std.ArrayList(H.NodeIndex) = .empty;
    defer children.deinit(H.allocator(parser));
    H.setLexerMode(parser, .normal);
    const text_token = H.reScanJsxText(parser, opening_span.end);
    if (text_token.span.end != closing_start) return null;
    if (text_token.len() > 0) {
        var value = H.sourceSlice(parser, text_token.span.start, text_token.span.end);
        switch (try text.value(H, parser, text_token.span)) {
            .handled => |decoded| value = decoded,
            .unhandled => {},
        }
        const text_node = try H.addNode(parser, H.NodeData{ .jsx_text = .{ .value = value } }, text_token.span);
        try children.append(H.allocator(parser), text_node);
    }
    if (!try H.advanceWithRescannedToken(parser, text_token)) return null;
    if (H.currentToken(parser) != .less_than) return null;

    const child_parser = parser.checkpoint();
    const child_store = container(parser).store.checkpoint();
    H.setLexerMode(parser, .jsx_tag);
    if (!try H.advance(parser)) return null;
    if (!try H.expect(parser, .slash, "Expected '/' in JSX closing element")) return null;
    if (H.currentToken(parser) != .jsx_identifier) return null;
    const closing_name_span = H.currentSpan(parser);
    const closing_name = try H.addNode(parser, H.NodeData{ .jsx_identifier = .{
        .name = H.sourceSlice(parser, closing_name_span.start, closing_name_span.end),
    } }, closing_name_span);
    if (!try H.advance(parser)) return null;
    if (H.currentToken(parser) != .greater_than) return null;
    const closing_end = H.currentSpan(parser).end;
    _ = try H.addNode(parser, H.NodeData{ .jsx_closing_element = .{ .name = closing_name } }, .{
        .start = closing_start,
        .end = closing_end,
    });

    const names_match = std.mem.eql(
        u8,
        std.mem.trim(u8, H.sourceText(parser, H.nodeSpan(parser, opening_name)), " \t\r\n"),
        std.mem.trim(u8, H.sourceText(parser, closing_name_span), " \t\r\n"),
    );
    const is_ancestor = hasUnclosedAncestorName(H, parser, opening, closing_name_span);
    parser.rewind(child_parser);
    container(parser).store.rewind(child_store);
    if (names_match) return null;
    if (!is_ancestor) return null;

    const child_range = try H.addExtra(parser, children.items);
    const node = try H.addNode(parser, H.NodeData{ .jsx_element = .{
        .opening_element = opening,
        .children = child_range,
        .closing_element = .null,
    } }, .{ .start = opening_span.start, .end = closing_start });
    recovered = true;
    return node;
}

fn hasUnclosedAncestorName(
    comptime H: type,
    parser: anytype,
    opening: H.NodeIndex,
    closing_name_span: H.Span,
) bool {
    const closing_name = std.mem.trim(u8, H.sourceText(parser, closing_name_span), " \t\r\n");
    var unmatched: u32 = 0;
    var raw: u32 = 0;
    while (raw < @intFromEnum(opening)) : (raw += 1) {
        const node: H.NodeIndex = @enumFromInt(raw);
        const name = switch (H.data(parser, node)) {
            .jsx_opening_element => |value| value.name,
            .jsx_closing_element => |value| value.name,
            else => continue,
        };
        const candidate = std.mem.trim(u8, H.sourceText(parser, H.nodeSpan(parser, name)), " \t\r\n");
        if (!std.mem.eql(u8, candidate, closing_name)) continue;
        switch (H.data(parser, node)) {
            .jsx_opening_element => unmatched += 1,
            .jsx_closing_element => {
                if (unmatched > 0) unmatched -= 1;
            },
            else => unreachable,
        }
    }
    return unmatched > 0;
}
