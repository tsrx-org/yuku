const std = @import("std");
const napi_zig = @import("napi_zig");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const yuku = b.dependency("yuku", .{
        .target = target,
        .optimize = optimize,
    });

    const module = b.addModule("yuku-tsrx", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("yuku", yuku.module("parser"));

    const unit_tests = b.addTest(.{ .root_module = module });
    const behavior_tests_module = b.createModule(.{
        .root_source_file = b.path("src/testing/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    behavior_tests_module.addImport("yuku", yuku.module("parser"));
    const behavior_tests = b.addTest(.{ .root_module = behavior_tests_module });

    const test_step = b.step("test", "Run unit and parser control tests");
    test_step.dependOn(&b.addRunArtifact(unit_tests).step);
    test_step.dependOn(&b.addRunArtifact(behavior_tests).step);

    const fuzz_module = b.createModule(.{
        .root_source_file = b.path("src/testing/fuzz.zig"),
        .target = b.graph.host,
        .optimize = .ReleaseSafe,
    });
    fuzz_module.addImport("yuku", yuku.module("parser"));
    const fuzz_executable = b.addExecutable(.{
        .name = "yuku-tsrx-fuzz",
        .root_module = fuzz_module,
    });
    const fuzz_run = b.addRunArtifact(fuzz_executable);
    fuzz_run.has_side_effects = true;
    const fuzz_step = b.step("fuzz", "Run the bounded parser control fuzzer");
    fuzz_step.dependOn(&fuzz_run.step);

    {
        const production = addProductionGraph(b, yuku, target, optimize);
        const production_dialect_module = production.parser_extension;
        const production_parser_module = production.parser;
        const production_transfer_module = production.transfer;

        const napi_dep = b.dependency("napi_zig", .{});
        napi_zig.addLib(b, napi_dep, .{
            .name = "yuku-tsrx",
            .root = b.path("src/ffi/root.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "parser", .module = production_parser_module },
                .{ .name = "transfer", .module = production_transfer_module },
            },
            .npm = .{
                .scope = "@tsrx",
                .description = "Native TSRX parser bindings",
                .dts = .auto,
            },
        });
        installNpmHostWrapper(b);
        installNpmHostAddon(b, "yuku-tsrx", "npm/yuku/@tsrx/yuku", target);

        napi_zig.addLib(b, napi_dep, .{
            .name = "yuku-tsrx-performance",
            .root = b.path("src/ffi/performance.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "parser", .module = production_parser_module },
            },
            .npm = null,
        });
        const performance_step = b.step(
            "performance-addon",
            "Build the private production-parser performance probe",
        );
        performance_step.dependOn(b.getInstallStep());

        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-parser-decoder",
            .description = "Generate production TSRX parser decoder",
            .root = "tools/gen_parser_decoder.zig",
            .kind = .decoder,
            .output = "decode.js",
        });
        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-analyzer-decoder",
            .description = "Generate production TSRX analyzer decoder",
            .root = "tools/gen_analyzer_decoder.zig",
            .kind = .decoder,
            .output = "decode-analyzer.js",
        });
        addEstreeGenerator(b, yuku, production_parser_module, production_transfer_module, .{
            .step = "gen-codegen-encoder",
            .description = "Generate production TSRX codegen encoder",
            .root = "tools/gen_codegen_encoder.zig",
            .kind = .encoder,
            .output = "encode.js",
        });
        const m4_test_module = b.createModule(.{
            .root_source_file = b.path("src/testing/m4.zig"),
            .target = target,
            .optimize = optimize,
        });
        m4_test_module.addImport("parser", production_parser_module);
        const m4_tests = b.addRunArtifact(b.addTest(.{ .root_module = m4_test_module }));
        const m4_step = b.step("test-m4-surfaces", "Test TSRX semantic and codegen surfaces");
        m4_step.dependOn(&m4_tests.step);

        const plain_transfer_module = b.createModule(.{
            .root_source_file = yuku.path("src/parser/ffi/transfer/root.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        plain_transfer_module.addImport("parser", yuku.module("parser"));
        addEstreeGenerator(b, yuku, yuku.module("parser"), plain_transfer_module, .{
            .step = "gen-upstream-parser-decoder",
            .description = "Generate the exact upstream parser decoder",
            .root = "tools/gen_parser_decoder.zig",
            .kind = .decoder,
            .output = "upstream-decode.js",
        });

        const binding_test_module = b.createModule(.{
            .root_source_file = b.path("src/testing/production_binding.zig"),
            .target = target,
            .optimize = optimize,
        });
        binding_test_module.addImport("dialect", production_dialect_module);
        binding_test_module.addImport("parser", production_parser_module);
        binding_test_module.addImport("transfer", production_transfer_module);
        const binding_tests = b.addRunArtifact(b.addTest(.{ .root_module = binding_test_module }));
        test_step.dependOn(&binding_tests.step);

        const dialect_fixture_options = b.addOptions();
        dialect_fixture_options.addOption(bool, "dialect_mode", true);
        const dialect_fixture_module = b.createModule(.{
            .root_source_file = b.path("src/testing/fixtures.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        dialect_fixture_module.addImport("parser", production_parser_module);
        dialect_fixture_module.addImport("transfer", production_transfer_module);
        dialect_fixture_module.addImport(
            "fixture_options",
            dialect_fixture_options.createModule(),
        );
        addFixtureImports(b, dialect_fixture_module);
        const dialect_fixture_executable = b.addExecutable(.{
            .name = "yuku-tsrx-fixtures-dialect",
            .root_module = dialect_fixture_module,
        });
        const dialect_fixture_install = b.addInstallArtifact(
            dialect_fixture_executable,
            .{},
        );

        const plain_fixture_options = b.addOptions();
        plain_fixture_options.addOption(bool, "dialect_mode", false);
        const plain_fixture_module = b.createModule(.{
            .root_source_file = b.path("src/testing/fixtures.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        plain_fixture_module.addImport("parser", yuku.module("parser"));
        plain_fixture_module.addImport("transfer", plain_transfer_module);
        plain_fixture_module.addImport(
            "fixture_options",
            plain_fixture_options.createModule(),
        );
        addFixtureImports(b, plain_fixture_module);
        const plain_fixture_executable = b.addExecutable(.{
            .name = "yuku-tsrx-fixtures-plain",
            .root_module = plain_fixture_module,
        });
        const plain_fixture_install = b.addInstallArtifact(
            plain_fixture_executable,
            .{},
        );

        const fixture_decoder_module = b.createModule(.{
            .root_source_file = b.path("tools/gen_parser_decoder.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        fixture_decoder_module.addImport("parser", production_parser_module);
        fixture_decoder_module.addImport("transfer", production_transfer_module);
        const fixture_decoder = b.addExecutable(.{
            .name = "gen-fixture-decoder",
            .root_module = fixture_decoder_module,
        });
        const fixture_decoder_output = b.addRunArtifact(fixture_decoder).captureStdOut(.{});
        const fixture_decoder_install = b.addInstallFile(
            fixture_decoder_output,
            "dialect-decode.js",
        );
        const fixture_plain_decoder_module = b.createModule(.{
            .root_source_file = b.path("tools/gen_parser_decoder.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        const fixture_plain_meta = b.createModule(.{
            .root_source_file = yuku.path("tools/estree/meta.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        fixture_plain_meta.addImport("parser", yuku.module("parser"));
        const fixture_plain_base = b.createModule(.{
            .root_source_file = yuku.path("tools/estree/decoder.zig"),
            .target = b.graph.host,
            .optimize = optimize,
        });
        fixture_plain_base.addImport("parser", yuku.module("parser"));
        fixture_plain_base.addImport("transfer", plain_transfer_module);
        fixture_plain_base.addImport("meta", fixture_plain_meta);
        fixture_plain_decoder_module.addImport("parser", yuku.module("parser"));
        fixture_plain_decoder_module.addImport("transfer", plain_transfer_module);
        fixture_plain_decoder_module.addImport("decoder", fixture_plain_base);
        const fixture_plain_decoder = b.addExecutable(.{
            .name = "gen-fixture-plain-decoder",
            .root_module = fixture_plain_decoder_module,
        });
        const fixture_plain_decoder_install = b.addInstallFile(
            b.addRunArtifact(fixture_plain_decoder).captureStdOut(.{}),
            "dialect-free-fixture-decode.js",
        );

        const fixture_oracle = b.addSystemCommand(&.{
            "node",
            "tools/fixture-oracle.ts",
            "--fixtures",
            "test/parser/misc",
        });
        fixture_oracle.step.dependOn(&dialect_fixture_install.step);
        fixture_oracle.step.dependOn(&plain_fixture_install.step);
        fixture_oracle.step.dependOn(&fixture_decoder_install.step);
        fixture_oracle.step.dependOn(&fixture_plain_decoder_install.step);
        const fixture_step = b.step(
            "test-fixtures",
            "Compare production TSRX trees and diagnostics with the immutable oracle",
        );
        fixture_step.dependOn(&fixture_oracle.step);
    }

    addWasm(b, yuku);
}

/// The production dialect module graph: the same wiring the napi addon uses,
/// built once per target so the browser build cannot drift from the native one.
const ProductionGraph = struct {
    dialect_abi: *std.Build.Module,
    schema: *std.Build.Module,
    parser_extension: *std.Build.Module,
    parser_base: *std.Build.Module,
    parser: *std.Build.Module,
    base_transfer: *std.Build.Module,
    transfer: *std.Build.Module,
};

fn addProductionGraph(
    b: *std.Build,
    yuku: *std.Build.Dependency,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) ProductionGraph {
    const dialect_abi_module = b.createModule(.{
        .root_source_file = b.path("src/dialect/abi.zig"),
        .target = target,
        .optimize = optimize,
    });
    const schema_module = b.createModule(.{
        .root_source_file = b.path("src/dialect/schema.zig"),
        .target = target,
        .optimize = optimize,
    });
    schema_module.addImport("dialect_abi", dialect_abi_module);
    const dialect_module = b.createModule(.{
        .root_source_file = b.path("src/dialect/parser_extension.zig"),
        .target = target,
        .optimize = optimize,
    });
    dialect_module.addImport("dialect_abi", dialect_abi_module);
    dialect_module.addImport("dialect_schema", schema_module);
    const parser_base = cloneModule(
        b,
        yuku.module("parser"),
        yuku.path("src/parser/root.zig"),
        target,
        optimize,
    );
    parser_base.addImport("parser_extension", dialect_module);
    const parser_module = b.createModule(.{
        .root_source_file = b.path("src/dialect/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    parser_module.addImport("yuku", parser_base);
    parser_module.addImport("parser_extension", dialect_module);
    parser_module.addImport("dialect_abi", dialect_abi_module);
    parser_module.addImport("util", parser_base.import_table.get("util").?);
    parser_module.addImport(
        "codegen_options",
        parser_base.import_table.get("codegen_options").?,
    );
    const base_transfer_module = b.createModule(.{
        .root_source_file = yuku.path("src/parser/ffi/transfer/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    base_transfer_module.addImport("parser", parser_base);
    const transfer_module = b.createModule(.{
        .root_source_file = b.path("src/dialect/transfer.zig"),
        .target = target,
        .optimize = optimize,
    });
    transfer_module.addImport("parser", parser_module);
    transfer_module.addImport("base_transfer", base_transfer_module);

    return .{
        .dialect_abi = dialect_abi_module,
        .schema = schema_module,
        .parser_extension = dialect_module,
        .parser_base = parser_base,
        .parser = parser_module,
        .base_transfer = base_transfer_module,
        .transfer = transfer_module,
    };
}

/// `zig build wasm` only. The default install still writes just the napi addon
/// and the npm package, so nothing here lands in a normal build.
fn addWasm(b: *std.Build, yuku: *std.Build.Dependency) void {
    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .cpu_features_add = std.Target.wasm.featureSet(&.{
            .bulk_memory,
            .nontrapping_fptoint,
            .sign_ext,
            .simd128,
        }),
    });
    const wasm_step = b.step(
        "wasm",
        "Build the yuku-tsrx dialect for the browser (zig-out/wasm/yuku-tsrx.wasm)",
    );

    const graph = addProductionGraph(b, yuku, wasm_target, .ReleaseSmall);
    const wasm_module = b.createModule(.{
        .root_source_file = b.path("src/ffi/wasm.zig"),
        .target = wasm_target,
        .optimize = .ReleaseSmall,
        .strip = true,
    });
    wasm_module.addImport("parser", graph.parser);
    wasm_module.addImport("transfer", graph.transfer);

    const wasm_exe = b.addExecutable(.{ .name = "yuku-tsrx", .root_module = wasm_module });
    wasm_exe.entry = .disabled;
    wasm_exe.rdynamic = true;
    const install = b.addInstallArtifact(wasm_exe, .{
        .dest_dir = .{ .override = .{ .custom = "wasm" } },
    });
    wasm_step.dependOn(&install.step);
}

fn installNpmHostWrapper(b: *std.Build) void {
    const install_step = b.getInstallStep();
    const generated_steps = b.allocator.dupe(
        *std.Build.Step,
        install_step.dependencies.items,
    ) catch @panic("unable to snapshot npm install dependencies");
    inline for ([_][]const u8{
        "index.js",
        "index.d.ts",
        "package.json",
        "decode.js",
        "decode-analyzer.js",
        "diagnostic-spans.js",
        "encode.js",
        "walk.js",
    }) |name| {
        const overlay = b.addInstallFile(
            b.path(b.fmt("npm/yuku/{s}", .{name})),
            b.fmt("npm/yuku/{s}", .{name}),
        );
        for (generated_steps) |generated| overlay.step.dependOn(generated);
        install_step.dependOn(&overlay.step);
    }
    const host_binding = b.addWriteFiles().add("binding.js",
        \\import { createRequire } from "node:module";
        \\import { fileURLToPath } from "node:url";
        \\const require = createRequire(import.meta.url);
        \\const report = process.platform === "linux" && process.report?.getReport?.();
        \\const header = typeof report === "string" ? JSON.parse(report).header : report?.header;
        \\const libc = process.platform === "linux" ? (header?.glibcVersionRuntime ? "-gnu" : "-musl") : "";
        \\const suffix = `${process.platform}-${process.arch}${libc}`;
        \\const local = fileURLToPath(new URL(`./@tsrx/yuku-${suffix}/yuku-tsrx.node`, import.meta.url));
        \\let binding;
        \\try { binding = require(local); }
        \\catch (localError) {
        \\  try { binding = require(`@tsrx/yuku-${suffix}/yuku-tsrx.node`); }
        \\  catch (packageError) {
        \\    throw new Error(`Failed to load the @tsrx/yuku native binding for ${suffix}`, {
        \\      cause: new AggregateError([localError, packageError]),
        \\    });
        \\  }
        \\}
        \\export default binding;
        \\
    );
    const binding_overlay = b.addInstallFile(host_binding, "npm/yuku/binding.js");
    for (generated_steps) |generated| binding_overlay.step.dependOn(generated);
    install_step.dependOn(&binding_overlay.step);

    // The binding packages that 0.1.0 actually ships. napi-zig only scaffolds a
    // per-platform package.json in its own `-Dnpm` release mode, which also
    // forces ReleaseFast and hardcodes version 0.0.0. This tree publishes from
    // the ordinary `zig build` / `zig build -Dtarget=...` path instead, so the
    // manifests are checked in under npm/ and overlaid here. Each one is
    // installed on every build, including builds that only produce the other
    // platform's .node: a manifest without its addon beside it is what
    // scripts/release-local.mjs and the publish workflow both refuse to
    // publish, and a missing manifest would be harder to notice than a
    // rejected one.
    inline for ([_][]const u8{
        "@tsrx/yuku-darwin-arm64",
        "@tsrx/yuku-linux-x64-gnu",
    }) |package| {
        const manifest = b.addInstallFile(
            b.path(b.fmt("npm/yuku/{s}/package.json", .{package})),
            b.fmt("npm/yuku/{s}/package.json", .{package}),
        );
        for (generated_steps) |generated| manifest.step.dependOn(generated);
        install_step.dependOn(&manifest.step);
    }
}

/// `binding_prefix` is the staged binding package path minus its platform
/// suffix: `npm/yuku/@tsrx/yuku` becomes `npm/yuku/@tsrx/yuku-darwin-arm64/`.
fn installNpmHostAddon(
    b: *std.Build,
    name: []const u8,
    binding_prefix: []const u8,
    target: std.Build.ResolvedTarget,
) void {
    if (npmReleaseRequested(b)) return;
    const platform = napi_zig.Platform.fromTarget(target.result) orelse return;
    const install_step = b.getInstallStep();
    const addon = for (install_step.dependencies.items) |dependency| {
        const artifact = dependency.cast(std.Build.Step.InstallArtifact) orelse continue;
        if (!std.mem.eql(u8, artifact.artifact.name, name)) continue;
        switch (artifact.dest_dir orelse continue) {
            .lib => break artifact.artifact.getEmittedBin(),
            else => continue,
        }
    } else return;
    const addon_install = b.addInstallFile(addon, b.fmt(
        "{s}-{s}/{s}.node",
        .{ binding_prefix, platform.suffix(), name },
    ));
    install_step.dependOn(&addon_install.step);
}

fn npmReleaseRequested(b: *std.Build) bool {
    const option = b.user_input_options.getPtr("npm") orelse return false;
    return switch (option.value) {
        .flag => true,
        .scalar => |value| std.mem.eql(u8, value, "true"),
        else => false,
    };
}

fn cloneModule(
    b: *std.Build,
    template: *std.Build.Module,
    root_source_file: std.Build.LazyPath,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) *std.Build.Module {
    const module = b.createModule(.{
        .root_source_file = root_source_file,
        .target = target,
        .optimize = optimize,
    });
    for (template.import_table.keys(), template.import_table.values()) |name, dependency| {
        module.addImport(name, dependency);
    }
    return module;
}

fn addFixtureImports(b: *std.Build, module: *std.Build.Module) void {
    inline for ([_]struct { name: []const u8, path: []const u8 }{
        .{ .name = "code_block_expression", .path = "test/parser/misc/tsrx/code-block-expression.module.tsrx" },
        .{ .name = "code_block_function", .path = "test/parser/misc/tsrx/code-block-function.module.tsrx" },
        .{ .name = "code_block", .path = "test/parser/misc/tsrx/code-block.module.tsrx" },
        .{ .name = "control_flow_for", .path = "test/parser/misc/tsrx/control-flow-for.module.tsrx" },
        .{ .name = "control_flow_if", .path = "test/parser/misc/tsrx/control-flow-if.module.tsrx" },
        .{ .name = "control_flow_switch_invalid", .path = "test/parser/misc/tsrx/control-flow-switch-invalid.module.tsrx" },
        .{ .name = "control_flow_switch", .path = "test/parser/misc/tsrx/control-flow-switch.module.tsrx" },
        .{ .name = "control_flow_try", .path = "test/parser/misc/tsrx/control-flow-try.module.tsrx" },
        .{ .name = "dynamic_tag_invalid", .path = "test/parser/misc/tsrx/dynamic-tag-invalid.module.tsrx" },
        .{ .name = "dynamic_tag", .path = "test/parser/misc/tsrx/dynamic-tag.module.tsrx" },
        .{ .name = "lazy_destructuring", .path = "test/parser/misc/tsrx/lazy-destructuring.module.tsrx" },
        .{ .name = "style_element", .path = "test/parser/misc/tsrx/style-element.module.tsrx" },
        .{ .name = "submodule_import", .path = "test/parser/misc/tsrx/submodule-import.module.tsrx" },
        .{ .name = "template_return_invalid", .path = "test/parser/misc/tsrx/template-return-invalid.module.tsrx" },
        .{ .name = "text_entities", .path = "test/parser/misc/tsrx/text-entities.module.tsrx" },
        .{ .name = "dynamic_tag_outside", .path = "test/parser/misc/ts/dynamic-tag-outside-tsrx.tsx" },
        .{ .name = "lazy_destructuring_outside", .path = "test/parser/misc/ts/lazy-destructuring-outside-tsrx.ts" },
        .{ .name = "submodule_import_outside", .path = "test/parser/misc/ts/submodule-import-outside-tsrx.ts" },
    }) |fixture| {
        module.addAnonymousImport(fixture.name, .{
            .root_source_file = b.path(fixture.path),
        });
    }
}

const EstreeGeneratorKind = enum { decoder, encoder };

const EstreeGenerator = struct {
    step: []const u8,
    description: []const u8,
    root: []const u8,
    kind: EstreeGeneratorKind,
    output: []const u8,
};

fn addEstreeGenerator(
    b: *std.Build,
    yuku: *std.Build.Dependency,
    parser_module: *std.Build.Module,
    transfer_module: *std.Build.Module,
    config: EstreeGenerator,
) void {
    if (std.mem.eql(u8, config.step, "gen-upstream-parser-decoder")) {
        const control = b.addSystemCommand(&.{
            "git",
            "-C",
            "../yuku",
            "show",
            "eb2adcb4c17da16e7ade1a0517192d81d469e67f:npm/yuku-parser/decode.js",
        });
        const step = b.step(config.step, config.description);
        step.dependOn(&b.addInstallFile(control.captureStdOut(.{}), config.output).step);
        return;
    }
    const meta_module = b.createModule(.{
        .root_source_file = yuku.path("tools/estree/meta.zig"),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    meta_module.addImport("parser", parser_module);

    const shared_module = b.createModule(.{
        .root_source_file = yuku.path(switch (config.kind) {
            .decoder => "tools/estree/decoder.zig",
            .encoder => "tools/estree/encoder.zig",
        }),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    shared_module.addImport("parser", parser_module);
    shared_module.addImport("transfer", transfer_module);
    shared_module.addImport("meta", meta_module);

    const root_module = b.createModule(.{
        .root_source_file = b.path(config.root),
        .target = b.graph.host,
        .optimize = .Debug,
    });
    root_module.addImport(switch (config.kind) {
        .decoder => "decoder",
        .encoder => "encoder",
    }, shared_module);
    root_module.addImport("meta", meta_module);
    root_module.addImport("parser", parser_module);
    root_module.addImport("transfer", transfer_module);

    const executable = b.addExecutable(.{ .name = config.step, .root_module = root_module });
    const output = b.addRunArtifact(executable).captureStdOut(.{});
    const step = b.step(config.step, config.description);
    step.dependOn(&b.addInstallFile(output, config.output).step);
}
