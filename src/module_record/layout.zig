//! The module record transfer, little endian u32 words, read by the decoder `zig build` generates
//! into `src/module-record/layout.ts` from these structs.
//!
//! sections, in order
//!
//!   header             one Header
//!   static imports     Header.static_imports StaticImport
//!   static exports     Header.static_exports StaticExport, each followed by its `entries` Entry
//!   dynamic imports    Header.dynamic_imports DynamicImport
//!   strings            Header.pool_len bytes of WTF-8, zero-padded to a 4-byte boundary
//!
//! offsets are UTF-16 code units into the source, so the host slices the source with them

/// A UTF-16 offset into the source.
pub const Offset = enum(u32) { _ };

/// Text as a UTF-16 range of the source, or, with `pool_bit` set in `start`, a byte range of the strings.
pub const Text = extern struct {
    start: u32,
    end: u32,

    pub const pool_bit: u32 = 1 << 31;
};

/// A `Text`, or `none` in `start` for no text.
pub const OptionalText = extern struct {
    start: u32,
    end: u32,

    pub const none: OptionalText = .{ .start = 0xFFFF_FFFF, .end = 0xFFFF_FFFF };
};

/// The number of `T` records that follow.
pub fn List(comptime T: type) type {
    return enum(u32) {
        _,

        pub const Item = T;
    };
}

pub const Flag = enum(u32) { false = 0, true = 1 };

pub const Header = extern struct {
    failed: Flag,
    static_imports: u32,
    static_exports: u32,
    dynamic_imports: u32,
    /// The word the strings start at.
    pool_start: u32,
    pool_len: u32,
};

/// `import ... from "m"` or `import "m"`.
pub const StaticImport = extern struct {
    start: Offset,
    end: Offset,
    specifier: Text,
    specifier_start: Offset,
    specifier_end: Offset,
};

/// An `export` statement.
pub const StaticExport = extern struct {
    start: Offset,
    end: Offset,
    braced: Flag,
    specifier: OptionalText,
    entries: List(Entry),
};

/// An ExportEntry Record of the ECMAScript specification.
pub const Entry = extern struct {
    exported: OptionalText,
    local: OptionalText,
    imported: OptionalText,
    imported_from: OptionalText,
};

/// An `import()`, `import.source()`, or `import.defer()` call.
pub const DynamicImport = extern struct {
    start: Offset,
    end: Offset,
    argument_start: Offset,
    argument_end: Offset,
};

pub fn words(comptime T: type) u32 {
    return @sizeOf(T) / 4;
}
