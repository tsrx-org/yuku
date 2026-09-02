const std = @import("std");
const parser = @import("parser");

test "the recoverable early-error set is exactly the redeclaration family" {
    // Kept tight on purpose: yuku carries no diagnostic codes, so the message
    // is all there is to key on, and every extra entry is another module the
    // bundler stops rejecting. See src/dialect/diagnostics.zig.
    try std.testing.expect(
        parser.diagnostics.isRecoverable("Identifier 'repeated' has already been declared"),
    );
    try std.testing.expect(
        parser.diagnostics.isRecoverable("Identifier '#a' has already been declared"),
    );
    try std.testing.expect(!parser.diagnostics.isRecoverable("Export 'a' is not defined"));
    try std.testing.expect(!parser.diagnostics.isRecoverable("Duplicate export of 'n'"));
    try std.testing.expect(!parser.diagnostics.isRecoverable("'with' in strict mode"));
    // an empty name is not a message the checker emits
    try std.testing.expect(
        !parser.diagnostics.isRecoverable("Identifier '' has already been declared"),
    );
}

/// Analyzes `source` the way the FFI parse entry point does and returns the
/// diagnostics the wire would carry.
fn boundaryDiagnostics(
    tree: *parser.ParseResult,
) []const parser.ast.Diagnostic {
    parser.diagnostics.analyzeWithBoundarySeverity(tree);
    return tree.tree.diagnostics.items;
}

fn findDiagnostic(
    diagnostics: []const parser.ast.Diagnostic,
    needle: []const u8,
) ?parser.ast.Diagnostic {
    for (diagnostics) |diagnostic| {
        if (std.mem.indexOf(u8, diagnostic.message, needle) != null) return diagnostic;
    }
    return null;
}

test "an undeclared export stays a fatal early error" {
    // The exact chunk shape that regressed: a Vite preload helper whose body
    // was stripped while its export clause survived. `@tsrx/core` throws here
    // (ES2015 16.2.1.5.1) and markless's preload-cleanup guard reads that
    // throw as "this chunk still has live exports". Anything short of
    // `.@"error"` here silently reintroduces the 62-byte chunk V8 rejects.
    const source = "import{t as e}from\"./c.js\";export{a as n,i as t};";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .js });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const diagnostics = boundaryDiagnostics(&tree);
    const undeclared = findDiagnostic(diagnostics, "Export 'a' is not defined") orelse
        return error.MissingUndeclaredExportDiagnostic;
    try std.testing.expectEqual(parser.ast.Severity.@"error", undeclared.severity);
    try std.testing.expect(tree.tree.hasErrors());
}

test "a duplicate binding stays a recoverable early error" {
    // Markless re-reports redeclarations itself as recoverable `usage`
    // diagnostics so a half-typed editor buffer still produces virtual code.
    // Reporting them at `.@"error"` here makes the module boundary throw and
    // closes those editor flows, so the checker's severity is lowered instead
    // of the diagnostic being dropped -- `parse()` consumers still see it.
    const source =
        "export default function Duplicate() @{\n" ++
        "\tlet repeated = 1;\n" ++
        "\tlet repeated = 2;\n" ++
        "\t<span>{repeated}</span>\n" ++
        "}";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const diagnostics = boundaryDiagnostics(&tree);
    const duplicate = findDiagnostic(
        diagnostics,
        "Identifier 'repeated' has already been declared",
    ) orelse return error.MissingDuplicateBindingDiagnostic;
    try std.testing.expectEqual(parser.ast.Severity.warning, duplicate.severity);
    // recoverable on its own: nothing here makes the module unusable
    try std.testing.expect(!tree.tree.hasErrors());
}

test "a duplicate binding does not mask a fatal export in the same module" {
    const source = "let a = 1;\nlet a = 2;\nexport{missing as gone};";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .js });
    defer tree.deinit();

    const diagnostics = boundaryDiagnostics(&tree);
    const duplicate = findDiagnostic(
        diagnostics,
        "Identifier 'a' has already been declared",
    ) orelse return error.MissingDuplicateBindingDiagnostic;
    const undeclared = findDiagnostic(diagnostics, "Export 'missing' is not defined") orelse
        return error.MissingUndeclaredExportDiagnostic;
    try std.testing.expectEqual(parser.ast.Severity.warning, duplicate.severity);
    try std.testing.expectEqual(parser.ast.Severity.@"error", undeclared.severity);
    try std.testing.expect(tree.tree.hasErrors());
}

test "boundary severity survives a tree parsed under recovery" {
    // The editor path parses broken buffers loosely; classification must not
    // depend on analysis completing.
    const source = "export default function Broken() @{ <div>";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx, .loose = true });
    defer tree.deinit();
    const parse_errors = tree.tree.diagnostics.items.len;
    try std.testing.expect(parse_errors > 0);

    const diagnostics = boundaryDiagnostics(&tree);
    try std.testing.expect(diagnostics.len >= parse_errors);
    try std.testing.expect(tree.tree.hasErrors());
}

test "dialect children participate in semantic analysis" {
    // References inside a code block resolve through reflected dialect children.
    const source = "const outer = 1; const view = @{ const inner = outer; <p>{inner}</p> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const semantic = try parser.semantic.analyze(&tree);
    var resolved: u32 = 0;
    resolved = @intCast(semantic.references.len);
    try std.testing.expect(resolved >= 2);
}

test "dialect codegen reparses without diagnostics" {
    // The printer callback emits grammar, then the strict parser validates it.
    const source = "const view = @if (ready) { <p /> } @else { <span /> };";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
}

