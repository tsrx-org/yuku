const std = @import("std");
const util = @import("util");
const parser = @import("root.zig");
const ast = parser.ast;
const sourcemap = struct {
    const SMAllocator = std.mem.Allocator;

    /// Source Map V3 output.
    pub const SMSourceMap = struct {
        version: u8 = 3,
        file: ?[]const u8 = null,
        source_root: ?[]const u8 = null,
        sources: []const []const u8,
        sources_content: ?[]const ?[]const u8 = null,
        names: []const []const u8 = &.{},
        mappings: []const u8,

        pub fn deinit(self: @This(), allocator: SMAllocator) void {
            allocator.free(self.sources);
            if (self.sources_content) |sc| allocator.free(sc);
            allocator.free(self.mappings);
        }
    };

    /// Configures source map generation.
    pub const SMOptions = struct {
        /// The original source text. Required to emit a map.
        source: ?[]const u8 = null,
        /// Output filename, embedded as the map's `file`.
        file: ?[]const u8 = null,
        /// Source filename, embedded as the single entry of `sources`.
        source_file_name: ?[]const u8 = null,
        /// Prefix embedded as `sourceRoot`.
        source_root: ?[]const u8 = null,
        /// When set, embedded as the single entry of `sourcesContent`.
        sources_content: ?[]const u8 = null,
    };

    /// A zero-based source position, with `col` counted in UTF-16 code units.
    pub const LineCol = struct { line: u32, col: u32 };

    /// A single mapping from a generated position to its original position.
    pub const Segment = struct {
        gen_line: u32,
        gen_col: u32,
        orig_line: u32,
        orig_col: u32,
    };

    /// Source map generation state for one codegen run.
    pub const State = struct {
        options: SMOptions,
        source: []const u8,
        cursor: SourceCursor = .{},
        // vlq mappings string, encoded as segments are recorded
        out: std.ArrayList(u8) = .empty,
        gen_line: u32 = 0,
        gen_col: u32 = 0,

        // most recent segment, held until one at a different generated position
        // arrives so a deeper node can overwrite it in place
        pending: Segment = undefined,
        has_pending: bool = false,

        // vlq deltas of the last segment flushed to out
        prev_gen_col: i32 = 0,
        prev_orig_line: i32 = 0,
        prev_orig_col: i32 = 0,
        enc_gen_line: i32 = 0,
        first_in_line: bool = true,

        /// State needed to undo a speculative emit.
        pub const Snapshot = struct {
            out_len: u32,
            gen_line: u32,
            gen_col: u32,
            pending: Segment,
            has_pending: bool,
            prev_gen_col: i32,
            prev_orig_line: i32,
            prev_orig_col: i32,
            enc_gen_line: i32,
            first_in_line: bool,
        };

        pub fn init(options: SMOptions) State {
            return .{ .options = options, .source = options.source orelse "" };
        }

        pub fn deinit(self: *State, allocator: SMAllocator) void {
            self.out.deinit(allocator);
        }

        /// Resolves a source offset to a zero-based `(line, col)` pair.
        pub fn resolve(self: *State, offset: u32) LineCol {
            return self.cursor.resolve(self.source, offset);
        }

        /// Advances the generated position over `bytes` just written, counting
        /// columns in UTF-16 code units.
        pub fn advance(self: *State, bytes: []const u8) void {
            if (isPlainAscii(bytes)) {
                self.gen_col += @intCast(bytes.len);
                return;
            }

            var i: usize = 0;
            var col_inc: u32 = 0;
            var saw_break = false;
            while (i < bytes.len) {
                const brk = util.Utf.lineBreakLen(bytes, i);
                if (brk > 0) {
                    self.gen_line += 1;
                    col_inc = 0;
                    saw_break = true;
                    i += brk;
                } else {
                    const n = std.unicode.utf8ByteSequenceLength(bytes[i]) catch 1;
                    col_inc += utf16Width(n);
                    i += n;
                }
            }
            self.gen_col = if (saw_break) col_inc else self.gen_col + col_inc;
        }

        inline fn isPlainAscii(bytes: []const u8) bool {
            const N = 16;
            const Vec = @Vector(N, u8);
            const hi: Vec = @splat(0x80);
            const lf: Vec = @splat('\n');
            const cr: Vec = @splat('\r');
            var i: usize = 0;
            while (i + N <= bytes.len) : (i += N) {
                const chunk: Vec = bytes[i..][0..N].*;
                if (@reduce(.Or, chunk >= hi) or
                    @reduce(.Or, chunk == lf) or
                    @reduce(.Or, chunk == cr)) return false;
            }
            while (i < bytes.len) : (i += 1) {
                if (bytes[i] >= 0x80 or bytes[i] == '\n' or bytes[i] == '\r') return false;
            }
            return true;
        }

        /// Records a mapping at the current generated position. A later record at
        /// the same generated position replaces this one.
        pub fn record(self: *State, allocator: SMAllocator, orig_line: u32, orig_col: u32) SMAllocator.Error!void {
            if (self.has_pending and
                self.pending.gen_line == self.gen_line and
                self.pending.gen_col == self.gen_col)
            {
                self.pending.orig_line = orig_line;
                self.pending.orig_col = orig_col;
                return;
            }
            if (self.has_pending) try self.flush(allocator);
            self.pending = .{
                .gen_line = self.gen_line,
                .gen_col = self.gen_col,
                .orig_line = orig_line,
                .orig_col = orig_col,
            };
            self.has_pending = true;
        }

        // encodes the pending segment into out and folds it into the running deltas
        fn flush(self: *State, allocator: SMAllocator) SMAllocator.Error!void {
            const seg = self.pending;
            const gen_line: i32 = @intCast(seg.gen_line);
            const line_gap: usize = @intCast(gen_line - self.enc_gen_line);

            const needed = line_gap + 2 + 3 * 7;
            if (self.out.capacity - self.out.items.len < needed) {
                try self.out.ensureTotalCapacity(allocator, self.out.items.len + needed);
            }
            var dst: [*]u8 = self.out.items.ptr + self.out.items.len;
            const base = dst;

            if (gen_line > self.enc_gen_line) {
                var gap = line_gap;
                while (gap > 0) : (gap -= 1) {
                    dst[0] = ';';
                    dst += 1;
                }
                self.enc_gen_line = gen_line;
                self.prev_gen_col = 0;
                self.first_in_line = true;
            }
            if (!self.first_in_line) {
                dst[0] = ',';
                dst += 1;
            }
            self.first_in_line = false;

            const gen_col: i32 = @intCast(seg.gen_col);
            dst = writeVlq(dst, gen_col - self.prev_gen_col);
            self.prev_gen_col = gen_col;
            // single source, so the source index delta is always zero
            dst[0] = 'A';
            dst += 1;
            const orig_line: i32 = @intCast(seg.orig_line);
            dst = writeVlq(dst, orig_line - self.prev_orig_line);
            self.prev_orig_line = orig_line;
            const orig_col: i32 = @intCast(seg.orig_col);
            dst = writeVlq(dst, orig_col - self.prev_orig_col);
            self.prev_orig_col = orig_col;

            self.out.items.len += @intFromPtr(dst) - @intFromPtr(base);
        }

        /// Returns the most recently recorded segment, or null if none.
        pub fn lastMapping(self: *const State) ?Segment {
            return if (self.has_pending) self.pending else null;
        }

        pub fn snapshot(self: *const State) Snapshot {
            return .{
                .out_len = @intCast(self.out.items.len),
                .gen_line = self.gen_line,
                .gen_col = self.gen_col,
                .pending = self.pending,
                .has_pending = self.has_pending,
                .prev_gen_col = self.prev_gen_col,
                .prev_orig_line = self.prev_orig_line,
                .prev_orig_col = self.prev_orig_col,
                .enc_gen_line = self.enc_gen_line,
                .first_in_line = self.first_in_line,
            };
        }

        pub fn restore(self: *State, s: Snapshot) void {
            std.debug.assert(s.out_len <= self.out.items.len);
            self.out.shrinkRetainingCapacity(s.out_len);
            self.gen_line = s.gen_line;
            self.gen_col = s.gen_col;
            self.pending = s.pending;
            self.has_pending = s.has_pending;
            self.prev_gen_col = s.prev_gen_col;
            self.prev_orig_line = s.prev_orig_line;
            self.prev_orig_col = s.prev_orig_col;
            self.enc_gen_line = s.enc_gen_line;
            self.first_in_line = s.first_in_line;
        }

        /// Finalizes the map. Output buffers are owned by `allocator` and freed by
        /// `SourceMap.deinit`.
        pub fn build(self: *State, allocator: SMAllocator) SMAllocator.Error!SMSourceMap {
            if (self.has_pending) {
                try self.flush(allocator);
                self.has_pending = false;
            }
            const mappings = try self.out.toOwnedSlice(allocator);
            errdefer allocator.free(mappings);

            const sources = try allocator.alloc([]const u8, 1);
            errdefer allocator.free(sources);
            sources[0] = self.options.source_file_name orelse "";

            var sources_content: ?[]const ?[]const u8 = null;
            if (self.options.sources_content) |content| {
                const sc = try allocator.alloc(?[]const u8, 1);
                sc[0] = content;
                sources_content = sc;
            }

            return .{
                .file = self.options.file,
                .source_root = self.options.source_root,
                .sources = sources,
                .sources_content = sources_content,
                .mappings = mappings,
            };
        }
    };

    /// Maps a UTF-16 offset into a UTF-8 source to a zero-based `(line, col)`,
    /// columns in UTF-16 code units. Scans incrementally from the last position.
    pub const SourceCursor = struct {
        byte: u32 = 0,
        utf16: u32 = 0,
        line: u32 = 0,
        line_start_utf16: u32 = 0,

        pub fn resolve(
            self: *SourceCursor,
            source: []const u8,
            target_utf16: u32,
        ) LineCol {
            if (target_utf16 >= self.utf16) {
                while (self.utf16 < target_utf16 and self.byte < source.len) {
                    const brk = util.Utf.lineBreakLen(source, self.byte);
                    if (brk > 0) {
                        self.line += 1;
                        self.byte += brk;
                        self.utf16 += if (brk == 2) @as(u32, 2) else 1;
                        self.line_start_utf16 = self.utf16;
                    } else {
                        const len = std.unicode.utf8ByteSequenceLength(source[self.byte]) catch 1;
                        self.byte += len;
                        self.utf16 += utf16Width(len);
                    }
                }
            } else {
                while (self.utf16 > target_utf16) {
                    self.byte -= 1;
                    while (self.byte > 0 and isContinuation(source[self.byte])) self.byte -= 1;
                    const lead = source[self.byte];
                    self.utf16 -= utf16Width(std.unicode.utf8ByteSequenceLength(lead) catch 1);
                    // count a crlf once: its lf belongs to the preceding cr
                    const is_break = if (lead == '\n')
                        self.byte == 0 or source[self.byte - 1] != '\r'
                    else
                        util.Utf.lineBreakLen(source, self.byte) > 0;
                    if (is_break) self.line -= 1;
                }
                self.line_start_utf16 = self.lineStart(source);
            }
            return .{ .line = self.line, .col = self.utf16 - self.line_start_utf16 };
        }

        fn lineStart(self: *const SourceCursor, source: []const u8) u32 {
            var b = self.byte;
            var units_back: u32 = 0;
            while (b > 0) {
                var p = b - 1;
                while (p > 0 and isContinuation(source[p])) p -= 1;
                if (util.Utf.lineBreakLen(source, p) > 0) break;
                units_back += utf16Width(std.unicode.utf8ByteSequenceLength(source[p]) catch 1);
                b = p;
            }
            return self.utf16 - units_back;
        }
    };

    inline fn isContinuation(byte: u8) bool {
        return (byte & 0xC0) == 0x80;
    }

    // a 4-byte utf-8 code point is a utf-16 surrogate pair, all else one unit
    inline fn utf16Width(utf8_len: u8) u32 {
        return if (utf8_len == 4) 2 else 1;
    }

    const VLQ_CHARS: [64]u8 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".*;

    // writes one signed vlq integer. caller ensures at least 7 bytes of headroom.
    inline fn writeVlq(dst: [*]u8, v: i32) [*]u8 {
        var bits: u32 = if (v < 0) (@as(u32, @intCast(-v)) << 1) | 1 else @as(u32, @intCast(v)) << 1;
        var p = dst;
        while (true) {
            const digit: u8 = @intCast(bits & 0x1F);
            bits >>= 5;
            p[0] = VLQ_CHARS[if (bits != 0) digit | 0x20 else digit];
            p += 1;
            if (bits == 0) return p;
        }
    }
};
const utils = struct {
    /// true when `op` is a word-shaped operator (`in`, `typeof`, ...) that needs a
    /// space to stay separate from its operands.
    pub fn isWordOp(op: []const u8) bool {
        return std.mem.eql(u8, op, "in") or std.mem.eql(u8, op, "instanceof") or
            std.mem.eql(u8, op, "typeof") or std.mem.eql(u8, op, "void") or
            std.mem.eql(u8, op, "delete");
    }

    /// true when `c` can continue an ascii identifier (or is a non-ascii lead byte).
    pub inline fn isIdCont(c: u8) bool {
        return c == '$' or c >= 0x80 or util.UnicodeId.canContinueId(c);
    }

    /// true when `s` is a valid identifier name (so it can be written as a bare key).
    pub fn isIdentifierName(s: []const u8) bool {
        if (s.len == 0) return false;
        var i: usize = 0;
        while (i < s.len) {
            const cp = util.Utf.codePointAt(s, i) catch return false;
            const ok = if (i == 0)
                util.UnicodeId.canStartId(cp.value)
            else
                util.UnicodeId.canContinueId(cp.value);
            if (!ok) return false;
            i += cp.len;
        }
        return true;
    }

    /// escape for the character at `s[i]` when it would otherwise let minified
    /// output break out of an inline `<script>`, or null when none is needed.
    /// neutralizes `</script`, `<!--`, and `-->` by inserting a backslash the value
    /// ignores (`<\/script`, `<\!--`, `--\>`).
    pub fn scriptEscape(s: []const u8, i: usize) ?[]const u8 {
        return switch (s[i]) {
            '<' => if (scriptOpenAt(s, i)) "<\\" else null,
            '>' => if (i >= 2 and s[i - 1] == '-' and s[i - 2] == '-') "\\>" else null,
            else => null,
        };
    }

    fn scriptOpenAt(s: []const u8, i: usize) bool {
        const rest = s[i + 1 ..];
        if (std.mem.startsWith(u8, rest, "!--")) return true; // `<!--`
        if (rest.len < 7 or rest[0] != '/' or !std.ascii.eqlIgnoreCase(rest[1..7], "script"))
            return false;
        // `</script` ends the tag only when whitespace, `/`, `>`, or eof follows
        return rest.len == 7 or std.ascii.isWhitespace(rest[7]) or rest[7] == '/' or rest[7] == '>';
    }

    /// removes numeric separators (`_`), returning `raw` unchanged when it has none
    /// and `null` when the result would not fit in `buf`.
    pub fn stripUnderscores(raw: []const u8, buf: []u8) ?[]const u8 {
        if (std.mem.findScalar(u8, raw, '_') == null) return raw;
        if (raw.len > buf.len) return null;
        var len: usize = 0;
        for (raw) |c| if (c != '_') {
            buf[len] = c;
            len += 1;
        };
        return buf[0..len];
    }

    /// returns the shortest semantically-equivalent spelling of decimal `s`.
    ///
    /// the value is normalized to `d * 10^exp` (d a significand with no leading or
    /// trailing zeros), then rendered as whichever of the fixed-point or
    /// exponential form is shorter. it rewrites the source text only, so every step
    /// is an exact decimal rearrangement with no float round-trip involved.
    /// `scratch` and `s` must not alias.
    pub fn shortestDecimal(s: []const u8, scratch: []u8) []const u8 {
        const exp_at = std.mem.findAny(u8, s, "eE") orelse s.len;
        const mantissa = s[0..exp_at];
        const dot_at = std.mem.findScalar(u8, mantissa, '.') orelse mantissa.len;
        const int_part = mantissa[0..dot_at];
        const frac_part = if (dot_at < mantissa.len) mantissa[dot_at + 1 ..] else "";

        // value == <int_part><frac_part> (an integer) * 10^(exp - frac_len).
        // bound the exponent so the arithmetic and any fixed form stay sane; a
        // number past it is 0 or Infinity, not worth a textual rewrite.
        var exp: i64 = blk: {
            if (exp_at == s.len) break :blk 0;
            const e = std.fmt.parseInt(i64, s[exp_at + 1 ..], 10) catch return s;
            if (e > 100_000 or e < -100_000) return s;
            break :blk e;
        };
        exp -= @intCast(frac_part.len);

        // gather the significand into one buffer so leading/trailing zeros can be
        // stripped across the (now removed) decimal point.
        var dig: [128]u8 = undefined;
        if (int_part.len + frac_part.len > dig.len) return s;
        @memcpy(dig[0..int_part.len], int_part);
        @memcpy(dig[int_part.len..][0..frac_part.len], frac_part);
        var d = dig[0 .. int_part.len + frac_part.len];

        var lead: usize = 0;
        while (lead < d.len and d[lead] == '0') lead += 1;
        if (lead == d.len) return "0"; // the value is zero
        d = d[lead..];
        while (d[d.len - 1] == '0') {
            d = d[0 .. d.len - 1];
            exp += 1;
        }

        // exp == 0: a bare integer, already minimal (trailing zeros raised exp).
        if (exp == 0) {
            @memcpy(scratch[0..d.len], d);
            return if (d.len <= s.len) scratch[0..d.len] else s;
        }

        const exp_len = d.len + 1 + std.fmt.count("{d}", .{exp});
        const out = if (exp_len < fixedLen(d.len, exp, scratch.len))
            (std.fmt.bufPrint(scratch, "{s}e{d}", .{ d, exp }) catch return s)
        else
            writeFixed(scratch, d, exp) orelse return s;
        return if (out.len <= s.len) out else s;
    }

    /// length of the fixed-point rendering of `d * 10^exp`, or `maxInt` if it would
    /// exceed `cap`. `exp` is never zero here.
    fn fixedLen(dlen: usize, exp: i64, cap: usize) usize {
        if (exp > 0) {
            const e: usize = @intCast(exp);
            return if (e <= cap) dlen + e else std.math.maxInt(usize);
        }
        const f: usize = @intCast(-exp);
        if (f < dlen) return dlen + 1; // dot sits inside the significand
        return if (1 + f <= cap) 1 + f else std.math.maxInt(usize); // `.000…d`
    }

    /// renders `d * 10^exp` (exp != 0) in fixed-point form into `scratch`.
    fn writeFixed(scratch: []u8, d: []const u8, exp: i64) ?[]const u8 {
        if (exp > 0) {
            const e: usize = @intCast(exp);
            if (d.len + e > scratch.len) return null;
            @memcpy(scratch[0..d.len], d);
            @memset(scratch[d.len..][0..e], '0');
            return scratch[0 .. d.len + e];
        }
        const f: usize = @intCast(-exp);
        if (f < d.len) { // `<head>.<tail>`
            const head = d.len - f;
            if (d.len + 1 > scratch.len) return null;
            @memcpy(scratch[0..head], d[0..head]);
            scratch[head] = '.';
            @memcpy(scratch[head + 1 ..][0..f], d[head..]);
            return scratch[0 .. d.len + 1];
        }
        const zeros = f - d.len; // `.000…d`
        if (1 + f > scratch.len) return null;
        scratch[0] = '.';
        @memset(scratch[1..][0..zeros], '0');
        @memcpy(scratch[1 + zeros ..][0..d.len], d);
        return scratch[0 .. 1 + f];
    }

    /// true when a block comment's continuation lines are all blank or `*`-prefixed
    /// (jsdoc shape), so re-indenting them cannot disturb their content.
    pub fn isJsdocBody(value: []const u8) bool {
        var it = std.mem.splitScalar(u8, value, '\n');
        _ = it.next(); // first line follows `/*` and is never re-indented
        var multi = false;
        while (it.next()) |line| {
            multi = true;
            const t = std.mem.trimStart(u8, line, " \t");
            if (t.len != 0 and t[0] != '*') return false;
        }
        return multi;
    }

    /// true when a block comment is a legal header or annotation worth preserving
    /// under the `.some` comment filter.
    pub fn isSignificantBlockComment(value: []const u8) bool {
        if (value.len == 0) return false;
        switch (value[0]) {
            '!', '*', '#', '@' => return true,
            else => {},
        }
        var i: usize = 0;
        while (std.mem.findScalarPos(u8, value, i, '@')) |pos| {
            const rest = value[pos..];
            if (std.mem.startsWith(u8, rest, "@license") or
                std.mem.startsWith(u8, rest, "@preserve") or
                std.mem.startsWith(u8, rest, "@cc_on")) return true;
            i = pos + 1;
        }
        return false;
    }
};

