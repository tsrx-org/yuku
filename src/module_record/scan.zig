//! The imports and exports of a module, read from its tree without sending the tree to the host.

const std = @import("std");
const parser = @import("parser");
const layout = @import("layout.zig");

const ast = parser.ast;
const Allocator = std.mem.Allocator;
const NodeIndex = ast.NodeIndex;
const Text = layout.Text;
const OptionalText = layout.OptionalText;

/// Writes the record of `tree` into `out`, which is cleared first.
pub fn write(allocator: Allocator, tree: *ast.Tree, out: *std.ArrayList(u32)) Allocator.Error!void {
    out.clearRetainingCapacity();
    var w: Writer = .{ .allocator = allocator, .tree = tree, .out = out };
    defer w.pool.deinit(allocator);
    defer w.fix.deinit(allocator);
    defer w.dynamic.deinit(allocator);

    try w.push(layout.Header, undefined);
    if (tree.hasErrors()) {
        w.header().* = .{
            .failed = .true,
            .static_imports = 0,
            .static_exports = 0,
            .dynamic_imports = 0,
            .pool_start = 0,
            .pool_len = 0,
        };
        return;
    }

    const body = tree.extra(tree.data(tree.root).program.body);
    var imports: Imports = .empty;
    var static_imports: u32 = 0;
    for (body) |statement| switch (tree.data(statement)) {
        // TSRX's `from server` names no module
        .import_declaration => |decl| if (decl.import_kind != .type and
            tree.data(decl.source) == .string_literal)
        {
            try w.staticImport(decl, statement);
            try w.bind(&imports, decl);
            static_imports += 1;
        },
        else => {},
    };

    var static_exports: u32 = 0;
    for (body) |statement| {
        if (try w.staticExport(&imports, statement)) static_exports += 1;
    }

    const dynamic_imports = try w.dynamicImports();
    try w.toUtf16();

    const pool_start: u32 = @intCast(out.items.len);
    const pool_len: u32 = @intCast(w.pool.items.len);
    try w.pool.appendNTimes(allocator, 0, std.mem.alignForward(usize, pool_len, 4) - pool_len);
    const pool = try out.addManyAsSlice(allocator, w.pool.items.len / 4);
    @memcpy(std.mem.sliceAsBytes(pool), w.pool.items);

    w.header().* = .{
        .failed = .false,
        .static_imports = static_imports,
        .static_exports = static_exports,
        .dynamic_imports = dynamic_imports,
        .pool_start = pool_start,
        .pool_len = pool_len,
    };
}

/// The binding a top-level import declares.
const Binding = struct {
    kind: enum { named, default, namespace },
    /// The name in the source module of a `.named` binding.
    name: ast.String = .empty,
    specifier: ast.String,
    type_only: bool = false,
};

const Imports = std.StringHashMapUnmanaged(Binding);

const Span = struct { start: u32, end: u32, argument_start: u32, argument_end: u32 };

