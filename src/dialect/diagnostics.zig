//! The semantic checker's early errors, as the module boundary reports them.
//!
//! yuku's checker reports every early error at `.@"error"` severity, and so
//! does `@tsrx/core`, the reference parser: a normal parse throws each one,
//! and `collect`/`loose` record it and go on (tsrx-org/oxc#113). That includes
//! the redeclaration family, which acorn raises through `raiseRecoverable`:
//! recoverable means "recorded under `collect`", not "a warning". Up to 0.3.0
//! this module lowered redeclarations to `.warning`, so `parseModule` neither
//! threw nor recorded them; they are errors again, on `parse()` and
//! `parseModule` alike, so both entry points agree with each other and with
//! core. Editor flows keep working the way they do on core: they parse with
//! `collect` or `loose` and read the recorded errors.
//!
//! Two things are added on top of the checker. An import and a value
//! declaration of the same name merge into one symbol there, since the
//! checker's exclusion sets let a type-only import merge with a value; core
//! (acorn) reports them, so they are reported here as redeclarations too.
//!
//! And some redeclarations are reshaped to what core reports (acorn with
//! acorn-typescript's scope rules):
//!
//!   * A parameter that repeats another parameter of the same list is
//!     `Argument name clash`. The diagnostic keeps the checker's labels, the
//!     first one on the earlier parameter, which the npm wrapper uses to
//!     record the clash at both parameters, as core does. In a function
//!     without a body (a `declare`d function, an overload, an abstract
//!     method) core reports nothing, so neither does this.
//!   * A type alias that repeats a type alias or an interface is `type 'A' has
//!     already been declared.`; an interface after a type alias of the same
//!     name is not reported, as in core.

const std = @import("std");
const yuku = @import("yuku");
const semantic = @import("semantic.zig");

pub const argument_name_clash = "Argument name clash";

/// Runs semantic analysis over `tree`, appending its early errors to the
/// tree's diagnostics, and rewords duplicate parameters as core does.
///
/// Only the diagnostics analysis appended are reworded; whatever the parser
/// itself reported is left alone. Analysis failure is not fatal -- a partially
/// checked tree still reports the diagnostics it did produce, which matches
/// the recovery contract the editor path parses under.
pub fn analyzeEarlyErrors(tree: anytype) void {
    const parsed = tree.tree.diagnostics.items.len;
    if (semantic.analyze(tree)) |analysis| {
        reportImportRedeclarations(&tree.tree, analysis, parsed) catch {};
        reportLexicalRedeclarations(&tree.tree, analysis, parsed) catch {};
        reportOverloadOnlyExports(&tree.tree, analysis) catch {};
    } else |_| {}
    reportCatchResetClashes(tree, parsed) catch {};
    alignRedeclarations(&tree.tree, parsed) catch {};
    orderLikeCore(&tree.tree, parsed) catch {};
}

/// How acorn binds a declaration, for the redeclarations the checker lets
/// through under TypeScript's merging rules.
const BindingKind = enum { lexical, @"var", other };

fn bindingKind(tree: *const yuku.ast.Tree, analysis: yuku.semantic.Semantic, decl: yuku.ast.NodeIndex, scope_kind: anytype) BindingKind {
    var node = decl;
    var depth: u32 = 0;
    while (analysis.parentOf(node)) |parent| : (depth += 1) {
        if (depth == 64) return .other;
        switch (tree.data(parent)) {
            .variable_declaration => |declaration| return switch (declaration.kind) {
                .@"var" => .@"var",
                else => .lexical,
            },
            .function => |function| {
                if (function.id != node) return .other;
                // an overload signature or a `declare function` binds nothing
                if (function.body == .null) return .other;
                // in a module or a block a function is lexical; at the top of a
                // function body it is var-like
                return switch (scope_kind) {
                    .module, .block => .lexical,
                    else => .@"var",
                };
            },
            .class => |class| return if (class.id == node) .lexical else .other,
            .variable_declarator, .array_pattern, .object_pattern, .binding_property, .assignment_pattern, .binding_rest_element => node = parent,
            else => return .other,
        }
    }
    return .other;
}

