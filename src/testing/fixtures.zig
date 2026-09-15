const std = @import("std");
const parser = @import("parser");
const transfer = @import("transfer");
const fixture_options = @import("fixture_options");

const Fixture = struct {
    path: []const u8,
    source: []const u8,
};

const fixtures = [_]Fixture{
    .{ .path = "tsrx/code-block-expression.module.tsrx", .source = @embedFile("code_block_expression") },
    .{ .path = "tsrx/code-block-function.module.tsrx", .source = @embedFile("code_block_function") },
    .{ .path = "tsrx/code-block.module.tsrx", .source = @embedFile("code_block") },
    .{ .path = "tsrx/control-flow-for.module.tsrx", .source = @embedFile("control_flow_for") },
    .{ .path = "tsrx/control-flow-if.module.tsrx", .source = @embedFile("control_flow_if") },
    .{ .path = "tsrx/control-flow-switch-invalid.module.tsrx", .source = @embedFile("control_flow_switch_invalid") },
    .{ .path = "tsrx/control-flow-switch.module.tsrx", .source = @embedFile("control_flow_switch") },
    .{ .path = "tsrx/control-flow-try.module.tsrx", .source = @embedFile("control_flow_try") },
    .{ .path = "tsrx/dynamic-tag-invalid.module.tsrx", .source = @embedFile("dynamic_tag_invalid") },
    .{ .path = "tsrx/dynamic-tag.module.tsrx", .source = @embedFile("dynamic_tag") },
    .{ .path = "tsrx/style-element.module.tsrx", .source = @embedFile("style_element") },
    .{ .path = "tsrx/submodule-import.module.tsrx", .source = @embedFile("submodule_import") },
    .{ .path = "tsrx/template-return-invalid.module.tsrx", .source = @embedFile("template_return_invalid") },
    .{ .path = "tsrx/text-entities.module.tsrx", .source = @embedFile("text_entities") },
    .{ .path = "ts/dynamic-tag-outside-tsrx.tsx", .source = @embedFile("dynamic_tag_outside") },
    .{ .path = "ts/submodule-import-outside-tsrx.ts", .source = @embedFile("submodule_import_outside") },
};

pub fn main(init: std.process.Init) !void {
    const allocator = std.heap.smp_allocator;
    const stdout = std.Io.File.stdout();
    var output_buffer: [64 * 1024]u8 = undefined;
    var output = stdout.writer(init.io, &output_buffer);

    try writeU32(&output.interface, if (fixture_options.dialect_mode) 14 else 2);
    for (fixtures) |fixture| {
        const is_tsrx = std.mem.endsWith(u8, fixture.path, ".tsrx");
        if (is_tsrx != fixture_options.dialect_mode) continue;
        try writeU32(&output.interface, fixture.path.len);
        try output.interface.writeAll(fixture.path);
        try writeU32(&output.interface, fixture.source.len);
        try output.interface.writeAll(fixture.source);
        var tree = try parser.parse(
            allocator,
            fixture.source,
            .{
                .lang = if (is_tsrx) .tsx else parser.ast.Lang.fromPath(fixture.path),
                .source_type = if (is_tsrx) .module else .script,
            },
        );
        defer tree.deinit();
        const bytes = try allocator.alloc(u8, transfer.bufferSize(&tree));
        defer allocator.free(bytes);
        _ = transfer.serializeInto(&tree, bytes);
        try writeU32(&output.interface, bytes.len);
        try output.interface.writeAll(bytes);
    }
    try output.flush();
}

fn writeU32(writer: *std.Io.Writer, value: usize) !void {
    var bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &bytes, @intCast(value), .little);
    try writer.writeAll(&bytes);
}
