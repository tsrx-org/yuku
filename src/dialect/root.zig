const std = @import("std");
const yuku = @import("yuku");
const extension = @import("parser_extension");

pub const ast = yuku.ast;
pub const Parser = yuku.Parser;
pub const CommentMode = yuku.CommentMode;
pub const dialect_schema = extension.schema_module;
pub const dialect_enabled = true;
pub const Store = extension.Store;

pub const Options = struct {
    source_type: ast.SourceType = .module,
    lang: ast.Lang = .js,
    preserve_parens: bool = true,
    comments: CommentMode = .flat,
    loose: bool = false,
    /// The source is a `.tsrx` file. Only then is a comment in JSX text a
    /// comment, as `@tsrx/core` reads it; in `.tsx` and `.jsx` it is text.
    tsrx: bool = false,
};

pub const ParseResult = struct {
    tree: ast.Tree,
    dialect_store: Store,
    root: ast.NodeIndex,
    nodes: @TypeOf(@as(ast.Tree, undefined).nodes),
    extras: @TypeOf(@as(ast.Tree, undefined).extras),
    source: []const u8,
    diagnostics: @TypeOf(@as(ast.Tree, undefined).diagnostics),

    pub fn init(tree: ast.Tree, store: Store) ParseResult {
        return .{
            .root = tree.root,
            .nodes = tree.nodes,
            .extras = tree.extras,
            .source = tree.source,
            .diagnostics = tree.diagnostics,
            .tree = tree,
            .dialect_store = store,
        };
    }

    pub fn deinit(self: *const ParseResult) void {
        self.tree.deinit();
    }
    pub fn allocator(self: *ParseResult) std.mem.Allocator {
        return self.tree.allocator();
    }
    pub fn hasErrors(self: *const ParseResult) bool {
        return self.tree.hasErrors();
    }
    pub fn hasDiagnostics(self: *const ParseResult) bool {
        return self.tree.hasDiagnostics();
    }
    pub fn data(self: *const ParseResult, index: ast.NodeIndex) ast.NodeData {
        return self.tree.data(index);
    }
    pub fn span(self: *const ParseResult, index: ast.NodeIndex) ast.Span {
        return self.tree.span(index);
    }
    pub fn extra(self: *const ParseResult, range: ast.IndexRange) []const ast.NodeIndex {
        return self.tree.extra(range);
    }
    pub fn string(self: *const ParseResult, value: ast.String) []const u8 {
        return self.tree.string(value);
    }
    pub fn commentsOf(self: *const ParseResult, index: ast.NodeIndex) []const ast.AttachedComment {
        return self.tree.commentsOf(index);
    }
    pub fn dialectOverlay(self: *const ParseResult, node: u32) ?u32 {
        return self.dialect_store.findOverlay(node);
    }
    pub fn dialectRecord(self: *const ParseResult, node: u32) ?u32 {
        return self.dialect_store.findAssociation(node);
    }
    pub fn addDialectRecord(self: *ParseResult, record: dialect_schema.Record) !u32 {
        return self.dialect_store.addRecord(self.tree.allocator(), record);
    }
    pub fn addDialectOverlay(self: *ParseResult, node: u32, record: u32) !void {
        return self.dialect_store.addOverlay(self.tree.allocator(), node, record);
    }
};

pub const parse = parseLocal;

fn parseLocal(allocator: std.mem.Allocator, source: []const u8, options: Options) !ParseResult {
    const C = extension.Container(yuku.Parser);
    var state = C{
        .parser = yuku.Parser.init(allocator, source, .{
            .source_type = options.source_type,
            .lang = options.lang,
            .preserve_parens = options.preserve_parens,
            .comments = options.comments,
        }),
        .options = .{ .loose = options.loose, .tsrx = options.tsrx },
    };
    var tree = try state.parser.parse();
    normalizeJsxTypeArguments(&tree);
    return ParseResult.init(tree, state.store);
}

/// The pinned parser initializes an absent JSX type-argument field with node
/// zero instead of `.null`.  Do not let that sentinel escape through transfer
/// (where it would become an unrelated ESTree `typeArguments` child), while
/// retaining a real `<T>` node whose span lies inside the opening tag.
fn normalizeJsxTypeArguments(tree: *ast.Tree) void {
    const data_items = tree.nodes.items(.data);
    for (data_items, 0..) |*data, index| switch (data.*) {
        .jsx_opening_element => |value| {
            var opening = value;
            if (opening.type_arguments == .null) continue;
            const raw = @intFromEnum(opening.type_arguments);
            if (raw >= tree.nodes.len) {
                opening.type_arguments = .null;
                data.* = .{ .jsx_opening_element = opening };
                continue;
            }
            const opening_span = tree.nodes.items(.span)[index];
            const argument_span = tree.span(opening.type_arguments);
            if (argument_span.start < tree.span(opening.name).end or
                argument_span.end > opening_span.end)
            {
                opening.type_arguments = .null;
                data.* = .{ .jsx_opening_element = opening };
            }
        },
        else => {},
    };
}

pub const semantic = @import("semantic.zig");
pub const diagnostics = @import("diagnostics.zig");
pub const traverser = @import("traverser.zig");
pub const projection = @import("projection.zig");
pub const codegen = @import("codegen.zig");