const source_maps = @import("codegen_options").source_maps;

const Allocator = std.mem.Allocator;
const Tree = parser.ParseResult;
const NodeIndex = ast.NodeIndex;
const NodeData = ast.NodeData;
const IndexRange = ast.IndexRange;
const Precedence = struct {
    const Lowest: u8 = 0;
    const Comma: u8 = 1;
    const Assignment: u8 = 2;
    const LogicalOr: u8 = 3;
    const LogicalAnd: u8 = 4;
    const BitwiseOr: u8 = 5;
    const BitwiseXor: u8 = 6;
    const BitwiseAnd: u8 = 7;
    const Equality: u8 = 8;
    const Relational: u8 = 9;
    const Shift: u8 = 10;
    const Additive: u8 = 11;
    const Multiplicative: u8 = 12;
    const Unary: u8 = 14;
    const Postfix: u8 = 15;
    const New: u8 = 16;
    const Call: u8 = 17;
    const Grouping: u8 = 18;
};

const Ctx = struct {
    /// minimum precedence allowed unparenthesized
    prec: u8 = Precedence.Lowest,
    /// in a `for` head, where a top-level `in` reads as `for (a in b)`
    no_in: bool = false,
    /// in a `new` callee, where a call would bind to the `new`
    no_call: bool = false,
};

/// Leading-edge position, where `{`/`function`/`class`/`let[` misparses as a
/// block or declaration.
const Lead = enum { none, stmt, arrow };

pub const SourceMap = sourcemap.SMSourceMap;
pub const SourceMapOptions = sourcemap.SMOptions;

/// Whitespace mode for the output.
pub const Format = enum {
    /// Indented, with spaces around operators and after commas.
    pretty,
    /// No discretionary whitespace, only what the grammar requires.
    compact,
};

/// Quote style for emitted string literals.
///
/// - `preserve`: keep each literal's original quote style (single vs double);
///   synthetic nodes default to double.
/// - `double` / `single`: force that quote.
///
/// Minify mode ignores this and always picks whichever quote needs fewer
/// escapes.
pub const Quotes = enum { preserve, double, single };

/// Comment passthrough filter.
pub const Comments = enum {
    /// Drop all comments.
    none,
    /// Emit every comment.
    all,
    /// Emit legal headers, JSDoc, and tree-shaking annotations
    /// (`__PURE__`, `__NO_SIDE_EFFECTS__`, `@`/`#` annotations).
    some,
    /// Emit `// ...` only.
    line,
    /// Emit `/* ... */` only.
    block,
};

/// Codegen options.
pub const Options = struct {
    format: Format = .pretty,
    /// Spaces per indentation level. Used only when `format = .pretty`.
    indent: u8 = 2,
    quotes: Quotes = .preserve,
    /// Set to enable Source Map V3 output alongside the code.
    source_maps: ?SourceMapOptions = null,
    /// Comment passthrough filter. Defaults to `.some`, which preserves
    /// legal headers, JSDoc, and tree-shaking annotations.
    comments: Comments = .some,
};

/// A codegen-detected problem in the input AST.
pub const Diagnostic = struct {
    message: []const u8,
    /// Byte offset where the problem starts.
    start: u32,
    /// Byte offset where the problem ends.
    end: u32,
};

/// Output of a codegen run. All buffers are owned by the allocator
/// passed to `print`/`strip`/`minify`. Call `deinit` with the same
/// allocator to free them.
pub const Result = struct {
    code: []const u8,
    /// Empty when codegen succeeded cleanly.
    errors: []const Diagnostic,
    /// Populated when `Options.source_maps` was set.
    map: ?SourceMap = null,

    pub fn deinit(self: Result, allocator: Allocator) void {
        allocator.free(self.code);
        allocator.free(self.errors);
        if (self.map) |m| m.deinit(allocator);
    }
};

pub const Error = error{OutOfMemory};

/// Comptime configuration for the print pipeline.
pub const Config = struct {
    strip_ts: bool = false,
    /// When true, applies size-reducing substitutions during emit.
    minify: bool = false,
};

/// Renders a `Tree` to source code.
pub fn print(allocator: Allocator, tree: *Tree, options: Options) Error!Result {
    return printImpl(.{}, allocator, tree, options);
}

/// Render TypeScript `Tree` to JavaScript output, excluding TypeScript-specific syntax.
pub const generate = print;

/// Render TypeScript `Tree` to JavaScript output, excluding TypeScript-specific syntax.
pub fn strip(allocator: Allocator, tree: *Tree, options: Options) Error!Result {
    return printImpl(.{ .strip_ts = true }, allocator, tree, options);
}

/// render `Tree` with print-time minification substitutions enabled.
/// combine with `Options.format = .compact` for fully minified output.
pub fn minify(allocator: Allocator, tree: *Tree, options: Options) Error!Result {
    return printImpl(.{ .minify = true }, allocator, tree, options);
}

/// Runtime dispatch over the printers, for a host that receives `strip` and
/// `minify` as data. `strip` wins when both are set: each printer is its own
/// comptime instantiation and a combined one costs the wasm ~140 KiB.
pub fn emit(allocator: Allocator, tree: *Tree, cfg: Config, options: Options) Error!Result {
    if (cfg.strip_ts) return strip(allocator, tree, options);
    if (cfg.minify) return minify(allocator, tree, options);
    return print(allocator, tree, options);
}

pub fn printImpl(
    comptime cfg: Config,
    allocator: Allocator,
    tree: *Tree,
    options: Options,
) Error!Result {
    std.debug.assert(tree.root != .null);
    var p = try Printer(cfg).init(allocator, tree, options);
    defer p.deinit();
    try p.printRoot();

    const code = try p.code.toOwnedSlice(allocator);
    errdefer allocator.free(code);
    const errors = try p.errors.toOwnedSlice(allocator);
    errdefer allocator.free(errors);
    const map = if (comptime source_maps) (if (p.sm) |*sm| try sm.build(allocator) else null) else null;
    return .{ .code = code, .errors = errors, .map = map };
}

/// Tags whose emit is a single fixed string. Centralizing these trivial
/// keyword/punctuation nodes lets `emitNode` handle them in one branch
/// instead of a per-tag `emit_*` function each.
fn fixedString(comptime tag: std.meta.Tag(NodeData)) ?[]const u8 {
    return switch (tag) {
        .super => "super",
        .this_expression, .ts_this_type => "this",
        .null_literal, .ts_null_keyword => "null",
        .ts_any_keyword => "any",
        .ts_unknown_keyword => "unknown",
        .ts_never_keyword => "never",
        .ts_void_keyword => "void",
        .ts_undefined_keyword => "undefined",
        .ts_string_keyword => "string",
        .ts_number_keyword => "number",
        .ts_bigint_keyword => "bigint",
        .ts_boolean_keyword => "boolean",
        .ts_symbol_keyword => "symbol",
        .ts_object_keyword => "object",
        .ts_intrinsic_keyword => "intrinsic",
        .ts_jsdoc_unknown_type => "?",
        .jsx_opening_fragment => "<>",
        .jsx_closing_fragment => "</>",
        else => null,
    };
}

