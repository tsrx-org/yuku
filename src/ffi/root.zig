const std = @import("std");
const napi = @import("napi-zig");
const parser = @import("parser");
const transfer = @import("transfer");
const semantic_transfer = transfer.semantic;

const ParseOptions = struct {
    source_type: parser.ast.SourceType = .module,
    lang: parser.ast.Lang = .js,
    preserve_parens: bool = true,
    semantic_errors: bool = false,
    attach_comments: bool = false,
    loose: bool = false,
};

const AnalyzeOptions = struct {
    source_type: parser.ast.SourceType = .module,
    lang: parser.ast.Lang = .js,
    preserve_parens: bool = true,
    attach_comments: bool = false,
};

pub fn parse(env: napi.Env, source: []const u8, options: ParseOptions) !napi.Val {
    var tree = parser.parse(std.heap.smp_allocator, source, .{
        .source_type = options.source_type,
        .lang = options.lang,
        .preserve_parens = options.preserve_parens,
        .comments = if (options.attach_comments) .both else .flat,
        .loose = options.loose,
    }) catch return error.ParseFailed;
    defer tree.deinit();
    if (options.semantic_errors) parser.diagnostics.analyzeWithBoundarySeverity(&tree);
    const buffer = try env.createArrayBuffer(transfer.bufferSize(&tree));
    _ = transfer.serializeInto(&tree, buffer.data);
    return buffer.val;
}

pub fn analyze(env: napi.Env, source: []const u8, options: AnalyzeOptions) !napi.Val {
    var tree = parser.parse(std.heap.smp_allocator, source, .{
        .source_type = options.source_type,
        .lang = options.lang,
        .preserve_parens = options.preserve_parens,
        .comments = if (options.attach_comments) .both else .flat,
    }) catch return error.AnalyzeFailed;
    defer tree.deinit();
    var semantic = parser.semantic.analyze(&tree) catch return error.AnalyzeFailed;
    const records = parser.semantic.module_record.collect(
        &tree,
        &semantic,
    ) catch return error.AnalyzeFailed;
    const core_size = transfer.bufferSize(&tree);
    const size = semantic_transfer.bufferSize(&tree, &semantic, records, core_size);
    const buffer = try env.createArrayBuffer(size);
    const core_written = transfer.serializeInto(&tree, buffer.data);
    _ = try semantic_transfer.appendInto(&tree, &semantic, records, buffer.data, core_written);
    return buffer.val;
}

const codegen_defaults: parser.codegen.Options = .{};

const GenerateOptions = struct {
    strip: bool = false,
    minify: bool = false,
    format: parser.codegen.Format = codegen_defaults.format,
    indent: u8 = codegen_defaults.indent,
    quotes: parser.codegen.Quotes = codegen_defaults.quotes,
    comments: parser.codegen.Comments = codegen_defaults.comments,
    source_maps: ?parser.codegen.SourceMapOptions = codegen_defaults.source_maps,
};

pub fn generate(
    env: napi.Env,
    buffer: napi.Val,
    options: GenerateOptions,
) !parser.codegen.Result {
    const allocator = env.allocator();
    const bytes = try buffer.getArrayBufferData(env);
    var tree = transfer.deserializeFromBuf(allocator, bytes, "") catch return error.DecodeFailed;
    defer tree.deinit();
    return parser.codegen.emit(allocator, &tree, .{
        .strip_ts = options.strip,
        .minify = options.minify,
    }, .{
        .format = options.format,
        .indent = options.indent,
        .quotes = options.quotes,
        .comments = options.comments,
        .source_maps = options.source_maps,
    });
}

comptime {
    napi.module(@This());
}
