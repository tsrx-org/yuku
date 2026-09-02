const std = @import("std");
const parser = @import("parser");
const transfer = @import("transfer");

test "production lazy object parameter preserves alias type span overlay and transfer" {
    const source = "type Props = { title: string }; function pick(&{ title: label }: Props) { return label; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const pattern = findNode(&tree, .object_pattern) orelse return error.MissingObjectPattern;
    const prefix = std.mem.indexOfScalar(u8, source, '&').?;
    try std.testing.expectEqual(@as(u32, @intCast(prefix)), tree.span(pattern).start);
    const data = tree.data(pattern).object_pattern;
    try std.testing.expect(data.type_annotation != .null);
    try std.testing.expectEqualStrings(": Props", source[tree.span(data.type_annotation).start..tree.span(data.type_annotation).end]);

    const properties = tree.extra(data.properties);
    try std.testing.expectEqual(@as(usize, 1), properties.len);
    const property = tree.data(properties[0]).binding_property;
    try std.testing.expectEqualStrings("title", source[tree.span(property.key).start..tree.span(property.key).end]);
    try std.testing.expectEqualStrings("label", source[tree.span(property.value).start..tree.span(property.value).end]);

    const overlay = tree.dialectOverlay(@intFromEnum(pattern)) orelse return error.MissingObjectOverlay;
    const record = tree.dialect_store.records.items[overlay].object_pattern;
    try std.testing.expectEqual(@intFromEnum(pattern), record.host_node.raw);
    try std.testing.expect(record.lazy);
    try expectRoundTrip(&tree);
}

test "production lazy array parameter preserves type span overlay and transfer" {
    const source = "type Values = string[]; function pick(&[first, ...rest]: Values) { return first; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const pattern = findNode(&tree, .array_pattern) orelse return error.MissingArrayPattern;
    const prefix = std.mem.indexOfScalar(u8, source, '&').?;
    try std.testing.expectEqual(@as(u32, @intCast(prefix)), tree.span(pattern).start);
    const data = tree.data(pattern).array_pattern;
    try std.testing.expect(data.type_annotation != .null);
    try std.testing.expectEqualStrings(": Values", source[tree.span(data.type_annotation).start..tree.span(data.type_annotation).end]);
    try std.testing.expectEqual(@as(usize, 1), tree.extra(data.elements).len);
    try std.testing.expect(data.rest != .null);

    const overlay = tree.dialectOverlay(@intFromEnum(pattern)) orelse return error.MissingArrayOverlay;
    const record = tree.dialect_store.records.items[overlay].array_pattern;
    try std.testing.expectEqual(@intFromEnum(pattern), record.host_node.raw);
    try std.testing.expect(record.lazy);
    try expectRoundTrip(&tree);
}

test "production binding prefix leaves ordinary patterns untouched" {
    const source = "type Props = { title: string }; function pick({ title: label }: Props) { return label; }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const pattern = findNode(&tree, .object_pattern) orelse return error.MissingOrdinaryObjectPattern;
    try std.testing.expectEqual(@as(?u32, null), tree.dialectOverlay(@intFromEnum(pattern)));
    try std.testing.expectEqual(@as(usize, 0), tree.dialect_store.records.items.len);
}

test "production lazy let bindings preserve ordinary let ambiguity" {
    for ([_]struct { source: []const u8, tag: std.meta.Tag(parser.ast.NodeData), lazy: bool }{
        .{ .source = "let &[value] = source;", .tag = .array_pattern, .lazy = true },
        .{ .source = "let &{value} = source;", .tag = .object_pattern, .lazy = true },
        .{ .source = "let [value] = source;", .tag = .array_pattern, .lazy = false },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .js });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        const pattern = findNode(&tree, case.tag) orelse return error.MissingLetPattern;
        const overlay = tree.dialectOverlay(@intFromEnum(pattern));
        if (case.lazy) {
            const record_index = overlay orelse return error.MissingLazyLetOverlay;
            switch (tree.dialect_store.records.items[record_index]) {
                .array_pattern => |record| try std.testing.expect(record.lazy),
                .object_pattern => |record| try std.testing.expect(record.lazy),
                else => return error.UnexpectedLazyLetOverlay,
            }
        } else {
            try std.testing.expectEqual(@as(?u32, null), overlay);
        }
    }

    for ([_]struct { source: []const u8, tag: std.meta.Tag(parser.ast.NodeData) }{
        .{ .source = "let = 1;", .tag = .assignment_expression },
        .{ .source = "let in object;", .tag = .binary_expression },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .js });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expect(findNode(&tree, case.tag) != null);
        try std.testing.expect(findNode(&tree, .variable_declaration) == null);
        try std.testing.expectEqual(@as(usize, 0), tree.dialect_store.overlays.items.len);
    }
}