fn Printer(comptime cfg: Config) type {
    return struct {
        const Self = @This();
        const strip_ts = cfg.strip_ts;
        const minify_mode = cfg.minify;

        tree: *Tree,
        node_data: []const NodeData,
        code: std.ArrayList(u8) = .empty,
        errors: std.ArrayList(Diagnostic) = .empty,
        options: Options,
        allocator: Allocator,
        indent_depth: u32 = 0,
        /// set while emitting a destructuring/assignment target so nested
        /// array/object literals know to re-paren ts `as`/`satisfies`/
        /// type-assertion leaves the parser elided.
        in_assign_target: bool = false,
        /// In compact mode, statement terminators are deferred via this flag
        /// rather than emitted immediately. The next statement flushes it,
        /// a closing `}` clears it, eliminating the trailing `;` for free.
        pending_semi: bool = false,
        /// Source-map state. Present if `options.source_maps != null`.
        sm: ?sourcemap.State = null,
        /// node currently being emitted, used by container helpers to look
        /// up inside-comments without threading the index through every call
        current_idx: NodeIndex = .null,
        /// a declarator's `!` parked so the binding target emits it next to `?`,
        /// before its nested type annotation. consumed by `takeDefinite`
        definite_pending: bool = false,
        /// a key whose leading comments `hoistKeyComments` already emitted, so
        /// `emitLeadingComments` skips them. set and `defer`-cleared by the member
        /// emitter, so it can't dangle if the key's emit is bypassed (minify).
        skip_leading_of: NodeIndex = .null,
        /// leading edge of a statement or arrow body, cleared by the first real
        /// token (`writeByte`/`writeStr`) but preserved across comments
        at_lead: Lead = .none,
        /// within a directive prologue, where a bare string would reparse as one
        in_prologue: bool = false,
        /// `in` forbidden in the current declarator init (a `for` head)
        decl_no_in: bool = false,
        /// Prevents recursive re-entry when emitting an overlaid host node.
        dialect_overlay: bool = true,

        fn init(allocator: Allocator, tree: *Tree, options: Options) Error!Self {
            var p = Self{
                .tree = tree,
                .node_data = tree.nodes.items(.data),
                .options = options,
                .allocator = allocator,
            };
            try p.code.ensureTotalCapacity(allocator, tree.source.len);

            if (comptime source_maps) if (options.source_maps) |sm_opts| {
                if (sm_opts.source != null) {
                    p.sm = sourcemap.State.init(sm_opts);
                    try p.sm.?.out.ensureTotalCapacity(allocator, tree.nodes.len * 8 + 64);
                }
            };
            return p;
        }

        fn deinit(self: *Self) void {
            self.code.deinit(self.allocator);
            self.errors.deinit(self.allocator);
            if (comptime source_maps) if (self.sm) |*sm| sm.deinit(self.allocator);
        }

        inline fn pretty(self: *const Self) bool {
            return self.options.format == .pretty;
        }

        inline fn nodeData(self: *const Self, idx: NodeIndex) NodeData {
            return self.node_data[@intFromEnum(idx)];
        }

        inline fn pushByte(self: *Self, b: u8) Error!void {
            if (self.code.items.len == self.code.capacity)
                try self.code.ensureTotalCapacity(self.allocator, self.code.items.len + 1);
            self.code.appendAssumeCapacity(b);
        }

        inline fn pushSlice(self: *Self, s: []const u8) Error!void {
            if (self.code.capacity - self.code.items.len < s.len)
                try self.code.ensureUnusedCapacity(self.allocator, s.len);
            const old = self.code.items.len;
            self.code.items.len = old + s.len;
            const dst = self.code.items.ptr + old;
            if (s.len <= 16) {
                for (0..s.len) |k| dst[k] = s[k];
            } else {
                @memcpy(dst[0..s.len], s);
            }
        }

        inline fn writeByte(self: *Self, b: u8) Error!void {
            self.dropPendingKeywordSpace(b);
            self.at_lead = .none; // real token ends the leading edge
            try self.pushByte(b);
            if (comptime source_maps) if (self.sm) |*sm| {
                if (b == '\n') {
                    sm.gen_line += 1;
                    sm.gen_col = 0;
                } else sm.gen_col += 1;
            };
        }

        inline fn writeStr(self: *Self, s: []const u8) Error!void {
            if (s.len == 0) return;
            self.dropPendingKeywordSpace(s[0]);
            self.at_lead = .none; // real token ends the leading edge
            try self.pushSlice(s);
            if (comptime source_maps) if (self.sm) |*sm| sm.advance(s);
        }

        /// In compact mode, drop the trailing ` ` from a just-written `keyword `
        /// when the upcoming byte is punctuation (`else { … }` → `else{…}`,
        /// `return"x"` → `return"x"`). Preserved when the next byte extends an
        /// identifier (`return foo`, `case 5:`).
        inline fn dropPendingKeywordSpace(self: *Self, next: u8) void {
            if (self.pretty()) return;
            const items = self.code.items;
            if (items.len < 2 or items[items.len - 1] != ' ') return;
            if (utils.isIdCont(items[items.len - 2]) and !utils.isIdCont(next)) {
                _ = self.code.pop();
                if (comptime source_maps) if (self.sm) |*sm| if (sm.gen_col > 0) {
                    sm.gen_col -= 1;
                };
            }
        }

        inline fn writeString(self: *Self, id: ast.String) Error!void {
            try self.writeStr(self.tree.string(id));
        }

        inline fn space(self: *Self) Error!void {
            if (self.pretty()) try self.writeByte(' ');
        }

        /// `, ` list separator (just `,` in compact mode).
        inline fn comma(self: *Self) Error!void {
            try self.writeByte(',');
            try self.space();
        }

        /// ` = ` with surrounding spaces (just `=` in compact mode).
        inline fn printEq(self: *Self) Error!void {
            try self.space();
            try self.writeByte('=');
            try self.space();
        }

        /// Emits `items` as a `, `-separated list.
        fn emitList(self: *Self, items: IndexRange) Error!void {
            for (self.tree.extra(items), 0..) |x, i| {
                if (i > 0) try self.comma();
                try self.emit(x);
            }
        }

        /// Trailing `?`/`!`/type-annotation shared by binding identifiers and
        /// array/object patterns.
        fn printBindingSuffix(self: *Self, optional: bool, definite: bool, annotation: NodeIndex) Error!void {
            if (comptime !strip_ts) if (optional) try self.writeByte('?');
            if (definite) try self.writeByte('!');
            try self.emit(annotation);
        }

        /// takes the parked `!`, clearing it so it never leaks into a nested
        /// binding (`let {x}!` keeps `!` after `}`)
        inline fn takeDefinite(self: *Self) bool {
            if (comptime strip_ts) return false;
            const d = self.definite_pending;
            self.definite_pending = false;
            return d;
        }

        // pretty-mode-only break with indent (no-op in compact)
        fn newline(self: *Self) Error!void {
            if (!self.pretty()) return;
            try self.breakLine();
        }

        inline fn mark(self: *const Self) usize {
            return self.code.items.len;
        }

        inline fn rewindTo(self: *Self, pos: usize) void {
            std.debug.assert(pos <= self.code.items.len);
            self.code.shrinkRetainingCapacity(pos);
        }

        /// Snapshot of the state needed to undo a speculative `tryEmit`.
        const Cursor = struct {
            code: usize,
            sm: ?sourcemap.State.Snapshot,
        };

        inline fn cursor(self: *const Self) Cursor {
            return .{
                .code = self.code.items.len,
                .sm = if (comptime source_maps) (if (self.sm) |sm| sm.snapshot() else null) else null,
            };
        }

        inline fn restore(self: *Self, c: Cursor) void {
            std.debug.assert(c.code <= self.code.items.len);
            self.code.shrinkRetainingCapacity(c.code);
            if (comptime source_maps) if (c.sm) |snap| if (self.sm) |*sm| sm.restore(snap);
        }

        fn tryEmit(self: *Self, idx: NodeIndex) Error!bool {
            const start = self.mark();
            const tail: u8 = if (start > 0) self.code.items[start - 1] else 0;
            try self.emit(idx);
            if (self.code.items.len > start) return true;
            return start > 0 and self.code.items[start - 1] != tail;
        }

        /// Emits `idx` in a position where a statement is grammatically required.
        /// Substitutes an empty statement when the emit produces no output.
        fn emitStmt(self: *Self, idx: NodeIndex) Error!void {
            if (!try self.tryEmit(idx)) try self.writeByte(';');
        }

        fn printRoot(self: *Self) Error!void {
            try self.emit(self.tree.root);
        }

        fn emit(self: *Self, idx: NodeIndex) Error!void {
            return self.emitExpr(idx, .{});
        }

        /// Emits `idx`, parenthesizing it when its slot `ctx` requires. The one
        /// place parentheses are decided for expressions.
        fn emitExpr(self: *Self, idx: NodeIndex, ctx: Ctx) Error!void {
            if (idx == .null) return;

            if (comptime strip_ts) {
                const data = self.nodeData(idx);
                if (data.isTypeContext()) return;

                switch (data) {
                    .ts_type_alias_declaration,
                    .ts_interface_declaration,
                    .ts_global_declaration,
                    .ts_namespace_export_declaration,
                    .ts_this_parameter,
                    => return,
                    .ts_as_expression,
                    .ts_satisfies_expression,
                    .ts_type_assertion,
                    .ts_non_null_expression,
                    .ts_instantiation_expression,
                    => return self.emitExpr(self.stripped(idx), ctx),
                    .ts_enum_declaration => |e| {
                        if (e.declare) return;
                        return self.diagnose(
                            idx,
                            "TypeScript enums cannot be stripped to JavaScript",
                        );
                    },
                    .ts_module_declaration => |m| {
                        if (m.declare) return;
                        return self.diagnose(
                            idx,
                            "TypeScript namespaces cannot be stripped to JavaScript",
                        );
                    },
                    .ts_import_equals_declaration => |i| {
                        if (i.import_kind == .type) return;
                        return self.diagnose(
                            idx,
                            "`import = require()` cannot be stripped to JavaScript",
                        );
                    },
                    .ts_export_assignment => return self.diagnose(
                        idx,
                        "`export =` cannot be stripped to JavaScript",
                    ),
                    .ts_parameter_property => |pp| {
                        try self.diagnose(
                            idx,
                            "parameter properties cannot be stripped to JavaScript",
                        );
                        return self.emitExpr(pp.parameter, ctx);
                    },
                    else => {},
                }
            }

            const wrap = self.needsParens(idx, ctx);
            const inner: Ctx = if (wrap) .{} else ctx;
            if (wrap) try self.writeByte('(');
            if (self.options.comments != .none) {
                const prev_idx = self.current_idx;
                self.current_idx = idx;
                defer self.current_idx = prev_idx;
                // a comment must not consume the leading edge, only a token does
                const saved_lead = self.at_lead;
                try self.emitLeadingComments(idx);
                self.at_lead = saved_lead;
                try self.emitNode(idx, inner);
                try self.emitTrailingComments(idx);
            } else {
                try self.emitNode(idx, inner);
            }
            if (wrap) try self.writeByte(')');
        }

        /// Precedence of `idx` as an operand. Primaries return `Grouping` and
        /// never wrap. Minify rewrites are accounted for so they regroup right.
        fn precedenceOf(self: *const Self, idx: NodeIndex) u8 {
            return switch (self.nodeData(idx)) {
                .sequence_expression => Precedence.Comma,
                .assignment_expression,
                .arrow_function_expression,
                .yield_expression,
                .conditional_expression,
                => Precedence.Assignment,
                .logical_expression => |l| l.operator.toToken().precedence(),
                .binary_expression => |b| b.operator.toToken().precedence(),
                .unary_expression, .await_expression, .ts_type_assertion => Precedence.Unary,
                .update_expression => Precedence.Postfix,
                .ts_as_expression, .ts_satisfies_expression => Precedence.Relational,
                .new_expression,
                .call_expression,
                .member_expression,
                .chain_expression,
                .tagged_template_expression,
                .import_expression,
                .ts_non_null_expression,
                .ts_instantiation_expression,
                => Precedence.Call,
                .boolean_literal => if (minify_mode) Precedence.Unary else Precedence.Grouping,
                // minify rewrites `undefined` and `Infinity`
                .identifier_reference => |id| blk: {
                    if (!minify_mode or self.in_assign_target) break :blk Precedence.Grouping;
                    const s = self.tree.string(id.name);
                    if (std.mem.eql(u8, s, "undefined")) break :blk Precedence.Unary;
                    if (std.mem.eql(u8, s, "Infinity")) break :blk Precedence.Multiplicative;
                    break :blk Precedence.Grouping;
                },
                else => Precedence.Grouping,
            };
        }

        /// Whether `idx` needs parentheses in slot `ctx`, by precedence plus the
        /// positional rules the grammar forces regardless.
        fn needsParens(self: *const Self, idx: NodeIndex, ctx: Ctx) bool {
            const data = self.nodeData(idx);

            // a leading `{` reads as a block, `function`/`class` as a declaration
            if (self.at_lead != .none) {
                switch (data) {
                    .object_expression => return true,
                    .assignment_expression => |a| if (self.nodeData(a.left) == .object_pattern) {
                        const target_raw: u32 = @intFromEnum(a.left);
                        if (self.tree.dialectOverlay(target_raw)) |record_index| {
                            if (hasDisambiguatingAssignmentTargetPrefix(
                                Self,
                                self,
                                record_index,
                                target_raw,
                            )) return false;
                        }
                        return true;
                    },
                    else => {},
                }
            }
            if (self.at_lead == .stmt) {
                switch (data) {
                    .function => |f| if (f.type == .function_expression or
                        f.type == .ts_empty_body_function_expression) return true,
                    .class => |c| if (c.type == .class_expression) return true,
                    .member_expression => |m| if (m.computed and self.isLetIdentifier(m.object)) return true,
                    else => {},
                }
            }

            if (ctx.no_call) switch (data) {
                .call_expression, .import_expression, .chain_expression => return true,
                else => {},
            };
            if (ctx.prec >= Precedence.Call and data == .chain_expression) return true;

            if (ctx.no_in and data == .binary_expression and
                data.binary_expression.operator == .in) return true;

            return self.precedenceOf(idx) < ctx.prec;
        }

        fn isLetIdentifier(self: *const Self, idx: NodeIndex) bool {
            return switch (self.nodeData(idx)) {
                .identifier_reference => |id| std.mem.eql(u8, self.tree.string(id.name), "let"),
                else => false,
            };
        }

        inline fn stripped(self: *const Self, idx: NodeIndex) NodeIndex {
            if (comptime !strip_ts) return idx;
            var i = idx;
            while (true) i = switch (self.nodeData(i)) {
                .ts_as_expression => |e| e.expression,
                .ts_satisfies_expression => |e| e.expression,
                .ts_non_null_expression => |e| e.expression,
                .ts_instantiation_expression => |e| e.expression,
                .ts_type_assertion => |e| e.expression,
                else => return i,
            };
        }

        inline fn emitNode(self: *Self, idx: NodeIndex, ctx: Ctx) Error!void {
            if (comptime source_maps) if (self.sm != null) try self.recordMapping(idx);

            if (self.dialect_overlay) {
                if (self.tree.dialectOverlay(@intFromEnum(idx))) |record_index| {
                    if (try dialectPrintOverlay(Self, self, record_index, idx)) return;
                }
            }
            if (self.tree.dialectRecord(@intFromEnum(idx))) |record_index| {
                try dialectPrintRecord(Self, self, record_index);
                return;
            }

            switch (self.node_data[@intFromEnum(idx)]) {
                inline else => |*node, tag| {
                    if (comptime fixedString(tag)) |fixed| {
                        try self.writeStr(fixed);
                    } else {
                        const fn_name = "emit_" ++ @tagName(tag);
                        if (comptime @hasDecl(Self, fn_name)) {
                            const f = @field(Self, fn_name);
                            if (comptime @typeInfo(@TypeOf(f)).@"fn".params.len == 3) {
                                try f(self, node, ctx);
                            } else {
                                try f(self, node);
                            }
                        } else {
                            std.debug.panic("codegen: not implemented for {s}", .{@tagName(tag)});
                        }
                    }
                },
            }
        }

        pub fn dialectWrite(self: *Self, bytes: []const u8) Error!void {
            std.debug.assert(bytes.len > 0);
            try self.writeStr(bytes);
        }

        pub fn dialectSpace(self: *Self) Error!void {
            try self.space();
        }

        pub fn dialectEmit(self: *Self, raw: u32) Error!void {
            std.debug.assert(raw < self.node_data.len);
            try self.emit(@enumFromInt(raw));
        }

        pub fn dialectEmitStatements(self: *Self, start: u32, len: u32) Error!void {
            const end = start + len;
            std.debug.assert(end >= start and end <= self.tree.extras.items.len);
            for (self.tree.extras.items[start..end], 0..) |node, index| {
                if (index > 0) try self.space();
                try self.emit(node);
                try self.flushSemi();
            }
        }

        pub fn dialectEmitOverlaySuppressed(self: *Self, raw: u32) Error!void {
            const previous = self.dialect_overlay;
            defer self.dialect_overlay = previous;
            self.dialect_overlay = false;
            try self.emitNode(@enumFromInt(raw), .{});
        }

        pub fn dialectEmitForLeft(self: *Self, raw: u32) Error!void {
            try self.printForLeft(@enumFromInt(raw));
        }

        pub fn dialectEmitValue(self: *Self, raw: u32) Error!void {
            try self.emitValue(@enumFromInt(raw));
        }

        pub fn dialectEmitStatement(self: *Self, raw: u32) Error!void {
            try self.emitStmt(@enumFromInt(raw));
        }

        pub fn dialectEmitBlock(self: *Self, start: u32, len: u32) Error!void {
            try self.printBlock(.{ .start = start, .len = len }, false);
        }

        inline fn allowComment(self: *const Self, c: ast.AttachedComment) bool {
            return switch (self.options.comments) {
                .none => false,
                .all => true,
                .some => c.type == .block and utils.isSignificantBlockComment(self.tree.string(c.value)),
                .line => c.type == .line,
                .block => c.type == .block,
            };
        }

        inline fn lastByte(self: *const Self) u8 {
            const items = self.code.items;
            return if (items.len == 0) 0 else items[items.len - 1];
        }

        fn emitLeadingComments(self: *Self, idx: NodeIndex) Error!void {
            if (idx == self.skip_leading_of) return; // already hoisted, see hoistKeyComments
            for (self.tree.commentsOf(idx)) |c| {
                if (c.position == .before and self.allowComment(c)) try self.writeLeading(c);
            }
        }

        /// emits a class-member key's leading comments before the member's
        /// modifiers, so a comment cannot land between a no-line-terminator
        /// modifier (`get`/`set`/`async`/`accessor`) and the key and split it
        fn hoistKeyComments(self: *Self, key: NodeIndex) Error!void {
            if (self.options.comments == .none) return;
            if (key == .null) return;
            try self.emitLeadingComments(key);
            self.skip_leading_of = key;
        }

        fn emitTrailingComments(self: *Self, idx: NodeIndex) Error!void {
            for (self.tree.commentsOf(idx)) |c| {
                if (c.position == .after and self.allowComment(c)) {
                    // flush a deferred `;` first, so it lands before the comment
                    // rather than after it where a reparse would re-home it
                    try self.flushSemi();
                    try self.writeTrailing(c);
                }
            }
        }

        fn writeLeading(self: *Self, c: ast.AttachedComment) Error!void {
            // same-line block (`function /* x */ foo`) stays inline
            if (c.type == .block and c.same_line) {
                const last = self.lastByte();
                if (self.pretty() and last != 0 and last != ' ' and last != '\n') {
                    try self.writeByte(' ');
                }
                try self.writeCommentBody(c);
                if (self.pretty()) try self.writeByte(' ');
                return;
            }
            // everything else lands on its own line above the host so jsdoc
            // stays resolvable by language servers
            try self.breakLine();
            try self.writeCommentBody(c);
            try self.breakLine();
        }

        fn writeTrailing(self: *Self, c: ast.AttachedComment) Error!void {
            if (c.same_line) {
                if (self.pretty()) try self.writeByte(' ');
                try self.writeCommentBody(c);
                if (c.type == .line) try self.breakLine();
                return;
            }
            try self.breakLine();
            try self.writeCommentBody(c);
            try self.breakLine();
        }

        inline fn writeCommentBody(self: *Self, c: ast.AttachedComment) Error!void {
            const value = self.tree.string(c.value);
            try self.writeStr(if (c.type == .line) "//" else "/*");
            if (c.type == .block) {
                try self.writeBlockBody(value);
                try self.pushSlice("*/");
                if (comptime source_maps) if (self.sm) |*sm| sm.advance("*/");
            } else {
                try self.pushSlice(value);
                if (comptime source_maps) if (self.sm) |*sm| sm.advance(value);
            }
        }

        // writes a block comment's interior. jsdoc-shaped bodies have their
        // continuation lines re-indented under the reformatted `/*`, so the
        // star column survives a change of nesting depth. anything else is
        // emitted verbatim.
        fn writeBlockBody(self: *Self, value: []const u8) Error!void {
            if (!self.pretty() or !utils.isJsdocBody(value)) {
                try self.pushSlice(value);
                if (comptime source_maps) if (self.sm) |*sm| sm.advance(value);
                return;
            }
            var it = std.mem.splitScalar(u8, value, '\n');
            try self.writeStr(it.first()); // first line follows `/*`
            while (it.next()) |line| {
                try self.breakLine(); // newline at the current indent
                try self.writeByte(' '); // align the star under the opener
                try self.writeStr(std.mem.trimStart(u8, line, " \t"));
            }
        }

        // idempotent line break with indent in pretty mode. strips stale
        // trailing indent so repeated calls collapse, and re-indents at the
        // current depth. no-op at the very start of the output.
        fn breakLine(self: *Self) Error!void {
            var i = self.code.items.len;
            while (i > 0 and self.code.items[i - 1] == ' ') i -= 1;
            if (i == 0) return;
            if (i < self.code.items.len) self.code.shrinkRetainingCapacity(i);

            const n = if (self.pretty()) self.indent_depth * self.options.indent else 0;
            if (self.code.capacity - self.code.items.len < 1 + n)
                try self.code.ensureUnusedCapacity(self.allocator, 1 + n);
            if (self.code.items[self.code.items.len - 1] != '\n') {
                self.code.appendAssumeCapacity('\n');
                if (comptime source_maps) if (self.sm) |*sm| {
                    sm.gen_line += 1;
                };
            }
            if (n > 0) self.code.appendNTimesAssumeCapacity(' ', n);
            if (comptime source_maps) if (self.sm) |*sm| {
                sm.gen_col = n;
            };
        }

        // records a source-map segment for idx, skipping synthetic spans
        fn recordMapping(self: *Self, idx: NodeIndex) Error!void {
            const sm = &self.sm.?;
            const span = self.tree.span(idx);
            if (span.start == 0 and span.end == 0) return;

            const orig = sm.resolve(span.start);

            try sm.record(self.allocator, orig.line, orig.col);
        }

        fn diagnose(self: *Self, idx: NodeIndex, message: []const u8) Error!void {
            const span = self.tree.span(idx);
            try self.errors.append(self.allocator, .{
                .message = message,
                .start = span.start,
                .end = span.end,
            });
        }

        fn emit_program(self: *Self, p: *const ast.Program) Error!void {
            if (p.hashbang) |h| {
                try self.writeStr("#!");
                try self.writeString(h.value);
                try self.writeByte('\n');
            }
            try self.printStmtList(p.body, true);
            self.pending_semi = false;
            if (self.options.comments != .none) try self.emitInsideComments(self.current_idx);
        }

        /// Emits a list of statements, flushing the deferred `;` between each.
        /// On strip-to-nothing, rewinds the buffer and restores `pending_semi`
        /// so the preceding statement's terminator is not lost. `prologue` marks
        /// a program or function body whose leading string statements are directives.
        fn printStmtList(self: *Self, items: IndexRange, prologue: bool) Error!void {
            var first = true;
            var prol = prologue;
            for (self.tree.extra(items)) |s| {
                const cur = self.cursor();
                const saved_semi = self.pending_semi;
                if (!first) try self.newline();
                try self.flushSemi();
                self.in_prologue = prol;
                if (try self.tryEmit(s)) {
                    first = false;
                    if (prol and self.nodeData(s) != .directive) prol = false;
                } else {
                    self.restore(cur);
                    self.pending_semi = saved_semi;
                }
            }
            self.in_prologue = false;
        }

        fn printBlock(self: *Self, items: IndexRange, prologue: bool) Error!void {
            try self.writeByte('{');
            if (self.tree.extra(items).len > 0) {
                const cur = self.cursor();
                self.indent_depth += 1;
                try self.newline();
                const after_indent = self.mark();
                try self.printStmtList(items, prologue);
                self.indent_depth -= 1;
                if (self.mark() == after_indent) {
                    self.restore(cur);
                } else {
                    self.pending_semi = false;
                    try self.newline();
                }
            } else if (self.options.comments != .none) {
                try self.emitInsideComments(self.current_idx);
            }
            try self.writeByte('}');
        }

        // emits inside-host comments between an empty container's delimiters
        fn emitInsideComments(self: *Self, idx: NodeIndex) Error!void {
            var any = false;
            for (self.tree.commentsOf(idx)) |c| {
                if (c.position != .inside or !self.allowComment(c)) continue;
                if (!any) {
                    any = true;
                    self.indent_depth += 1;
                }
                try self.breakLine();
                try self.writeCommentBody(c);
            }
            if (any) {
                self.indent_depth -= 1;
                try self.breakLine();
            }
        }

        /// Statement-terminator `;`. In compact mode, defers via `pending_semi`
        /// so the next `flushSemi` writes it or a closing `}` drops it for free.
        inline fn softSemi(self: *Self) Error!void {
            if (self.pretty()) try self.writeByte(';') else self.pending_semi = true;
        }

        /// Emits any deferred `;` and clears the flag.
        inline fn flushSemi(self: *Self) Error!void {
            if (self.pending_semi) {
                self.pending_semi = false;
                try self.writeByte(';');
            }
        }

        fn emit_block_statement(self: *Self, s: *const ast.BlockStatement) Error!void {
            try self.printBlock(s.body, false);
        }

        fn emit_function_body(self: *Self, b: *const ast.FunctionBody) Error!void {
            try self.printBlock(b.body, true);
        }

        fn emit_static_block(self: *Self, b: *const ast.StaticBlock) Error!void {
            try self.writeStr("static");
            try self.space();
            try self.printBlock(b.body, false);
        }

        fn emit_directive(self: *Self, d: *const ast.Directive) Error!void {
            // a directive's meaning depends on its exact code units (an escaped
            // `"use strict"` is not one), so emit the original lexeme verbatim
            switch (self.nodeData(d.expression)) {
                .string_literal => |lit| try self.writeString(lit.raw),
                else => try self.emit(d.expression),
            }
            try self.softSemi();
        }

        fn emit_empty_statement(self: *Self, _: *const ast.EmptyStatement) Error!void {
            // direct `;` (not deferred): when this is the body of an outer
            // control-flow construct like `if(x);`, `for(;;);`, or `lbl:;`,
            // the parser requires the `;` to materialize the body.
            try self.writeByte(';');
        }

        fn emit_debugger_statement(self: *Self, _: *const ast.DebuggerStatement) Error!void {
            try self.writeStr("debugger");
            try self.softSemi();
        }

        fn emit_expression_statement(self: *Self, s: *const ast.ExpressionStatement) Error!void {
            const as_directive = self.in_prologue and self.nodeData(s.expression) == .string_literal;
            self.in_prologue = false;
            if (as_directive) {
                try self.writeByte('(');
                try self.emit(s.expression);
                try self.writeByte(')');
                try self.softSemi();
                return;
            }
            self.at_lead = .stmt;
            try self.emitExpr(s.expression, .{});
            try self.softSemi();
        }

        fn emit_if_statement(self: *Self, s: *const ast.IfStatement) Error!void {
            try self.writeStr("if");
            try self.space();
            try self.writeByte('(');
            try self.emit(s.@"test");
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.consequent);
            if (s.alternate != .null) {
                try self.flushSemi();
                try self.space();
                try self.writeStr("else ");
                try self.emitStmt(s.alternate);
            }
        }

        fn emit_return_statement(self: *Self, s: *const ast.ReturnStatement) Error!void {
            try self.writeStr("return");
            try self.emitRestrictedArg(s.argument, Precedence.Lowest);
            try self.softSemi();
        }

        fn emit_throw_statement(self: *Self, s: *const ast.ThrowStatement) Error!void {
            try self.writeStr("throw");
            try self.emitRestrictedArg(s.argument, Precedence.Lowest);
            try self.softSemi();
        }

        /// Emits the space-prefixed operand of a newline-restricted keyword
        /// (`return`/`throw`/`yield`). If a leading comment broke it onto its own
        /// line, ASI would sever it, so it is re-emitted parenthesized.
        fn emitRestrictedArg(self: *Self, idx: NodeIndex, prec: u8) Error!void {
            if (idx == .null) return;
            const cur = self.cursor();
            const at = self.mark();
            try self.writeByte(' ');
            try self.emitExpr(idx, .{ .prec = prec });
            // the break stripped the separator space, leaving a leading newline
            if (self.code.items[at] == '\n') {
                self.restore(cur);
                try self.writeStr(" (");
                try self.emitExpr(idx, .{ .prec = prec });
                try self.writeByte(')');
            }
        }

        fn emit_break_statement(self: *Self, s: *const ast.BreakStatement) Error!void {
            try self.writeStr("break");
            if (s.label != .null) {
                try self.writeByte(' ');
                try self.emit(s.label);
            }
            try self.softSemi();
        }

        fn emit_continue_statement(self: *Self, s: *const ast.ContinueStatement) Error!void {
            try self.writeStr("continue");
            if (s.label != .null) {
                try self.writeByte(' ');
                try self.emit(s.label);
            }
            try self.softSemi();
        }

        fn emit_labeled_statement(self: *Self, s: *const ast.LabeledStatement) Error!void {
            try self.emit(s.label);
            try self.writeByte(':');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn emit_with_statement(self: *Self, s: *const ast.WithStatement) Error!void {
            try self.writeStr("with");
            try self.space();
            try self.writeByte('(');
            try self.emit(s.object);
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn emit_while_statement(self: *Self, s: *const ast.WhileStatement) Error!void {
            try self.writeStr("while");
            try self.space();
            try self.writeByte('(');
            try self.emit(s.@"test");
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn emit_do_while_statement(self: *Self, s: *const ast.DoWhileStatement) Error!void {
            try self.writeStr("do ");
            try self.emitStmt(s.body);
            try self.flushSemi();
            try self.space();
            try self.writeStr("while");
            try self.space();
            try self.writeByte('(');
            try self.emit(s.@"test");
            try self.writeStr(");");
        }

        fn emit_for_statement(self: *Self, s: *const ast.ForStatement) Error!void {
            try self.writeStr("for");
            try self.space();
            try self.writeByte('(');
            if (s.init != .null) switch (self.nodeData(s.init)) {
                .variable_declaration => |d| try self.printVariableDecl(d, false, true),
                else => try self.emitExpr(s.init, .{ .no_in = true }),
            };
            try self.writeByte(';');
            if (s.@"test" != .null) {
                try self.space();
                try self.emit(s.@"test");
            }
            try self.writeByte(';');
            if (s.update != .null) {
                try self.space();
                try self.emit(s.update);
            }
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn emit_for_in_statement(self: *Self, s: *const ast.ForInStatement) Error!void {
            try self.writeStr("for");
            try self.space();
            try self.writeByte('(');
            try self.printForLeft(s.left);
            try self.writeStr(" in ");
            try self.emit(s.right);
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn emit_for_of_statement(self: *Self, s: *const ast.ForOfStatement) Error!void {
            try self.writeStr("for");
            if (s.await) try self.writeStr(" await");
            try self.space();
            try self.writeByte('(');
            // `for (async of …)` is forbidden, disambiguates from `for await`.
            const wrap_async = !s.await and isBareAsyncIdentifier(self.tree, s.left);
            if (wrap_async) try self.writeByte('(');
            try self.printForLeft(s.left);
            if (wrap_async) try self.writeByte(')');
            try self.writeStr(" of ");
            try self.emitValue(s.right);
            try self.writeByte(')');
            try self.space();
            try self.emitStmt(s.body);
        }

        fn printForLeft(self: *Self, idx: NodeIndex) Error!void {
            switch (self.nodeData(idx)) {
                .variable_declaration => |d| try self.printVariableDecl(d, false, false),
                else => try self.emitAssignTarget(idx),
            }
        }

        fn emit_switch_statement(self: *Self, s: *const ast.SwitchStatement) Error!void {
            try self.writeStr("switch");
            try self.space();
            try self.writeByte('(');
            try self.emit(s.discriminant);
            try self.writeByte(')');
            try self.space();
            try self.writeByte('{');
            const cases = self.tree.extra(s.cases);
            if (cases.len > 0) {
                for (cases) |c| {
                    try self.flushSemi();
                    try self.newline();
                    try self.emit(c);
                }
                self.pending_semi = false;
                try self.newline();
            }
            try self.writeByte('}');
        }

        fn emit_switch_case(self: *Self, c: *const ast.SwitchCase) Error!void {
            if (c.@"test" != .null) {
                try self.writeStr("case ");
                try self.emit(c.@"test");
                try self.writeByte(':');
            } else {
                try self.writeStr("default:");
            }
            if (self.tree.extra(c.consequent).len == 0) return;
            self.indent_depth += 1;
            defer self.indent_depth -= 1;
            try self.printStmtList(c.consequent, false);
        }

        fn emit_try_statement(self: *Self, s: *const ast.TryStatement) Error!void {
            try self.writeStr("try ");
            try self.emit(s.block);
            if (s.handler != .null) {
                try self.space();
                try self.emit(s.handler);
            }
            if (s.finalizer != .null) {
                try self.space();
                try self.writeStr("finally ");
                try self.emit(s.finalizer);
            }
        }

        fn emit_catch_clause(self: *Self, c: *const ast.CatchClause) Error!void {
            try self.writeStr("catch");
            if (c.param != .null) {
                try self.space();
                try self.writeByte('(');
                try self.emit(c.param);
                try self.writeByte(')');
            }
            try self.space();
            try self.emit(c.body);
        }

        fn emit_variable_declaration(self: *Self, d: *const ast.VariableDeclaration) Error!void {
            if (comptime strip_ts) if (d.declare) return;
            try self.printVariableDecl(d.*, true, false);
        }

        fn printVariableDecl(
            self: *Self,
            d: ast.VariableDeclaration,
            with_semicolon: bool,
            no_in: bool,
        ) Error!void {
            if (comptime !strip_ts) if (d.declare) try self.writeStr("declare ");
            try self.writeStr(d.kind.toString());
            try self.writeByte(' ');
            const prev = self.decl_no_in;
            self.decl_no_in = no_in;
            defer self.decl_no_in = prev;
            try self.emitList(d.declarators);
            if (with_semicolon) try self.softSemi();
        }

        fn emit_variable_declarator(self: *Self, d: *const ast.VariableDeclarator) Error!void {
            // park `!` so the binding emits it as `let x!: T`, not `let x: T!`.
            // `d.id` is always a binding pattern, whose takeDefinite() consumes it.
            if (comptime !strip_ts) self.definite_pending = d.definite;
            try self.emit(d.id);
            std.debug.assert(!self.definite_pending);
            if (d.init != .null) {
                try self.separateBangFromAssign();
                try self.printEq();
                try self.emitExpr(d.init, .{ .prec = Precedence.Assignment, .no_in = self.decl_no_in });
            }
        }

        fn emit_sequence_expression(self: *Self, e: *const ast.SequenceExpression, ctx: Ctx) Error!void {
            for (self.tree.extra(e.expressions), 0..) |x, i| {
                if (i > 0) try self.comma();
                try self.emitExpr(x, .{ .prec = Precedence.Assignment, .no_in = ctx.no_in });
            }
        }

        fn emit_parenthesized_expression(self: *Self, e: *const ast.ParenthesizedExpression) Error!void {
            try self.writeByte('(');
            try self.emit(e.expression);
            try self.writeByte(')');
        }

        fn emit_binary_expression(self: *Self, e: *const ast.BinaryExpression, ctx: Ctx) Error!void {
            const no_in = ctx.no_in;
            const tok = e.operator.toToken();
            const op = tok.toString().?;
            const p: u8 = tok.precedence();
            const right_assoc = e.operator == .exponent;
            var left_min = if (right_assoc) Precedence.Postfix else p;
            const right_min = if (right_assoc) p else p + 1;
            // `x as T < y` would re-lex as the type arguments `T<y>`
            if (op[0] == '<' and endsWithTsCast(self.tree, e.left)) left_min = Precedence.Grouping;

            try self.emitExpr(e.left, .{ .prec = left_min, .no_in = no_in });
            const right_ctx = Ctx{ .prec = right_min, .no_in = no_in };
            if (utils.isWordOp(op)) {
                try self.writeByte(' ');
                try self.writeStr(op);
                try self.writeByte(' ');
            } else {
                // `x! == y` would re-lex as `!==`
                if (op[0] == '=') try self.separateBangFromAssign();
                try self.space();
                try self.writeStr(op);
                try self.space();
                // guard token merges like `++`, `--`, `//` comment, `<!--`. a
                // wrapped right operand starts with `(` and cannot merge
                if (!self.pretty() and op.len == 1 and !self.needsParens(e.right, right_ctx)) {
                    switch (op[0]) {
                        '+', '-', '/' => if (leftmostByteIs(self.tree, e.right, op[0])) {
                            try self.writeByte(' ');
                        },
                        '<' => if (leftmostByteIs(self.tree, e.right, '!')) {
                            try self.writeByte(' ');
                        },
                        else => {},
                    }
                }
            }
            try self.emitExpr(e.right, right_ctx);
        }

        fn emit_logical_expression(self: *Self, e: *const ast.LogicalExpression, ctx: Ctx) Error!void {
            const no_in = ctx.no_in;
            const tok = e.operator.toToken();
            const p: u8 = tok.precedence();
            try self.emitLogicalOperand(e.left, p, e.operator, no_in);
            try self.space();
            try self.writeStr(tok.toString().?);
            try self.space();
            try self.emitLogicalOperand(e.right, p + 1, e.operator, no_in);
        }

        fn emitLogicalOperand(self: *Self, child: NodeIndex, min: u8, parent: ast.LogicalOperator, no_in: bool) Error!void {
            const prec = if (logicalMismatch(self.tree, parent, self.stripped(child))) Precedence.Grouping else min;
            try self.emitExpr(child, .{ .prec = prec, .no_in = no_in });
        }

        fn emit_conditional_expression(self: *Self, e: *const ast.ConditionalExpression, ctx: Ctx) Error!void {
            const no_in = ctx.no_in;
            try self.emitExpr(e.@"test", .{ .prec = Precedence.LogicalOr, .no_in = no_in });
            try self.space();
            try self.writeByte('?');
            try self.space();
            try self.emitExpr(e.consequent, .{ .prec = Precedence.Assignment });
            try self.space();
            try self.writeByte(':');
            try self.space();
            try self.emitExpr(e.alternate, .{ .prec = Precedence.Assignment, .no_in = no_in });
        }

        fn emit_unary_expression(self: *Self, e: *const ast.UnaryExpression) Error!void {
            const op = e.operator.toString();
            try self.writeStr(op);
            if (utils.isWordOp(op)) try self.writeByte(' ');
            // `+ +x` would print as `++x` and re-lex as a prefix update.
            if (op.len == 1 and (op[0] == '+' or op[0] == '-')) {
                if (leftmostByteIs(self.tree, e.argument, op[0])) try self.writeByte(' ');
            }
            try self.emitExpr(e.argument, .{ .prec = Precedence.Unary });
        }

        fn emit_update_expression(self: *Self, e: *const ast.UpdateExpression) Error!void {
            const op = e.operator.toString();
            if (e.prefix) {
                try self.writeStr(op);
                try self.emitAssignTarget(e.argument);
            } else {
                try self.emitAssignTarget(e.argument);
                try self.writeStr(op);
            }
        }

        fn emit_assignment_expression(self: *Self, e: *const ast.AssignmentExpression, ctx: Ctx) Error!void {
            try self.emitAssignTarget(e.left);
            try self.separateBangFromAssign();
            try self.space();
            try self.writeStr(e.operator.toString());
            try self.space();
            try self.emitExpr(e.right, .{ .prec = Precedence.Assignment, .no_in = ctx.no_in });
        }

        /// `x!=…` would re-lex `!` (non-null assertion) into `!=`. pad if needed.
        inline fn separateBangFromAssign(self: *Self) Error!void {
            if (self.pretty()) return;
            if (self.lastByte() == '!') try self.writeByte(' ');
        }

        /// emits `idx` as an assignment/destructuring target, wrapping a bare
        /// ts `as`/`satisfies`/type-assertion in parens (the parser elides
        /// them, the grammar doesn't).
        fn emitAssignTarget(self: *Self, idx: NodeIndex) Error!void {
            if (idx == .null) return;
            const prev = self.in_assign_target;
            defer self.in_assign_target = prev;

            if (needsParensAsAssignTarget(self.tree, idx)) {
                self.in_assign_target = false;
                try self.writeByte('(');
                try self.emit(idx);
                try self.writeByte(')');
            } else {
                self.in_assign_target = true;
                try self.emit(idx);
            }
        }

        inline fn emitChildOfAssignTarget(self: *Self, idx: NodeIndex) Error!void {
            if (self.in_assign_target) try self.emitAssignTarget(idx) else try self.emitValue(idx);
        }

        /// Emits an element-slot expression (argument, array element, property
        /// value, default), an AssignmentExpression, so a comma sequence wraps.
        inline fn emitValue(self: *Self, idx: NodeIndex) Error!void {
            try self.emitExpr(idx, .{ .prec = Precedence.Assignment });
        }

        fn emit_array_expression(self: *Self, e: *const ast.ArrayExpression) Error!void {
            const in_target = self.in_assign_target;
            self.in_assign_target = false;
            defer self.in_assign_target = in_target;

            try self.writeByte('[');
            const list = self.tree.extra(e.elements);
            for (list, 0..) |x, i| {
                if (i > 0) try self.comma();
                if (in_target) try self.emitAssignTarget(x) else try self.emitValue(x);
            }
            // a trailing hole needs its own comma, else `[a,]` is one element
            if (list.len > 0 and list[list.len - 1] == .null) try self.writeByte(',');
            try self.writeByte(']');
        }

        fn emit_object_expression(self: *Self, e: *const ast.ObjectExpression) Error!void {
            // re-set per-property so a value's recursion can't strip the flag
            // from later siblings.
            const in_target = self.in_assign_target;
            defer self.in_assign_target = in_target;

            try self.writeByte('{');
            const list = self.tree.extra(e.properties);
            if (list.len > 0) {
                try self.space();
                for (list, 0..) |x, i| {
                    if (i > 0) try self.comma();
                    self.in_assign_target = in_target;
                    try self.emit(x);
                }
                try self.space();
            }
            try self.writeByte('}');
        }

        fn emit_object_property(self: *Self, p: *const ast.ObjectProperty) Error!void {
            if (p.method or p.kind == .get or p.kind == .set) {
                const fn_data = self.nodeData(p.value).function;
                if (p.kind == .get) {
                    try self.writeStr("get ");
                } else if (p.kind == .set) {
                    try self.writeStr("set ");
                } else {
                    if (fn_data.async) try self.writeStr("async ");
                    if (fn_data.generator) try self.writeByte('*');
                }
                try self.printObjectKey(p.key, p.computed);
                try self.printFunctionAsMethod(fn_data);
                return;
            }

            if (p.shorthand and shorthandStillValid(self.tree, p.key, p.value)) {
                try self.emitChildOfAssignTarget(p.value);
                return;
            }

            try self.printObjectKey(p.key, p.computed);
            try self.writeByte(':');
            try self.space();
            try self.emitChildOfAssignTarget(p.value);
        }

        fn emit_spread_element(self: *Self, s: *const ast.SpreadElement) Error!void {
            try self.writeStr("...");
            try self.emitValue(s.argument);
        }

        fn emit_member_expression(self: *Self, e: *const ast.MemberExpression, ctx: Ctx) Error!void {
            const head_start = self.mark();
            try self.emitExpr(e.object, .{ .prec = Precedence.Call, .no_call = ctx.no_call });

            // `obj["foo"]` → `obj.foo` when the key names a valid identifier.
            const static_key: ?[]const u8 = if (comptime minify_mode)
                (if (e.computed) simpleStringKey(self.tree, e.property) else null)
            else
                null;

            if (e.computed and static_key == null) {
                if (e.optional) try self.writeStr("?.");
                try self.writeByte('[');
                try self.emit(e.property);
                try self.writeByte(']');
            } else {
                // a bare integer head would eat the member `.` as a fraction dot.
                // pretty pads (`1 .x`, keeping `raw`), compact doubles it (`1..x`)
                const head = self.code.items[head_start..];
                if (!e.optional and isBareIntegerHead(head))
                    try self.writeByte(if (self.pretty()) ' ' else '.');
                try self.writeStr(if (e.optional) "?." else ".");
                if (static_key) |k| try self.writeStr(k) else try self.emit(e.property);
            }
        }

        fn emit_call_expression(self: *Self, e: *const ast.CallExpression) Error!void {
            try self.emitExpr(e.callee, .{ .prec = Precedence.Call });
            if (e.optional) try self.writeStr("?.");
            try self.emit(e.type_arguments);
            try self.printArgList(e.arguments);
        }

        fn emit_chain_expression(self: *Self, e: *const ast.ChainExpression, ctx: Ctx) Error!void {
            try self.emitExpr(e.expression, ctx);
        }

        fn emit_new_expression(self: *Self, e: *const ast.NewExpression) Error!void {
            try self.writeStr("new ");
            try self.emitExpr(e.callee, .{ .prec = Precedence.New, .no_call = true });
            try self.emit(e.type_arguments);
            try self.printArgList(e.arguments);
        }

        fn emit_tagged_template_expression(
            self: *Self,
            e: *const ast.TaggedTemplateExpression,
            ctx: Ctx,
        ) Error!void {
            try self.emitExpr(e.tag, .{ .prec = Precedence.Call, .no_call = ctx.no_call });
            try self.emit(e.type_arguments);
            try self.emit(e.quasi);
        }

        fn emit_await_expression(self: *Self, e: *const ast.AwaitExpression) Error!void {
            try self.writeStr("await ");
            try self.emitExpr(e.argument, .{ .prec = Precedence.Unary });
        }

        fn emit_yield_expression(self: *Self, e: *const ast.YieldExpression) Error!void {
            try self.writeStr("yield");
            if (e.delegate) try self.writeByte('*');
            try self.emitRestrictedArg(e.argument, Precedence.Assignment);
        }

        fn emit_meta_property(self: *Self, p: *const ast.MetaProperty) Error!void {
            try self.emit(p.meta);
            try self.writeByte('.');
            try self.emit(p.property);
        }

        fn printArgList(self: *Self, args: IndexRange) Error!void {
            try self.writeByte('(');
            for (self.tree.extra(args), 0..) |x, i| {
                if (i > 0) try self.comma();
                try self.emitValue(x);
            }
            try self.writeByte(')');
        }

        fn emit_string_literal(self: *Self, lit: *const ast.StringLiteral) Error!void {
            const raw = self.tree.string(lit.raw);
            const single_quoted = raw.len != 0 and raw[0] == '\'';
            try self.emitQuoted(self.tree.string(lit.value), single_quoted);
        }

        fn emitStringLit(self: *Self, value: ast.String) Error!void {
            try self.emitQuoted(self.tree.string(value), false);
        }

        fn emitQuoted(self: *Self, s: []const u8, single_quoted: bool) Error!void {
            const q = self.pickQuote(s, single_quoted);
            try self.writeByte(q);
            try self.writeEscapedString(s, q);
            try self.writeByte(q);
        }

        /// In minify mode, picks the quote that needs fewer escapes for `s`.
        /// Otherwise `.preserve` keeps the source's quote style (`single_quoted`)
        /// and `.single` / `.double` force that quote.
        inline fn pickQuote(self: *const Self, s: []const u8, single_quoted: bool) u8 {
            if (comptime minify_mode) {
                const single = std.mem.count(u8, s, "'");
                const double = std.mem.count(u8, s, "\"");
                if (single == double) return if (self.options.quotes == .single) '\'' else '"';
                return if (double < single) '"' else '\'';
            }
            return switch (self.options.quotes) {
                .preserve => if (single_quoted) '\'' else '"',
                .single => '\'',
                .double => '"',
            };
        }

        fn writeEscapedString(self: *Self, s: []const u8, quote: u8) Error!void {
            var start: usize = 0;
            var i: usize = 0;
            while (i < s.len) : (i += 1) {
                const c = s[i];
                if (c >= 0x80) {
                    if (c == 0xED) {
                        if (util.Utf.loneSurrogateAt(s, i)) |cp| {
                            if (i > start) try self.writeStr(s[start..i]);
                            try self.writeUnicodeEscape(cp);
                            i += 2;
                            start = i + 1;
                        }
                    }
                    continue;
                }
                const esc: ?[]const u8 = blk: {
                    // keep minified output safe to inline in a `<script>` tag
                    if (comptime minify_mode) {
                        if (utils.scriptEscape(s, i)) |e| break :blk e;
                    }
                    break :blk switch (c) {
                        '\\' => "\\\\",
                        '\n' => "\\n",
                        '\r' => "\\r",
                        '\t' => "\\t",
                        0x08 => "\\b",
                        0x0C => "\\f",
                        0x0B => "\\v",
                        0 => if (i + 1 < s.len and std.ascii.isDigit(s[i + 1])) "\\x00" else "\\0",
                        else => if (c == quote) (if (quote == '"') "\\\"" else "\\'") else null,
                    };
                };
                if (esc) |e| {
                    if (i > start) try self.writeStr(s[start..i]);
                    try self.writeStr(e);
                    start = i + 1;
                }
            }
            if (start < s.len) try self.writeStr(s[start..]);
        }

        /// writes `\uXXXX` for a 16-bit code unit
        fn writeUnicodeEscape(self: *Self, cp: u32) Error!void {
            const hex = "0123456789abcdef";
            const buf = [_]u8{
                '\\',                  'u',
                hex[(cp >> 12) & 0xF], hex[(cp >> 8) & 0xF],
                hex[(cp >> 4) & 0xF],  hex[cp & 0xF],
            };
            try self.writeStr(&buf);
        }

        fn emit_numeric_literal(self: *Self, lit: *const ast.NumericLiteral) Error!void {
            if (comptime minify_mode) {
                try self.writeShortestNumber(lit.*);
            } else {
                try self.writeString(lit.raw);
            }
        }

        fn writeShortestNumber(self: *Self, lit: ast.NumericLiteral) Error!void {
            const raw = self.tree.string(lit.raw);
            var src_buf: [128]u8 = undefined;
            const cleaned = utils.stripUnderscores(raw, &src_buf) orelse return self.writeStr(raw);
            if (lit.kind != .decimal) return self.writeStr(cleaned);

            var dst_buf: [128]u8 = undefined;
            try self.writeStr(utils.shortestDecimal(cleaned, &dst_buf));
        }

        fn emit_bigint_literal(self: *Self, lit: *const ast.BigIntLiteral) Error!void {
            try self.writeString(lit.raw);
            try self.writeByte('n');
        }

        fn emit_boolean_literal(self: *Self, lit: *const ast.BooleanLiteral) Error!void {
            if (comptime minify_mode) {
                try self.writeStr(if (lit.value) "!0" else "!1");
            } else {
                try self.writeStr(if (lit.value) "true" else "false");
            }
        }

        fn emit_regexp_literal(self: *Self, lit: *const ast.RegExpLiteral) Error!void {
            try self.writeByte('/');
            try self.writeString(lit.pattern);
            try self.writeByte('/');
            try self.writeString(lit.flags);
        }

        fn emit_template_literal(self: *Self, lit: *const ast.TemplateLiteral) Error!void {
            try self.printTemplate(lit.quasis, lit.expressions);
        }

        /// Emits a `` `…${…}…` `` template; `subs` are the expressions (value
        /// template) or types (type template) interleaved between `quasis`.
        fn printTemplate(self: *Self, quasis: IndexRange, subs: IndexRange) Error!void {
            try self.writeByte('`');
            const xs = self.tree.extra(subs);
            for (self.tree.extra(quasis), 0..) |q, i| {
                try self.emit(q);
                if (i < xs.len) {
                    try self.writeStr("${");
                    try self.emit(xs[i]);
                    try self.writeByte('}');
                }
            }
            try self.writeByte('`');
        }

        fn emit_template_element(self: *Self, el: *const ast.TemplateElement) Error!void {
            // print/strip emit the raw verbatim to keep the exact escapes (the
            // tag of a tagged template sees them). minify recomputes from cooked,
            // as do synthetic nodes with no raw.
            if (comptime !minify_mode) {
                const raw = self.tree.string(el.raw);
                if (raw.len != 0) return self.writeStr(raw);
            }
            const s = self.tree.string(el.cooked);
            var i: usize = 0;
            var start: usize = 0;
            while (i < s.len) : (i += 1) {
                const c = s[i];
                if (util.Utf.loneSurrogateAt(s, i)) |cp| {
                    if (i > start) try self.writeStr(s[start..i]);
                    try self.writeUnicodeEscape(cp);
                    i += 2;
                    start = i + 1;
                    continue;
                }
                const esc: ?[]const u8 = blk: {
                    // keep minified output safe to inline in a `<script>` tag
                    if (comptime minify_mode) {
                        if (utils.scriptEscape(s, i)) |e| break :blk e;
                    }
                    break :blk switch (c) {
                        '\\' => "\\\\",
                        '`' => "\\`",
                        '$' => if (i + 1 < s.len and s[i + 1] == '{') "\\$" else null,
                        '\r' => "\\r",
                        0 => if (i + 1 < s.len and std.ascii.isDigit(s[i + 1])) "\\x00" else "\\0",
                        else => null,
                    };
                };
                if (esc) |e| {
                    if (i > start) try self.writeStr(s[start..i]);
                    try self.writeStr(e);
                    start = i + 1;
                }
            }
            if (start < s.len) try self.writeStr(s[start..]);
        }

        fn emit_identifier_reference(self: *Self, id: *const ast.IdentifierReference) Error!void {
            if (comptime minify_mode) {
                if (!self.in_assign_target) {
                    const name = self.tree.string(id.name);
                    if (std.mem.eql(u8, name, "undefined")) return self.writeStr("void 0");
                    if (std.mem.eql(u8, name, "Infinity")) return self.writeStr("1/0");
                }
            }
            try self.writeString(id.name);
        }

        fn emit_identifier_name(self: *Self, id: *const ast.IdentifierName) Error!void {
            try self.writeString(id.name);
        }

        fn emit_binding_identifier(self: *Self, id: *const ast.BindingIdentifier) Error!void {
            const definite = self.takeDefinite();
            if (comptime !strip_ts) try self.printDecorators(id.decorators);
            try self.writeString(id.name);
            try self.printBindingSuffix(id.optional, definite, id.type_annotation);
        }

        fn emit_label_identifier(self: *Self, id: *const ast.LabelIdentifier) Error!void {
            try self.writeString(id.name);
        }

        fn emit_private_identifier(self: *Self, id: *const ast.PrivateIdentifier) Error!void {
            try self.writeByte('#');
            try self.writeString(id.name);
        }

        fn emit_assignment_pattern(self: *Self, p: *const ast.AssignmentPattern) Error!void {
            if (comptime !strip_ts) try self.printDecorators(p.decorators);
            try self.emit(p.left);
            if (comptime !strip_ts) if (p.optional) try self.writeByte('?');
            try self.emit(p.type_annotation);
            try self.separateBangFromAssign();
            try self.printEq();
            try self.emitValue(p.right);
        }

        fn emit_binding_rest_element(self: *Self, r: *const ast.BindingRestElement) Error!void {
            if (comptime !strip_ts) try self.printDecorators(r.decorators);
            try self.writeStr("...");
            try self.emit(r.argument);
            if (comptime !strip_ts) if (r.optional) try self.writeByte('?');
            try self.emit(r.type_annotation);
        }

        fn emit_array_pattern(self: *Self, p: *const ast.ArrayPattern) Error!void {
            const definite = self.takeDefinite();
            if (comptime !strip_ts) try self.printDecorators(p.decorators);
            try self.writeByte('[');
            const list = self.tree.extra(p.elements);
            for (list, 0..) |x, i| {
                if (i > 0) try self.comma();
                try self.emitAssignTarget(x);
            }
            if (p.rest != .null) {
                if (list.len > 0) try self.comma();
                try self.emit(p.rest);
            } else if (list.len > 0 and list[list.len - 1] == .null) {
                // a trailing hole needs its own comma, else `[a,]` is one element
                try self.writeByte(',');
            }
            try self.writeByte(']');
            try self.printBindingSuffix(p.optional, definite, p.type_annotation);
        }

        fn emit_object_pattern(self: *Self, p: *const ast.ObjectPattern) Error!void {
            const definite = self.takeDefinite();
            if (comptime !strip_ts) try self.printDecorators(p.decorators);
            try self.writeByte('{');
            const list = self.tree.extra(p.properties);
            const has_any = list.len > 0 or p.rest != .null;
            if (has_any) try self.space();
            for (list, 0..) |x, i| {
                if (i > 0) try self.comma();
                try self.emit(x);
            }
            if (p.rest != .null) {
                if (list.len > 0) try self.comma();
                try self.emit(p.rest);
            }
            if (has_any) try self.space();
            try self.writeByte('}');
            try self.printBindingSuffix(p.optional, definite, p.type_annotation);
        }

        fn emit_binding_property(self: *Self, p: *const ast.BindingProperty) Error!void {
            if (p.shorthand and shorthandStillValid(self.tree, p.key, p.value)) {
                try self.emitAssignTarget(p.value);
                return;
            }
            try self.printObjectKey(p.key, p.computed);
            try self.writeByte(':');
            try self.space();
            try self.emitAssignTarget(p.value);
        }

        fn printPropertyKey(self: *Self, key: NodeIndex, computed: bool) Error!void {
            if (computed) {
                try self.writeByte('[');
                try self.emitValue(key);
                try self.writeByte(']');
            } else {
                try self.emit(key);
            }
        }

        fn printObjectKey(self: *Self, key: NodeIndex, computed: bool) Error!void {
            if (comptime minify_mode) {
                if (simpleStringKey(self.tree, key)) |s| return self.writeStr(s);
            }
            try self.printPropertyKey(key, computed);
        }

        /// class member key. non-computed string keys collapse to bare
        /// identifiers the same way object keys do. computed `["…"]` collapses
        /// are gated to avoid the cases ECMA reinterprets or rejects.
        ///   `["constructor"]` on a non-static method becomes the actual
        ///     constructor (different `kind`)
        ///   `["constructor"]` on a non-static get/set is a SyntaxError per ECMA
        ///   `["constructor"]` on a field is a SyntaxError per ECMA
        ///   `["prototype"]` on any static member is a SyntaxError per ECMA
        fn printClassKey(
            self: *Self,
            key: NodeIndex,
            computed: bool,
            static: bool,
            is_field: bool,
        ) Error!void {
            if (comptime minify_mode) {
                if (simpleStringKey(self.tree, key)) |s| {
                    if (!computed) return self.writeStr(s);
                    const ctor_clash = std.mem.eql(u8, s, "constructor") and (is_field or !static);
                    const proto_clash = static and std.mem.eql(u8, s, "prototype");
                    if (!ctor_clash and !proto_clash) return self.writeStr(s);
                }
            }
            try self.printPropertyKey(key, computed);
        }

        fn emit_function(self: *Self, f: *const ast.Function) Error!void {
            if (comptime strip_ts) {
                const is_ts_only = f.declare or
                    f.type == .ts_declare_function or
                    f.type == .ts_empty_body_function_expression;
                if (is_ts_only) return;
            }
            if (comptime !strip_ts) if (f.declare) try self.writeStr("declare ");
            if (f.async) try self.writeStr("async ");
            try self.writeStr("function");
            if (f.generator) try self.writeByte('*');
            if (f.id != .null) {
                try self.writeByte(' ');
                try self.emit(f.id);
            }
            try self.printFunctionAsMethod(f.*);
        }

        fn printFunctionAsMethod(self: *Self, f: ast.Function) Error!void {
            try self.emit(f.type_parameters);
            try self.emit(f.params);
            try self.emit(f.return_type);
            if (f.body != .null) {
                try self.space();
                try self.emit(f.body);
            } else if (comptime !strip_ts) {
                try self.softSemi();
            }
        }

        fn emit_arrow_function_expression(self: *Self, a: *const ast.ArrowFunctionExpression) Error!void {
            if (a.async) try self.writeStr("async ");
            try self.emit(a.type_parameters);
            try self.emit(a.params);
            try self.emit(a.return_type);
            try self.space();
            try self.writeStr("=>");
            try self.space();
            if (a.expression) {
                self.at_lead = .arrow;
                try self.emitExpr(a.body, .{ .prec = Precedence.Assignment });
            } else {
                try self.emit(a.body);
            }
        }

        fn emit_formal_parameters(self: *Self, params: *const ast.FormalParameters) Error!void {
            try self.writeByte('(');
            const list = self.tree.extra(params.items);
            var first = true;
            for (list) |p| first = (try self.emitSeparated(p, first));
            if (params.rest != .null) _ = try self.emitSeparated(params.rest, first);
            try self.writeByte(')');
        }

        /// writes `, ` then emits `idx`. rolls back the separator if emit
        /// produced no output. returns the new value of `first`.
        fn emitSeparated(self: *Self, idx: NodeIndex, first: bool) Error!bool {
            const cur = self.cursor();
            if (!first) {
                try self.writeByte(',');
                try self.space();
            }
            if (try self.tryEmit(idx)) return false;
            self.restore(cur);
            return first;
        }

        fn emit_formal_parameter(self: *Self, p: *const ast.FormalParameter) Error!void {
            try self.emit(p.pattern);
        }

        fn emit_class(self: *Self, c: *const ast.Class) Error!void {
            if (comptime strip_ts) if (c.declare) return;
            try self.printDecorators(c.decorators);
            if (comptime !strip_ts) {
                if (c.declare) try self.writeStr("declare ");
                if (c.abstract) try self.writeStr("abstract ");
            }
            try self.writeStr("class");
            if (c.id != .null) {
                try self.writeByte(' ');
                try self.emit(c.id);
            }
            try self.emit(c.type_parameters);
            if (c.super_class != .null) {
                try self.writeStr(" extends ");
                try self.emitExpr(c.super_class, .{ .prec = Precedence.Call });
                try self.emit(c.super_type_arguments);
            }
            if (comptime !strip_ts) {
                if (self.tree.extra(c.implements).len > 0) {
                    try self.writeStr(" implements ");
                    try self.emitList(c.implements);
                }
            }
            try self.space();
            try self.emit(c.body);
        }

        fn emit_class_body(self: *Self, b: *const ast.ClassBody) Error!void {
            try self.writeByte('{');
            self.indent_depth += 1;
            var any = false;
            for (self.tree.extra(b.body)) |m| {
                const cur = self.cursor();
                const saved_semi = self.pending_semi;
                try self.flushSemi();
                try self.newline();
                if (try self.tryEmit(m)) {
                    any = true;
                } else {
                    self.restore(cur);
                    self.pending_semi = saved_semi;
                }
            }
            self.indent_depth -= 1;
            if (any) {
                self.pending_semi = false;
                try self.newline();
            } else if (self.options.comments != .none) {
                // no member emitted, but the empty body may still hold comments
                try self.emitInsideComments(self.current_idx);
            }
            try self.writeByte('}');
        }

        fn emit_method_definition(self: *Self, m: *const ast.MethodDefinition) Error!void {
            const fn_data = self.nodeData(m.value).function;
            if (comptime strip_ts) if (m.abstract or fn_data.body == .null) return;
            try self.printDecorators(m.decorators);
            try self.hoistKeyComments(m.key);
            defer self.skip_leading_of = .null;
            if (comptime !strip_ts) if (m.accessibility != .none) {
                try self.writeStr(m.accessibility.toString());
                try self.writeByte(' ');
            };
            if (m.static) try self.writeStr("static ");
            if (comptime !strip_ts) {
                if (m.abstract) try self.writeStr("abstract ");
                if (m.override) try self.writeStr("override ");
            }
            switch (m.kind) {
                .get => try self.writeStr("get "),
                .set => try self.writeStr("set "),
                .constructor, .method => {
                    if (fn_data.async) try self.writeStr("async ");
                    if (fn_data.generator) try self.writeByte('*');
                },
            }
            try self.printClassKey(m.key, m.computed, m.static, false);
            if (comptime !strip_ts) if (m.optional) try self.writeByte('?');
            try self.printFunctionAsMethod(fn_data);
        }

        fn emit_property_definition(self: *Self, p: *const ast.PropertyDefinition) Error!void {
            if (comptime strip_ts) if (p.declare or p.abstract) return;
            try self.printDecorators(p.decorators);
            try self.hoistKeyComments(p.key);
            defer self.skip_leading_of = .null;
            if (comptime !strip_ts) {
                if (p.declare) try self.writeStr("declare ");
                if (p.accessibility != .none) {
                    try self.writeStr(p.accessibility.toString());
                    try self.writeByte(' ');
                }
            }
            if (p.static) try self.writeStr("static ");
            if (comptime !strip_ts) {
                if (p.abstract) try self.writeStr("abstract ");
                if (p.override) try self.writeStr("override ");
                if (p.readonly) try self.writeStr("readonly ");
            }
            if (p.accessor) try self.writeStr("accessor ");
            try self.printClassKey(p.key, p.computed, p.static, true);
            if (comptime !strip_ts) {
                if (p.optional) try self.writeByte('?');
                if (p.definite) try self.writeByte('!');
            }
            try self.emit(p.type_annotation);
            if (p.value != .null) {
                try self.printEq();
                try self.emitValue(p.value);
            }
            try self.softSemi();
        }

        fn emit_decorator(self: *Self, d: *const ast.Decorator) Error!void {
            try self.writeByte('@');
            // a non-simple decorator like `@(x!)` must wrap
            try self.emitExpr(d.expression, .{ .prec = if (self.decoratorIsSimple(d.expression)) Precedence.Lowest else Precedence.Grouping });
        }

        fn decoratorIsSimple(self: *const Self, idx: NodeIndex) bool {
            return switch (self.nodeData(idx)) {
                .identifier_reference => true,
                .member_expression => |m| !m.computed and self.decoratorIsSimple(m.object),
                .call_expression => |c| self.decoratorIsSimple(c.callee),
                else => false,
            };
        }

        fn printDecorators(self: *Self, decs: IndexRange) Error!void {
            const list = self.tree.extra(decs);
            if (list.len == 0) return;
            // capture the parent node's mapping before decorator content
            // writes its own and re-record it after, so the text that
            // follows the decorators still maps back to the parent.
            const carry: ?sourcemap.Segment = if (comptime source_maps) (if (self.sm) |*sm| sm.lastMapping() else null) else null;
            for (list, 0..) |d, i| {
                try self.emit(d);
                // `@a.b class` would fuse to `@a.bclass` without a separator.
                if (self.pretty()) {
                    try self.newline();
                } else if (i + 1 == list.len) {
                    try self.writeByte(' ');
                }
            }
            if (comptime source_maps) if (carry) |c| if (self.sm) |*sm| {
                try sm.record(self.allocator, c.orig_line, c.orig_col);
            };
        }

        fn emit_import_declaration(self: *Self, d: *const ast.ImportDeclaration) Error!void {
            const list = self.tree.extra(d.specifiers);
            if (comptime strip_ts) {
                if (d.import_kind == .type) return;
                if (list.len > 0 and !hasValueImportSpecifier(self.tree, list)) return;
            }

            try self.writeStr("import");
            if (d.import_kind == .type) try self.writeStr(" type");
            if (d.phase) |ph| {
                try self.writeByte(' ');
                try self.writeStr(switch (ph) {
                    .source => "source",
                    .@"defer" => "defer",
                });
            }

            if (list.len > 0) {
                try self.writeByte(' ');
                var i: usize = 0;
                if (self.nodeData(list[0]) == .import_default_specifier) {
                    try self.emit(list[0]);
                    i = 1;
                }
                if (i < list.len) {
                    if (i > 0) try self.comma();
                    if (self.nodeData(list[i]) == .import_namespace_specifier) {
                        try self.emit(list[i]);
                    } else {
                        try self.writeByte('{');
                        try self.space();
                        var first = true;
                        while (i < list.len) : (i += 1) {
                            first = try self.emitSeparated(list[i], first);
                        }
                        try self.space();
                        try self.writeByte('}');
                    }
                }
                try self.writeStr(" from ");
            } else {
                try self.writeByte(' ');
            }

            try self.emit(d.source);
            try self.printAttributes(d.attributes);
            try self.softSemi();
        }

        fn emit_import_specifier(self: *Self, s: *const ast.ImportSpecifier) Error!void {
            if (comptime strip_ts) if (s.import_kind == .type) return;
            if (s.import_kind == .type) try self.writeStr("type ");
            try self.emit(s.imported);
            if (!sameIdentifier(self.tree, s.imported, s.local)) {
                try self.writeStr(" as ");
                try self.emit(s.local);
            }
        }

        fn emit_import_default_specifier(self: *Self, s: *const ast.ImportDefaultSpecifier) Error!void {
            try self.emit(s.local);
        }

        fn emit_import_namespace_specifier(
            self: *Self,
            s: *const ast.ImportNamespaceSpecifier,
        ) Error!void {
            try self.writeStr("* as ");
            try self.emit(s.local);
        }

        fn emit_import_attribute(self: *Self, a: *const ast.ImportAttribute) Error!void {
            try self.emit(a.key);
            try self.writeByte(':');
            try self.space();
            try self.emit(a.value);
        }

        fn emit_import_expression(self: *Self, e: *const ast.ImportExpression) Error!void {
            try self.writeStr("import");
            if (e.phase) |ph| {
                try self.writeByte('.');
                try self.writeStr(switch (ph) {
                    .source => "source",
                    .@"defer" => "defer",
                });
            }
            try self.writeByte('(');
            try self.emitValue(e.source);
            if (e.options != .null) {
                try self.writeByte(',');
                try self.space();
                try self.emitValue(e.options);
            }
            try self.writeByte(')');
        }

        fn emit_export_named_declaration(self: *Self, d: *const ast.ExportNamedDeclaration) Error!void {
            if (comptime strip_ts) if (d.export_kind == .type) return;
            const list = self.tree.extra(d.specifiers);
            if (comptime strip_ts) {
                const no_value_specifiers = d.declaration == .null and list.len > 0 and
                    !hasValueExportSpecifier(self.tree, list);
                if (no_value_specifiers) return;
            }

            const cur = self.cursor();
            try self.writeStr("export");
            // for `export type Foo = …`, the declaration emits its own `type`.
            if (d.export_kind == .type and d.declaration == .null) try self.writeStr(" type");
            if (d.declaration != .null) {
                try self.writeByte(' ');
                if (!try self.tryEmit(d.declaration)) self.restore(cur);
                return;
            }
            try self.space();
            try self.writeByte('{');
            if (list.len > 0) {
                try self.space();
                var first = true;
                for (list) |s| first = try self.emitSeparated(s, first);
                try self.space();
            }
            try self.writeByte('}');
            if (d.source != .null) {
                try self.writeStr(" from ");
                try self.emit(d.source);
            }
            try self.printAttributes(d.attributes);
            try self.softSemi();
        }

        fn emit_export_default_declaration(
            self: *Self,
            d: *const ast.ExportDefaultDeclaration,
        ) Error!void {
            const cur = self.cursor();
            try self.writeStr("export default ");
            const data = self.nodeData(d.declaration);
            // a declaration may strip to nothing, so roll back the prefix
            const emitted = switch (data) {
                .function, .class, .ts_interface_declaration => try self.tryEmit(d.declaration),
                else => blk: {
                    try self.emitExpr(d.declaration, .{ .prec = Precedence.Assignment });
                    break :blk true;
                },
            };
            if (!emitted) {
                self.restore(cur);
                return;
            }
            // expression defaults need `;`, function/class declarations do not.
            switch (data) {
                .function, .class => {},
                else => try self.softSemi(),
            }
        }

        fn emit_export_all_declaration(self: *Self, d: *const ast.ExportAllDeclaration) Error!void {
            if (comptime strip_ts) if (d.export_kind == .type) return;
            try self.writeStr("export");
            if (d.export_kind == .type) try self.writeStr(" type");
            try self.writeStr(" *");
            if (d.exported != .null) {
                try self.writeStr(" as ");
                try self.emit(d.exported);
            }
            try self.writeStr(" from ");
            try self.emit(d.source);
            try self.printAttributes(d.attributes);
            try self.softSemi();
        }

        fn emit_export_specifier(self: *Self, s: *const ast.ExportSpecifier) Error!void {
            if (comptime strip_ts) if (s.export_kind == .type) return;
            if (s.export_kind == .type) try self.writeStr("type ");
            try self.emit(s.local);
            if (!sameIdentifier(self.tree, s.local, s.exported)) {
                try self.writeStr(" as ");
                try self.emit(s.exported);
            }
        }

        fn printAttributes(self: *Self, attrs: IndexRange) Error!void {
            const list = self.tree.extra(attrs);
            if (list.len == 0) return;
            try self.writeStr(" with ");
            try self.writeByte('{');
            try self.space();
            try self.emitList(attrs);
            try self.space();
            try self.writeByte('}');
        }

        fn emit_ts_type_annotation(self: *Self, t: *const ast.TSTypeAnnotation) Error!void {
            try self.writeByte(':');
            try self.space();
            try self.emit(t.type_annotation);
        }

        fn emit_ts_type_reference(self: *Self, t: *const ast.TSTypeReference) Error!void {
            try self.emitEntityName(t.type_name);
            try self.emit(t.type_arguments);
        }

        fn emit_ts_qualified_name(self: *Self, q: *const ast.TSQualifiedName) Error!void {
            try self.emitEntityName(q.left);
            try self.writeByte('.');
            try self.emitEntityName(q.right);
        }

        fn emit_ts_type_query(self: *Self, q: *const ast.TSTypeQuery) Error!void {
            try self.writeStr("typeof ");
            try self.emitEntityName(q.expr_name);
            try self.emit(q.type_arguments);
        }

        fn emit_ts_import_type(self: *Self, t: *const ast.TSImportType) Error!void {
            try self.writeStr("import(");
            try self.emit(t.source);
            if (t.options != .null) {
                try self.writeByte(',');
                try self.space();
                try self.emit(t.options);
            }
            try self.writeByte(')');
            if (t.qualifier != .null) {
                try self.writeByte('.');
                try self.emitEntityName(t.qualifier);
            }
            try self.emit(t.type_arguments);
        }

        /// emits `idx` as a TS entity name (Identifier | QualifiedName | this |
        /// ImportType). Suppresses `undefined`/`Infinity` rewrites that the
        /// expression-context emitter applies, since type queries and type
        /// references require a bare entity name.
        fn emitEntityName(self: *Self, idx: NodeIndex) Error!void {
            if (idx == .null) return;
            const data = self.nodeData(idx);
            switch (data) {
                .identifier_reference => |id| {
                    if (comptime source_maps) if (self.sm != null) try self.recordMapping(idx);
                    try self.writeString(id.name);
                },
                else => try self.emit(idx),
            }
        }

        fn emit_ts_type_parameter(self: *Self, p: *const ast.TSTypeParameter) Error!void {
            if (p.@"const") try self.writeStr("const ");
            if (p.in) try self.writeStr("in ");
            if (p.out) try self.writeStr("out ");
            try self.emit(p.name);
            if (p.constraint != .null) {
                try self.writeStr(" extends ");
                try self.emit(p.constraint);
            }
            if (p.default != .null) {
                try self.printEq();
                try self.emit(p.default);
            }
        }

        /// `<…>` comma-separated type parameter/argument list.
        fn printAngleList(self: *Self, params: IndexRange) Error!void {
            try self.writeByte('<');
            try self.emitList(params);
            try self.writeByte('>');
        }

        fn emit_ts_type_parameter_declaration(
            self: *Self,
            d: *const ast.TSTypeParameterDeclaration,
        ) Error!void {
            try self.printAngleList(d.params);
        }

        fn emit_ts_type_parameter_instantiation(
            self: *Self,
            d: *const ast.TSTypeParameterInstantiation,
        ) Error!void {
            try self.printAngleList(d.params);
        }

        fn emit_ts_literal_type(self: *Self, t: *const ast.TSLiteralType) Error!void {
            // in a type position `true`/`false` are literal types, not expressions:
            // the minify-mode `!0`/`!1` shorthand is invalid syntax here. emit the
            // keyword form directly and let everything else (string/number/bigint/
            // template) fall through to its normal emitter.
            switch (self.nodeData(t.literal)) {
                .boolean_literal => |b| try self.writeStr(if (b.value) "true" else "false"),
                else => try self.emit(t.literal),
            }
        }

        fn emit_ts_template_literal_type(self: *Self, t: *const ast.TSTemplateLiteralType) Error!void {
            try self.printTemplate(t.quasis, t.types);
        }

        fn emitType(self: *Self, idx: NodeIndex, floor: u8) Error!void {
            try self.wrapIf(self.typePrec(idx) < floor, idx);
        }

        fn typePrec(self: *const Self, idx: NodeIndex) u8 {
            return switch (self.nodeData(idx)) {
                .ts_function_type, .ts_constructor_type, .ts_conditional_type, .ts_infer_type => TPrec.trailing,
                .ts_union_type => TPrec.@"union",
                .ts_intersection_type => TPrec.intersection,
                .ts_type_operator => TPrec.operator,
                else => TPrec.primary,
            };
        }

        fn emit_ts_array_type(self: *Self, t: *const ast.TSArrayType) Error!void {
            try self.emitType(t.element_type, TPrec.primary);
            try self.writeStr("[]");
        }

        fn emit_ts_indexed_access_type(self: *Self, t: *const ast.TSIndexedAccessType) Error!void {
            try self.emitType(t.object_type, TPrec.primary);
            try self.writeByte('[');
            try self.emit(t.index_type);
            try self.writeByte(']');
        }

        fn emit_ts_tuple_type(self: *Self, t: *const ast.TSTupleType) Error!void {
            try self.writeByte('[');
            try self.emitList(t.element_types);
            try self.writeByte(']');
        }

        fn emit_ts_named_tuple_member(self: *Self, m: *const ast.TSNamedTupleMember) Error!void {
            try self.emit(m.label);
            if (m.optional) try self.writeByte('?');
            try self.writeByte(':');
            try self.space();
            try self.emit(m.element_type);
        }

        fn emit_ts_optional_type(self: *Self, t: *const ast.TSOptionalType) Error!void {
            try self.emitType(t.type_annotation, TPrec.primary);
            try self.writeByte('?');
        }

        fn emit_ts_rest_type(self: *Self, t: *const ast.TSRestType) Error!void {
            try self.writeStr("...");
            try self.emit(t.type_annotation);
        }

        fn emit_ts_jsdoc_nullable_type(self: *Self, t: *const ast.TSJSDocNullableType) Error!void {
            if (t.postfix) {
                try self.emit(t.type_annotation);
                try self.writeByte('?');
            } else {
                try self.writeByte('?');
                try self.emit(t.type_annotation);
            }
        }

        fn emit_ts_jsdoc_non_nullable_type(self: *Self, t: *const ast.TSJSDocNonNullableType) Error!void {
            if (t.postfix) {
                try self.emit(t.type_annotation);
                try self.writeByte('!');
            } else {
                try self.writeByte('!');
                try self.emit(t.type_annotation);
            }
        }

        fn emit_ts_union_type(self: *Self, t: *const ast.TSUnionType) Error!void {
            try self.emitTypeList(t.types, '|');
        }

        fn emit_ts_intersection_type(self: *Self, t: *const ast.TSIntersectionType) Error!void {
            try self.emitTypeList(t.types, '&');
        }

        /// emits a `|`- or `&`-separated type list. a single-member list only
        /// comes from a leading operator (`type X = | A`), re-emitted so reparse
        /// keeps the union/intersection wrapper instead of collapsing to `A`
        fn emitTypeList(self: *Self, types: IndexRange, comptime op: u8) Error!void {
            const list = self.tree.extra(types);
            if (list.len == 1) {
                try self.writeByte(op);
                try self.space();
            }
            const floor: u8 = if (op == '|') TPrec.intersection else TPrec.operator;
            for (list, 0..) |x, i| {
                if (i > 0) {
                    try self.space();
                    try self.writeByte(op);
                    try self.space();
                }
                try self.emitType(x, floor);
            }
        }

        fn emit_ts_conditional_type(self: *Self, t: *const ast.TSConditionalType) Error!void {
            try self.emitType(t.check_type, TPrec.@"union");
            try self.writeStr(" extends ");
            try self.emitType(t.extends_type, TPrec.@"union");
            try self.space();
            try self.writeByte('?');
            try self.space();
            try self.emit(t.true_type);
            try self.space();
            try self.writeByte(':');
            try self.space();
            try self.emit(t.false_type);
        }

        fn emit_ts_infer_type(self: *Self, t: *const ast.TSInferType) Error!void {
            try self.writeStr("infer ");
            try self.emit(t.type_parameter);
        }

        fn emit_ts_type_operator(self: *Self, t: *const ast.TSTypeOperator) Error!void {
            try self.writeStr(t.operator.toString());
            try self.writeByte(' ');
            try self.emitType(t.type_annotation, TPrec.operator);
        }

        fn emit_ts_parenthesized_type(self: *Self, t: *const ast.TSParenthesizedType) Error!void {
            try self.writeByte('(');
            try self.emit(t.type_annotation);
            try self.writeByte(')');
        }

        fn emit_ts_function_type(self: *Self, t: *const ast.TSFunctionType) Error!void {
            try self.printArrowType(t.type_parameters, t.params, t.return_type);
        }

        fn emit_ts_constructor_type(self: *Self, t: *const ast.TSConstructorType) Error!void {
            if (t.abstract) try self.writeStr("abstract ");
            try self.writeStr("new ");
            try self.printArrowType(t.type_parameters, t.params, t.return_type);
        }

        /// `<T>(params) => Return` shared by function and constructor types.
        fn printArrowType(self: *Self, type_parameters: NodeIndex, params: NodeIndex, return_type: NodeIndex) Error!void {
            try self.emit(type_parameters);
            try self.emit(params);
            try self.space();
            try self.writeStr("=>");
            try self.space();
            try self.emitUnwrappedType(return_type);
        }

        /// strips the `ts_type_annotation` wrapper before emitting. used for
        /// arrow-form return types and `is`-predicates where the wrapper's
        /// leading `:` would be wrong.
        fn emitUnwrappedType(self: *Self, idx: NodeIndex) Error!void {
            if (idx == .null) return;
            const data = self.nodeData(idx);
            if (data == .ts_type_annotation) {
                try self.emit(data.ts_type_annotation.type_annotation);
            } else {
                try self.emit(idx);
            }
        }

        fn emit_ts_type_predicate(self: *Self, t: *const ast.TSTypePredicate) Error!void {
            if (t.asserts) try self.writeStr("asserts ");
            try self.emit(t.parameter_name);
            if (t.type_annotation != .null) {
                try self.writeStr(" is ");
                try self.emitUnwrappedType(t.type_annotation);
            }
        }

        fn emit_ts_type_literal(self: *Self, t: *const ast.TSTypeLiteral) Error!void {
            try self.printSignatureBody(t.members);
        }

        fn emit_ts_mapped_type(self: *Self, t: *const ast.TSMappedType) Error!void {
            try self.writeByte('{');
            try self.space();
            try self.printMappedModifier(t.readonly, "readonly");
            try self.writeByte('[');
            try self.emit(t.key);
            try self.writeStr(" in ");
            try self.emit(t.constraint);
            if (t.name_type != .null) {
                try self.writeStr(" as ");
                try self.emit(t.name_type);
            }
            try self.writeByte(']');
            try self.printMappedOptional(t.optional);
            if (t.type_annotation != .null) {
                try self.writeByte(':');
                try self.space();
                try self.emit(t.type_annotation);
            }
            try self.softSemi();
            self.pending_semi = false;
            try self.space();
            try self.writeByte('}');
        }

        fn printMappedModifier(
            self: *Self,
            m: ast.TSMappedTypeModifier,
            keyword: []const u8,
        ) Error!void {
            switch (m) {
                .none => {},
                .true => {
                    try self.writeStr(keyword);
                    try self.writeByte(' ');
                },
                .plus => {
                    try self.writeByte('+');
                    try self.writeStr(keyword);
                    try self.writeByte(' ');
                },
                .minus => {
                    try self.writeByte('-');
                    try self.writeStr(keyword);
                    try self.writeByte(' ');
                },
            }
        }

        fn printMappedOptional(self: *Self, m: ast.TSMappedTypeModifier) Error!void {
            switch (m) {
                .none => {},
                .true => try self.writeByte('?'),
                .plus => try self.writeStr("+?"),
                .minus => try self.writeStr("-?"),
            }
        }

        fn emit_ts_property_signature(self: *Self, s: *const ast.TSPropertySignature) Error!void {
            if (s.readonly) try self.writeStr("readonly ");
            try self.printPropertyKey(s.key, s.computed);
            if (s.optional) try self.writeByte('?');
            if (s.type_annotation != .null) try self.emit(s.type_annotation);
            try self.softSemi();
        }

        fn emit_ts_method_signature(self: *Self, s: *const ast.TSMethodSignature) Error!void {
            switch (s.kind) {
                .get => try self.writeStr("get "),
                .set => try self.writeStr("set "),
                .method => {},
            }
            try self.printPropertyKey(s.key, s.computed);
            if (s.optional) try self.writeByte('?');
            try self.printSignatureTail(s.type_parameters, s.params, s.return_type);
        }

        /// `<T>(params): Return;` tail shared by call/construct/method signatures.
        fn printSignatureTail(self: *Self, type_parameters: NodeIndex, params: NodeIndex, return_type: NodeIndex) Error!void {
            try self.emit(type_parameters);
            try self.emit(params);
            if (return_type != .null) try self.emit(return_type);
            try self.softSemi();
        }

        fn emit_ts_call_signature_declaration(
            self: *Self,
            s: *const ast.TSCallSignatureDeclaration,
        ) Error!void {
            try self.printSignatureTail(s.type_parameters, s.params, s.return_type);
        }

        fn emit_ts_construct_signature_declaration(
            self: *Self,
            s: *const ast.TSConstructSignatureDeclaration,
        ) Error!void {
            try self.writeStr("new ");
            try self.printSignatureTail(s.type_parameters, s.params, s.return_type);
        }

        fn emit_ts_index_signature(self: *Self, s: *const ast.TSIndexSignature) Error!void {
            if (s.static) try self.writeStr("static ");
            if (s.readonly) try self.writeStr("readonly ");
            try self.writeByte('[');
            try self.emitList(s.parameters);
            try self.writeByte(']');
            try self.emit(s.type_annotation);
            try self.softSemi();
        }

        /// emits a `{ … }` block of ts signatures (type literal or interface body).
        fn printSignatureBody(self: *Self, items: IndexRange) Error!void {
            try self.writeByte('{');
            if (self.tree.extra(items).len > 0) {
                self.indent_depth += 1;
                for (self.tree.extra(items)) |s| {
                    try self.flushSemi();
                    try self.newline();
                    try self.emit(s);
                }
                self.indent_depth -= 1;
                self.pending_semi = false;
                try self.newline();
            }
            try self.writeByte('}');
        }

        fn emit_ts_type_alias_declaration(self: *Self, d: *const ast.TSTypeAliasDeclaration) Error!void {
            if (d.declare) try self.writeStr("declare ");
            try self.writeStr("type ");
            try self.emit(d.id);
            try self.emit(d.type_parameters);
            try self.printEq();
            // a leftmost bare `intrinsic` reference would reparse as the keyword
            try self.wrapIf(self.isLeftmostIntrinsicReference(d.type_annotation), d.type_annotation);
            try self.softSemi();
        }

        fn wrapIf(self: *Self, cond: bool, idx: NodeIndex) Error!void {
            if (cond) try self.writeByte('(');
            try self.emit(idx);
            if (cond) try self.writeByte(')');
        }

        /// Whether `idx`'s leftmost type is a bare `intrinsic` reference, distinct
        /// from the keyword.
        fn isLeftmostIntrinsicReference(self: *const Self, idx: NodeIndex) bool {
            return switch (self.nodeData(idx)) {
                .ts_type_reference => |r| r.type_arguments == .null and switch (self.nodeData(r.type_name)) {
                    .identifier_reference => |id| std.mem.eql(u8, self.tree.string(id.name), "intrinsic"),
                    else => false,
                },
                .ts_array_type => |a| self.isLeftmostIntrinsicReference(a.element_type),
                .ts_indexed_access_type => |a| self.isLeftmostIntrinsicReference(a.object_type),
                .ts_union_type => |u| self.firstTypeIsIntrinsic(u.types),
                .ts_intersection_type => |i| self.firstTypeIsIntrinsic(i.types),
                .ts_conditional_type => |c| self.isLeftmostIntrinsicReference(c.check_type),
                else => false,
            };
        }

        fn firstTypeIsIntrinsic(self: *const Self, types: IndexRange) bool {
            const list = self.tree.extra(types);
            return list.len > 0 and self.isLeftmostIntrinsicReference(list[0]);
        }

        fn emit_ts_interface_declaration(self: *Self, d: *const ast.TSInterfaceDeclaration) Error!void {
            if (d.declare) try self.writeStr("declare ");
            try self.writeStr("interface ");
            try self.emit(d.id);
            try self.emit(d.type_parameters);
            if (self.tree.extra(d.extends).len > 0) {
                try self.writeStr(" extends ");
                try self.emitList(d.extends);
            }
            try self.space();
            try self.emit(d.body);
        }

        fn emit_ts_interface_body(self: *Self, b: *const ast.TSInterfaceBody) Error!void {
            try self.printSignatureBody(b.body);
        }

        fn emit_ts_interface_heritage(self: *Self, h: *const ast.TSInterfaceHeritage) Error!void {
            try self.emit(h.expression);
            try self.emit(h.type_arguments);
        }

        fn emit_ts_class_implements(self: *Self, c: *const ast.TSClassImplements) Error!void {
            try self.emit(c.expression);
            try self.emit(c.type_arguments);
        }

        fn emit_ts_enum_declaration(self: *Self, d: *const ast.TSEnumDeclaration) Error!void {
            if (d.declare) try self.writeStr("declare ");
            if (d.is_const) try self.writeStr("const ");
            try self.writeStr("enum ");
            try self.emit(d.id);
            try self.space();
            try self.emit(d.body);
        }

        fn emit_ts_enum_body(self: *Self, b: *const ast.TSEnumBody) Error!void {
            try self.writeByte('{');
            const list = self.tree.extra(b.members);
            if (list.len > 0) {
                self.indent_depth += 1;
                for (list, 0..) |m, i| {
                    try self.newline();
                    try self.emit(m);
                    if (i < list.len - 1) try self.writeByte(',');
                }
                self.indent_depth -= 1;
                try self.newline();
            }
            try self.writeByte('}');
        }

        fn emit_ts_enum_member(self: *Self, m: *const ast.TSEnumMember) Error!void {
            if (m.computed) {
                try self.writeByte('[');
                try self.emit(m.id);
                try self.writeByte(']');
            } else {
                try self.emit(m.id);
            }
            if (m.initializer != .null) {
                try self.printEq();
                try self.emit(m.initializer);
            }
        }

        fn emit_ts_module_declaration(self: *Self, d: *const ast.TSModuleDeclaration) Error!void {
            if (d.declare) try self.writeStr("declare ");
            try self.writeStr(d.kind.toString());
            try self.writeByte(' ');
            // route through emitEntityName so the minify-mode `undefined ->
            // void 0` rewrite never fires on a declaration name.
            try self.emitEntityName(d.id);
            if (d.body != .null) {
                try self.space();
                try self.emit(d.body);
            } else {
                try self.softSemi();
            }
        }

        fn emit_ts_module_block(self: *Self, b: *const ast.TSModuleBlock) Error!void {
            try self.printBlock(b.body, false);
        }

        fn emit_ts_global_declaration(self: *Self, d: *const ast.TSGlobalDeclaration) Error!void {
            if (d.declare) try self.writeStr("declare ");
            try self.emitEntityName(d.id);
            try self.space();
            try self.emit(d.body);
        }

        fn emit_ts_as_expression(self: *Self, e: *const ast.TSAsExpression, ctx: Ctx) Error!void {
            try self.emitExpr(e.expression, .{ .prec = Precedence.Relational, .no_in = ctx.no_in });
            try self.writeStr(" as ");
            try self.emit(e.type_annotation);
        }

        fn emit_ts_satisfies_expression(self: *Self, e: *const ast.TSSatisfiesExpression, ctx: Ctx) Error!void {
            try self.emitExpr(e.expression, .{ .prec = Precedence.Relational, .no_in = ctx.no_in });
            try self.writeStr(" satisfies ");
            try self.emit(e.type_annotation);
        }

        fn emit_ts_type_assertion(self: *Self, e: *const ast.TSTypeAssertion) Error!void {
            try self.writeByte('<');
            // `<<T>` would re-lex as `<<` (left shift).
            if (typeStartsWithLeftAngle(self.tree, e.type_annotation)) try self.writeByte(' ');
            try self.emit(e.type_annotation);
            try self.writeByte('>');
            try self.emitExpr(e.expression, .{ .prec = Precedence.Unary });
        }

        fn emit_ts_non_null_expression(self: *Self, e: *const ast.TSNonNullExpression) Error!void {
            try self.emitExpr(e.expression, .{ .prec = Precedence.Postfix });
            try self.writeByte('!');
        }

        fn emit_ts_instantiation_expression(
            self: *Self,
            e: *const ast.TSInstantiationExpression,
        ) Error!void {
            try self.emitExpr(e.expression, .{ .prec = Precedence.Postfix });
            try self.emit(e.type_arguments);
        }

        fn emit_ts_export_assignment(self: *Self, e: *const ast.TSExportAssignment) Error!void {
            try self.writeStr("export");
            try self.printEq();
            try self.emit(e.expression);
            try self.softSemi();
        }

        fn emit_ts_namespace_export_declaration(
            self: *Self,
            d: *const ast.TSNamespaceExportDeclaration,
        ) Error!void {
            try self.writeStr("export as namespace ");
            try self.emit(d.id);
            try self.softSemi();
        }

        fn emit_ts_import_equals_declaration(
            self: *Self,
            d: *const ast.TSImportEqualsDeclaration,
        ) Error!void {
            try self.writeStr("import ");
            if (d.import_kind == .type) try self.writeStr("type ");
            try self.emit(d.id);
            try self.printEq();
            try self.emit(d.module_reference);
            try self.softSemi();
        }

        fn emit_ts_external_module_reference(
            self: *Self,
            r: *const ast.TSExternalModuleReference,
        ) Error!void {
            try self.writeStr("require(");
            try self.emit(r.expression);
            try self.writeByte(')');
        }

        fn emit_ts_parameter_property(self: *Self, p: *const ast.TSParameterProperty) Error!void {
            try self.printDecorators(p.decorators);
            if (p.accessibility != .none) {
                try self.writeStr(p.accessibility.toString());
                try self.writeByte(' ');
            }
            if (p.override) try self.writeStr("override ");
            if (p.readonly) try self.writeStr("readonly ");
            try self.emit(p.parameter);
        }

        fn emit_ts_this_parameter(self: *Self, p: *const ast.TSThisParameter) Error!void {
            try self.writeStr("this");
            if (p.type_annotation != .null) try self.emit(p.type_annotation);
        }

        fn emit_jsx_element(self: *Self, e: *const ast.JSXElement) Error!void {
            try self.emit(e.opening_element);
            for (self.tree.extra(e.children)) |c| try self.emit(c);
            if (e.closing_element != .null) try self.emit(e.closing_element);
        }

        fn emit_jsx_opening_element(self: *Self, o: *const ast.JSXOpeningElement) Error!void {
            try self.writeByte('<');
            try self.emit(o.name);
            try self.emit(o.type_arguments);
            for (self.tree.extra(o.attributes)) |a| {
                try self.writeByte(' ');
                try self.emit(a);
            }
            if (o.self_closing) {
                try self.space();
                try self.writeStr("/>");
            } else {
                try self.writeByte('>');
            }
        }

        fn emit_jsx_closing_element(self: *Self, c: *const ast.JSXClosingElement) Error!void {
            try self.writeStr("</");
            try self.emit(c.name);
            try self.writeByte('>');
        }

        fn emit_jsx_fragment(self: *Self, f: *const ast.JSXFragment) Error!void {
            try self.emit(f.opening_fragment);
            for (self.tree.extra(f.children)) |c| try self.emit(c);
            try self.emit(f.closing_fragment);
        }

        fn emit_jsx_identifier(self: *Self, id: *const ast.JSXIdentifier) Error!void {
            try self.writeString(id.name);
        }

        fn emit_jsx_namespaced_name(self: *Self, n: *const ast.JSXNamespacedName) Error!void {
            try self.emit(n.namespace);
            try self.writeByte(':');
            try self.emit(n.name);
        }

        fn emit_jsx_member_expression(self: *Self, m: *const ast.JSXMemberExpression) Error!void {
            try self.emit(m.object);
            try self.writeByte('.');
            try self.emit(m.property);
        }

        fn emit_jsx_attribute(self: *Self, a: *const ast.JSXAttribute) Error!void {
            try self.emit(a.name);
            if (a.value != .null) {
                try self.writeByte('=');
                // jsx attribute strings have no escape processing, so emit the
                // raw lexeme verbatim rather than re-escaping the cooked value
                switch (self.nodeData(a.value)) {
                    .string_literal => |lit| try self.writeString(lit.raw),
                    else => try self.emit(a.value),
                }
            }
        }

        fn emit_jsx_spread_attribute(self: *Self, a: *const ast.JSXSpreadAttribute) Error!void {
            try self.writeByte('{');
            try self.writeStr("...");
            try self.emit(a.argument);
            try self.writeByte('}');
        }

        fn emit_jsx_expression_container(self: *Self, c: *const ast.JSXExpressionContainer) Error!void {
            try self.writeByte('{');
            try self.emit(c.expression);
            try self.writeByte('}');
        }

        fn emit_jsx_empty_expression(_: *Self, _: *const ast.JSXEmptyExpression) Error!void {}

        fn emit_jsx_text(self: *Self, t: *const ast.JSXText) Error!void {
            try dialectPrintText(Self, self, self.tree.string(t.value));
        }

        fn emit_jsx_spread_child(self: *Self, c: *const ast.JSXSpreadChild) Error!void {
            try self.writeByte('{');
            try self.writeStr("...");
            try self.emit(c.expression);
            try self.writeByte('}');
        }
    };
}

fn leftmostByteIs(tree: *const Tree, idx: NodeIndex, byte: u8) bool {
    if (idx == .null) return false;
    return switch (tree.data(idx)) {
        .unary_expression => |u| switch (u.operator) {
            .positive => byte == '+',
            .negate => byte == '-',
            .logical_not => byte == '!',
            .bitwise_not => byte == '~',
            else => false, // typeof/void/delete start with a letter
        },
        .update_expression => |u| if (u.prefix) switch (u.operator) {
            .increment => byte == '+',
            .decrement => byte == '-',
        } else leftmostByteIs(tree, u.argument, byte),
        .regexp_literal => byte == '/',
        .member_expression => |m| leftmostByteIs(tree, m.object, byte),
        .call_expression => |c| leftmostByteIs(tree, c.callee, byte),
        .chain_expression => |c| leftmostByteIs(tree, c.expression, byte),
        .tagged_template_expression => |tt| leftmostByteIs(tree, tt.tag, byte),
        .binary_expression => |b| leftmostByteIs(tree, b.left, byte),
        .logical_expression => |l| leftmostByteIs(tree, l.left, byte),
        .conditional_expression => |c| leftmostByteIs(tree, c.@"test", byte),
        .assignment_expression => |a| leftmostByteIs(tree, a.left, byte),
        .sequence_expression => |s| blk: {
            const list = tree.extra(s.expressions);
            break :blk list.len > 0 and leftmostByteIs(tree, list[0], byte);
        },
        .ts_as_expression => |e| leftmostByteIs(tree, e.expression, byte),
        .ts_satisfies_expression => |e| leftmostByteIs(tree, e.expression, byte),
        .ts_non_null_expression => |e| leftmostByteIs(tree, e.expression, byte),
        .ts_instantiation_expression => |e| leftmostByteIs(tree, e.expression, byte),
        else => false,
    };
}

fn sameIdentifier(tree: *const Tree, a: NodeIndex, b: NodeIndex) bool {
    if (a == .null or b == .null) return false;
    const an = identifierStringOrNull(tree, a) orelse return false;
    const bn = identifierStringOrNull(tree, b) orelse return false;
    return std.mem.eql(u8, tree.string(an), tree.string(bn));
}

// whether an object property / binding property can stay in shorthand form
// (`{ name }`) at emit time. the parser sets `shorthand = true` when the
// source was written that way, but a later rename pass (the mangler) may
// have changed the value-side binding without touching the key. at that
// point `{ name: a }` is required to preserve which property is being
// read/destructured. peels through `assignment_pattern` so `{ name = 1 }`
// is still considered shorthand when the binding kept the same name.
fn shorthandStillValid(tree: *const Tree, key: NodeIndex, value: NodeIndex) bool {
    var v = value;
    if (tree.data(v) == .assignment_pattern) v = tree.data(v).assignment_pattern.left;
    return sameIdentifier(tree, key, v);
}

fn identifierStringOrNull(tree: *const Tree, idx: NodeIndex) ?ast.String {
    return switch (tree.data(idx)) {
        .identifier_name => |id| id.name,
        .identifier_reference => |id| id.name,
        .binding_identifier => |id| id.name,
        else => null,
    };
}

fn hasValueImportSpecifier(tree: *const Tree, list: []const NodeIndex) bool {
    for (list) |idx| {
        switch (tree.data(idx)) {
            .import_default_specifier, .import_namespace_specifier => return true,
            .import_specifier => |s| if (s.import_kind != .type) return true,
            else => {},
        }
    }
    return false;
}

fn hasValueExportSpecifier(tree: *const Tree, list: []const NodeIndex) bool {
    for (list) |idx| {
        switch (tree.data(idx)) {
            .export_specifier => |s| if (s.export_kind != .type) return true,
            else => {},
        }
    }
    return false;
}

fn isBareAsyncIdentifier(tree: *const Tree, idx: NodeIndex) bool {
    const name = identifierStringOrNull(tree, idx) orelse return false;
    return std.mem.eql(u8, tree.string(name), "async");
}

fn needsParensAsAssignTarget(tree: *const Tree, idx: NodeIndex) bool {
    return switch (tree.data(idx)) {
        .ts_as_expression,
        .ts_satisfies_expression,
        .ts_type_assertion,
        => true,
        else => false,
    };
}

fn typeStartsWithLeftAngle(tree: *const Tree, idx: NodeIndex) bool {
    if (idx == .null) return false;
    return switch (tree.data(idx)) {
        .ts_function_type => |t| t.type_parameters != .null,
        .ts_constructor_type => |t| !t.abstract and t.type_parameters != .null,
        else => false,
    };
}

/// Whether `??` is mixed with `&&`/`||`, which must be parenthesized.
fn logicalMismatch(tree: *const Tree, parent: ast.LogicalOperator, child: NodeIndex) bool {
    const child_op = switch (tree.data(child)) {
        .logical_expression => |l| l.operator,
        else => return false,
    };
    return (parent == .nullish_coalescing) != (child_op == .nullish_coalescing);
}

/// returns the decoded value of `idx` if it's a string literal whose
/// contents form a valid IdentifierName. used by the `obj["foo"]` to
/// `obj.foo` and `{"foo": x}` to `{foo: x}` rewrites.
fn simpleStringKey(tree: *const Tree, idx: NodeIndex) ?[]const u8 {
    const lit = switch (tree.data(idx)) {
        .string_literal => |l| l,
        else => return null,
    };
    const s = tree.string(lit.value);
    return if (utils.isIdentifierName(s)) s else null;
}

/// Whether an emitted head is a bare integer (digit-led, only digits and `_`)
/// that would fuse with a following `.` into a float.
fn isBareIntegerHead(head: []const u8) bool {
    if (head.len == 0 or !std.ascii.isDigit(head[0])) return false;
    for (head[1..]) |c| if (!std.ascii.isDigit(c) and c != '_') return false;
    return true;
}

// true when the last token emitted for `idx` closes a `as`/`satisfies` type. a
// following `<` would then bind as that type's argument list, so the caller
// must parenthesize. recurses down the right edge since the cast can be nested.
fn endsWithTsCast(tree: *const Tree, idx: NodeIndex) bool {
    return switch (tree.data(idx)) {
        .ts_as_expression, .ts_satisfies_expression => true,
        .binary_expression => |b| endsWithTsCast(tree, b.right),
        .logical_expression => |b| endsWithTsCast(tree, b.right),
        .assignment_expression => |a| endsWithTsCast(tree, a.right),
        .conditional_expression => |c| endsWithTsCast(tree, c.alternate),
        else => false,
    };
}

const TPrec = struct {
    const trailing: u8 = 1; // function, constructor, conditional, infer
    const @"union": u8 = 2;
    const intersection: u8 = 3;
    const operator: u8 = 4; // keyof, typeof, readonly, unique
    const primary: u8 = 5;
};

const schema = @import("parser_extension").schema_module;

fn dialectPrintText(comptime Host: type, host: *Host, value: []const u8) !void {
    std.debug.assert(value.len <= std.math.maxInt(u32));
    var start: usize = 0;
    for (value, 0..) |byte, index| {
        const entity: ?[]const u8 = switch (byte) {
            '&' => "&amp;",
            '<' => "&lt;",
            '>' => "&gt;",
            else => null,
        };
        if (entity) |replacement| {
            if (start < index) try host.dialectWrite(value[start..index]);
            try host.dialectWrite(replacement);
            start = index + 1;
        }
    }
    if (start < value.len) try host.dialectWrite(value[start..]);
}

fn dialectPrintRecord(comptime Host: type, host: *Host, record_index: u32) !void {
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const record = host.tree.dialect_store.records.items[record_index];
    switch (record) {
        .node => |node| try host.dialectEmit(node.value.raw),
        .jsx_code_block => |block| {
            try host.dialectWrite("@{");
            if (block.body.len > 0) {
                try host.dialectSpace();
                try host.dialectEmitStatements(block.body.start, block.body.len);
            }
            if (block.render.raw != std.math.maxInt(u32)) {
                try host.dialectSpace();
                try host.dialectEmit(block.render.raw);
            }
            try host.dialectSpace();
            try host.dialectWrite("}");
        },
        .jsx_for_expression => |expression| {
            try host.dialectWrite("@");
            try host.dialectEmit(expression.statement.raw);
            if (expression.empty.raw != std.math.maxInt(u32)) {
                try host.dialectWrite(" @empty ");
                try host.dialectEmit(expression.empty.raw);
            }
        },
        .jsx_if_expression => |expression| {
            try host.dialectWrite("@if (");
            try host.dialectEmit(expression.@"test".raw);
            try host.dialectWrite(") ");
            try host.dialectEmit(expression.consequent.raw);
            if (expression.alternate.raw != std.math.maxInt(u32)) {
                try host.dialectWrite(" @else ");
                try host.dialectEmit(expression.alternate.raw);
            }
        },
        .jsx_switch_expression => |expression| {
            try printSwitch(Host, host, expression.statement.raw);
        },
        .jsx_try_expression => |expression| {
            try printTry(Host, host, expression.statement.raw, expression.pending.raw);
        },
        .style_sheet => |sheet| try host.dialectWrite(
            host.tree.string(.{ .start = sheet.source.start, .end = sheet.source.end }),
        ),
        .jsx_style_element => |element| {
            try host.dialectEmit(element.opening_element.raw);
            try host.dialectWrite(host.tree.string(.{
                .start = element.css.start,
                .end = element.css.end,
            }));
            if (element.closing_element.raw != std.math.maxInt(u32))
                try host.dialectEmit(element.closing_element.raw);
        },
        .tsrx_expression => |expression| {
            try host.dialectWrite("{");
            try host.dialectEmit(expression.expression.raw);
            try host.dialectWrite("}");
        },
        // CSS structure records are offsets into the sheet text `style_sheet` already wrote.
        .css_rule, .css_atrule, .css_selector => {},
        .for_of, .catch_clause, .array_pattern, .object_pattern => unreachable,
    }
}

pub fn hasDisambiguatingAssignmentTargetPrefix(
    comptime Host: type,
    host: *const Host,
    record_index: u32,
    target_raw: u32,
) bool {
    std.debug.assert(target_raw < host.tree.nodes.len);
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const target = host.tree.data(@enumFromInt(target_raw));
    std.debug.assert(target == .object_pattern);
    const overlay_index = host.tree.dialectOverlay(target_raw);
    std.debug.assert(overlay_index != null);
    std.debug.assert(overlay_index.? == record_index);
    return switch (host.tree.dialect_store.records.items[record_index]) {
        .object_pattern => |overlay| overlay.lazy,
        else => false,
    };
}

fn dialectPrintOverlay(
    comptime Host: type,
    host: *Host,
    record_index: u32,
    node_index: anytype,
) !bool {
    std.debug.assert(record_index < host.tree.dialect_store.records.items.len);
    const raw: u32 = @intFromEnum(node_index);
    return switch (host.tree.dialect_store.records.items[record_index]) {
        .for_of => |overlay| block: {
            try printForOf(Host, host, raw, overlay.index.raw, overlay.key.raw);
            break :block true;
        },
        .array_pattern => |overlay| block: {
            if (!overlay.lazy) break :block false;
            try host.dialectWrite("&");
            try host.dialectEmitOverlaySuppressed(raw);
            break :block true;
        },
        .object_pattern => |overlay| block: {
            if (!overlay.lazy) break :block false;
            try host.dialectWrite("&");
            try host.dialectEmitOverlaySuppressed(raw);
            break :block true;
        },
        .catch_clause => |overlay| block: {
            try printCatch(Host, host, raw, overlay.reset_param.raw);
            break :block true;
        },
        .node,
        .jsx_code_block,
        .jsx_for_expression,
        .jsx_if_expression,
        .jsx_switch_expression,
        .jsx_try_expression,
        .style_sheet,
        .jsx_style_element,
        .tsrx_expression,
        .css_rule,
        .css_atrule,
        .css_selector,
        => false,
    };
}

fn printForOf(comptime Host: type, host: *Host, raw: u32, index: u32, key: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .for_of_statement);
    const statement = data.for_of_statement;

    try host.dialectWrite("for");
    if (statement.await) try host.dialectWrite(" await");
    try host.dialectWrite(" (");
    try host.dialectEmitForLeft(@intFromEnum(statement.left));
    try host.dialectWrite(" of ");
    try host.dialectEmitValue(@intFromEnum(statement.right));
    if (index < host.tree.nodes.len) {
        try host.dialectWrite("; index ");
        try host.dialectEmit(index);
    } else std.debug.assert(index == std.math.maxInt(u32));
    if (key < host.tree.nodes.len) {
        try host.dialectWrite("; key ");
        try host.dialectEmit(key);
    } else std.debug.assert(key == std.math.maxInt(u32));
    try host.dialectWrite(") ");
    try host.dialectEmitStatement(@intFromEnum(statement.body));
}

fn printCatch(comptime Host: type, host: *Host, raw: u32, reset: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .catch_clause);
    const clause = data.catch_clause;

    try host.dialectWrite("@catch");
    if (clause.param != .null or reset < host.tree.nodes.len) {
        try host.dialectWrite(" (");
        if (clause.param != .null) try host.dialectEmit(@intFromEnum(clause.param));
        if (reset < host.tree.nodes.len) {
            if (clause.param != .null) try host.dialectWrite(", ");
            try host.dialectEmit(reset);
        } else std.debug.assert(reset == std.math.maxInt(u32));
        try host.dialectWrite(")");
    } else std.debug.assert(reset == std.math.maxInt(u32));
    try host.dialectSpace();
    try host.dialectEmit(@intFromEnum(clause.body));
}

fn printTry(comptime Host: type, host: *Host, raw: u32, pending: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .try_statement);
    const statement = data.try_statement;

    try host.dialectWrite("@try ");
    try host.dialectEmit(@intFromEnum(statement.block));
    if (pending < host.tree.nodes.len) {
        try host.dialectWrite(" @pending ");
        try host.dialectEmit(pending);
    } else std.debug.assert(pending == std.math.maxInt(u32));
    if (statement.handler != .null) {
        try host.dialectSpace();
        try host.dialectEmit(@intFromEnum(statement.handler));
    }
}

fn printSwitch(comptime Host: type, host: *Host, raw: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .switch_statement);
    const statement = data.switch_statement;
    const cases = host.tree.extra(statement.cases);

    try host.dialectWrite("@switch (");
    try host.dialectEmit(@intFromEnum(statement.discriminant));
    try host.dialectWrite(") {");
    for (cases) |case_index| {
        std.debug.assert(@intFromEnum(case_index) < host.tree.nodes.len);
        try host.dialectSpace();
        try printSwitchCase(Host, host, @intFromEnum(case_index));
    }
    if (cases.len > 0) try host.dialectSpace();
    try host.dialectWrite("}");
}

fn printSwitchCase(comptime Host: type, host: *Host, raw: u32) !void {
    std.debug.assert(raw < host.tree.nodes.len);
    const data = host.tree.data(@enumFromInt(raw));
    std.debug.assert(data == .switch_case);
    const case = data.switch_case;

    if (case.@"test" != .null) {
        try host.dialectWrite("@case ");
        try host.dialectEmit(@intFromEnum(case.@"test"));
    } else {
        try host.dialectWrite("@default");
    }
    try host.dialectWrite(": ");
    try host.dialectEmitBlock(case.consequent.start, case.consequent.len);
}
