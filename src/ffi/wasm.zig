//! Freestanding WebAssembly entry point for the yuku-tsrx dialect. One module
//! carries what the napi addon exposes as three calls, so a browser pays for a
//! single fetch:
//!
//!   alloc(len)                     -> ptr   buffer for the source bytes
//!   free(ptr, len)                 -> void
//!   parse(ptr, len, flags)         -> ptr   `[u32 N][N bytes]`, the AST buffer
//!                                           npm/yuku-tsrx/decode.js reads, or 0
//!   analyze(ptr, len, flags)       -> ptr   `[u32 N][N bytes]`, the AST buffer
//!                                           plus the semantic sections that
//!                                           decode-analyzer.js reads, or 0
//!   generate(ptr, len, flags, opts)-> ptr   `[u32 total][u32 code_len]
//!                                           [code utf8][u32 error_count]
//!                                           {[u32 start][u32 end]
//!                                            [u32 msg_len][msg utf8]}*`, or 0
//!
//! `generate` parses from source in the same call rather than taking an encoded
//! AST: transfer.deserializeFromBuf asserts a 4-byte-aligned input buffer, and
//! nothing on the JS side guarantees that for a buffer the page owns.
//!
//! The host must re-view `memory.buffer` after every call (memory grows) and
//! `free` both the source buffer and the result buffer.

const std = @import("std");
const parser = @import("parser");
const transfer = @import("transfer");
const semantic_transfer = transfer.semantic;

const gpa = std.heap.wasm_allocator;

/// Option bits packed by the JS host. Bits 0..7 match yuku's own wasm entries;
/// bit 8 is the dialect's `loose` option.
const flag = struct {
    const source_type_mask: u32 = 0b11; // bits 0..1: ast.SourceType index
    const lang_shift: u5 = 2; // bits 2..4: ast.Lang index
    const lang_mask: u32 = 0b111;
    const preserve_parens: u32 = 1 << 5;
    const semantic: u32 = 1 << 6;
    const attach_comments: u32 = 1 << 7;
    const loose: u32 = 1 << 8;
};

/// Codegen option bits packed by the JS host. `strip` and `minify` select the
/// printer configuration (`codegen.Config`), the rest fill `codegen.Options`.
const opt = struct {
    const strip: u32 = 1 << 0;
    const minify: u32 = 1 << 1;
    const compact: u32 = 1 << 2;
    const quotes_shift: u5 = 3; // bits 3..4
    const comments_shift: u5 = 5; // bits 5..7
    const indent_shift: u5 = 8; // bits 8..15
};

const source_type_count = @typeInfo(parser.ast.SourceType).@"enum".fields.len;
const lang_count = @typeInfo(parser.ast.Lang).@"enum".fields.len;
const quotes_count = @typeInfo(parser.codegen.Quotes).@"enum".fields.len;
const comments_count = @typeInfo(parser.codegen.Comments).@"enum".fields.len;

export fn alloc(len: usize) [*]u8 {
    return (gpa.alloc(u8, len) catch @trap()).ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    gpa.free(ptr[0..len]);
}

export fn parse(ptr: [*]const u8, len: usize, flags: u32) usize {
    const out = runParse(ptr[0..len], flags) catch return 0;
    return @intFromPtr(out.ptr);
}

export fn analyze(ptr: [*]const u8, len: usize, flags: u32) usize {
    const out = runAnalyze(ptr[0..len], flags) catch return 0;
    return @intFromPtr(out.ptr);
}

export fn generate(ptr: [*]const u8, len: usize, flags: u32, opts: u32) usize {
    const out = runGenerate(ptr[0..len], flags, opts) catch return 0;
    return @intFromPtr(out.ptr);
}

/// A packed index the host got wrong must not become an illegal enum value, so
/// every field is clamped to the tag range instead of trusted.
fn clamp(value: u32, count: usize) u32 {
    return @min(value, @as(u32, @intCast(count - 1)));
}