test "production for transformation retains parser overlay node refs and spans" {
    const source = "const view = @for (const item of items; index item_index; key item.id) { <span /> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    var transformed: ?parser.ast.NodeIndex = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .jsx_for_expression => |jsx_for| transformed = @enumFromInt(jsx_for.statement.raw),
        else => {},
    };
    const transformed_node = transformed orelse return error.MissingTransformedFor;
    try std.testing.expectEqual(.for_of_statement, std.meta.activeTag(tree.data(transformed_node)));
    const transformed_overlay = tree.dialectOverlay(@intFromEnum(transformed_node)) orelse
        return error.MissingTransformedForOverlay;
    const transformed_record = tree.dialect_store.records.items[transformed_overlay].for_of;

    var source_record: ?parser.dialect_schema.ForOfOverlay = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .for_of => |for_of| if (for_of.host_node.raw != @intFromEnum(transformed_node)) {
            source_record = for_of;
        },
        else => {},
    };
    const original = source_record orelse return error.MissingParserForOverlay;
    try std.testing.expectEqual(original.index.raw, transformed_record.index.raw);
    try std.testing.expectEqual(original.key.raw, transformed_record.key.raw);

    const index: parser.ast.NodeIndex = @enumFromInt(transformed_record.index.raw);
    const key: parser.ast.NodeIndex = @enumFromInt(transformed_record.key.raw);
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(index)));
    try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
    try std.testing.expectEqualStrings("item_index", source[tree.span(index).start..tree.span(index).end]);
    try std.testing.expectEqualStrings("item.id", source[tree.span(key).start..tree.span(key).end]);
}

test "JSX-child for preserves index and key overlay" {
    const source = "const list = <ul>@for (const item of items; index slot; key item.id) { <li /> }</ul>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    var statement: ?parser.ast.NodeIndex = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .jsx_for_expression => |jsx_for| statement = @enumFromInt(jsx_for.statement.raw),
        else => {},
    };
    const for_of = statement orelse return error.MissingJsxChildFor;
    try std.testing.expectEqual(.for_of_statement, std.meta.activeTag(tree.data(for_of)));
    const overlay = tree.dialectOverlay(@intFromEnum(for_of)) orelse
        return error.MissingJsxChildForOverlay;
    const record = tree.dialect_store.records.items[overlay].for_of;
    const index: parser.ast.NodeIndex = @enumFromInt(record.index.raw);
    const key: parser.ast.NodeIndex = @enumFromInt(record.key.raw);
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(index)));
    try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
    try std.testing.expectEqualStrings("slot", source[tree.span(index).start..tree.span(index).end]);
    try std.testing.expectEqualStrings("item.id", source[tree.span(key).start..tree.span(key).end]);
}

test "JSX-child for accepts bare identifier left" {
    const source = "const list = <ul>@for (item of items; key item.id) { <li /> }</ul>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const directive = findDialectNode(&tree, .jsx_for_expression) orelse return error.MissingBareIdentifierFor;
    const directive_record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(directive)).?].jsx_for_expression;
    const for_of: parser.ast.NodeIndex = @enumFromInt(directive_record.statement.raw);
    try std.testing.expectEqual(.for_of_statement, std.meta.activeTag(tree.data(for_of)));
    const data = tree.data(for_of).for_of_statement;
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(data.left)));
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(data.right)));
    try std.testing.expectEqualStrings("item", source[tree.span(data.left).start..tree.span(data.left).end]);
    try std.testing.expectEqualStrings("items", source[tree.span(data.right).start..tree.span(data.right).end]);
    try std.testing.expectEqualStrings("@for (item of items; key item.id) { <li /> }", source[tree.span(directive).start..tree.span(directive).end]);
    try std.testing.expectEqualStrings("for (item of items; key item.id) { <li /> }", source[tree.span(for_of).start..tree.span(for_of).end]);

    const overlay = tree.dialectOverlay(@intFromEnum(for_of)) orelse
        return error.MissingBareIdentifierForOverlay;
    const record = tree.dialect_store.records.items[overlay].for_of;
    try std.testing.expectEqual(@intFromEnum(for_of), record.host_node.raw);
    try std.testing.expectEqual(@intFromEnum(parser.ast.NodeIndex.null), record.index.raw);
    const key: parser.ast.NodeIndex = @enumFromInt(record.key.raw);
    try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
    try std.testing.expectEqualStrings("item.id", source[tree.span(key).start..tree.span(key).end]);
    try expectRoundTrip(&tree);
}