/// Reports the redeclarations acorn makes and the checker's TypeScript
/// merging lets through: `function g() {} function g() {}` or `function g() {}
/// var g;` in a module, and an ambient `declare const a` or `declare class A`
/// followed by a declaration of the same name.
pub fn reportLexicalRedeclarations(tree: *yuku.ast.Tree, analysis: yuku.semantic.Semantic, checked_from: usize) !void {
    for (analysis.symbols, 0..) |symbol, index| {
        const decls = analysis.decls(@enumFromInt(index));
        if (decls.len < 2) continue;
        const scope_kind = analysis.scopes.get(symbol.scope).kind;
        var saw_lexical = false;
        var saw_any = false;
        var first: ?yuku.ast.Span = null;
        for (decls) |decl| {
            const kind = bindingKind(tree, analysis, decl, scope_kind);
            if (kind == .other) continue;
            const span = tree.span(decl);
            const conflict = (kind == .lexical and saw_any) or (kind == .@"var" and saw_lexical);
            if (conflict and !reportedAt(tree.diagnostics.items[checked_from..], span)) {
                try reportRedeclaration(tree, tree.string(symbol.name), first.?, span);
            }
            if (first == null) first = span;
            saw_any = true;
            if (kind == .lexical) saw_lexical = true;
        }
    }
}

fn reportRedeclaration(tree: *yuku.ast.Tree, name: []const u8, first: yuku.ast.Span, later: yuku.ast.Span) !void {
    const allocator = tree.allocator();
    const labels = try allocator.dupe(yuku.ast.Label, &.{
        .{ .span = first, .message = try std.fmt.allocPrint(allocator, "'{s}' was first declared here", .{name}) },
        .{ .span = later, .message = "cannot be redeclared here" },
    });
    try tree.diagnostics.append(allocator, .{
        .severity = .@"error",
        .message = try std.fmt.allocPrint(allocator, "Identifier '{s}' has already been declared", .{name}),
        .span = later,
        .help = try std.fmt.allocPrint(allocator, "Consider removing or renaming this declaration of '{s}'", .{name}),
        .labels = labels,
    });
}

/// `export { f }` where `f` is only overload signatures: acorn-typescript
/// binds nothing for a signature, so core reports the export as undefined.
pub fn reportOverloadOnlyExports(tree: *yuku.ast.Tree, analysis: yuku.semantic.Semantic) !void {
    const count = tree.nodes.len;
    for (0..count) |index| {
        const export_named = switch (tree.data(@enumFromInt(index))) {
            .export_named_declaration => |value| value,
            else => continue,
        };
        if (export_named.declaration != .null or export_named.source != .null) continue;
        for (0..export_named.specifiers.len) |offset| {
            const specifier = tree.extras.items[export_named.specifiers.start + offset];
            const local = switch (tree.data(specifier)) {
                .export_specifier => |value| value.local,
                else => continue,
            };
            const name = switch (tree.data(local)) {
                .identifier_reference => |value| tree.string(value.name),
                else => continue,
            };
            if (!onlySignatures(tree, analysis, name)) continue;
            const allocator = tree.allocator();
            try tree.diagnostics.append(allocator, .{
                .severity = .@"error",
                .message = try std.fmt.allocPrint(allocator, "Export '{s}' is not defined", .{name}),
                .span = tree.span(local),
            });
        }
    }
}

fn onlySignatures(tree: *const yuku.ast.Tree, analysis: yuku.semantic.Semantic, name: []const u8) bool {
    for (analysis.symbols, 0..) |symbol, index| {
        if (analysis.scopes.get(symbol.scope).kind != .module) continue;
        if (!std.mem.eql(u8, tree.string(symbol.name), name)) continue;
        const decls = analysis.decls(@enumFromInt(index));
        if (decls.len == 0) return false;
        for (decls) |decl| {
            const parent = analysis.parentOf(decl) orelse return false;
            switch (tree.data(parent)) {
                .function => |function| if (function.body != .null or function.declare) return false,
                else => return false,
            }
        }
        return true;
    }
    return false;
}

/// `@catch (e, e)`: the reset parameter repeats the error parameter. The
/// reset parameter lives on a dialect overlay the checker doesn't see.
pub fn reportCatchResetClashes(tree: anytype, checked_from: usize) !void {
    const ast_tree = &tree.tree;
    for (tree.dialect_store.overlays.items) |overlay| {
        const record = tree.dialect_store.records.items[overlay.record_index];
        const catch_overlay = switch (record) {
            .catch_clause => |value| value,
            else => continue,
        };
        const reset: yuku.ast.NodeIndex = @enumFromInt(catch_overlay.reset_param.raw);
        if (reset == .null) continue;
        const reset_name = switch (ast_tree.data(reset)) {
            .binding_identifier => |value| ast_tree.string(value.name),
            else => continue,
        };
        const host: yuku.ast.NodeIndex = @enumFromInt(overlay.host_node);
        const param = switch (ast_tree.data(host)) {
            .catch_clause => |value| value.param,
            else => continue,
        };
        if (param == .null) continue;
        const param_span = ast_tree.span(param);
        for (ast_tree.nodes.items(.data), ast_tree.nodes.items(.span)) |data, span| {
            const binding = switch (data) {
                .binding_identifier => |value| value,
                else => continue,
            };
            if (span.start < param_span.start or span.end > param_span.end) continue;
            if (!std.mem.eql(u8, ast_tree.string(binding.name), reset_name)) continue;
            const reset_span = ast_tree.span(reset);
            if (reportedAt(ast_tree.diagnostics.items[checked_from..], reset_span)) break;
            try reportRedeclaration(ast_tree, reset_name, span, reset_span);
            break;
        }
    }
}