fn parseOptions(flags: u32) parser.Options {
    return .{
        .source_type = @enumFromInt(clamp(flags & flag.source_type_mask, source_type_count)),
        .lang = @enumFromInt(clamp((flags >> flag.lang_shift) & flag.lang_mask, lang_count)),
        .preserve_parens = flags & flag.preserve_parens != 0,
        .comments = if (flags & flag.attach_comments != 0) .both else .flat,
        .loose = flags & flag.loose != 0,
    };
}

fn codegenOptions(opts: u32) parser.codegen.Options {
    return .{
        .format = if (opts & opt.compact != 0) .compact else .pretty,
        .indent = @intCast((opts >> opt.indent_shift) & 0xFF),
        .quotes = @enumFromInt(clamp((opts >> opt.quotes_shift) & 0b11, quotes_count)),
        .comments = @enumFromInt(clamp((opts >> opt.comments_shift) & 0b111, comments_count)),
        .source_maps = null,
    };
}

/// Allocates `4 + payload` bytes and writes the little-endian payload length
/// into the first four. The allocator hands out power-of-two slots, so the
/// payload at offset 4 is 4-byte aligned as the transfer writers require.
fn prefixed(payload: usize) ![]u8 {
    const out = try gpa.alloc(u8, 4 + payload);
    std.mem.writeInt(u32, out[0..4], @intCast(payload), .little);
    return out;
}

fn runParse(source: []const u8, flags: u32) ![]u8 {
    var tree = try parser.parse(gpa, source, parseOptions(flags));
    defer tree.deinit();

    if (flags & flag.semantic != 0) parser.diagnostics.analyzeWithBoundarySeverity(&tree);

    const out = try prefixed(transfer.bufferSize(&tree));
    _ = transfer.serializeInto(&tree, out[4..]);
    return out;
}

fn runAnalyze(source: []const u8, flags: u32) ![]u8 {
    var tree = try parser.parse(gpa, source, parseOptions(flags));
    defer tree.deinit();

    var semantic = try parser.semantic.analyze(&tree);
    // collect before sizing: records may intern "default" into the pool
    const records = try parser.semantic.module_record.collect(&tree, &semantic);

    const core_size = transfer.bufferSize(&tree);
    const out = try prefixed(semantic_transfer.bufferSize(&tree, &semantic, records, core_size));
    const core_written = transfer.serializeInto(&tree, out[4..]);
    _ = try semantic_transfer.appendInto(&tree, &semantic, records, out[4..], core_written);
    return out;
}

fn runGenerate(source: []const u8, flags: u32, opts: u32) ![]u8 {
    var tree = try parser.parse(gpa, source, parseOptions(flags));
    defer tree.deinit();

    const result = try parser.codegen.emit(gpa, &tree, .{
        .strip_ts = opts & opt.strip != 0,
        .minify = opts & opt.minify != 0,
    }, codegenOptions(opts));
    defer result.deinit(gpa);

    var payload: usize = 4 + result.code.len + 4;
    for (result.errors) |diagnostic| payload += 12 + diagnostic.message.len;

    const out = try prefixed(payload);
    var pos: usize = 4;
    std.mem.writeInt(u32, out[pos..][0..4], @intCast(result.code.len), .little);
    pos += 4;
    @memcpy(out[pos..][0..result.code.len], result.code);
    pos += result.code.len;
    std.mem.writeInt(u32, out[pos..][0..4], @intCast(result.errors.len), .little);
    pos += 4;
    for (result.errors) |diagnostic| {
        std.mem.writeInt(u32, out[pos..][0..4], diagnostic.start, .little);
        std.mem.writeInt(u32, out[pos + 4 ..][0..4], diagnostic.end, .little);
        std.mem.writeInt(u32, out[pos + 8 ..][0..4], @intCast(diagnostic.message.len), .little);
        pos += 12;
        @memcpy(out[pos..][0..diagnostic.message.len], diagnostic.message);
        pos += diagnostic.message.len;
    }
    return out;
}
