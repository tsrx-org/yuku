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
/// tree's diagnostics, and reshapes them into the ones core reports.
///
/// Only the diagnostics analysis appended are reshaped; whatever the parser
/// itself reported is left alone. Analysis failure is not fatal -- a partially
/// checked tree still reports the diagnostics it did produce, which matches
/// the recovery contract the editor path parses under.
///
/// Every pass is linear in the tree, or `n log n`: nodes are looked up through
/// one sorted index of the binding identifiers and the analysis' parent links,
/// never by scanning the tree once per diagnostic.
pub fn analyzeEarlyErrors(tree: anytype) void {
    const parsed = tree.tree.diagnostics.items.len;
    // analysis only fails out of memory; the passes that read it are then
    // skipped, and the rest still shape what the checker appended
    const analysis = semantic.analyze(tree) catch null;
    var context = Context.init(&tree.tree, analysis, parsed) catch return;
    if (analysis != null) {
        reportImportRedeclarations(&context) catch {};
        reportLexicalRedeclarations(&context) catch {};
        reportOverloadOnlyExports(&context) catch {};
    }
    reportCatchResetClashes(&context, tree.dialect_store) catch {};
    alignRedeclarations(&context);
    orderLikeCore(&context) catch {};
}

const Binding = struct { start: u32, node: yuku.ast.NodeIndex };

/// What the passes share: the analysis, the binding identifiers sorted by
/// start, and the starts of the redeclarations already reported.
const Context = struct {
    tree: *yuku.ast.Tree,
    analysis: ?yuku.semantic.Semantic,
    checked_from: usize,
    bindings: []Binding,
    reported: std.AutoHashMapUnmanaged(u32, void),

    fn init(tree: *yuku.ast.Tree, analysis: ?yuku.semantic.Semantic, checked_from: usize) !Context {
        std.debug.assert(checked_from <= tree.diagnostics.items.len);
        const allocator = tree.allocator();
        var bindings: std.ArrayList(Binding) = .empty;
        for (tree.nodes.items(.data), tree.nodes.items(.span), 0..) |data, span, index| {
            if (data != .binding_identifier) continue;
            try bindings.append(allocator, .{ .start = span.start, .node = @enumFromInt(index) });
        }
        std.sort.pdq(Binding, bindings.items, {}, struct {
            fn lessThan(_: void, a: Binding, b: Binding) bool {
                return a.start < b.start or (a.start == b.start and @intFromEnum(a.node) < @intFromEnum(b.node));
            }
        }.lessThan);
        var context: Context = .{
            .tree = tree,
            .analysis = analysis,
            .checked_from = checked_from,
            .bindings = bindings.items,
            .reported = .empty,
        };
        for (tree.diagnostics.items[checked_from..]) |diagnostic| {
            if (isRedeclaration(diagnostic.message)) try context.reported.put(allocator, diagnostic.span.start, {});
        }
        return context;
    }

    /// The first binding identifier at or after `start`.
    fn lowerBound(self: *const Context, start: u32) usize {
        var low: usize = 0;
        var high: usize = self.bindings.len;
        while (low < high) {
            const middle = low + (high - low) / 2;
            if (self.bindings[middle].start < start) low = middle + 1 else high = middle;
        }
        return low;
    }

    /// The binding identifier that starts at `span.start`.
    fn bindingAt(self: *const Context, span: yuku.ast.Span) ?yuku.ast.NodeIndex {
        const index = self.lowerBound(span.start);
        if (index == self.bindings.len or self.bindings[index].start != span.start) return null;
        return self.bindings[index].node;
    }

    /// The binding identifiers inside `span`.
    fn bindingsIn(self: *const Context, span: yuku.ast.Span) []const Binding {
        const first = self.lowerBound(span.start);
        var last = first;
        while (last < self.bindings.len and self.bindings[last].start < span.end) last += 1;
        return self.bindings[first..last];
    }

    fn parentOf(self: *const Context, node: yuku.ast.NodeIndex) ?yuku.ast.NodeIndex {
        const analysis = self.analysis orelse return null;
        if (node == .null or @intFromEnum(node) >= analysis.node_parents.len) return null;
        return analysis.parentOf(node);
    }

    fn reportedAt(self: *const Context, span: yuku.ast.Span) bool {
        return self.reported.contains(span.start);
    }

    fn reportRedeclaration(self: *Context, name: []const u8, first: yuku.ast.Span, later: yuku.ast.Span) !void {
        const allocator = self.tree.allocator();
        const labels = try allocator.dupe(yuku.ast.Label, &.{
            .{ .span = first, .message = try std.fmt.allocPrint(allocator, "'{s}' was first declared here", .{name}) },
            .{ .span = later, .message = "cannot be redeclared here" },
        });
        try self.tree.diagnostics.append(allocator, .{
            .severity = .@"error",
            .message = try std.fmt.allocPrint(allocator, "Identifier '{s}' has already been declared", .{name}),
            .span = later,
            .help = try std.fmt.allocPrint(allocator, "Consider removing or renaming this declaration of '{s}'", .{name}),
            .labels = labels,
        });
        try self.reported.put(allocator, later.start, {});
    }
};

