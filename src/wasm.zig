//! Yuku's WebAssembly entries, with the module record scan.

const std = @import("std");
const parser = @import("parser");
const module_record = @import("module_record/scan.zig");

const gpa = std.heap.wasm_allocator;

comptime {
    _ = @import("yuku_wasm");
}

// packed as Yuku's `parse` packs them, by src/module-record.ts
const flag = struct {
    const source_type_mask = 0b11;
    const lang_shift = 2;
    const semantic_errors = 1 << 6;
    const dialect = 1 << 9;
};

var input: std.ArrayList(u8) = .empty;
var record: std.ArrayList(u32) = .empty;

/// A buffer of at least `len` bytes for the next source, kept across calls.
export fn module_record_input(len: usize) usize {
    input.ensureTotalCapacity(gpa, len) catch return 0;
    return @intFromPtr(input.allocatedSlice().ptr);
}

/// Scans the `len` bytes written to the input, and returns the record, valid until the next call.
export fn module_record_scan(len: usize, flags: u32) usize {
    scan(input.allocatedSlice()[0..len], flags) catch return 0;
    return @intFromPtr(record.items.ptr);
}

fn scan(source: []const u8, flags: u32) !void {
    var tree = try parser.parse(gpa, source, .{
        .source_type = @fromBackingInt(@truncate(flags & flag.source_type_mask)),
        .lang = @fromBackingInt(@truncate(flags >> flag.lang_shift)),
        .preserve_parens = false,
        .comments = .none,
        .dialect = flags & flag.dialect != 0,
    });
    defer tree.deinit();
    if (flags & flag.semantic_errors != 0 and !tree.hasErrors()) try parser.semantic.check(&tree);
    try module_record.write(gpa, &tree, &record);
}
