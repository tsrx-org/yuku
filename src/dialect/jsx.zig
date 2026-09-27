const std = @import("std");
const abi = @import("dialect_abi");

/// `@tsrx/core` 0.5.0's message for a dynamic tag expression that isn't an
/// identifier, a member access, or a string literal (code
/// `tsrx-dynamic-tag-expression`), and for a spread or empty dynamic tag.
pub const dynamic_tag_message = "A dynamic tag expression must be an identifier, a member access such as `props.as` or `registry[name]`, or a string literal. Compute anything else before the element: `const Tag = c ? Child : Fallback;`, then `<{Tag} />`.";

pub const dynamic_tag_placeholder_help = "Write the tag's expression between the braces; a spread or an empty '{}' is no expression.";

pub fn elementName(comptime Host: type, parser: anytype) Host.ErrorType!abi.Decision(?Host.NodeIndex) {
    if (Host.currentToken(parser) != .left_brace) return .unhandled;
    return .{ .handled = try Host.parseTagExpressionContainer(parser) };
}

/// Runs once per element, on the opening tag's name: a closing tag repeats
/// the expression, so it is not checked again. The check doesn't change the
/// parse; it reports the first part of the expression that isn't allowed.
pub fn validateElementName(comptime Host: type, parser: anytype, node: Host.NodeIndex) Host.ErrorType!abi.Decision(void) {
    const expression = switch (Host.data(parser, node)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    // A spread or an empty container is no expression at all: the container
    // parser stood a placeholder in for it. Core raises these as syntax
    // errors with no code; the help text is what keeps them apart from the
    // coded diagnostic below (see npm/yuku/index.js diagnosticCode).
    const container_span = Host.nodeSpan(parser, node);
    const inner = std.mem.trim(u8, Host.sourceText(parser, .{
        .start = container_span.start + 1,
        .end = @max(container_span.start + 1, container_span.end -| 1),
    }), " \t\r\n");
    if (inner.len == 0 or std.mem.startsWith(u8, inner, "...")) {
        const at = if (inner.len == 0) container_span.start + 1 else container_span.start;
        try Host.reportWithHelp(parser, .{ .start = at, .end = at }, dynamic_tag_message, dynamic_tag_placeholder_help);
        return .{ .handled = {} };
    }
    if (invalidPart(Host, parser, expression, 0)) |invalid| {
        try Host.report(parser, Host.nodeSpan(parser, invalid), dynamic_tag_message);
    }
    return .{ .handled = {} };
}

pub fn namesMatch(comptime Host: type, parser: anytype, left: Host.NodeIndex, right: Host.NodeIndex) abi.Decision(bool) {
    const left_expression = switch (Host.data(parser, left)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    const right_expression = switch (Host.data(parser, right)) {
        .jsx_expression_container => |data| data.expression,
        else => return .unhandled,
    };
    return .{ .handled = sameExpression(Host, parser, left_expression, right_expression) };
}

fn sameExpression(comptime Host: type, parser: anytype, left: Host.NodeIndex, right: Host.NodeIndex) bool {
    const left_span = Host.nodeSpan(parser, left);
    const right_span = Host.nodeSpan(parser, right);
    return std.mem.eql(
        u8,
        std.mem.trim(u8, Host.sourceText(parser, left_span), " \t\r\n"),
        std.mem.trim(u8, Host.sourceText(parser, right_span), " \t\r\n"),
    );
}

/// The part of a dynamic tag expression that isn't one of the allowed forms,
/// or null when the whole expression is one, as core's
/// `find_invalid_dynamic_tag_part`: an identifier other than `undefined`, a
/// string literal, or a member access whose chain starts at an identifier or
/// `this` and whose computed keys are identifiers, string or number literals,
/// or member accesses. Parentheses, type-only wrappers and optional chains are
/// reported, since the closing tag would have to repeat them.
fn invalidPart(comptime Host: type, parser: anytype, node: Host.NodeIndex, depth: u8) ?Host.NodeIndex {
    if (node == .null) return null;
    if (depth == 64) return node;
    return switch (Host.data(parser, node)) {
        .identifier_reference => |data| if (std.mem.eql(u8, Host.string(parser, data.name), "undefined")) node else null,
        .string_literal => null,
        .member_expression => |data| blk: {
            const invalid_object = switch (Host.data(parser, data.object)) {
                .identifier_reference, .member_expression => invalidPart(Host, parser, data.object, depth + 1),
                .this_expression => null,
                else => data.object,
            };
            if (invalid_object != null or !data.computed) break :blk invalid_object;
            break :blk switch (Host.data(parser, data.property)) {
                .identifier_reference, .string_literal, .numeric_literal => null,
                .member_expression => invalidPart(Host, parser, data.property, depth + 1),
                else => data.property,
            };
        },
        else => node,
    };
}