/// How acorn binds a declaration, for the redeclarations the checker lets
/// through under TypeScript's merging rules. `sloppy_function` is a plain
/// function declaration in a block of sloppy-mode code (Annex B.3.3): it
/// conflicts with `let`, `const`, `class` and `var`, but not with another
/// function declaration.
const BindingKind = enum { lexical, @"var", sloppy_function, other };

fn bindingKind(context: *const Context, decl: yuku.ast.NodeIndex, scope: anytype) BindingKind {
    const tree = context.tree;
    var node = decl;
    var depth: u32 = 0;
    while (context.parentOf(node)) |parent| : (depth += 1) {
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
                // At the top of a function body, or of a sloppy script, a
                // function is var-like. In a module, a block or a static block
                // it is lexical, except a plain function in sloppy code.
                return switch (scope.kind) {
                    .module, .block, .static_block => if (scope.flags.strict or function.generator or function.async)
                        .lexical
                    else
                        .sloppy_function,
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
fn reportLexicalRedeclarations(context: *Context) !void {
    const tree = context.tree;
    const analysis = context.analysis.?;
    for (analysis.symbols, 0..) |symbol, index| {
        const decls = analysis.decls(@enumFromInt(index));
        if (decls.len < 2) continue;
        const scope = analysis.scopes.get(symbol.scope);
        var saw_lexical = false;
        var saw_var = false;
        var saw_function = false;
        var first: ?yuku.ast.Span = null;
        for (decls) |decl| {
            const kind = bindingKind(context, decl, scope);
            if (kind == .other) continue;
            const span = tree.span(decl);
            const conflict = switch (kind) {
                .lexical => saw_lexical or saw_var or saw_function,
                .@"var" => saw_lexical or saw_function,
                .sloppy_function => saw_lexical or saw_var,
                .other => unreachable,
            };
            if (conflict and !context.reportedAt(span)) {
                try context.reportRedeclaration(tree.string(symbol.name), first.?, span);
            }
            if (first == null) first = span;
            switch (kind) {
                .lexical => saw_lexical = true,
                .@"var" => saw_var = true,
                .sloppy_function => saw_function = true,
                .other => unreachable,
            }
        }
    }
}

/// Reports each symbol an import shares with a value declaration -- `import
/// { a } from "x"; const a = 1;` -- at the later of the two declarations, as
/// `Identifier 'a' has already been declared`, unless the checker already
/// reported that declaration.
fn reportImportRedeclarations(context: *Context) !void {
    const tree = context.tree;
    const analysis = context.analysis.?;
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
        if (context.reportedAt(later)) continue;
        try context.reportRedeclaration(tree.string(symbol.name), first, later);
    }
}

/// `export { f }` where `f` is only overload signatures: acorn-typescript
/// binds nothing for a signature, so core reports the export as undefined.
fn reportOverloadOnlyExports(context: *Context) !void {
    const tree = context.tree;
    const analysis = context.analysis.?;
    const allocator = tree.allocator();
    // module-scope symbols made only of overload signatures, by name
    var signatures: std.StringHashMapUnmanaged(void) = .empty;
    for (analysis.symbols, 0..) |symbol, index| {
        if (analysis.scopes.get(symbol.scope).kind != .module) continue;
        const decls = analysis.decls(@enumFromInt(index));
        if (decls.len == 0) continue;
        const only_signatures = for (decls) |decl| {
            const parent = context.parentOf(decl) orelse break false;
            switch (tree.data(parent)) {
                .function => |function| if (function.body != .null or function.declare) break false,
                else => break false,
            }
        } else true;
        if (only_signatures) try signatures.put(allocator, tree.string(symbol.name), {});
    }
    if (signatures.count() == 0) return;

    for (0..tree.nodes.len) |index| {
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
            if (!signatures.contains(name)) continue;
            try tree.diagnostics.append(allocator, .{
                .severity = .@"error",
                .message = try std.fmt.allocPrint(allocator, "Export '{s}' is not defined", .{name}),
                .span = tree.span(local),
            });
        }
    }
}

/// `@catch (e, e)`: the reset parameter repeats the error parameter. The
/// reset parameter lives on a dialect overlay the checker doesn't see.
fn reportCatchResetClashes(context: *Context, store: anytype) !void {
    const tree = context.tree;
    for (store.overlays.items) |overlay| {
        const record = store.records.items[overlay.record_index];
        const catch_overlay = switch (record) {
            .catch_clause => |value| value,
            else => continue,
        };
        const reset: yuku.ast.NodeIndex = @enumFromInt(catch_overlay.reset_param.raw);
        if (reset == .null) continue;
        const reset_name = switch (tree.data(reset)) {
            .binding_identifier => |value| tree.string(value.name),
            else => continue,
        };
        const host: yuku.ast.NodeIndex = @enumFromInt(overlay.host_node);
        const param = switch (tree.data(host)) {
            .catch_clause => |value| value.param,
            else => continue,
        };
        if (param == .null) continue;
        const reset_span = tree.span(reset);
        for (context.bindingsIn(tree.span(param))) |binding| {
            const name = tree.string(tree.data(binding.node).binding_identifier.name);
            if (!std.mem.eql(u8, name, reset_name)) continue;
            if (!context.reportedAt(reset_span)) {
                try context.reportRedeclaration(reset_name, tree.span(binding.node), reset_span);
            }
            break;
        }
    }
}

/// Puts the early errors in the order core raises them: by position, except
/// that a function's own name is declared after its body (acorn-typescript),
/// and undefined exports come last, once the module is read.
fn orderLikeCore(context: *Context) !void {
    const tree = context.tree;
    const diagnostics = tree.diagnostics.items[context.checked_from..];
    if (diagnostics.len < 2) return;
    const Keyed = struct { key: u64, index: u32, diagnostic: yuku.ast.Diagnostic };
    const keyed = try tree.allocator().alloc(Keyed, diagnostics.len);
    for (diagnostics, keyed, 0..) |diagnostic, *entry, index| {
        entry.* = .{ .key = orderKey(context, diagnostic), .index = @intCast(index), .diagnostic = diagnostic };
    }
    std.sort.pdq(Keyed, keyed, {}, struct {
        fn lessThan(_: void, a: Keyed, b: Keyed) bool {
            return a.key < b.key or (a.key == b.key and a.index < b.index);
        }
    }.lessThan);
    for (diagnostics, keyed) |*diagnostic, entry| diagnostic.* = entry.diagnostic;
}

fn orderKey(context: *const Context, diagnostic: yuku.ast.Diagnostic) u64 {
    const start: u64 = diagnostic.span.start;
    if (std.mem.startsWith(u8, diagnostic.message, "Export '")) return (@as(u64, 1) << 40) + start;
    if (!isRedeclaration(diagnostic.message)) return start;
    const binding = context.bindingAt(diagnostic.span) orelse return start;
    const parent = context.parentOf(binding) orelse return start;
    return switch (context.tree.data(parent)) {
        .function => |function| if (function.id == binding and function.body != .null)
            context.tree.span(parent).end
        else
            start,
        else => start,
    };
}

/// Rewords or drops the redeclarations from `checked_from` on where core
/// reports them differently. See the module comment.
fn alignRedeclarations(context: *Context) void {
    const tree = context.tree;
    var kept = context.checked_from;
    for (context.checked_from..tree.diagnostics.items.len) |index| {
        var diagnostic = tree.diagnostics.items[index];
        const keep = alignRedeclaration(context, &diagnostic);
        if (!keep) continue;
        tree.diagnostics.items[kept] = diagnostic;
        kept += 1;
    }
    std.debug.assert(kept <= tree.diagnostics.items.len);
    tree.diagnostics.shrinkRetainingCapacity(kept);
}

/// False when core reports nothing for `diagnostic`.
fn alignRedeclaration(context: *const Context, diagnostic: *yuku.ast.Diagnostic) bool {
    if (diagnostic.severity != .@"error" or !isRedeclaration(diagnostic.message)) return true;
    if (diagnostic.labels.len == 0) return true;
    const first = diagnostic.labels[0];
    if (std.mem.endsWith(u8, first.message, " as a parameter here")) {
        const list = parameterList(context, first.span, diagnostic.span) orelse return true;
        if (!functionHasBody(context, list)) return false;
        diagnostic.message = argument_name_clash;
        return true;
    }
    // Annex B.3.3: two plain function declarations in a block of sloppy-mode
    // code are not an error.
    if (std.mem.endsWith(u8, first.message, " as a function here") and
        isSloppyFunction(context, first.span) and isSloppyFunction(context, diagnostic.span)) return false;
    const after_type_alias = std.mem.endsWith(u8, first.message, " as a type alias here");
    const after_interface = std.mem.endsWith(u8, first.message, " as an interface here");
    if (!after_type_alias and !after_interface) return true;
    switch (declarationKind(context, diagnostic.span)) {
        .type_alias => {
            const name = diagnostic.message["Identifier '".len .. diagnostic.message.len - "' has already been declared".len];
            // out of memory keeps the checker's message; failing here would leave the list half compacted
            diagnostic.message = std.fmt.allocPrint(context.tree.allocator(), "type '{s}' has already been declared.", .{name}) catch diagnostic.message;
            return true;
        },
        .interface => return !after_type_alias,
        .other => return true,
    }
}

fn isSloppyFunction(context: *const Context, span: yuku.ast.Span) bool {
    const binding = context.bindingAt(span) orelse return false;
    // the scope the declaration sits in, not the function's own
    const declaration = context.parentOf(binding) orelse return false;
    const container = context.parentOf(declaration) orelse return false;
    const analysis = context.analysis.?; // parents come from the analysis
    if (@intFromEnum(container) >= analysis.node_scopes.len) return false;
    const scope_id = analysis.scopeOf(container);
    if (scope_id == .none) return false;
    return bindingKind(context, binding, analysis.scopes.get(scope_id)) == .sloppy_function;
}

const DeclarationKind = enum { type_alias, interface, other };

/// Whether the binding at `span` names a type alias, an interface, or neither.
fn declarationKind(context: *const Context, span: yuku.ast.Span) DeclarationKind {
    const binding = context.bindingAt(span) orelse return .other;
    const parent = context.parentOf(binding) orelse return .other;
    return switch (context.tree.data(parent)) {
        .ts_type_alias_declaration => |declaration| if (declaration.id == binding) .type_alias else .other,
        .ts_interface_declaration => |declaration| if (declaration.id == binding) .interface else .other,
        else => .other,
    };
}

/// The parameter list both bindings belong to: the nearest
/// `formal_parameters` above the binding at `later`, when no function body
/// comes first (a default value's arrow function) and the binding at
/// `earlier` sits in the same list.
fn parameterList(context: *const Context, earlier: yuku.ast.Span, later: yuku.ast.Span) ?yuku.ast.NodeIndex {
    const list = enclosingParameterList(context, context.bindingAt(later) orelse return null) orelse return null;
    const other = enclosingParameterList(context, context.bindingAt(earlier) orelse return null) orelse return null;
    return if (list == other) list else null;
}

fn enclosingParameterList(context: *const Context, binding: yuku.ast.NodeIndex) ?yuku.ast.NodeIndex {
    var node = binding;
    var depth: u32 = 0;
    while (context.parentOf(node)) |parent| : (depth += 1) {
        if (depth == 256) return null;
        switch (context.tree.data(parent)) {
            .formal_parameters => return parent,
            .function_body, .function, .arrow_function_expression, .class => return null,
            else => node = parent,
        }
    }
    return null;
}

/// False for a function with no body: a `declare`d function, an overload
/// signature, an abstract method.
fn functionHasBody(context: *const Context, params: yuku.ast.NodeIndex) bool {
    const parent = context.parentOf(params) orelse return true;
    return switch (context.tree.data(parent)) {
        .function => |function| function.body != .null,
        else => true,
    };
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