test "Markless compatibility accepts static dynamic member tags" {
    const source = "const view = <{item.tag}></{item.tag}>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const member = findNode(&tree, .member_expression) orelse return error.MissingDynamicMemberTag;
    const data = tree.data(member).member_expression;
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(data.object)));
    try std.testing.expectEqual(.identifier_name, std.meta.activeTag(tree.data(data.property)));
    try std.testing.expectEqualStrings("item", source[tree.span(data.object).start..tree.span(data.object).end]);
    try std.testing.expectEqualStrings("tag", source[tree.span(data.property).start..tree.span(data.property).end]);
    try std.testing.expectEqualStrings("item.tag", source[tree.span(member).start..tree.span(member).end]);
    try expectRoundTrip(&tree);
}

test "Markless compatibility parses comparison conditions" {
    const source = "const view = @if (count > 0) { <p /> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const directive = findDialectNode(&tree, .jsx_if_expression) orelse return error.MissingComparisonIf;
    const record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(directive)).?].jsx_if_expression;
    const condition: parser.ast.NodeIndex = @enumFromInt(record.@"test".raw);
    const comparison = tree.data(condition).binary_expression;
    try std.testing.expectEqual(.greater_than, comparison.operator);
    try std.testing.expectEqualStrings("count > 0", source[tree.span(condition).start..tree.span(condition).end]);
    try std.testing.expectEqualStrings("@if (count > 0) { <p /> }", source[tree.span(directive).start..tree.span(directive).end]);
    try expectRoundTrip(&tree);
}

test "Markless compatibility parses compatible else-if spellings" {
    for ([_]struct { source: []const u8, nested_marker: []const u8 }{
        .{ .source = "const view = @if (a) { <a /> } @else if (b) { <b /> } @else { <c /> };", .nested_marker = "if (b)" },
        .{ .source = "const view = @if (a) { <a /> } @else @if (b) { <b /> } @else { <c /> };", .nested_marker = "@if (b)" },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const outer_start = std.mem.indexOf(u8, case.source, "@if").?;
        const nested_start = std.mem.indexOfPos(u8, case.source, outer_start + 3, case.nested_marker).?;
        const end = std.mem.lastIndexOfScalar(u8, case.source, '}').? + 1;
        const outer = findDialectNodeWithSpan(&tree, .jsx_if_expression, @intCast(outer_start), @intCast(end)) orelse
            return error.MissingOuterElseIf;
        const nested = findDialectNodeWithSpan(&tree, .jsx_if_expression, @intCast(nested_start), @intCast(end)) orelse
            return error.MissingNestedElseIf;
        const outer_record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(outer)).?].jsx_if_expression;
        const nested_record = tree.dialect_store.records.items[tree.dialectRecord(@intFromEnum(nested)).?].jsx_if_expression;
        try std.testing.expectEqual(@intFromEnum(nested), outer_record.alternate.raw);
        const final_alternate: parser.ast.NodeIndex = @enumFromInt(nested_record.alternate.raw);
        try std.testing.expectEqual(.block_statement, std.meta.activeTag(tree.data(final_alternate)));
        try std.testing.expectEqual(@as(u32, @intCast(end)), tree.span(final_alternate).end);
        const nested_condition: parser.ast.NodeIndex = @enumFromInt(nested_record.@"test".raw);
        try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(nested_condition)));
        try std.testing.expectEqualStrings("b", case.source[tree.span(nested_condition).start..tree.span(nested_condition).end]);
        try expectRoundTrip(&tree);
    }
}

