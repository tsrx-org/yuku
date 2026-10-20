const std = @import("std");

pub fn build(b: *std.Build) void {
    const yuku = b.dependency("yuku", .{ .dialect = b.path("src/tsrx.zig") });
    b.installArtifact(@import("yuku").addWasm(b, yuku, "yuku-tsrx"));
}