const Writer = struct {
    allocator: Allocator,
    tree: *ast.Tree,
    out: *std.ArrayList(u32),
    /// Text that is not in the source, as WTF-8.
    pool: std.ArrayList(u8) = .empty,
    /// The words of `out` that hold a byte offset into the source until `toUtf16`.
    fix: std.ArrayList(u32) = .empty,
    dynamic: std.ArrayList(Span) = .empty,
    default_text: ?Text = null,

    fn header(w: *Writer) *layout.Header {
        return @ptrCast(w.out.items[0..layout.words(layout.Header)]);
    }

    fn push(w: *Writer, comptime T: type, value: T) Allocator.Error!void {
        const at: u32 = @intCast(w.out.items.len);
        try w.out.appendSlice(w.allocator, @as(*const [layout.words(T)]u32, @ptrCast(&value)));
        inline for (@typeInfo(T).@"struct".field_names, @typeInfo(T).@"struct".field_types) |name, F| {
            const word = at + @offsetOf(T, name) / 4;
            if (F == layout.Offset) {
                try w.fix.append(w.allocator, word);
            } else if (F == Text or F == OptionalText) {
                const value_text = @field(value, name);
                if (value_text.start & Text.pool_bit == 0) try w.fix.appendSlice(w.allocator, &.{ word, word + 1 });
            }
        }
    }

    fn text(w: *Writer, string: ast.String) Allocator.Error!Text {
        if (string.start == string.end) return .{ .start = 0, .end = 0 };
        if (string.start < w.tree.source.len) return .{ .start = string.start, .end = string.end };
        const start: u32 = @intCast(w.pool.items.len);
        try w.pool.appendSlice(w.allocator, w.tree.string(string));
        return .{ .start = start | Text.pool_bit, .end = @intCast(w.pool.items.len) };
    }

    fn optional(w: *Writer, string: ?ast.String) Allocator.Error!OptionalText {
        const t = try w.text(string orelse return .none);
        return .{ .start = t.start, .end = t.end };
    }

    fn defaultName(w: *Writer) Allocator.Error!OptionalText {
        if (w.default_text == null) {
            const start: u32 = @intCast(w.pool.items.len);
            try w.pool.appendSlice(w.allocator, "default");
            w.default_text = .{ .start = start | Text.pool_bit, .end = @intCast(w.pool.items.len) };
        }
        return .{ .start = w.default_text.?.start, .end = w.default_text.?.end };
    }

    fn offset(value: u32) layout.Offset {
        return @fromBackingInt(@intCast(value));
    }

    fn staticImport(w: *Writer, decl: ast.ImportDeclaration, index: NodeIndex) Allocator.Error!void {
        const span = w.tree.span(index);
        const source = w.tree.span(decl.source);
        try w.push(layout.StaticImport, .{
            .start = offset(span.start),
            .end = offset(span.end),
            .specifier = try w.text(w.nameOf(decl.source)),
            .specifier_start = offset(source.start),
            .specifier_end = offset(source.end),
        });
    }

    fn bind(w: *Writer, imports: *Imports, decl: ast.ImportDeclaration) Allocator.Error!void {
        const specifier = w.nameOf(decl.source);
        for (w.tree.extra(decl.specifiers)) |spec| {
            const local: NodeIndex, const binding: Binding = switch (w.tree.data(spec)) {
                .import_specifier => |s| .{ s.local, Binding{
                    .kind = .named,
                    .name = w.nameOf(s.imported),
                    .specifier = specifier,
                    .type_only = s.import_kind == .type,
                } },
                .import_default_specifier => |s| .{ s.local, Binding{ .kind = .default, .specifier = specifier } },
                .import_namespace_specifier => |s| .{ s.local, Binding{ .kind = .namespace, .specifier = specifier } },
                else => continue,
            };
            const entry = try imports.getOrPut(w.tree.allocator(), w.tree.string(w.nameOf(local)));
            if (!entry.found_existing) entry.value_ptr.* = binding;
        }
    }

    fn staticExport(w: *Writer, imports: *const Imports, index: NodeIndex) Allocator.Error!bool {
        const span = w.tree.span(index);
        const at = w.out.items.len;
        var specifier: OptionalText = .none;
        var braced = false;
        switch (w.tree.data(index)) {
            .export_named_declaration => |decl| {
                if (decl.export_kind == .type) return false;
                if (decl.declaration != .null) {
                    if (w.tree.data(decl.declaration) == .ts_import_equals_declaration) return false;
                } else {
                    braced = true;
                    if (decl.source != .null) specifier = try w.optional(w.nameOf(decl.source));
                }
            },
            .export_all_declaration => |decl| {
                if (decl.export_kind == .type) return false;
                specifier = try w.optional(w.nameOf(decl.source));
            },
            .export_default_declaration => |decl| {
                if (w.tree.data(decl.declaration) == .ts_interface_declaration) return false;
            },
            else => return false,
        }
        try w.push(layout.StaticExport, .{
            .start = offset(span.start),
            .end = offset(span.end),
            .braced = if (braced) .true else .false,
            .specifier = specifier,
            .entries = @fromBackingInt(@intCast(0)),
        });

        var entries: u32 = 0;
        switch (w.tree.data(index)) {
            .export_named_declaration => |decl| if (decl.declaration != .null) {
                entries = try w.declarationNames(decl.declaration);
            } else for (w.tree.extra(decl.specifiers)) |spec_index| {
                const spec = w.tree.data(spec_index).export_specifier;
                if (spec.export_kind == .type) continue;
                const exported = try w.optional(w.nameOf(spec.exported));
                if (decl.source != .null) {
                    try w.push(layout.Entry, .{
                        .exported = exported,
                        .local = .none,
                        .imported = try w.optional(w.nameOf(spec.local)),
                        .imported_from = specifier,
                    });
                } else if (imports.get(w.tree.string(w.nameOf(spec.local)))) |binding| {
                    if (binding.type_only) continue;
                    // a namespace import exports as a local binding, ExportEntry semantics
                    if (binding.kind == .namespace) {
                        try w.localEntry(exported, w.nameOf(spec.local));
                    } else try w.push(layout.Entry, .{
                        .exported = exported,
                        .local = .none,
                        .imported = if (binding.kind == .default) try w.defaultName() else try w.optional(binding.name),
                        .imported_from = try w.optional(binding.specifier),
                    });
                } else try w.localEntry(exported, w.nameOf(spec.local));
                entries += 1;
            },
            .export_all_declaration => |decl| {
                try w.push(layout.Entry, .{
                    .exported = if (decl.exported != .null) try w.optional(w.nameOf(decl.exported)) else .none,
                    .local = .none,
                    .imported = .none,
                    .imported_from = specifier,
                });
                entries = 1;
            },
            .export_default_declaration => |decl| {
                // a parenthesized function or class is an expression, exported as `*default*`
                const local: ?ast.String = switch (w.tree.data(decl.declaration)) {
                    .function => |d| if (d.id != .null and d.type != .function_expression) w.nameOf(d.id) else null,
                    .class => |d| if (d.id != .null and d.type == .class_declaration) w.nameOf(d.id) else null,
                    else => null,
                };
                try w.push(layout.Entry, .{
                    .exported = try w.defaultName(),
                    .local = try w.optional(local),
                    .imported = .none,
                    .imported_from = .none,
                });
                entries = 1;
            },
            else => unreachable,
        }
        w.out.items[at + @offsetOf(layout.StaticExport, "entries") / 4] = entries;
        return true;
    }

    fn localEntry(w: *Writer, exported: OptionalText, local: ast.String) Allocator.Error!void {
        try w.push(layout.Entry, .{
            .exported = exported,
            .local = try w.optional(local),
            .imported = .none,
            .imported_from = .none,
        });
    }

    fn declarationNames(w: *Writer, declaration: NodeIndex) Allocator.Error!u32 {
        switch (w.tree.data(declaration)) {
            .variable_declaration => |decl| {
                var count: u32 = 0;
                for (w.tree.extra(decl.declarators)) |declarator| {
                    count += try w.patternNames(w.tree.data(declarator).variable_declarator.id);
                }
                return count;
            },
            inline .function, .class, .ts_enum_declaration => |decl| {
                if (decl.id == .null) return 0;
                return w.bindingName(decl.id);
            },
            .ts_module_declaration => |decl| {
                if (w.tree.data(decl.id) != .binding_identifier) return 0;
                return w.bindingName(decl.id);
            },
            else => return 0,
        }
    }

    fn patternNames(w: *Writer, pattern: NodeIndex) Allocator.Error!u32 {
        if (pattern == .null) return 0;
        return switch (w.tree.data(pattern)) {
            .binding_identifier => w.bindingName(pattern),
            .assignment_pattern => |p| w.patternNames(p.left),
            .binding_rest_element => |p| w.patternNames(p.argument),
            .array_pattern => |p| {
                var count: u32 = 0;
                for (w.tree.extra(p.elements)) |element| count += try w.patternNames(element);
                return count + try w.patternNames(p.rest);
            },
            .object_pattern => |p| {
                var count: u32 = 0;
                for (w.tree.extra(p.properties)) |property| {
                    if (w.tree.data(property) == .binding_property) {
                        count += try w.patternNames(w.tree.data(property).binding_property.value);
                    }
                }
                return count + try w.patternNames(p.rest);
            },
            else => 0,
        };
    }

    fn bindingName(w: *Writer, binding: NodeIndex) Allocator.Error!u32 {
        const name = try w.optional(w.nameOf(binding));
        try w.push(layout.Entry, .{
            .exported = name,
            .local = name,
            .imported = .none,
            .imported_from = .none,
        });
        return 1;
    }

    // a node the parser built and then replaced stays in the list, so calls are told apart by start
    fn dynamicImports(w: *Writer) Allocator.Error!u32 {
        const tree = w.tree;
        for (tree.nodes.items(.data), tree.nodes.items(.span)) |data, span| switch (data) {
            .import_expression => |expr| {
                const argument = tree.span(expr.source);
                try w.dynamic.append(w.allocator, .{
                    .start = span.start,
                    .end = span.end,
                    .argument_start = argument.start,
                    .argument_end = argument.end,
                });
            },
            else => {},
        };
        // post-order puts a nested call first
        std.sort.insertion(Span, w.dynamic.items, {}, struct {
            fn lessThan(_: void, a: Span, b: Span) bool {
                return a.start < b.start;
            }
        }.lessThan);
        var count: u32 = 0;
        var previous: ?u32 = null;
        for (w.dynamic.items) |span| {
            if (previous == span.start) continue;
            previous = span.start;
            try w.push(layout.DynamicImport, .{
                .start = offset(span.start),
                .end = offset(span.end),
                .argument_start = offset(span.argument_start),
                .argument_end = offset(span.argument_end),
            });
            count += 1;
        }
        return count;
    }

    fn nameOf(w: *const Writer, node: NodeIndex) ast.String {
        return switch (w.tree.data(node)) {
            inline .identifier_name, .identifier_reference, .binding_identifier => |id| id.name,
            .string_literal => |lit| lit.value,
            else => .empty,
        };
    }

    fn toUtf16(w: *Writer) Allocator.Error!void {
        const source = w.tree.source;
        const ascii = firstNonAscii(source);
        if (ascii == source.len) return;
        var units = try Utf16.init(w.allocator, source, ascii);
        defer units.deinit(w.allocator);
        for (w.fix.items) |word| w.out.items[word] = units.of(w.out.items[word]);
    }
};

