const std = @import("std");
const abi = @import("dialect_abi");

pub const NodeRecord = struct {
    value: abi.NodeRef,
    active: bool,
};

pub const ForOfOverlay = struct {
    pub const estree_type = "ForOfStatement";
    host_node: abi.OverlayHost,
    index: abi.OptionalNodeRef,
    key: abi.OptionalNodeRef,
};

pub const CatchClauseOverlay = struct {
    host_node: abi.OverlayHost,
    reset_param: abi.OptionalNodeRef,
};

pub const ArrayPatternOverlay = struct {
    host_node: abi.OverlayHost,
    lazy: bool,
};

pub const ObjectPatternOverlay = struct {
    host_node: abi.OverlayHost,
    lazy: bool,
};

pub const JSXCodeBlock = struct {
    pub const estree_type = "JSXCodeBlock";
    pub const scope_role = abi.ScopeRole.block;
    body: abi.NodeList,
    render: abi.OptionalNodeRef,
};

pub const JSXForExpression = struct {
    pub const estree_type = "JSXForExpression";
    statement: abi.NodeRef,
    empty: abi.OptionalNodeRef,
};

pub const JSXIfExpression = struct {
    pub const estree_type = "JSXIfExpression";
    @"test": abi.NodeRef,
    consequent: abi.NodeRef,
    alternate: abi.OptionalNodeRef,
};

pub const JSXSwitchExpression = struct {
    pub const estree_type = "JSXSwitchExpression";
    statement: abi.NodeRef,
};

pub const JSXTryExpression = struct {
    pub const estree_type = "JSXTryExpression";
    statement: abi.NodeRef,
    pending: abi.OptionalNodeRef,
};

pub const StyleSheet = struct {
    pub const estree_type = "StyleSheet";
    source: abi.StringSlice,
    children: abi.NodeList,
    /// false means the structure scanner bailed; `children` is then empty.
    scanned: bool,
};

pub const JSXStyleElement = struct {
    pub const estree_type = "JSXStyleElement";
    opening_element: abi.NodeRef,
    children: abi.NodeList,
    closing_element: abi.OptionalNodeRef,
    css: abi.StringSlice,
};

pub const JSXScriptElement = struct {
    pub const estree_type = "JSXScriptElement";
    opening_element: abi.NodeRef,
    children: abi.NodeList,
    closing_element: abi.OptionalNodeRef,
    raw: abi.StringSlice,
};

pub const TSRXExpression = struct {
    pub const estree_type = "TSRXExpression";
    expression: abi.NodeRef,
};

pub const CssRule = struct {
    pub const estree_type = "CssRule";
    prelude: abi.NodeList,
    block: abi.NodeList,
};

pub const CssAtrule = struct {
    pub const estree_type = "CssAtrule";
    name: abi.StringSlice,
    block: abi.NodeList,
    keyframes: bool,
};

pub const CssSelector = struct {
    pub const estree_type = "CssSelector";
    scope_insert: abi.ScalarU32,
};

pub const Record = union(enum) {
    node: NodeRecord,
    for_of: ForOfOverlay,
    catch_clause: CatchClauseOverlay,
    array_pattern: ArrayPatternOverlay,
    object_pattern: ObjectPatternOverlay,
    jsx_code_block: JSXCodeBlock,
    jsx_for_expression: JSXForExpression,
    jsx_if_expression: JSXIfExpression,
    jsx_switch_expression: JSXSwitchExpression,
    jsx_try_expression: JSXTryExpression,
    style_sheet: StyleSheet,
    jsx_style_element: JSXStyleElement,
    tsrx_expression: TSRXExpression,
    // Appended only: the Record union is positional ABI (tags 185/186/187).
    css_rule: CssRule,
    css_atrule: CssAtrule,
    css_selector: CssSelector,
    jsx_script_element: JSXScriptElement,
};

pub const record_count: u8 = @typeInfo(Record).@"union".fields.len;

comptime {
    std.debug.assert(record_count == 17);
    std.debug.assert(@sizeOf(NodeRecord) <= 28);
    std.debug.assert(@sizeOf(ForOfOverlay) <= 28);
    std.debug.assert(@sizeOf(CatchClauseOverlay) <= 28);
    std.debug.assert(@sizeOf(ArrayPatternOverlay) <= 28);
    std.debug.assert(@sizeOf(ObjectPatternOverlay) <= 28);
    std.debug.assert(@sizeOf(JSXCodeBlock) <= 28);
    std.debug.assert(@sizeOf(JSXForExpression) <= 28);
    std.debug.assert(@sizeOf(JSXIfExpression) <= 28);
    std.debug.assert(@sizeOf(JSXSwitchExpression) <= 28);
    std.debug.assert(@sizeOf(JSXTryExpression) <= 28);
    std.debug.assert(@sizeOf(StyleSheet) <= 28);
    std.debug.assert(@sizeOf(JSXStyleElement) <= 28);
    std.debug.assert(@sizeOf(TSRXExpression) <= 28);
    std.debug.assert(@sizeOf(CssRule) <= 28);
    std.debug.assert(@sizeOf(CssAtrule) <= 28);
    std.debug.assert(@sizeOf(CssSelector) <= 28);
    std.debug.assert(@sizeOf(JSXScriptElement) <= 28);
}