test "lazy object assignment prefix disambiguates statement lead" {
    // Lazy overlays remove only the wrapper made unnecessary by their emitted prefix.
    const Case = struct {
        source: []const u8,
        expected: []const u8,
        lazy: bool,
        parenthesized: bool,
    };
    for ([_]Case{
        .{
            .source = "({ title } = props);",
            .expected = "({ title } = props);",
            .lazy = false,
            .parenthesized = true,
        },
        .{
            .source = "&{ title } = props;",
            .expected = "&{ title } = props;",
            .lazy = true,
            .parenthesized = false,
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);
        try std.testing.expectEqualStrings(case.expected, result.code);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());
        try expectObjectAssignment(&reparsed, case.lazy, case.parenthesized);
    }
}

test "lazy object assignment remains wrapped in arrow body" {
    // Arrow bodies keep the wrapper required to preserve their assignment shape.
    const source = "const update = () => (&{ title } = props);";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    try std.testing.expectEqualStrings(source, result.code);

    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
    const program = reparsed.data(reparsed.root).program;
    const body = reparsed.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const declaration = reparsed.data(body[0]).variable_declaration;
    const declarators = reparsed.extra(declaration.declarators);
    try std.testing.expectEqual(@as(usize, 1), declarators.len);
    const declarator = reparsed.data(declarators[0]).variable_declarator;
    const arrow = reparsed.data(declarator.init).arrow_function_expression;
    try std.testing.expect(arrow.expression);
    try std.testing.expectEqual(
        .parenthesized_expression,
        std.meta.activeTag(reparsed.data(arrow.body)),
    );
    const expression = reparsed.data(arrow.body).parenthesized_expression.expression;
    const assignment = reparsed.data(expression).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(reparsed.data(assignment.left)));
    const record_index = reparsed.dialectOverlay(@intFromEnum(assignment.left));
    try std.testing.expect(record_index != null);
    const record = reparsed.dialect_store.records.items[record_index.?];
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
    try std.testing.expect(record.object_pattern.lazy);
}

test "lazy object assignment prefix disambiguates direct arrow body" {
    // Direct arrow bodies preserve assignment shape through the emitted lazy prefix.
    const source = "const update = () => &{ title } = props;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());

    const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
    defer result.deinit(std.testing.allocator);
    try std.testing.expectEqual(@as(usize, 0), result.errors.len);
    try std.testing.expectEqualStrings(source, result.code);

    var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
    defer reparsed.deinit();
    try std.testing.expect(!reparsed.hasErrors());
    const program = reparsed.data(reparsed.root).program;
    const body = reparsed.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const declaration = reparsed.data(body[0]).variable_declaration;
    const declarators = reparsed.extra(declaration.declarators);
    try std.testing.expectEqual(@as(usize, 1), declarators.len);
    const declarator = reparsed.data(declarators[0]).variable_declarator;
    const arrow = reparsed.data(declarator.init).arrow_function_expression;
    try std.testing.expect(arrow.expression);
    try std.testing.expectEqual(
        .assignment_expression,
        std.meta.activeTag(reparsed.data(arrow.body)),
    );
    const assignment = reparsed.data(arrow.body).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(reparsed.data(assignment.left)));
    const record_index = reparsed.dialectOverlay(@intFromEnum(assignment.left));
    try std.testing.expect(record_index != null);
    const record = reparsed.dialect_store.records.items[record_index.?];
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
    try std.testing.expect(record.object_pattern.lazy);
}

test "every control-flow directive family parses as a JSX child" {
    // `@for`/`@switch`/`@try` reach the dialect's JSX children loop through the
    // same `jsx_element_after_open` seam as `@if`, and each has to leave the
    // enclosing element closed behind it.
    const Case = struct { source: []const u8, tag: []const u8 };
    for ([_]Case{
        .{
            .source = "const view = <div>@if (ready) {<p>a</p>}</div>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <div>@if (ready) {<p>a</p>} @else {<p>b</p>}</div>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items) {<p>a</p>} @empty {<p>b</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const item of items; index i; key item.id) {<p>a</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (const { id } of items) {<p>{id}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@for (let i = 0; i < total; i++) {<p>{i}</p>}</div>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <div>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</div>;",
            .tag = "jsx_switch_expression",
        },
        .{
            .source = "const view = <div>@try {<p>a</p>} @catch (error) {<p>b</p>}</div>;",
            .tag = "jsx_try_expression",
        },
        .{
            .source = "const view = <div>@try {<p>a</p>} @pending {<p>b</p>}</div>;",
            .tag = "jsx_try_expression",
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());

        const element = declaredJsxElement(&tree);
        try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

        const children = dialectChildTags(&tree, element);
        try std.testing.expectEqual(@as(usize, 1), children.len);
        try std.testing.expectEqualStrings(case.tag, children.tags[0]);
    }
}

test "member-expression tag children accept the constructs identifier tag children do" {
    // The dialect only owns an element whose closing tag it can also parse, so
    // a closing name that stopped at the first identifier declined every `a.b`
    // tag and handed `@` back to the host children loop.
    const Case = struct { member: []const u8, identifier: []const u8, tag: []const u8 };
    for ([_]Case{
        .{
            .member = "const view = <select.content>@for (const item of items; key item) {<li>{item}</li>}</select.content>;",
            .identifier = "const view = <content>@for (const item of items; key item) {<li>{item}</li>}</content>;",
            .tag = "jsx_for_expression",
        },
        .{
            .member = "const view = <select.content>@if (ready) {<p>a</p>} @else {<p>b</p>}</select.content>;",
            .identifier = "const view = <content>@if (ready) {<p>a</p>} @else {<p>b</p>}</content>;",
            .tag = "jsx_if_expression",
        },
        .{
            .member = "const view = <a.b.c>@for (const item of items) {<p>{item}</p>}</a.b.c>;",
            .identifier = "const view = <c>@for (const item of items) {<p>{item}</p>}</c>;",
            .tag = "jsx_for_expression",
        },
        .{
            .member = "const view = <a.b><li>head</li>@if (ready) {<p>a</p>}tail</a.b>;",
            .identifier = "const view = <b><li>head</li>@if (ready) {<p>a</p>}tail</b>;",
            .tag = "jsx_if_expression",
        },
        .{
            .member = "const view = <a.b>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</a.b>;",
            .identifier = "const view = <b>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</b>;",
            .tag = "jsx_switch_expression",
        },
    }) |case| {
        var member_tree = try parser.parse(std.testing.allocator, case.member, .{ .lang = .tsx });
        defer member_tree.deinit();
        // the host cascade - `Expected JSX element name, but found '/'` - only
        // disappears when the dialect owns the element outright
        try std.testing.expectEqual(@as(usize, 0), member_tree.diagnostics.items.len);
        try std.testing.expect(!member_tree.hasErrors());

        var identifier_tree = try parser.parse(std.testing.allocator, case.identifier, .{ .lang = .tsx });
        defer identifier_tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), identifier_tree.diagnostics.items.len);
        try std.testing.expect(!identifier_tree.hasErrors());

        const member_element = declaredJsxElement(&member_tree);
        const identifier_element = declaredJsxElement(&identifier_tree);
        const member_data = member_tree.data(member_element).jsx_element;
        const identifier_data = identifier_tree.data(identifier_element).jsx_element;

        try std.testing.expect(member_data.closing_element != .null);
        try std.testing.expectEqual(
            .jsx_member_expression,
            std.meta.activeTag(member_tree.data(openingName(&member_tree, member_data.opening_element))),
        );
        try std.testing.expectEqual(
            .jsx_member_expression,
            std.meta.activeTag(member_tree.data(closingName(&member_tree, member_data.closing_element))),
        );

        const member_children = member_tree.extra(member_data.children);
        const identifier_children = identifier_tree.extra(identifier_data.children);
        try std.testing.expectEqual(identifier_children.len, member_children.len);
        for (member_children, identifier_children) |mine, theirs| {
            try std.testing.expectEqual(
                std.meta.activeTag(identifier_tree.data(theirs)),
                std.meta.activeTag(member_tree.data(mine)),
            );
        }

        const member_tags = dialectChildTags(&member_tree, member_element);
        const identifier_tags = dialectChildTags(&identifier_tree, identifier_element);
        try std.testing.expectEqual(identifier_tags.len, member_tags.len);
        try std.testing.expect(member_tags.len >= 1);
        try std.testing.expectEqualStrings(case.tag, member_tags.tags[0]);
        for (0..member_tags.len) |index| {
            try std.testing.expectEqualStrings(identifier_tags.tags[index], member_tags.tags[index]);
        }
    }
}