test "Markless compatibility copies nested for overlay references" {
    const source = "export function App() @{ @for (const item of items; index slot; key item.id) { <p /> } }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    var transformed: ?parser.ast.NodeIndex = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .jsx_for_expression => |jsx_for| transformed = @enumFromInt(jsx_for.statement.raw),
        else => {},
    };
    const transformed_node = transformed orelse return error.MissingNestedTransformedFor;
    const transformed_overlay = tree.dialectOverlay(@intFromEnum(transformed_node)) orelse
        return error.MissingNestedCopiedForOverlay;
    const copied = tree.dialect_store.records.items[transformed_overlay].for_of;

    var source_record: ?parser.dialect_schema.ForOfOverlay = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .for_of => |for_of| if (for_of.host_node.raw != @intFromEnum(transformed_node)) {
            source_record = for_of;
        },
        else => {},
    };
    const original = source_record orelse return error.MissingNestedParserForOverlay;
    try std.testing.expectEqual(original.index.raw, copied.index.raw);
    try std.testing.expectEqual(original.key.raw, copied.key.raw);
    const index: parser.ast.NodeIndex = @enumFromInt(copied.index.raw);
    const key: parser.ast.NodeIndex = @enumFromInt(copied.key.raw);
    try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(index)));
    try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
    try std.testing.expectEqualStrings("slot", source[tree.span(index).start..tree.span(index).end]);
    try std.testing.expectEqualStrings("item.id", source[tree.span(key).start..tree.span(key).end]);
    try expectRoundTrip(&tree);
}

test "for-of dialect labels preserve direct JSX-child key-only overlay" {
    const source = "const view = <ul>@for (const row of rows; key row.id) { <li /> }</ul>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    try expectKeyOnlyFor(&tree, source);
}

test "for-of dialect labels preserve code-block key-only overlay" {
    const source = "export function App() @{ @for (const row of rows; key row.id) { <li /> } }";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    try expectKeyOnlyFor(&tree, source);
}

test "for-of dialect labels preserve nested statement-host key-only overlay" {
    const source = "const view = @if (ready) { @for (const row of rows; key row.id) { <li /> } };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    try expectKeyOnlyFor(&tree, source);
}

test "for-of dialect labels preserve statement-host valid tails" {
    for ([_]struct { source: []const u8, index_text: ?[]const u8, key_text: ?[]const u8 }{
        .{ .source = "export function App() @{ @for (const row of rows; index slot) { <li /> } }", .index_text = "slot", .key_text = null },
        .{ .source = "export function App() @{ @for (const row of rows; index slot; key row.id) { <li /> } }", .index_text = "slot", .key_text = "row.id" },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());
        try expectForOverlay(&tree, case.source, case.index_text, case.key_text);
        try expectRoundTrip(&tree);
    }
}

test "for-of dialect labels reject malformed statement-host tails deterministically" {
    for ([_][]const u8{
        "export function App() @{ @for (const row of rows; position slot) { <li /> } }",
        "export function App() @{ @for (const row of rows; index slot; index other) { <li /> } }",
        "export function App() @{ @for (const row of rows; key row.id; index slot) { <li /> } }",
        "export function App() @{ @for (const row of rows; slot) { <li /> } }",
        "export function App() @{ @for (const row of rows; key) { <li /> } }",
        "export function App() @{ @for (const row of rows; index slot; key row.id; extra value) { <li /> } }",
        "export function App() @{ @for (const row of rows; key row.id;) { <li /> } }",
    }) |source| {
        var first = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer first.deinit();
        var second = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer second.deinit();
        try std.testing.expect(first.hasErrors());
        try std.testing.expectEqual(first.diagnostics.items.len, second.diagnostics.items.len);
        for (first.diagnostics.items, second.diagnostics.items) |left, right| {
            try std.testing.expectEqualStrings(left.message, right.message);
            try std.testing.expectEqual(left.span, right.span);
        }
        try std.testing.expectEqual(@as(usize, 0), first.dialect_store.overlays.items.len);
    }
}

test "production binding prefix deterministically rejects non-pattern targets" {
    for ([_][]const u8{
        "function invalid(&name: string) {}",
        "function invalid(&42) {}",
    }) |source| {
        var first = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
        defer first.deinit();
        var second = try parser.parse(std.testing.allocator, source, .{ .lang = .ts });
        defer second.deinit();
        try std.testing.expect(first.hasErrors());
        try std.testing.expectEqual(first.diagnostics.items.len, second.diagnostics.items.len);
        for (first.diagnostics.items, second.diagnostics.items) |left, right| {
            try std.testing.expectEqualStrings(left.message, right.message);
            try std.testing.expectEqual(left.span, right.span);
        }
        try std.testing.expectEqual(@as(usize, 0), first.dialect_store.records.items.len);
        try std.testing.expectEqual(@as(usize, 0), first.dialect_store.overlays.items.len);
    }
}