/// UTF-16 offsets of byte offsets: a code unit per UTF-8 sequence, two for a four-byte one.
const Utf16 = struct {
    source: []const u8,
    ascii: u32,
    /// The UTF-16 offset of every `block` bytes from `ascii` on.
    marks: []u32,

    const block = 256;

    fn init(allocator: Allocator, source: []const u8, ascii: usize) Allocator.Error!Utf16 {
        const marks = try allocator.alloc(u32, (source.len - ascii) / block + 1);
        var unit: u32 = @intCast(ascii);
        var from = ascii;
        for (marks) |*mark| {
            mark.* = unit;
            const end = @min(from + block, source.len);
            unit += count(source[from..end]);
            from = end;
        }
        return .{ .source = source, .ascii = @intCast(ascii), .marks = marks };
    }

    fn deinit(self: *Utf16, allocator: Allocator) void {
        allocator.free(self.marks);
    }

    fn of(self: *const Utf16, byte: u32) u32 {
        if (byte <= self.ascii) return byte;
        const from = byte - self.ascii;
        const start = self.ascii + from / block * block;
        return self.marks[from / block] + count(self.source[start..byte]);
    }

    fn count(bytes: []const u8) u32 {
        var units: u32 = 0;
        for (bytes) |c| units += @as(u32, @intFromBool(c & 0xC0 != 0x80)) + @intFromBool(c >= 0xF0);
        return units;
    }
};

fn firstNonAscii(source: []const u8) usize {
    const V = @Vector(16, u8);
    var i: usize = 0;
    while (i + 16 <= source.len) : (i += 16) {
        const chunk: V = source[i..][0..16].*;
        if (@reduce(.Or, chunk >= @as(V, @splat(0x80)))) break;
    }
    while (i < source.len and source[i] < 0x80) i += 1;
    return i;
}