/// Puts the early errors in the order core raises them: by position, except
/// that a function's own name is declared after its body (acorn-typescript),
/// and undefined exports come last, once the module is read.
pub fn orderLikeCore(tree: *yuku.ast.Tree, checked_from: usize) !void {
    const diagnostics = tree.diagnostics.items[checked_from..];
    if (diagnostics.len < 2) return;
    const Keyed = struct { key: u64, diagnostic: yuku.ast.Diagnostic };
    const keyed = try tree.allocator().alloc(Keyed, diagnostics.len);
    for (diagnostics, keyed) |diagnostic, *entry| {
        entry.* = .{ .key = orderKey(tree, diagnostic), .diagnostic = diagnostic };
    }
    std.sort.insertion(Keyed, keyed, {}, struct {
        fn lessThan(_: void, a: Keyed, b: Keyed) bool {
            return a.key < b.key;
        }
    }.lessThan);
    for (diagnostics, keyed) |*diagnostic, entry| diagnostic.* = entry.diagnostic;
}

fn orderKey(tree: *const yuku.ast.Tree, diagnostic: yuku.ast.Diagnostic) u64 {
    const start: u64 = diagnostic.span.start;
    if (std.mem.startsWith(u8, diagnostic.message, "Export '")) return (@as(u64, 1) << 40) + start;
    if (!isRedeclaration(diagnostic.message)) return start;
    for (tree.nodes.items(.data), tree.nodes.items(.span)) |data, span| {
        const function = switch (data) {
            .function => |value| value,
            else => continue,
        };
        if (function.id == .null or function.body == .null) continue;
        if (tree.span(function.id).start == diagnostic.span.start) return span.end;
    }
    return start;
}

/// Reports each symbol an import shares with a value declaration -- `import
/// { a } from "x"; const a = 1;` -- at the later of the two declarations, as
/// `Identifier 'a' has already been declared`, unless the checker already
/// reported that declaration.
pub fn reportImportRedeclarations(tree: *yuku.ast.Tree, analysis: yuku.semantic.Semantic, checked_from: usize) !void {
    std.debug.assert(checked_from <= tree.diagnostics.items.len);
    for (analysis.symbols, 0..) |symbol, index| {
        const flags = symbol.flags;
        if (!flags.import and !flags.type_import) continue;
        const declares_value = flags.function_scoped_var or flags.block_scoped_var or
            flags.function or flags.class or flags.regular_enum or flags.const_enum;
        if (!declares_value) continue;
        const decls = analysis.decls(@enumFromInt(index));
        if (decls.len < 2) continue;

        var first = tree.span(decls[0]);
        var later = tree.span(decls[1]);
        if (later.start < first.start) std.mem.swap(yuku.ast.Span, &first, &later);
        std.debug.assert(first.start <= later.start);
        if (reportedAt(tree.diagnostics.items[checked_from..], later)) continue;

        const name = tree.string(symbol.name);
        const allocator = tree.allocator();
        const labels = try allocator.dupe(yuku.ast.Label, &.{
            .{ .span = first, .message = try std.fmt.allocPrint(allocator, "'{s}' was first declared here", .{name}) },
            .{ .span = later, .message = "cannot be redeclared here" },
        });
        try tree.diagnostics.append(allocator, .{
            .severity = .@"error",
            .message = try std.fmt.allocPrint(allocator, "Identifier '{s}' has already been declared", .{name}),
            .span = later,
            .help = try std.fmt.allocPrint(allocator, "Consider removing or renaming this declaration of '{s}'", .{name}),
            .labels = labels,
        });
    }
}

fn reportedAt(diagnostics: []const yuku.ast.Diagnostic, span: yuku.ast.Span) bool {
    for (diagnostics) |diagnostic| {
        if (diagnostic.span.start == span.start and isRedeclaration(diagnostic.message)) return true;
    }
    return false;
}

