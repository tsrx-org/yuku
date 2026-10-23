const std = @import("std");

pub fn build(b: *std.Build) void {
    const yuku = b.dependency("yuku", .{ .dialect = b.path("src/tsrx.zig") });
    const parser = yuku.module("parser-wasm");
    const module = struct {
        fn create(owner: *std.Build, root: std.Build.LazyPath, p: *std.Build.Module) *std.Build.Module {
            return owner.createModule(.{
                .root_source_file = root,
                .target = p.resolved_target,
                .optimize = p.optimize,
                .imports = &.{.{ .name = "parser", .module = p }},
            });
        }
    }.create;

    // Yuku's entries, with the module record scan beside them
    const root = module(b, b.path("src/wasm.zig"), parser);
    root.strip = true;
    root.addImport("yuku_wasm", module(b, yuku.path("src/parser/ffi/wasm.zig"), parser));
    const wasm = b.addExecutable(.{ .name = "yuku-tsrx", .root_module = root });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    b.installArtifact(wasm);

    const decoder = b.addExecutable(.{
        .name = "module-record-decoder",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/module_record/decoder.zig"),
            .target = b.graph.host,
        }),
    });
    const generated = b.addUpdateSourceFiles();
    generated.addCopyFileToSource(
        b.addRunArtifact(decoder).captureStdOut(.{}),
        "src/module-record/layout.ts",
    );
    b.getInstallStep().dependOn(&generated.step);
}