test "a deep member tag name nests the same way in the opening and closing tag" {
    const source = "const view = <a.b.c>@for (const item of items) {<p>a</p>}</a.b.c>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);

    const element = tree.data(declaredJsxElement(&tree)).jsx_element;
    const opening = openingName(&tree, element.opening_element);
    const closing = closingName(&tree, element.closing_element);
    try std.testing.expectEqualStrings("a.b.c", source[tree.span(closing).start..tree.span(closing).end]);
    try std.testing.expectEqual(
        tree.span(opening).end - tree.span(opening).start,
        tree.span(closing).end - tree.span(closing).start,
    );

    const outer = tree.data(closing).jsx_member_expression;
    try std.testing.expectEqual(.jsx_identifier, std.meta.activeTag(tree.data(outer.property)));
    const inner = tree.data(outer.object).jsx_member_expression;
    try std.testing.expectEqual(.jsx_identifier, std.meta.activeTag(tree.data(inner.object)));
    try std.testing.expectEqual(.jsx_identifier, std.meta.activeTag(tree.data(inner.property)));
}

test "member tag children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <select.content>@for (const item of items) {<li>{item}</li>}</select.content>;",
        "const view = <a.b.c>@if (ready) {<p>a</p>} @else {<p>b</p>}</a.b.c>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());

        const expected = dialectChildTags(&tree, declaredJsxElement(&tree));
        const actual = dialectChildTags(&reparsed, declaredJsxElement(&reparsed));
        try std.testing.expectEqual(@as(usize, 1), actual.len);
        try std.testing.expectEqualStrings(expected.tags[0], actual.tags[0]);
    }
}

test "control-flow directives parse in template blocks and at statement position" {
    // The same directive bodies have to terminate cleanly when the directive is
    // not the last thing in its enclosing block.
    for ([_][]const u8{
        "const view = @{ @for (const item of items) {<p>{item}</p>} };",
        "const view = @{ @for (const item of items) { const label = item; <p>{label}</p> } };",
        "const view = @{ @switch (kind) {@case 1: {<p>a</p>}} };",
        "const view = @{ @for (const item of items) {<p>a</p>} @if (ready) {<b>b</b>} };",
        "const view = @{ @for (const item of items) {<p>a</p>} const trailing = 1; <p>{trailing}</p> };",
        "@for (const item of items) {<p>a</p>}",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());
        try std.testing.expect(tree.dialect_store.associations.items.len >= 1);
    }
}

test "a JSX child directive ends at its own closing brace" {
    // The children loop resumes its text scan at the child's span end, so a
    // directive node that over- or under-reports its end silently desyncs every
    // sibling that follows it.
    const source = "const view = <div>@for (const item of items) {<li>a</li>}@if (ready) {<b>b</b>}tail</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxElement(&tree);
    try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

    const children = dialectChildTags(&tree, element);
    try std.testing.expectEqual(@as(usize, 2), children.len);
    try std.testing.expectEqualStrings("jsx_for_expression", children.tags[0]);
    try std.testing.expectEqualStrings("jsx_if_expression", children.tags[1]);

    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 3), nodes.len);
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "@for").?)),
        tree.span(nodes[0]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "}@if").? + 1)),
        tree.span(nodes[0]).end,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "}tail").? + 1)),
        tree.span(nodes[1]).end,
    );
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[2])));
    try std.testing.expectEqualStrings("tail", tree.string(tree.data(nodes[2]).jsx_text.value));
}