fn expectRoundTrip(tree: *const parser.ParseResult) !void {
    const bytes = try std.testing.allocator.alignedAlloc(u8, .@"4", transfer.bufferSize(tree));
    defer std.testing.allocator.free(bytes);
    _ = transfer.serializeInto(tree, bytes);
    var restored = try transfer.deserializeFromBuf(std.testing.allocator, bytes, tree.source);
    defer restored.deinit();
    try std.testing.expectEqualDeep(tree.dialect_store.records.items, restored.dialect_store.records.items);
    try std.testing.expectEqualDeep(tree.dialect_store.overlays.items, restored.dialect_store.overlays.items);
}

fn expectKeyOnlyFor(tree: *const parser.ParseResult, source: []const u8) !void {
    try expectForOverlay(tree, source, null, "row.id");
    try expectRoundTrip(tree);
}

fn expectForOverlay(
    tree: *const parser.ParseResult,
    source: []const u8,
    expected_index: ?[]const u8,
    expected_key: ?[]const u8,
) !void {
    var statement: ?parser.ast.NodeIndex = null;
    for (tree.dialect_store.records.items) |record| switch (record) {
        .jsx_for_expression => |jsx_for| statement = @enumFromInt(jsx_for.statement.raw),
        else => {},
    };
    const for_of = statement orelse return error.MissingKeyOnlyFor;
    try std.testing.expectEqual(.for_of_statement, std.meta.activeTag(tree.data(for_of)));
    const overlay = tree.dialectOverlay(@intFromEnum(for_of)) orelse return error.MissingKeyOnlyForOverlay;
    const record = tree.dialect_store.records.items[overlay].for_of;
    if (expected_index) |text| {
        const index: parser.ast.NodeIndex = @enumFromInt(record.index.raw);
        try std.testing.expectEqual(.identifier_reference, std.meta.activeTag(tree.data(index)));
        try std.testing.expectEqualStrings(text, source[tree.span(index).start..tree.span(index).end]);
    } else try std.testing.expectEqual(@intFromEnum(parser.ast.NodeIndex.null), record.index.raw);
    if (expected_key) |text| {
        const key: parser.ast.NodeIndex = @enumFromInt(record.key.raw);
        try std.testing.expectEqual(.member_expression, std.meta.activeTag(tree.data(key)));
        try std.testing.expectEqualStrings(text, source[tree.span(key).start..tree.span(key).end]);
    } else try std.testing.expectEqual(@intFromEnum(parser.ast.NodeIndex.null), record.key.raw);
}

fn findNode(tree: *const parser.ParseResult, tag: std.meta.Tag(parser.ast.NodeData)) ?parser.ast.NodeIndex {
    for (tree.tree.nodes.items(.data), 0..) |data, index| {
        if (std.meta.activeTag(data) == tag) return @enumFromInt(index);
    }
    return null;
}

fn findNodeWithSpan(
    tree: *const parser.ParseResult,
    tag: std.meta.Tag(parser.ast.NodeData),
    start: u32,
    end: u32,
) ?parser.ast.NodeIndex {
    for (tree.tree.nodes.items(.data), tree.tree.nodes.items(.span), 0..) |data, span, index| {
        if (std.meta.activeTag(data) == tag and span.start == start and span.end == end) return @enumFromInt(index);
    }
    return null;
}

fn findDialectNode(tree: *const parser.ParseResult, tag: std.meta.Tag(parser.dialect_schema.Record)) ?parser.ast.NodeIndex {
    for (tree.dialect_store.associations.items) |association| {
        if (std.meta.activeTag(tree.dialect_store.records.items[association.record_index]) == tag)
            return @enumFromInt(association.anchor);
    }
    return null;
}

fn findDialectNodeWithSpan(
    tree: *const parser.ParseResult,
    tag: std.meta.Tag(parser.dialect_schema.Record),
    start: u32,
    end: u32,
) ?parser.ast.NodeIndex {
    for (tree.dialect_store.associations.items) |association| {
        const node: parser.ast.NodeIndex = @enumFromInt(association.anchor);
        const span = tree.span(node);
        if (std.meta.activeTag(tree.dialect_store.records.items[association.record_index]) == tag and span.start == start and span.end == end)
            return node;
    }
    return null;
}
