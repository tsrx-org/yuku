const std = @import("std");

pub fn Decision(comptime T: type) type {
    return union(enum) { unhandled, handled: T };
}

pub const Hook = enum(u8) {
    statement_at_code_block,
    statement_at_control_flow,
    expression_at_code_block,
    expression_at_control_flow,
    function_body_starts,
    function_body,
    for_of_tail,
    module_specifier,
    jsx_element_after_open,
    jsx_names_match,
    jsx_text_boundary,
    jsx_text_value,
    jsx_child_at_code_block,
    jsx_child_at_control_flow,
    jsx_element_name,
    validate_jsx_element_name,
};

pub const FieldRole = enum(u8) {
    scalar_u32,
    node_ref,
    optional_node_ref,
    node_list,
    string_slice,
    overlay_host,
};

pub const ScopeRole = enum(u8) { none, block };

fn Word(comptime role: FieldRole) type {
    return packed struct(u32) {
        raw: u32,
        pub const dialect_role = role;

        pub inline fn init(value: u32) @This() {
            return .{ .raw = value };
        }
    };
}

pub const ScalarU32 = Word(.scalar_u32);
pub const NodeRef = Word(.node_ref);
pub const OptionalNodeRef = Word(.optional_node_ref);
pub const OverlayHost = Word(.overlay_host);

pub const NodeList = extern struct {
    start: u32,
    len: u32,
    pub const dialect_role = FieldRole.node_list;
};

pub const StringSlice = extern struct {
    start: u32,
    end: u32,
    pub const dialect_role = FieldRole.string_slice;
};

/// Independent reflected schema used only by the sentinel specialization.
pub const NodeRecord = struct {
    pub const estree_type = "Node";
    value: NodeRef,
    active: bool,
};

pub const ForOfOverlay = struct {
    pub const estree_type = "ForOfStatement";
    host_node: OverlayHost,
    index: NodeRef,
    key: NodeRef,
};

pub const CatchClauseOverlay = struct {
    host_node: OverlayHost,
    reset_param: OptionalNodeRef,
};

pub const Record = union(enum) {
    node: NodeRecord,
    for_of: ForOfOverlay,
    catch_clause: CatchClauseOverlay,
};

pub const record_count: u8 = @typeInfo(Record).@"union".fields.len;

comptime {
    std.debug.assert(@typeInfo(Hook).@"enum".fields.len == 16);
    std.debug.assert(@sizeOf(FieldRole) == 1);
    std.debug.assert(@sizeOf(ScopeRole) == 1);
    std.debug.assert(@sizeOf(NodeRef) == 4);
    std.debug.assert(@sizeOf(NodeList) == 8);
    std.debug.assert(@sizeOf(StringSlice) == 8);
}