test "control-flow JSX children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;",
        "const view = <div>@for (const item of items; index i; key item.id) {<p>a</p>}</div>;",
        "const view = <div>@for (const item of items) {<p>a</p>} @empty {<p>b</p>}</div>;",
        "const view = <div>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</div>;",
        "const view = <div>@try {<p>a</p>} @catch (error) {<p>b</p>}</div>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());

        const element = declaredJsxElement(&tree);
        const expected = dialectChildTags(&tree, element);
        const reparsed_element = declaredJsxElement(&reparsed);
        const actual = dialectChildTags(&reparsed, reparsed_element);
        try std.testing.expectEqual(expected.len, actual.len);
        try std.testing.expectEqual(@as(usize, 1), actual.len);
        try std.testing.expectEqualStrings(expected.tags[0], actual.tags[0]);
    }
}

test "a JSX child for-of binding resolves inside its body" {
    const source = "const view = <div>@for (const item of items) {<p>{item}</p>}</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expect(!tree.hasErrors());
    const semantic = try parser.semantic.analyze(&tree);
    try std.testing.expect(semantic.references.len >= 2);
}

test "every control-flow directive family parses at JSX fragment root" {
    // Fragments reach the dialect's children loop through `jsx_fragment_after_open`,
    // the fragment-shaped twin of the seam elements use.
    const Case = struct { source: []const u8, tag: []const u8 };
    for ([_]Case{
        .{
            .source = "const view = <>@if (ready) {<p>a</p>}</>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <>@if (ready) {<p>a</p>} @else {<p>b</p>}</>;",
            .tag = "jsx_if_expression",
        },
        .{
            .source = "const view = <>@for (const item of items) {<p>{item}</p>}</>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <>@for (const item of items) {<p>a</p>} @empty {<p>b</p>}</>;",
            .tag = "jsx_for_expression",
        },
        .{
            .source = "const view = <>@switch (kind) {@case 1: {<p>a</p>} @default: {<p>b</p>}}</>;",
            .tag = "jsx_switch_expression",
        },
        .{
            .source = "const view = <>@try {<p>a</p>} @pending {<p>b</p>}</>;",
            .tag = "jsx_try_expression",
        },
        .{
            .source = "const view = <>@try {<p>a</p>} @catch (error) {<p>b</p>}</>;",
            .tag = "jsx_try_expression",
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());

        const fragment = declaredJsxFragment(&tree);
        try std.testing.expect(tree.data(fragment).jsx_fragment.closing_fragment != .null);

        const children = dialectChildTags(&tree, fragment);
        try std.testing.expectEqual(@as(usize, 1), children.len);
        try std.testing.expectEqualStrings(case.tag, children.tags[0]);
    }
}

test "a fragment root directive ends at its own closing brace" {
    const source = "const view = <>@for (const item of items) {<li>a</li>}@if (ready) {<b>b</b>}tail</>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const fragment = declaredJsxFragment(&tree);
    const children = dialectChildTags(&tree, fragment);
    try std.testing.expectEqual(@as(usize, 2), children.len);
    try std.testing.expectEqualStrings("jsx_for_expression", children.tags[0]);
    try std.testing.expectEqualStrings("jsx_if_expression", children.tags[1]);

    const nodes = tree.extra(tree.data(fragment).jsx_fragment.children);
    try std.testing.expectEqual(@as(usize, 3), nodes.len);
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "@for").?)),
        tree.span(nodes[0]).start,
    );
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[2])));
    try std.testing.expectEqualStrings("tail", tree.string(tree.data(nodes[2]).jsx_text.value));
    try std.testing.expectEqual(
        @as(u32, @intCast(source.len - ";".len)),
        tree.span(fragment).end,
    );
}

test "a directive-free fragment keeps the parser's own children" {
    var tree = try parser.parse(std.testing.allocator, "const view = <><p>a</p>{b}</>;", .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);

    const fragment = declaredJsxFragment(&tree);
    const nodes = tree.extra(tree.data(fragment).jsx_fragment.children);
    try std.testing.expectEqual(@as(usize, 2), nodes.len);
    try std.testing.expectEqual(.jsx_element, std.meta.activeTag(tree.data(nodes[0])));
    try std.testing.expectEqual(.jsx_expression_container, std.meta.activeTag(tree.data(nodes[1])));
}

test "fragment root control-flow children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <>@if (ready) {<p>a</p>} @else {<p>b</p>}</>;",
        "const view = <>@for (const item of items) {<p>{item}</p>}</>;",
        "const view = <>@try {<p>a</p>} @pending {<p>b</p>}</>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());
    }
}

fn declaredJsxFragment(tree: *const parser.ParseResult) parser.ast.NodeIndex {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    const declaration = tree.data(body[0]).variable_declaration;
    const declarators = tree.extra(declaration.declarators);
    const fragment = tree.data(declarators[0]).variable_declarator.init;
    std.debug.assert(tree.data(fragment) == .jsx_fragment);
    return fragment;
}

fn openingName(tree: *const parser.ParseResult, opening: parser.ast.NodeIndex) parser.ast.NodeIndex {
    return tree.data(opening).jsx_opening_element.name;
}

fn closingName(tree: *const parser.ParseResult, closing: parser.ast.NodeIndex) parser.ast.NodeIndex {
    return tree.data(closing).jsx_closing_element.name;
}

fn declaredJsxElement(tree: *const parser.ParseResult) parser.ast.NodeIndex {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    const declaration = tree.data(body[0]).variable_declaration;
    const declarators = tree.extra(declaration.declarators);
    const element = tree.data(declarators[0]).variable_declarator.init;
    std.debug.assert(tree.data(element) == .jsx_element);
    return element;
}

const DialectChildTags = struct {
    tags: [8][]const u8 = undefined,
    len: usize = 0,
};