/// Rewords or drops the redeclarations from `checked_from` on where core
/// reports them differently. See the module comment.
pub fn alignRedeclarations(tree: *yuku.ast.Tree, checked_from: usize) !void {
    std.debug.assert(checked_from <= tree.diagnostics.items.len);
    var kept = checked_from;
    for (checked_from..tree.diagnostics.items.len) |index| {
        var diagnostic = tree.diagnostics.items[index];
        const keep = try alignRedeclaration(tree, &diagnostic);
        if (!keep) continue;
        tree.diagnostics.items[kept] = diagnostic;
        kept += 1;
    }
    std.debug.assert(kept <= tree.diagnostics.items.len);
    tree.diagnostics.shrinkRetainingCapacity(kept);
}

/// False when core reports nothing for `diagnostic`.
fn alignRedeclaration(tree: *yuku.ast.Tree, diagnostic: *yuku.ast.Diagnostic) !bool {
    if (diagnostic.severity != .@"error" or !isRedeclaration(diagnostic.message)) return true;
    if (diagnostic.labels.len == 0) return true;
    const first = diagnostic.labels[0];
    if (std.mem.endsWith(u8, first.message, " as a parameter here")) {
        const list = parameterList(tree, first.span, diagnostic.span) orelse return true;
        if (!functionHasBody(tree, list)) return false;
        diagnostic.message = argument_name_clash;
        return true;
    }
    const after_type_alias = std.mem.endsWith(u8, first.message, " as a type alias here");
    const after_interface = std.mem.endsWith(u8, first.message, " as an interface here");
    if (!after_type_alias and !after_interface) return true;
    switch (declarationKind(tree, diagnostic.span)) {
        .type_alias => {
            const name = diagnostic.message["Identifier '".len .. diagnostic.message.len - "' has already been declared".len];
            diagnostic.message = try std.fmt.allocPrint(tree.allocator(), "type '{s}' has already been declared.", .{name});
            return true;
        },
        .interface => return !after_type_alias,
        .other => return true,
    }
}

const DeclarationKind = enum { type_alias, interface, other };

/// Whether the binding at `span` names a type alias, an interface, or neither.
fn declarationKind(tree: *const yuku.ast.Tree, span: yuku.ast.Span) DeclarationKind {
    for (tree.nodes.items(.data)) |data| {
        const id, const kind: DeclarationKind = switch (data) {
            .ts_type_alias_declaration => |declaration| .{ declaration.id, .type_alias },
            .ts_interface_declaration => |declaration| .{ declaration.id, .interface },
            else => continue,
        };
        if (id == .null) continue;
        const id_span = tree.span(id);
        if (id_span.start == span.start and id_span.end == span.end) return kind;
    }
    return .other;
}

/// The parameter list `earlier` and `later` are both bindings of: the
/// innermost list around `later`, when it also holds `earlier` and `later`
/// is not in a function body nested in it (a default value's arrow function).
fn parameterList(tree: *const yuku.ast.Tree, earlier: yuku.ast.Span, later: yuku.ast.Span) ?yuku.ast.NodeIndex {
    const datas = tree.nodes.items(.data);
    const spans = tree.nodes.items(.span);
    var list: ?usize = null;
    for (datas, spans, 0..) |data, span, index| {
        if (data != .formal_parameters or !contains(span, later)) continue;
        if (list == null or contains(spans[list.?], span)) list = index;
    }
    const params = spans[list orelse return null];
    if (!contains(params, earlier)) return null;
    for (datas, spans) |data, span| {
        if (data == .function_body and contains(params, span) and contains(span, later)) return null;
    }
    return @enumFromInt(list.?);
}

/// False for a function with no body: a `declare`d function, an overload
/// signature, an abstract method.
fn functionHasBody(tree: *const yuku.ast.Tree, params: yuku.ast.NodeIndex) bool {
    for (tree.nodes.items(.data)) |data| {
        switch (data) {
            .function => |function| if (function.params == params) return function.body != .null,
            else => {},
        }
    }
    return true;
}

fn contains(outer: yuku.ast.Span, inner: yuku.ast.Span) bool {
    return outer.start <= inner.start and inner.end <= outer.end;
}

/// `Checker.reportRedeclaration` -- every duplicate binding form (`let`/`const`
/// collisions, duplicate function declarations, duplicate imports, clashing
/// strict-mode parameters) funnels into this one message.
pub fn isRedeclaration(message: []const u8) bool {
    const prefix = "Identifier '";
    const suffix = "' has already been declared";
    return message.len > prefix.len + suffix.len and
        std.mem.startsWith(u8, message, prefix) and
        std.mem.endsWith(u8, message, suffix);
}
