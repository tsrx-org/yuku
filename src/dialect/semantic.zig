const std = @import("std");
const parser = @import("yuku");

pub const module_record = struct {
    pub const Flags = parser.semantic.module_record.Flags;

    pub fn collect(tree: anytype, analysis: anytype) !parser.semantic.module_record.Records {
        return parser.semantic.module_record.collect(&tree.tree, analysis);
    }
};

const AnalyzeResult = @typeInfo(@TypeOf(parser.semantic.analyze)).@"fn".return_type.?;

pub fn analyze(tree: anytype) AnalyzeResult {
    const NodeData = @TypeOf(tree.tree.data(tree.tree.root));
    const saved = try tree.tree.allocator().alloc(NodeData, tree.dialect_store.associations.items.len);
    defer tree.tree.allocator().free(saved);
    for (tree.dialect_store.associations.items, 0..) |association, index| {
        const anchor: parser.ast.NodeIndex = @enumFromInt(association.anchor);
        saved[index] = tree.tree.data(anchor);
        const record = tree.dialect_store.records.items[association.record_index];
        tree.tree.setData(anchor, switch (record) {
            inline else => |value, tag| if (comptime std.mem.eql(u8, @tagName(tag), "node"))
                .{ .parenthesized_expression = .{ .expression = @enumFromInt(value.value.raw) } }
            else if (comptime std.mem.eql(u8, @tagName(tag), "jsx_code_block"))
                .{ .block_statement = .{ .body = try semanticRange(tree, value.body.start, value.body.len, value.render.raw) } }
            else if (comptime std.mem.eql(u8, @tagName(tag), "jsx_for_expression") or
                std.mem.eql(u8, @tagName(tag), "jsx_switch_expression") or
                std.mem.eql(u8, @tagName(tag), "jsx_try_expression"))
                .{ .block_statement = .{ .body = try semanticRange(tree, 0, 0, value.statement.raw) } }
            else if (comptime std.mem.eql(u8, @tagName(tag), "jsx_if_expression"))
                .{ .conditional_expression = .{
                    .@"test" = @enumFromInt(value.@"test".raw),
                    .consequent = @enumFromInt(value.consequent.raw),
                    .alternate = @enumFromInt(value.alternate.raw),
                } }
            else if (comptime std.mem.eql(u8, @tagName(tag), "jsx_style_element") or
                std.mem.eql(u8, @tagName(tag), "jsx_script_element"))
                .{ .jsx_element = .{
                    .opening_element = @enumFromInt(value.opening_element.raw),
                    .children = .{ .start = value.children.start, .len = value.children.len },
                    .closing_element = @enumFromInt(value.closing_element.raw),
                } }
            else if (comptime std.mem.eql(u8, @tagName(tag), "tsrx_expression"))
                .{ .parenthesized_expression = .{ .expression = @enumFromInt(value.expression.raw) } }
            else
                saved[index],
        });
    }
    defer for (tree.dialect_store.associations.items, saved) |association, data| {
        tree.tree.setData(@enumFromInt(association.anchor), data);
    };
    return parser.semantic.analyze(&tree.tree);
}

fn semanticRange(tree: anytype, start: u32, len: u32, tail: u32) !parser.ast.IndexRange {
    const first: u32 = @intCast(tree.tree.extras.items.len);
    if (len > 0) {
        try tree.tree.extras.ensureUnusedCapacity(tree.tree.allocator(), len);
        const values = tree.tree.extra(.{ .start = start, .len = len });
        tree.tree.extras.appendSliceAssumeCapacity(values);
    }
    if (tail != std.math.maxInt(u32)) try tree.tree.extras.append(tree.tree.allocator(), @enumFromInt(tail));
    return .{ .start = first, .len = len + @intFromBool(tail != std.math.maxInt(u32)) };
}