fn dialectChildTags(
    tree: *const parser.ParseResult,
    host: parser.ast.NodeIndex,
) DialectChildTags {
    var found: DialectChildTags = .{};
    const host_children = switch (tree.data(host)) {
        .jsx_element => |value| value.children,
        .jsx_fragment => |value| value.children,
        else => unreachable,
    };
    for (tree.extra(host_children)) |child| {
        const index = tree.dialectRecord(@intFromEnum(child)) orelse continue;
        if (found.len == found.tags.len) break;
        found.tags[found.len] = @tagName(tree.dialect_store.records.items[index]);
        found.len += 1;
    }
    return found;
}

fn expectObjectAssignment(
    tree: *const parser.ParseResult,
    lazy: bool,
    parenthesized: bool,
) !void {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    try std.testing.expectEqual(@as(usize, 1), body.len);
    const statement = tree.data(body[0]).expression_statement;
    var expression = statement.expression;
    if (parenthesized) {
        try std.testing.expectEqual(
            .parenthesized_expression,
            std.meta.activeTag(tree.data(expression)),
        );
        expression = tree.data(expression).parenthesized_expression.expression;
    } else {
        try std.testing.expectEqual(
            .assignment_expression,
            std.meta.activeTag(tree.data(expression)),
        );
    }
    const assignment = tree.data(expression).assignment_expression;
    try std.testing.expectEqual(.object_pattern, std.meta.activeTag(tree.data(assignment.left)));
    const record_index = tree.dialectOverlay(@intFromEnum(assignment.left));
    if (lazy) {
        try std.testing.expect(record_index != null);
        const record = tree.dialect_store.records.items[record_index.?];
        try std.testing.expectEqual(.object_pattern, std.meta.activeTag(record));
        try std.testing.expect(record.object_pattern.lazy);
    } else {
        try std.testing.expectEqual(@as(?u32, null), record_index);
    }
}

/// Shape of one JSX child, coarse enough to describe an interleaving without
/// pinning the whole subtree.
const ChildShape = enum { text, element, fragment, directive, expression, other };

fn childShapes(
    tree: *const parser.ParseResult,
    element: parser.ast.NodeIndex,
    buffer: []ChildShape,
) []const ChildShape {
    const children = switch (tree.data(element)) {
        .jsx_element => |value| tree.extra(value.children),
        .jsx_fragment => |value| tree.extra(value.children),
        else => &[_]parser.ast.NodeIndex{},
    };
    var len: usize = 0;
    for (children) |child| {
        if (len == buffer.len) break;
        buffer[len] = switch (tree.data(child)) {
            .jsx_text => .text,
            .jsx_element => .element,
            .jsx_fragment => .fragment,
            .jsx_expression_container => .expression,
            else => if (tree.dialectRecord(@intFromEnum(child)) != null)
                .directive
            else
                .other,
        };
        len += 1;
    }
    return buffer[0..len];
}

fn declaredJsxRoot(tree: *const parser.ParseResult) parser.ast.NodeIndex {
    const program = tree.data(tree.root).program;
    const body = tree.extra(program.body);
    const declaration = tree.data(body[0]).variable_declaration;
    const declarators = tree.extra(declaration.declarators);
    return tree.data(declarators[0]).variable_declarator.init;
}

test "TSRX directives interleave with sibling element children" {
    // The dialect owns the children loop of any element that holds a directive,
    // so that loop - not just the host's - has to accept element children on
    // either side of the directive instead of mistaking the first '<' it meets
    // for the closing tag.
    const Case = struct {
        source: []const u8,
        shapes: []const ChildShape,
    };
    for ([_]Case{
        // directive then element
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <span>x</span></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // element then directive
        .{
            .source = "const view = <div><span>x</span> @if (a) {<p>y</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // directive, text, element
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} hi <b>x</b></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // capitalised component child after a directive
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <Link>x</Link></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // self-closing component child before a directive
        .{
            .source = "const view = <div><Link /> @if (a) {<p>y</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // full interleaving in both directions
        .{
            .source = "const view = <div>a <b>c</b> @if (a) {<p>y</p>} d <i>e</i> tail</div>;",
            .shapes = &.{ .text, .element, .text, .directive, .text, .element, .text },
        },
        // nested fragment among directives
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <><b>x</b></> @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .directive, .text, .fragment, .text, .directive },
        },
        // a child element that carries its own directive
        .{
            .source = "const view = <div><Card>@if (a) {<p>y</p>}</Card> @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .element, .text, .directive },
        },
        // element child holding an expression container next to a directive
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} <b>{value}</b></div>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // a code-block directive interleaved with elements
        .{
            .source = "const view = <div><b>x</b> @{ <p>y</p> } <i>z</i></div>;",
            .shapes = &.{ .element, .text, .directive, .text, .element },
        },
        // guard: directive-only children keep working
        .{
            .source = "const view = <div>@if (a) {<p>y</p>}</div>;",
            .shapes = &.{.directive},
        },
        // guard: two directives keep working
        .{
            .source = "const view = <div>@if (a) {<p>y</p>} @if (b) {<p>z</p>}</div>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // guard: element-only children stay on the host path
        .{
            .source = "const view = <div><span>x</span></div>;",
            .shapes = &.{.element},
        },
        // guard: a plain fragment stays on the host path
        .{
            .source = "const view = <><p>a</p></>;",
            .shapes = &.{.element},
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            for (tree.diagnostics.items) |diagnostic| {
                std.debug.print("  diagnostic: {s}\n", .{diagnostic.message});
            }
            return err;
        };
        try std.testing.expect(!tree.hasErrors());

        var buffer: [12]ChildShape = undefined;
        const shapes = childShapes(&tree, declaredJsxRoot(&tree), &buffer);
        std.testing.expectEqualSlices(ChildShape, case.shapes, shapes) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            return err;
        };
    }
}

test "TSRX directives interleave with expression container children" {
    // `{expr}` is the third kind of child the dialect's own children loop has
    // to recognise: with only directives and element children handled, a single
    // expression container made the loop decline and handed the whole element
    // back to the host, whose loop then choked on the directive.
    const Case = struct {
        source: []const u8,
        shapes: []const ChildShape,
    };
    for ([_]Case{
        // directive then expression container
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {fb}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // expression container then directive
        .{
            .source = "const view = <section>{fb} @if (a) {<p>y</p>}</section>;",
            .shapes = &.{ .expression, .text, .directive },
        },
        // expression container between two directives
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {fb} @if (b) {<p>z</p>}</section>;",
            .shapes = &.{ .directive, .text, .expression, .text, .directive },
        },
        // expression container after a code-block directive
        .{
            .source = "const view = <section>@{ const l = 1; <span>{l}</span> } {fb}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // expression container beside both a directive and an element child
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {fb} <b>x</b></section>;",
            .shapes = &.{ .directive, .text, .expression, .text, .element },
        },
        // object literals inside the container nest braces of their own
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {c ? {x:1} : {y:2}}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // a string holding `}` and `<` is not child syntax
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {\"}<\"}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // template literals carry their own braces
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {`a${b}c`}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // an arrow function body is a braced region inside the container
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {(() => { return x; })()}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // an empty container holds no expression at all
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // a container whose expression is itself JSX carrying a directive
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} {c ? <b>@if (d) {<i>q</i>}</b> : null}</section>;",
            .shapes = &.{ .directive, .text, .expression },
        },
        // guard: expression-container-only children stay on the host path
        .{
            .source = "const view = <section>{fb}</section>;",
            .shapes = &.{.expression},
        },
        // guard: directive-only children keep working
        .{
            .source = "const view = <section>@{ const l = t.trim(); <span>{l}</span> }</section>;",
            .shapes = &.{.directive},
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            for (tree.diagnostics.items) |diagnostic| {
                std.debug.print("  diagnostic: {s}\n", .{diagnostic.message});
            }
            return err;
        };
        try std.testing.expect(!tree.hasErrors());

        var buffer: [12]ChildShape = undefined;
        const shapes = childShapes(&tree, declaredJsxRoot(&tree), &buffer);
        std.testing.expectEqualSlices(ChildShape, case.shapes, shapes) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            return err;
        };
    }
}

test "expression container children keep exact spans" {
    // The container's span end is where the next text rescan starts, so a
    // brace counted wrong silently truncates every sibling that follows it.
    const source = "const view = <section>@if (a) {<p>y</p>} {fb} tail</section>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxRoot(&tree);
    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 4), nodes.len);

    const container_start: u32 = @intCast(std.mem.indexOf(u8, source, "{fb}").?);
    try std.testing.expectEqual(.jsx_expression_container, std.meta.activeTag(tree.data(nodes[2])));
    try std.testing.expectEqual(container_start, tree.span(nodes[2]).start);
    try std.testing.expectEqual(container_start + @as(u32, "{fb}".len), tree.span(nodes[2]).end);
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[3])));
    try std.testing.expectEqualStrings(" tail", tree.string(tree.data(nodes[3]).jsx_text.value));
}

test "expression container children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <section>@if (a) {<p>y</p>} {fb}</section>;",
        "const view = <section>{fb} @if (a) {<p>y</p>}</section>;",
        "const view = <section>@{ const l = 1; <span>{l}</span> } {fb}</section>;",
        "const view = <section>@if (a) {<p>y</p>} {c ? {x:1} : {y:2}} @if (b) {<p>z</p>}</section>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        std.testing.expect(!reparsed.hasErrors()) catch |err| {
            std.debug.print("source: {s}\ncode: {s}\n", .{ source, result.code });
            return err;
        };
    }
}

test "interleaved JSX children keep exact spans" {
    // Every child span feeds the next text rescan, so an element child that
    // over- or under-reports its end silently truncates its siblings.
    const source = "const view = <div>@if (a) {<p>y</p>} <span>x</span> tail</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxElement(&tree);
    try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);

    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 4), nodes.len);
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "@if").?)),
        tree.span(nodes[0]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "} <span").? + 1)),
        tree.span(nodes[0]).end,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "<span").?)),
        tree.span(nodes[2]).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "</span>").? + "</span>".len)),
        tree.span(nodes[2]).end,
    );
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[3])));
    try std.testing.expectEqualStrings(" tail", tree.string(tree.data(nodes[3]).jsx_text.value));
}

test "interleaved JSX children round-trip through codegen" {
    for ([_][]const u8{
        "const view = <div>@if (a) {<p>y</p>} <span>x</span></div>;",
        "const view = <div><span>x</span> @if (a) {<p>y</p>}</div>;",
        "const view = <div>@for (const item of items) {<p>a</p>} <b>x</b></div>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());
    }
}

test "style siblings survive a directive in the same children region" {
    // A `<style>` sibling is the one child element the dialect itself owns: the
    // after-open hook answers with a dialect record hung on an anchor statement
    // instead of a host jsx node. The children loop has to accept that shape,
    // and its raw scan has to walk the CSS as raw text - `{`, `<` and `@` in a
    // stylesheet are not the JSX syntax the scan otherwise models.
    const Case = struct {
        source: []const u8,
        shapes: []const ChildShape,
    };
    for ([_]Case{
        // guard: style alone, with no directive, is the host's to parse
        .{
            .source = "const view = <section><style>.a{color:red}</style></section>;",
            .shapes = &.{.directive},
        },
        // guard: a directive beside a plain element child still interleaves
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <span>x</span></section>;",
            .shapes = &.{ .directive, .text, .element },
        },
        // guard: `@for`/`@empty` with no trailing sibling
        .{
            .source = "const view = <section>@for (const i of xs; index n; key i.id) {<p>y</p>} @empty {<span>e</span>}</section>;",
            .shapes = &.{.directive},
        },
        // style sibling after a directive
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>.a{color:red}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // style sibling after `@for`/`@empty`
        .{
            .source = "const view = <section>@for (const i of xs; index n; key i.id) {<p>y</p>} @empty {<span>e</span>} <style>.a{color:red}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // style sibling before a directive
        .{
            .source = "const view = <section><style>.a{color:red}</style> @if (a) {<p>y</p>}</section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // CSS braces nest deeper than the element that holds them
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>@media (width>0px){.a{color:red}}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // a quoted brace in CSS closes nothing
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>.a::after{content:'{'}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>.a::after{content:\"}\"}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // a `<` in a CSS comment opens no tag, and a `>` combinator closes none
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>/* a < b */ .a > .b{color:red}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // a partial `</style` inside a CSS string is not the closing tag
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style>.a{content:\"</style\"}</style></section>;",
            .shapes = &.{ .directive, .text, .directive },
        },
        // a self-closing style is not raw text and holds no body to scan
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <style /> <span>x</span></section>;",
            .shapes = &.{ .directive, .text, .directive, .text, .element },
        },
        // a tag whose name merely starts with `style` is ordinary JSX
        .{
            .source = "const view = <section>@if (a) {<p>y</p>} <styled-box>{x}</styled-box></section>;",
            .shapes = &.{ .directive, .text, .element },
        },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            for (tree.diagnostics.items) |diagnostic| {
                std.debug.print("  diagnostic: {s}\n", .{diagnostic.message});
            }
            return err;
        };
        try std.testing.expect(!tree.hasErrors());

        var buffer: [12]ChildShape = undefined;
        const shapes = childShapes(&tree, declaredJsxRoot(&tree), &buffer);
        std.testing.expectEqualSlices(ChildShape, case.shapes, shapes) catch |err| {
            std.debug.print("source: {s}\n", .{case.source});
            return err;
        };
    }
}

test "a style sibling keeps its exact span and its CSS" {
    // The style child's span end is where the next text rescan starts, so an
    // element the dialect owns has to report the same end the host hook built.
    const source = "const view = <section>@if (a) {<p>y</p>} <style>.a{color:red}</style> tail</section>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const element = declaredJsxElement(&tree);
    const nodes = tree.extra(tree.data(element).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 4), nodes.len);

    const style_node = nodes[2];
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "<style>").?)),
        tree.span(style_node).start,
    );
    try std.testing.expectEqual(
        @as(u32, @intCast(std.mem.indexOf(u8, source, "</style>").? + "</style>".len)),
        tree.span(style_node).end,
    );

    const record_index = tree.dialectRecord(@intFromEnum(style_node)).?;
    const record = tree.dialect_store.records.items[record_index];
    try std.testing.expectEqual(.jsx_style_element, std.meta.activeTag(record));
    try std.testing.expectEqualStrings(
        ".a{color:red}",
        source[record.jsx_style_element.css.start..record.jsx_style_element.css.end],
    );

    // the sibling after the style element is not truncated
    try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[3])));
    try std.testing.expectEqualStrings(" tail", tree.string(tree.data(nodes[3]).jsx_text.value));
}

test "style siblings round-trip through codegen" {
    for ([_][]const u8{
        "const view = <section>@if (a) {<p>y</p>} <style>.a{color:red}</style></section>;",
        "const view = <section>@for (const i of xs; index n; key i.id) {<p>y</p>} @empty {<span>e</span>} <style>.a{color:red}</style></section>;",
        "const view = <section><style>.a{color:red}</style> @if (a) {<p>y</p>}</section>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expect(!tree.hasErrors());

        const result = try parser.codegen.generate(std.testing.allocator, &tree, .{});
        defer result.deinit(std.testing.allocator);
        try std.testing.expectEqual(@as(usize, 0), result.errors.len);
        try std.testing.expect(std.mem.indexOf(u8, result.code, ".a{color:red}") != null);

        var reparsed = try parser.parse(std.testing.allocator, result.code, .{ .lang = .tsx });
        defer reparsed.deinit();
        try std.testing.expect(!reparsed.hasErrors());
    }
}

test "a less-than that cannot open a tag is one literal text child" {
    // TSRX follows HTML - and @tsrx/core - here: `<` opens a tag only when the
    // byte after it can start one. In front of anything else it is the
    // character it looks like, and the run around it stays a single text child
    // rather than being cut in two. tsrx.dev's specification says nothing about
    // the case, so the rule is pinned here.
    for ([_]struct { source: []const u8, text: []const u8 }{
        .{ .source = "const view = <span><3</span>;", .text = "<3" },
        .{ .source = "const view = <span><= arrow</span>;", .text = "<= arrow" },
        .{ .source = "const view = <span>a <3 b</span>;", .text = "a <3 b" },
    }) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());

        const element = declaredJsxElement(&tree);
        try std.testing.expect(tree.data(element).jsx_element.closing_element != .null);
        const nodes = tree.extra(tree.data(element).jsx_element.children);
        try std.testing.expectEqual(@as(usize, 1), nodes.len);
        try std.testing.expectEqual(.jsx_text, std.meta.activeTag(tree.data(nodes[0])));
        try std.testing.expectEqualStrings(
            case.text,
            tree.string(tree.data(nodes[0]).jsx_text.value),
        );
    }
}

test "a literal less-than survives inside an expression container" {
    // An element written inside `{ … }` has its children read through a
    // different entry point than bare markup text, so the rule has to hold on
    // that path too.
    const source = "const view = <div>{<span><3</span>}</div>;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expect(!tree.hasErrors());

    const outer = tree.extra(tree.data(declaredJsxElement(&tree)).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 1), outer.len);
    const inner = tree.data(outer[0]).jsx_expression_container.expression;
    try std.testing.expectEqual(.jsx_element, std.meta.activeTag(tree.data(inner)));
    const inner_children = tree.extra(tree.data(inner).jsx_element.children);
    try std.testing.expectEqual(@as(usize, 1), inner_children.len);
    try std.testing.expectEqualStrings(
        "<3",
        tree.string(tree.data(inner_children[0]).jsx_text.value),
    );
}

test "a less-than that can open a tag still opens one" {
    // The guard rail on the rule above: every byte the tag grammar accepts
    // after `<` - a name start, `/`, `>` for a fragment, `{` for a TSRX dynamic
    // tag name - keeps opening a tag rather than turning into text.
    for ([_][]const u8{
        "const view = <div><span>a</span></div>;",
        "const view = <div><>a</></div>;",
        "const view = <div><{Tag}>a</{Tag}></div>;",
        "const view = <div><_leading>a</_leading></div>;",
    }) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
        defer tree.deinit();
        try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
        try std.testing.expect(!tree.hasErrors());

        const nodes = tree.extra(tree.data(declaredJsxElement(&tree)).jsx_element.children);
        try std.testing.expectEqual(@as(usize, 1), nodes.len);
        try std.testing.expect(switch (tree.data(nodes[0])) {
            .jsx_element, .jsx_fragment => true,
            else => false,
        });
    }
}

test "a malformed TSRX construct reports where it breaks instead of truncating the module" {
    // Each of these used to return zero diagnostics and a program cut off at the construct.
    const cases = [_]struct {
        source: []const u8,
        /// Unique text whose first byte is where the diagnostic must start.
        needle: []const u8,
        /// Length of the span the diagnostic must cover from that byte.
        len: usize,
        message: []const u8,
    }{
        .{
            .source = "const z = 1; const v = @for (const i of xs) <b/>; const w = 2;",
            .needle = "<b/>",
            .len = 4,
            .message = "Expected '{' after TSRX control-flow directive",
        },
        .{
            .source = "const v = @for (const k in obj) { <b/> }; const z = 1;",
            .needle = "const k in obj",
            .len = 14,
            .message = "for...in",
        },
        .{
            .source = "const v = @for (const i of xs; index a; index b) { <b/> }; const z = 1;",
            .needle = "index b",
            .len = 5,
            .message = "Expected unique 'index' then 'key' clauses",
        },
        .{
            .source = "const v = @for (const i of xs; key a; index b) { <b/> }; const z = 1;",
            .needle = "index b",
            .len = 5,
            .message = "Expected unique 'index' then 'key' clauses",
        },
        .{
            .source = "const v = @for (const i of xs; foo) { <b/> }; const z = 1;",
            .needle = "foo",
            .len = 3,
            .message = "Expected 'index' or 'key' after ';'",
        },
        .{
            .source = "const v = @for (const i of xs; 1) { <b/> }; const z = 1;",
            .needle = "1)",
            .len = 1,
            .message = "Expected 'index' or 'key' after ';'",
        },
        .{
            .source = "const v = @for (const i of xs; index ) { <b/> }; const z = 1;",
            .needle = ") {",
            .len = 1,
            .message = "Expected an expression after a for-of tail clause",
        },
        .{
            .source = "const v = @for (const i of xs) { <b/> } @emptyish { }; const z = 1;",
            .needle = "emptyish",
            .len = 8,
            .message = "Expected 'empty' after '@'",
        },
        .{
            .source = "const v = @fortune (x) { }; const z = 1;",
            .needle = "fortune",
            .len = 7,
            .message = "Expected 'for' after '@'",
        },
        .{
            .source = "const v = @if () { <b/> }; const z = 1;",
            .needle = ") {",
            .len = 1,
            .message = "Expected a condition after '@if ('",
        },
        .{
            .source = "const v = @switch (x) { <b/> }; const z = 1;",
            .needle = "<b/> }",
            .len = 1,
            .message = "Expected '@case' or '@default'",
        },
        .{
            .source = "const v = @try { <b/> } @pendingly { }; const z = 1;",
            .needle = "pendingly",
            .len = 9,
            .message = "Expected 'pending' after '@'",
        },
        .{
            .source = "const v = <{a />; const z = 1;",
            .needle = "/>",
            .len = 1,
            .message = "Expected '}' to close TSRX dynamic tag expression",
        },
        .{
            .source = "let &x = p; const z = 1;",
            .needle = "x = p",
            .len = 1,
            .message = "Expected '[' or '{' after '&'",
        },
        .{
            .source = "let &{ 1 } = p; const z = 1;",
            .needle = "1 }",
            .len = 1,
            .message = "Expected a property name",
        },
        .{
            .source = "let &[ 1 ] = p; const z = 1;",
            .needle = "1 ]",
            .len = 1,
            .message = "Expected an identifier",
        },
    };
    for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case.source, .{ .lang = .tsx });
        defer tree.deinit();
        const start = std.mem.indexOf(u8, case.source, case.needle) orelse return error.NeedleMissing;
        const expected: parser.ast.Span = .{ .start = @intCast(start), .end = @intCast(start + case.len) };
        var found = false;
        for (tree.diagnostics.items) |diagnostic| {
            if (std.mem.indexOf(u8, diagnostic.message, case.message) == null) continue;
            if (diagnostic.span.start == expected.start and diagnostic.span.end == expected.end) found = true;
        }
        if (!found) {
            std.debug.print("\n{s}\n  wanted {s} at {d}:{d}, got {d} diagnostics:\n", .{ case.source, case.message, expected.start, expected.end, tree.diagnostics.items.len });
            for (tree.diagnostics.items) |diagnostic| std.debug.print("    {s} @{d}:{d}\n", .{ diagnostic.message, diagnostic.span.start, diagnostic.span.end });
            return error.SilentTruncation;
        }
        try std.testing.expect(tree.hasErrors());
    }
}

test "a for directive whose comment holds a brace still parses whole" {
    // The raw brace scan cannot see comments; the host parse can, and its result wins.
    const source = "const v = @for (const i of xs) { // }\n<b/> }; const z = 1;";
    var tree = try parser.parse(std.testing.allocator, source, .{ .lang = .tsx });
    defer tree.deinit();
    try std.testing.expectEqual(@as(usize, 0), tree.diagnostics.items.len);
    try std.testing.expectEqual(@as(usize, 2), tree.extra(tree.data(tree.root).program.body).len);
}
